import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Pollinations } from "@pollinations/sdk";
import { PollinationsMidiClient } from "../.generated/midi-core.mjs";
import { observeChat } from "../src/call-log.mjs";
import { createChatSession } from "../src/chat-session.mjs";
import { copyDetails } from "../src/copy-details.mjs";
import { pianoRoll } from "../src/piano-roll.mjs";
import { normalizeChat } from "../src/session.mjs";

const require = createRequire(import.meta.url);
const SYSTEM_PROMPT = require("../../core/systemPrompt.js");
const agentFixtures = require("../../core/test/fixtures/agent-responses.json");
const AGENT = "community/pollinations-router/midijourney";
const clip = {
	title: "Agent phrase",
	explanation: "A short musical variation.",
	key: "C major",
	duration: 8,
	notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 90 }],
};
const response = {
	model: "openai/gpt-6-astra",
	choices: [
		{ message: { content: JSON.stringify(clip) }, finish_reason: "stop" },
	],
	usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

test("the real chat session and SDK send the agent ID, fresh MIDI, and output contract", async (t) => {
	const requests = [];
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(new URL(url).pathname, "/v1/chat/completions");
		const body = JSON.parse(init.body);
		requests.push(body);
		// Reproduce the managed agent's actual rejection, not a permissive mock.
		if (Object.hasOwn(body, "response_format")) {
			return Response.json(
				{
					error: {
						code: "BAD_REQUEST",
						message:
							"Structured text output is not supported by managed agents",
					},
				},
				{ status: 400 },
			);
		}
		return Response.json(response);
	});
	const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
	let callId = 0;
	const session = createChatSession({
		initial: normalizeChat(null),
		save: () => true,
		readContext: async () => ({
			connected: true,
			target: "10:20:30:20",
			sourceId: "30",
			source: clip,
		}),
		writeClip: async () => assert.fail("Generation must not write to Live"),
		createGenerator: (onEntry) =>
			new PollinationsMidiClient({
				auth: {
					requireClient: () => observeChat(client, onEntry, () => ++callId),
				},
			}),
	});
	t.after(() => session.dispose());
	session.setDraft("Use GPT Astra model please");
	await session.generate();
	assert.equal(requests.length, 1);
	const body = requests[0];
	assert.equal(body.model, AGENT);
	assert.equal(body.stream, false);
	assert.equal(session.getSnapshot().turns.at(-1).status, "complete");
	assert.equal(Object.hasOwn(body, "response_format"), false);
	assert.equal(body.messages[0].content, SYSTEM_PROMPT);
	assert.match(body.messages[0].content, /pitch,time,duration,velocity/);
	const input = JSON.parse(body.messages.at(-1).content);
	assert.equal(input.instruction, "Use GPT Astra model please");
	assert.deepEqual(input.sourceClip.notes, clip.notes);
	const turn = session.getSnapshot().turns.at(-1);
	assert.equal(turn.status, "complete");
	assert.equal(turn.calls[0].requestedModel, AGENT);
	assert.equal(turn.calls[0].model, response.model);
	const details = JSON.parse(copyDetails(turn));
	assert.equal(details.calls[0].requestedModel, AGENT);
	assert.equal(details.calls[0].reportedModel, response.model);
	assert.equal(details.calls[0].tokens.total, 150);
});

test("an SDK retry stays on the agent and never falls back to a direct model", async (t) => {
	const models = [];
	t.mock.method(globalThis, "fetch", async (_url, init) => {
		const body = JSON.parse(init.body);
		assert.equal(Object.hasOwn(body, "response_format"), false);
		models.push(body.model);
		return models.length === 1
			? Response.json(
					{ error: { message: "Temporarily unavailable" } },
					{ status: 503 },
				)
			: Response.json(response);
	});
	const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
	const generator = new PollinationsMidiClient({
		auth: { requireClient: () => client },
	});
	const result = await generator.generate({
		promptText: "A short phrase",
		model: "openai",
	});
	assert.deepEqual(models, [AGENT, AGENT]);
	assert.equal(result.title, clip.title);
});

