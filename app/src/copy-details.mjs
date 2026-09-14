import { redactSecrets } from "../.generated/midi-core.mjs";

export const MAX_REPLY_CHARS = 512_000;

// Keep the actual message, not a reconstruction of normalized MIDI. No headers,
// auth state, request bodies, or arbitrary response fields are retained.
export function captureReply(value) {
	if (typeof value !== "string") return { text: null, status: "not retained" };
	if (value.length > MAX_REPLY_CHARS)
		return { text: null, status: "too large to retain" };
	const text = redactSecrets(value);
	return {
		text,
		status: text === value ? "original" : "credential-like text redacted",
	};
}

export function copyDetails({ calls, result, basedOn }) {
	return redactSecrets(
		JSON.stringify(
			{
				basedOn: basedOn || null,
				calls: calls.map((call) => ({
					startedAt: call.startedAt,
					status: call.status,
					durationMs: call.durationMs,
					requestedModel: call.requestedModel,
					reportedModel: call.model,
					finishReason: call.finishReason,
					messageCount: call.messageCount,
					tokens: call.usage,
					error: call.error,
					response: call.reply || {
						text: null,
						status: "not retained for this older reply",
					},
				})),
				midi: result
					? {
							title: result.title,
							explanation: result.explanation,
							key: result.key,
							duration: result.duration,
							noteCount: result.notes.length,
							notes: result.notes,
						}
					: null,
			},
			null,
			2,
		),
	);
}
