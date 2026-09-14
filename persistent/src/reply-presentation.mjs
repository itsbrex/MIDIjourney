// Presentation only: keep the stored response and Copy Details payload intact.
export function clipCreationUnavailable(live) {
	if (live.checking) return "Checking Live…";
	if (live.connected) return undefined;
	if (!live.error || live.error.startsWith("Select "))
		return "Please select a clip.";
	return live.error;
}

// The shared MIDI client appends this final attribution paragraph itself.
export function replyPresentation(turn) {
	const explanation = turn.result?.explanation || "";
	const attribution = explanation.match(/\n\nModel: ([^\r\n]+)$/);
	const lastResponse = (turn.calls || []).findLast(
		(call) => call.status === "Received",
	);
	return {
		explanation: attribution
			? explanation.slice(0, attribution.index)
			: explanation,
		// A missing model on the final response must not inherit an earlier attempt's model.
		model: lastResponse
			? lastResponse.model || "not reported"
			: attribution?.[1] || "not reported",
	};
}
