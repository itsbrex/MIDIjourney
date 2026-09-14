import assert from "node:assert/strict";
import test from "node:test";
import { createClipboardHandler } from "../../device/clipboard.mjs";
import { makeDevice } from "../../scripts/device.mjs";
import {
  readPromptClipboard,
  writePromptClipboard,
  writeResponseClipboard,
} from "../src/prompt-clipboard.mjs";

test("explicit Max clipboard messages round-trip through the handler, without shell or clipboard polling", async () => {
	let receiver,
		stored = "fixture",
		stdin,
		commands = [];
	const handler = createClipboardHandler({
		platform: "darwin",
		run(file, args, options, done) {
			commands.push(file);
			assert.deepEqual(
				args,
				file.endsWith("pbpaste") ? ["-Prefer", "txt"] : [],
			);
			assert.equal(options.shell, false);
			assert.equal(options.timeout, 5000);
			assert.ok(options.maxBuffer <= 128000);
			queueMicrotask(() => done(null, file.endsWith("pbpaste") ? stored : ""));
			return {
				stdin: {
					on() {},
					end(value) {
						stdin = value;
						if (file.endsWith("pbcopy")) stored = value;
					},
				},
			};
		},
		reply(id, value) {
			receiver(id, JSON.stringify(value));
		},
	});
	const host = {
		max: {
			bindInlet(_name, callback) {
				receiver = callback;
			},
			outlet(action, id, raw) {
        void handler(action === "clipboard_read" ? "read" : action === "clipboard_response_write" ? "response" : "write", id, raw);
			},
		},
	};
	assert.deepEqual(commands, []);
	await writePromptClipboard(host, 'notes\n"🎹" $(literal)');
	assert.equal(stdin, 'notes\n"🎹" $(literal)');
	assert.equal(await readPromptClipboard(host), 'notes\n"🎹" $(literal)');
  assert.deepEqual(commands, ["/usr/bin/pbcopy", "/usr/bin/pbpaste"]);
  const response = JSON.stringify({notes: Array.from({length: 2048}, (_, i) => ({pitch: i % 128, duration: 0.5}))});
  await writeResponseClipboard(host, response);
  assert.equal(stored, response, "A response larger than a prompt is copied exactly, never truncated");
  await assert.rejects(writeResponseClipboard(host, "x".repeat(4_000_001)), /too large/);
});

test("native clipboard rejects invalid requests and sanitizes errors", async () => {
	let executions = 0,
		responses = [];
	const handler = createClipboardHandler({
		platform: "darwin",
		run() {
			executions++;
			throw new Error("private details");
		},
		reply: (_id, result) => responses.push(result),
	});
	await handler("read", "invalid id");
	assert.equal(responses.length, 0);
	await handler("arbitrary", "test-1");
  await handler("write", "test-2", JSON.stringify({ text: "a".repeat(12001) }));
  await handler("response", "test-large", JSON.stringify({ text: "a".repeat(4_000_001) }));
	assert.equal(executions, 0);
	await handler("read", "test-3");
	assert.equal(executions, 1);
	assert.ok(responses.every((response) => !response.ok));
	assert.doesNotMatch(JSON.stringify(responses), /private details/);
});

test("native responses are routed back to jweb, not the page navigation inlet", () => {
	const { patcher } = makeDevice("/tmp/midijourney-clipboard-fixture");
	const boxes = new Map(patcher.boxes.map(({ box }) => [box.id, box]));
	assert.equal(boxes.get("route").text, "route uiurl clipboard_response panel");
	assert.equal(boxes.get("clipboard-response").text, "prepend response");
	assert.ok(
		patcher.lines.some(
			({ patchline: l }) =>
				l.source[0] === "route" &&
				l.source[1] === 1 &&
				l.destination[0] === "clipboard-response",
		),
	);
	assert.ok(
		patcher.lines.some(
			({ patchline: l }) =>
				l.source[0] === "clipboard-response" && l.destination[0] === "window",
		),
	);
});
