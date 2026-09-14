// Test-only entry. Real App, SDK provider, generation client and Max transport;
// fake network and fake Live. No paid calls or real credentials leave this page.
import { PolliProvider } from "@pollinations/sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/App";
import "../src/style.css";

function requiredElement(id: string) {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing fixture element: ${id}`);
	return element;
}

let destination = 1,
	writes = 0,
	generation = 0;
let receive: (id: string, raw: string) => void;
const host = window as unknown as {
	max: {
		bindInlet: (name: string, callback: typeof receive) => void;
		outlet: (...values: string[]) => void;
	};
};
host.max = {
	bindInlet: (_name, callback) => {
		receive = callback;
	},
	outlet: (action, id, raw) => {
		if (action === "context")
			queueMicrotask(() =>
				receive(
					id,
					JSON.stringify({
						ok: true,
						context: {
							connected: true,
							target: `track-${destination}`,
							destination: `MIDI ${destination} · empty slot 1`,
							source: null,
						},
					}),
				),
			);
		if (action === "create") {
			const request = JSON.parse(raw);
			const ok = request.target === `track-${destination}`;
			if (ok) {
				writes++;
				requiredElement("test-writes").textContent =
					`Writes: ${writes} · ${request.clip.title}`;
			}
			queueMicrotask(() =>
				receive(
					id,
					JSON.stringify(
						ok
							? {
									ok: true,
									noteCount: request.clip.notes.length,
									destination: `MIDI ${destination} · empty slot 1`,
								}
							: { ok: false, error: "Selection changed" },
					),
				),
			);
		}
	},
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
	const url = new URL(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
		location.href,
	);
	if (url.origin === location.origin) return originalFetch(input, options);
	let payload: unknown;
	if (url.origin === "https://enter.pollinations.ai")
		payload = {
			name: "Test musician",
			githubUsername: "fixture-user",
			image: null,
			tier: "spore",
			nextResetAt: null,
			balance: 5,
		};
	else if (url.origin === "https://gen.pollinations.ai") {
		const request = JSON.parse(String(options?.body || "{}"));
		requiredElement("test-context").textContent =
			`Request messages: ${request.messages?.length || 0}`;
		const n = ++generation;
		if ((document.getElementById("test-delay") as HTMLInputElement).checked)
			await new Promise((resolve) => setTimeout(resolve, 3500));
		if ((document.getElementById("test-fail") as HTMLInputElement).checked)
			return new Response(
				JSON.stringify({
					error: { message: "Fixture rejected", code: "BAD_REQUEST" },
				}),
				{ status: 400 },
			);
		payload = {
			model: "fixture-serving-model-with-a-long-version-name-2026-09-14",
			usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
			choices: [
				{
					finish_reason: "stop",
					message: {
						content: JSON.stringify({
							title: `Melody ${n}`,
							explanation: "A gentle phrase with a little room to breathe.",
							key: "C major",
							duration: 8,
							notes: Array.from({ length: 16 }, (_, i) => ({
								pitch: [48, 60, 64, 67, 52, 62, 65, 69][i % 8] + ((n - 1) % 3),
								start_time: Math.floor(i / 2),
								duration: i % 2 ? 0.75 : 1.5,
								velocity: 65 + i * 3,
							})),
						}),
					},
				},
			],
		};
	} else throw new Error("Unexpected external request in test fixture");
	return new Response(JSON.stringify(payload), {
		headers: { "Content-Type": "application/json" },
	});
};
if (!localStorage.getItem("fixture-seeded")) {
	localStorage.setItem(
		"midijourney:persistent-workspace:v1",
		JSON.stringify({ prompt: "Legacy prompt must not appear", history: [] }),
	);
	localStorage.setItem("fixture-seeded", "yes");
}
const storage = {
	getItem: (key: string) =>
		key.endsWith(":token") ? "not-a-real-user-key" : null,
	setItem: () => {},
	removeItem: () => {},
};
createRoot(requiredElement("root")).render(
	<StrictMode>
		<section style={{ fontSize: 11, height: 44 }} aria-label="Test controls">
			<button
				type="button"
				onClick={() => {
					destination = destination === 1 ? 2 : 1;
				}}
			>
				Switch MIDI target
			</button>{" "}
			<label>
				<input id="test-delay" type="checkbox" />
				Delay reply
			</label>{" "}
			<label>
				<input id="test-fail" type="checkbox" />
				Fail reply
			</label>{" "}
			<span id="test-writes">Writes: 0</span>{" "}
			<span id="test-context">Request messages: 0</span>
		</section>
		<div style={{ height: "calc(100dvh - 44px)" }}>
			<PolliProvider appKey="pk_fixture_application" storage={storage}>
				<App />
			</PolliProvider>
		</div>
		<style>
			{"#root > div:nth-child(2) > div { height: calc(100dvh - 44px); }"}
		</style>
	</StrictMode>,
);