test("native agent YAML/CSV works through the SDK, chat, preview, storage, and copy details", async (t) => {
	let requests = 0;
	let saved = null;
	const replies = [
		agentFixtures.native,
		agentFixtures.nativeDespiteJsonRequest,
		agentFixtures.updatedApp,
	];
	t.mock.method(globalThis, "fetch", async (_url, init) => {
		const body = JSON.parse(init.body);
		assert.equal(body.model, AGENT);
		assert.equal(Object.hasOwn(body, "response_format"), false);
		assert.equal(body.messages[0].content, SYSTEM_PROMPT);
		if (requests > 0) {
			// A native reply becomes validated context for the next request.
			const previous = body.messages.find(
				(message) => message.role === "assistant",
			);
			assert.equal(JSON.parse(previous.content).notes.length, 8);
		}
		return Response.json({
			...response,
			choices: [
				{ message: { content: replies[requests++] }, finish_reason: "stop" },
			],
		});
	});
	const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
	let callId = 0;
	const session = createChatSession({
		initial: normalizeChat(null),
		save: (state) => {
			saved = state;
			return true;
		},
		readContext: async () => ({ connected: true, target: "10:20:30:20" }),
		writeClip: async () => assert.fail("Generation must not write to Live"),
		createGenerator: (onEntry) =>
			new PollinationsMidiClient({
				auth: {
					requireClient: () => observeChat(client, onEntry, () => ++callId),
				},
			}),
	});
	t.after(() => session.dispose());
	for (const [index, original] of replies.entries()) {
		session.setDraft(index === 0 ? "A gentle melody" : "Make a variation");
		await session.generate();
		const turn = session.getSnapshot().turns.at(-1);
		assert.equal(turn.status, "complete");
		assert.equal(turn.result.notes.length, 8);
		assert.equal(turn.result.duration, 8);
		const roll = pianoRoll(turn.result.notes, turn.result.duration);
		assert.equal(roll.notes.length, 8);
		assert.ok(
			roll.notes.every(
				(note) =>
					Number.isFinite(note.x) && Number.isFinite(note.y) && note.width > 0,
			),
		);
		if (original === agentFixtures.updatedApp) {
			assert.match(turn.result.explanation, /A rising piano phrase/);
		}
		assert.equal(turn.calls[0].output.validation, "Valid MIDI");
		assert.equal(turn.calls[0].output.noteCount, 8);
		assert.equal(turn.calls[0].model, response.model);
		const details = JSON.parse(copyDetails(turn));
		assert.equal(details.calls[0].response.text, original);
		assert.equal(details.calls[0].tokens.total, 150);
		const restored = normalizeChat(saved).turns.at(-1);
		assert.deepEqual(restored.result.notes, turn.result.notes);
		assert.equal(
			JSON.parse(copyDetails(restored)).calls[0].response.text,
			original,
		);
	}
	assert.equal(requests, replies.length);
});

test("agent text responses still require valid MIDI and never trigger a model fallback", async (t) => {
	let requests = 0;
	for (const content of [
		"Here is a nice melody",
		agentFixtures.native.replace("60,0,1,60", "60,0,1,seventy"),
		JSON.stringify({
			...clip,
			notes: [{ pitch: 128, start_time: 0, duration: 1, velocity: 90 }],
		}),
	]) {
		t.mock.method(globalThis, "fetch", async (_url, init) => {
			const body = JSON.parse(init.body);
			assert.equal(body.model, AGENT);
			assert.equal(Object.hasOwn(body, "response_format"), false);
			requests += 1;
			return Response.json({
				...response,
				choices: [{ message: { content }, finish_reason: "stop" }],
			});
		});
		const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
		const generator = new PollinationsMidiClient({
			auth: { requireClient: () => client },
		});
		await assert.rejects(generator.generate({ promptText: "A short phrase" }), {
			code: "INVALID_MIDI_RESPONSE",
		});
		t.mock.restoreAll();
	}
	assert.equal(requests, 3);
});
