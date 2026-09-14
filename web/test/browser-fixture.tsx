// Test-only entry, excluded from the production Vite build. The actual App,
// Pollinations UI, provider, account hooks and MIDI client run unchanged.

import { PolliProvider } from "@pollinations/sdk/react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import "../src/style.css";

const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
	const url = new URL(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
		location.href,
	);
	let fixture: unknown;
	if (url.origin === "https://enter.pollinations.ai")
		fixture = {
			name: "Test musician",
			githubUsername: "fixture-user",
			image: null,
			tier: "spore",
			nextResetAt: null,
			balance: 5,
		};
	if (url.origin === "https://gen.pollinations.ai")
		fixture = {
			model: "fixture-serving-model",
			usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
			choices: [
				{
					finish_reason: "stop",
					message: {
						content: JSON.stringify({
							title: "Test melody",
							explanation: "A small phrase for verification.",
							key: "C major",
							duration: 8,
							notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 90 }],
						}),
					},
				},
			],
		};
	if (url.pathname.endsWith("/api/context"))
		fixture =
			new URLSearchParams(location.search).get("layout") === "live"
				? {
						connected: true,
						destination: "1-MIDI · empty slot 2",
						source: {
							title: "Question & Answer Piano",
							duration: 8,
							notes: [],
						},
					}
				: { connected: false };
	return fixture
		? Promise.resolve(
				new Response(JSON.stringify(fixture), {
					headers: { "Content-Type": "application/json" },
				}),
			)
		: originalFetch(input, options);
};
const root = document.getElementById("root");
if (!root) throw new Error("Test root missing");
createRoot(root).render(
	<PolliProvider
		appKey="pk_fixture_application"
		storage={{
			getItem: (key) => (key.endsWith(":token") ? "not-a-real-user-key" : null),
			setItem: () => {},
			removeItem: () => {},
		}}
	>
		<App />
	</PolliProvider>,
);
