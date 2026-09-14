const test = require("node:test");
const assert = require("node:assert/strict");
const { CONFIG } = require("../config.js");
const {
	parseMidiClipResponse,
	MidiValidationError,
} = require("../encoding/midiClip.js");
const fixtures = require("./fixtures/agent-responses.json");

const yaml = (rows, metadata = "title: Test\nduration: 8") =>
	`${metadata}\nnotation: |-\n  pitch,time,duration,velocity\n${rows.map((row) => `  ${row}`).join("\n")}`;
const row = "60,0,1,70";
const rejects = (text) =>
	assert.throws(() => parseMidiClipResponse(text), MidiValidationError);

test("accepts both actual managed-agent YAML/CSV replies with all notes intact", () => {
	for (const text of [fixtures.native, fixtures.nativeDespiteJsonRequest]) {
		const clip = parseMidiClipResponse(text);
		assert.equal(clip.notes.length, 8);
		assert.equal(clip.duration, 8);
		assert.equal(clip.key, "C major");
		assert.equal(clip.explanation, "");
		const expected = text
			.split("pitch,time,duration,velocity\n")[1]
			.split("\n")
			.map((line) => {
				const [pitch, start_time, duration, velocity] = line
					.trim()
					.split(",")
					.map(Number);
				return { pitch, start_time, duration, velocity, mute: 0 };
			});
		assert.deepEqual(clip.notes, expected);
	}
});

test("accepts one whole YAML fence, CRLF, and a folded explanation", () => {
	const text = yaml(
		[row],
		'title: "A: bright melody"\nduration: 8\nkey: null\nexplanation: >-\n  A little melody\n  with a soft ending.',
	);
	for (const fence of ["yaml", "yml", ""]) {
		const clip = parseMidiClipResponse(
			`\uFEFF\`\`\`${fence}\n${text}\n\`\`\``.replaceAll("\n", "\r\n"),
		);
		assert.equal(clip.title, "A: bright melody");
		assert.equal(clip.explanation, "A little melody with a soft ending.");
		assert.equal(clip.key, null);
	}
});

test("derives omitted native duration from the last note and preserves MIDI boundaries", () => {
	const clip = parseMidiClipResponse(
		yaml(["127,2.5,1.5,1", "0,0,0.5,127"], "title: Boundaries"),
	);
	assert.equal(clip.duration, 4);
	assert.deepEqual(
		clip.notes.map((n) => [n.pitch, n.velocity]),
		[
			[0, 127],
			[127, 1],
		],
	);
});

test("accepts decimal/scientific CSV numbers but does not invent missing values", () => {
	const clip = parseMidiClipResponse(yaml(["60, .5, 5e-1, 7e1"]));
	assert.equal(clip.notes[0].start_time, 0.5);
	assert.equal(clip.notes[0].duration, 0.5);
	assert.equal(clip.notes[0].velocity, 70);
	for (const invalid of [
		"",
		"seventy",
		"NaN",
		"Infinity",
		"null",
		"false",
		"0x46",
		'"70"',
		"1e999",
	])
		rejects(yaml([`60,0,1,${invalid}`]));
});

test("rejects a whole response when any CSV row or header is malformed", () => {
	for (const invalid of [
		"60,0,1",
		"60,0,1,70,extra",
		"...",
		"pitch,time,duration,velocity",
	])
		rejects(yaml([row, invalid, row]));
	rejects(
		yaml([row]).replace(
			"pitch,time,duration,velocity",
			"time,pitch,duration,velocity",
		),
	);
	rejects(yaml([row]).replace("pitch,time,duration,velocity\n", ""));
	rejects(yaml([]));
});

test("native notes retain strict range checks with no clamping or dropped notes", () => {
	for (const invalid of [
		"128,0,1,70",
		"60,-1,1,70",
		"60,0,0,70",
		"60,0,1,0",
		"60,0,1,128",
		"60,0,1,70.5",
		"60.5,0,1,70",
		"60,4095.5,1,70",
	])
		rejects(yaml([row, invalid]));
	rejects(yaml([row], 'title: Test\nduration: "8"'));
	rejects(yaml([row], "title: Test\nduration: .inf"));
});

test("rejects ambiguous, nested, tagged, aliased, or multi-document YAML", () => {
	for (const extra of [
		"title: Duplicate",
		"notes: []",
		"__proto__: polluted",
		"unknown: true",
		"key: [C, major]",
		"explanation: {nested: true}",
		"key: !!timestamp 2026-09-14",
		"key: !custom C",
		"explanation: &x hello\nkey: *x",
		"explanation: *missing",
		"<<: {title: Other}",
	])
		rejects(yaml([row], `title: Test\nduration: 8\n${extra}`));
	rejects(`${yaml([row])}\n---\n${yaml([row])}`);
	rejects(`Here is your music:\n${yaml([row])}`);
	rejects(`\`\`\`yaml\n${yaml([row])}\n\`\`\`\nExtra commentary`);
});

test("bounds native response size and note count without truncating", () => {
	assert.equal(
		parseMidiClipResponse(yaml(Array(CONFIG.maxOutputNotes).fill(row))).notes
			.length,
		CONFIG.maxOutputNotes,
	);
	rejects(yaml(Array(CONFIG.maxOutputNotes + 1).fill(row)));
	rejects(`${yaml([row])}\n#${"x".repeat(512_000)}`);
});

test("retains valid JSON compatibility and rejects number words in JSON", () => {
	const json =
		'{"title":"Morning Light","explanation":"A melody.","key":"C major","duration":8,"notes":[{"pitch":64,"start_time":0,"duration":0.68,"velocity":70}]}';
	assert.equal(parseMidiClipResponse(json).notes[0].velocity, 70);
	rejects(json.replace('"velocity":70', '"velocity":seventy'));
	rejects(json.replace('"velocity":70', '"velocity":"seventy"'));
});
