import assert from "node:assert/strict";
import test from "node:test";
import {
	clipboardOperation,
	copyPromptText,
	insertClipboardText,
	promptClipboardAction,
	responseCopyError,
} from "../src/prompt-clipboard.mjs";

test("Option clipboard shortcuts use physical keys, without stealing standard shortcuts or text composition", () => {
	const event = { altKey: true, code: "KeyC", key: "ç" };
	assert.equal(promptClipboardAction(event), "copy");
	assert.equal(
		promptClipboardAction({ ...event, code: "KeyV", key: "√" }),
		"paste",
	);
	// Repeat events still identify the shortcut so the listener can consume it,
	// but it must not start another clipboard operation.
	assert.equal(promptClipboardAction({ ...event, repeat: true }), "copy");
	for (const extra of [
		{ altKey: false },
		{ ctrlKey: true },
		{ metaKey: true },
		{ shiftKey: true },
		{ isComposing: true },
		{ defaultPrevented: true },
		{ code: "KeyX" },
		{ code: "", key: "c" },
		{ getModifierState: (key) => key === "AltGraph" },
	])
		assert.equal(promptClipboardAction({ ...event, ...extra }), null);
});

test("copy uses selection or whole prompt without modifying it", () => {
	const input = { value: "soft piano", selectionStart: 5, selectionEnd: 10 };
	assert.equal(copyPromptText(input), "piano");
	assert.equal(copyPromptText({ ...input, selectionStart: 10 }), "soft piano");
	assert.equal(input.value, "soft piano");
});

test("response copy distinguishes a missing native acknowledgement without exposing raw failures", () => {
	assert.match(
		responseCopyError({ code: "CLIPBOARD_CONNECTOR_TIMEOUT" }),
		/Reload the updated MIDI Journey device/,
	);
	assert.match(
		responseCopyError({ code: "CLIPBOARD_TOO_LARGE" }),
		/size limit/,
	);
	assert.doesNotMatch(
		responseCopyError(new Error("private system error")),
		/private system error/,
	);
});
test("paste inserts at cursor, replaces selection, and preserves literal multiline text", () => {
	assert.deepEqual(
		insertClipboardText("soft piano", 5, 10, "bass\r\n<groove>"),
		{ value: "soft bass\n<groove>", cursor: 18 },
	);
	assert.deepEqual(insertClipboardText("AB", 1, 1, "🎹"), {
		value: "A🎹B",
		cursor: 3,
	});
	assert.deepEqual(insertClipboardText("ABC", 0, 3, "x"), {
		value: "x",
		cursor: 1,
	});
	assert.equal(insertClipboardText("ABC", 0, 3, ""), null);
});
test("oversize paste is rejected instead of truncating or erasing the prompt", () => {
	assert.throws(() => insertClipboardText("ABC", 1, 2, "xxxxx", 4), /limit/);
	assert.deepEqual(insertClipboardText("ABC", 0, 3, "1234", 4), {
		value: "1234",
		cursor: 4,
	});
});
test("clipboard operations propagate success/failure and bound a hung host permission request", async () => {
	assert.equal(await clipboardOperation(async () => "test"), "test");
	await assert.rejects(
		clipboardOperation(() => {
			throw new Error("denied");
		}),
		/denied/,
	);
	await assert.rejects(
		clipboardOperation(() => new Promise(() => {}), 5),
		/unavailable/,
	);
});
