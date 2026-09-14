import { liveMessageHandler } from "./session.mjs";

export function fragmentValue(hash, name) {
	const value = new URLSearchParams(hash.slice(1)).get(name);
	return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function liveAuthCapability(host) {
	return liveMessageHandler(host)
		? fragmentValue(host.location.hash, "live-session")
		: null;
}

/** @param {string} action
 * @param {string} capability
 * @param {{method?: string, apiKey?: string, signal?: AbortSignal}} options */
export async function authRequest(
	action,
	capability,
	{ method = "POST", apiKey, signal } = {},
) {
	const response = await fetch(`/api/auth/${action}`, {
		method,
		signal,
		cache: "no-store",
		credentials: "omit",
		headers: {
			Authorization: `Bearer ${capability}`,
			...(method === "POST" ? { "Content-Type": "application/json" } : {}),
		},
		...(method === "POST"
			? { body: JSON.stringify(apiKey ? { apiKey } : {}) }
			: {}),
	});
	if (!response.ok)
		throw new Error(
			response.status === 403
				? "This connection expired. Click Connect again in Live."
				: "Could not connect. Keep Live open and try again.",
		);
	return response.json();
}

export function pause(signal, milliseconds = 1000) {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("Canceled"));
			return;
		}
		const abort = () => {
			clearTimeout(timer);
			reject(new Error("Canceled"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", abort, { once: true });
	});
}
