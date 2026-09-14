import { bridge, isJweb } from "./jweb.mjs";

// Physical keys survive macOS Option producing a different character in `key`.
// Do not steal Ctrl/Cmd shortcuts, AltGr text entry or IME composition.
export function promptClipboardAction(event) {
	if (
		event.defaultPrevented ||
		event.isComposing ||
		!event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.getModifierState?.("AltGraph")
	)
		return null;
	return event.code === "KeyC"
		? "copy"
		: event.code === "KeyV"
			? "paste"
			: null;
}

export async function readPromptClipboard(host) {
	return isJweb(host)
		? (await bridge(host)("clipboard_read")).text
		: host.navigator.clipboard.readText();
}
export async function writePromptClipboard(host, text) {
	if (isJweb(host))
		await bridge(host)("clipboard_write", JSON.stringify({ text }));
	else await host.navigator.clipboard.writeText(text);
}

export async function writeResponseClipboard(host, text) {
	if (typeof text !== "string" || text.length > 4_000_000)
		throw Object.assign(new Error("Response is too large to copy."), {
			code: "CLIPBOARD_TOO_LARGE",
		});
	if (isJweb(host))
		await bridge(host)("clipboard_response_write", JSON.stringify({ text }));
	else await host.navigator.clipboard.writeText(text);
}

export function responseCopyError(error) {
	if (error?.code === "CLIPBOARD_CONNECTOR_TIMEOUT")
		return "Live did not acknowledge the copy. Reload the updated MIDI Journey device and try again.";
	if (error?.code === "CLIPBOARD_TOO_LARGE")
		return "This response exceeds the copy size limit.";
	return "Could not copy the response to the system clipboard. Please try again.";
}

export function copyPromptText(input) {
	const { value, selectionStart: start, selectionEnd: end } = input;
	return start !== end ? value.slice(start, end) : value;
}

export function insertClipboardText(value, start, end, text, limit = 12000) {
	if (typeof text !== "string" || !text.length) return null;
	const normalized = text.replace(/\r\n?/g, "\n");
	const next = value.slice(0, start) + normalized + value.slice(end);
	if (next.length > limit)
		throw new Error("Paste would exceed the 12,000-character prompt limit.");
	return { value: next, cursor: start + normalized.length };
}

// Bound a permission prompt that the embedded host might never answer.
export async function clipboardOperation(operation, timeoutMs = 10000) {
	let timer;
	try {
		return await Promise.race([
			operation(),
			new Promise((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Clipboard unavailable")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
