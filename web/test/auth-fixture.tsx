// Isolated test only: no real authorization, credentials or Live mutation.
import { PolliProvider } from "@pollinations/sdk/react";
import { createRoot } from "react-dom/client";
import { AppEntry } from "../src/BrowserConnect";
import "../src/style.css";

const live = new URLSearchParams(location.search).get("role") === "live";
window.history.replaceState(
	{},
	"",
	`${location.pathname}${location.search}#${live ? "live-session" : "live-connect"}=${"a".repeat(64)}`,
);
const fixture = window as unknown as {
	fixtureReady: boolean;
	fixtureEvents: string[];
	webkit?: unknown;
};
fixture.fixtureReady = false;
fixture.fixtureEvents = [];
if (live)
	fixture.webkit = {
		messageHandlers: {
			live: {
				postMessage() {
					throw new Error("No Live writes in auth test");
				},
			},
		},
	};
const originalFetch = window.fetch.bind(window);
let completed = false;
window.fetch = async (input, options) => {
	const url = new URL(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
		location.href,
	);
	let value: unknown;
	if (url.origin === "https://enter.pollinations.ai")
		value = {
			name: "Test musician",
			githubUsername: "fixture-user",
			image: null,
			tier: "spore",
			nextResetAt: null,
			balance: 5,
		};
	if (url.pathname === "/api/context")
		value = { connected: live, destination: "Test MIDI slot" };
	if (url.pathname.startsWith("/api/auth/")) {
		const action = url.pathname.split("/").pop() || "";
		fixture.fixtureEvents.push(action);
		if (action === "complete") completed = true;
		value =
			action === "status"
				? {
						status: fixture.fixtureReady ? "received" : "pending",
						apiKey: fixture.fixtureReady ? "fake-session-for-ui-test" : null,
					}
				: {
						status:
							(action === "browser-status" && completed) || action === "finish"
								? "delivered"
								: "pending",
					};
	}
	return value
		? new Response(JSON.stringify(value), {
				headers: { "Content-Type": "application/json" },
			})
		: originalFetch(input, options);
};
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<PolliProvider
		appKey="pk_fixture_application"
		storage={{
			getItem: (key) =>
				!live && key.endsWith(":token") ? "fake-session-for-ui-test" : null,
			setItem: () => {
				fixture.fixtureEvents.push("sdk-stored-session");
			},
			removeItem: () => {},
		}}
	>
		<AppEntry />
	</PolliProvider>,
);
