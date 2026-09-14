// Retain a bounded rejection reason in local call diagnostics, never a raw
// error/details object, request headers, credentials, or the submitted messages.
export function providerErrorDetails(error, client, messages) {
	const identifier = (value) =>
		typeof value === "string" &&
		/^[a-z0-9_.:-]{1,128}$/i.test(value) &&
		!/(?:pk_|sk_)/i.test(value)
			? value
			: null;
	const details = {
		code: identifier(error?.code),
		httpStatus: Number.isInteger(error?.status) ? error.status : null,
		requestId: identifier(error?.requestId),
	};
	// These are the rejections whose generic SDK classification used to hide
	// whether the agent, endpoint, or a request parameter was the problem.
	if (![400, 404].includes(error?.status)) return details;
	let reason = error?.message;
	if (typeof reason !== "string" || reason.length > 32_000) return details;
	if (typeof client?.apiKey === "string" && client.apiKey)
		reason = reason.replaceAll(client.apiKey, "[credential omitted]");
	for (const message of Array.isArray(messages) ? messages : []) {
		if (typeof message?.content === "string" && message.content)
			reason = reason.replaceAll(message.content, "[message omitted]");
	}
	details.message = reason
		.replace(/(?:pk_|sk_)[a-z0-9_-]+/gi, "[credential omitted]")
		.replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [credential omitted]")
		.replace(
			/eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi,
			"[credential omitted]",
		)
		.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL omitted]")
		.replace(/\p{Cc}/gu, " ")
		.slice(0, 1000);
	return details;
}
