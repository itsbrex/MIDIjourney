// Presentation only: keep the stored response and Copy Details payload intact.
export function clipCreationUnavailable(live) {
	if (live.checking) return "Checking Live…";
	if (live.connected) return undefined;
	if (!live.error || live.error.startsWith("Select "))
		return "Please select a clip.";
	return live.error;
}

// Hide attribution appended by older builds without rewriting saved responses.
export function replyPresentation(turn) {
	const explanation = turn.result?.explanation || "";
	const attribution = explanation.match(/\n\nModel: ([^\r\n]+)$/);
	const lastResponse = (turn.calls || []).findLast(
		(call) => call.status === "Received",
	);
	const previousModel =
		typeof lastResponse?.model === "string"
			? lastResponse.model.replace(/\s+/g, " ").trim()
			: "";
	const attributionOnly =
		explanation === `Model: ${previousModel}` ||
		/^Model: (?:not reported|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(
			explanation,
		);
	return {
		explanation: attributionOnly
			? ""
			: attribution
				? explanation.slice(0, attribution.index)
				: explanation,
	};
}
