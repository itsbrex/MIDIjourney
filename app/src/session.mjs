import {
	CONFIG,
	normalizeHistory,
	parseMidiClipResponse,
	redactSecrets,
} from "../.generated/midi-core.mjs";
import { captureReply } from "./copy-details.mjs";
import { createClip, isJweb } from "./jweb.mjs";
import { MAX_SOURCE_CLIPS, normalizeMidiInput } from "./midi-input.mjs";
export const SESSION_KEY = "midijourney:persistent-chat:v1";
export const LEGACY_KEY = "midijourney:persistent-workspace:v1";
const MAX_BYTES = 3_000_000;
const text = (value, limit = 1000) =>
	typeof value === "string" ? redactSecrets(value).slice(0, limit) : "";
const count = (value) =>
	Number.isSafeInteger(value) && value >= 0 ? value : null;
export function browserStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function normalizeCall(call) {
	return {
		id: count(call?.id) ?? 0,
		startedAt: text(call?.startedAt, 40),
		requestedModel: text(call?.requestedModel, 160) || null,
		model: text(call?.model, 160) || null,
		status: text(call?.status, 30),
		durationMs: count(call?.durationMs) ?? 0,
		messageCount: count(call?.messageCount) ?? 0,
		finishReason: text(call?.finishReason, 80) || null,
		...(call?.reply
			? {
					reply: {
						...captureReply(call.reply.text),
						status: text(call.reply.status, 100) || "not retained",
					},
				}
			: {}),
		usage: Object.fromEntries(
			["input", "output", "total", "cached", "reasoning"].map((key) => [
				key,
				count(call?.usage?.[key]),
			]),
		),
		...(call?.error
			? {
					error: {
						code: text(call.error.code, 80) || null,
						httpStatus: count(call.error.httpStatus),
					},
				}
			: {}),
		...(call?.output
			? {
					output: {
						validation: text(call.output.validation, 100),
						noteCount: count(call.output.noteCount) ?? undefined,
					},
				}
			: {}),
	};
}
export function normalizeChat(value) {
	const turns = [];
	for (const [index, raw] of (Array.isArray(value?.turns)
		? value.turns.slice(-30)
		: []
	).entries()) {
		if (!raw || typeof raw.prompt !== "string") continue;
		let result;
		try {
			if (raw.result) {
				result = parseMidiClipResponse(
					JSON.stringify({
						...raw.result,
						explanation: text(raw.result.explanation, 1000),
					}),
				);
				// The validated provider explanation can have an appended model label.
				result.explanation = text(raw.result.explanation, 1200);
				result.title = text(result.title, CONFIG.maxTitleLength);
				result.key = text(result.key, 40) || null;
			}
		} catch {
			/* Reject invalid saved MIDI. */
		}
		turns.push({
			id: text(raw.id, 80) || `restored-${index}`,
			prompt: text(raw.prompt, CONFIG.maxPromptLength),
			status: result ? "complete" : "failed",
			result,
			error: result
				? ""
				: text(raw.error) ||
					"This generation was interrupted. Send your message again.",
			basedOn: text(raw.basedOn, 240),
			sourceTarget: text(raw.sourceTarget, 120),
			input: normalizeMidiInput(raw.input),
			inputs: Array.isArray(raw.inputs)
				? raw.inputs
						.slice(0, MAX_SOURCE_CLIPS)
						.map(normalizeMidiInput)
						.filter(Boolean)
				: undefined,
			calls: (Array.isArray(raw.calls) ? raw.calls : [])
				.slice(-30)
				.map(normalizeCall),
			notice: text(raw.notice),
			writeError: text(raw.writeError),
		});
	}
	return {
		draft: text(value?.draft, CONFIG.maxPromptLength),
		turns,
		context: normalizeHistory(value?.context),
	};
}
export function loadChat(storage) {
	try {
		// Approved fresh start: only this prototype's old drawer, never SDK login,
		// theme storage, or the other versions' conversations.
		storage?.removeItem(LEGACY_KEY);
		const raw = storage?.getItem(SESSION_KEY);
		return normalizeChat(
			raw && raw.length <= MAX_BYTES ? JSON.parse(raw) : null,
		);
	} catch {
		return normalizeChat(null);
	}
}
export function saveChat(storage, value) {
	try {
		const bounded = normalizeChat(value);
		let serialized = JSON.stringify(bounded);
		while (serialized.length > MAX_BYTES && bounded.turns.length > 1) {
			bounded.turns.shift();
			serialized = JSON.stringify(bounded);
		}
		if (serialized.length > MAX_BYTES || !storage) return false;
		storage.setItem(SESSION_KEY, serialized);
		return true;
	} catch {
		return false;
	}
}
export function liveMessageHandler(host) {
	return isJweb(host) ? (message) => host.max.outlet(message) : null;
}
export function sendClipToLive(host, result, target) {
	return createClip(host, result, target);
}
