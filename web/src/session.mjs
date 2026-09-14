import {
	CONFIG,
	normalizeHistory,
	redactSecrets,
} from "../.generated/midi-core.mjs";

export const SESSION_KEY = "midijourney:workspace:v1";
const MAX_BYTES = 3_000_000;

export function browserStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function normalizeWorkspace(value) {
	return {
		prompt:
			typeof value?.prompt === "string"
				? redactSecrets(value.prompt).slice(0, CONFIG.maxPromptLength)
				: "",
		duration:
			Number.isFinite(value?.duration) &&
			value.duration > 0 &&
			value.duration <= CONFIG.maxClipBeats
				? value.duration
				: 8,
		history: normalizeHistory(value?.history),
	};
}

export function loadWorkspace(storage) {
	try {
		const raw = storage.getItem(SESSION_KEY);
		if (!raw || raw.length > MAX_BYTES) return normalizeWorkspace(null);
		return normalizeWorkspace(JSON.parse(raw));
	} catch {
		return normalizeWorkspace(null);
	}
}

export function saveWorkspace(storage, value) {
	try {
		const bounded = normalizeWorkspace(value);
		// Retain the newest complete exchanges when browser storage is limited.
		let serialized = JSON.stringify(bounded);
		while (serialized.length > MAX_BYTES && bounded.history.length > 2) {
			bounded.history = bounded.history.slice(2);
			serialized = JSON.stringify(bounded);
		}
		storage.setItem(SESSION_KEY, serialized);
		return true;
	} catch {
		return false;
	}
}

export function liveMessageHandler(host) {
	const webkit = host?.webkit?.messageHandlers?.live;
	const webview = host?.chrome?.webview;
	if (typeof webkit?.postMessage === "function")
		return (message) => webkit.postMessage(message);
	if (typeof webview?.postMessage === "function")
		return (message) => webview.postMessage(message);
	return null;
}

export function sendClipToLive(host, result) {
	const send = liveMessageHandler(host);
	if (!send)
		throw new Error(
			"Open MIDIjourney from Live’s Extensions menu to create a clip.",
		);
	// Neither history nor credentials cross the SDK's UI bridge.
	const clip = {
		title: result.title,
		explanation: "",
		key: result.key,
		duration: result.duration,
		notes: result.notes.map(({ pitch, start_time, duration, velocity }) => ({
			pitch,
			start_time,
			duration,
			velocity,
		})),
	};
	send({
		method: "close_and_send",
		params: [JSON.stringify({ action: "create", clip })],
	});
}
