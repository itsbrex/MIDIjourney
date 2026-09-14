import { bridge, isJweb } from "./jweb.mjs";

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
		throw new Error("Response is too large to copy.");
	if (isJweb(host))
		await bridge(host)("clipboard_response_write", JSON.stringify({ text }));
	else await host.navigator.clipboard.writeText(text);
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
