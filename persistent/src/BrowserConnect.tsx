import { useAuthActions, useAuthState } from "@pollinations/sdk/react";
import {
	Alert,
	Button,
	ColorModeToggle,
	Heading,
	Surface,
	Text,
} from "@pollinations/ui";
import { AppUserMenu } from "@pollinations/ui/app-user-menu/sdk";
import { useEffect, useRef, useState } from "react";
import { App } from "./App";
import { authRequest, fragmentValue, pause } from "./live-auth.mjs";
import { liveMessageHandler } from "./session.mjs";

export function AppEntry() {
	const { isHydrated } = useAuthState();
	// PolliProvider restores its return path after checking state/exchanging the
	// code. Inspect only after hydration; never parse or exchange OAuth ourselves.
	if (!isHydrated)
		return (
			<main className="p-6">
				<Text>Loading MIDIjourney…</Text>
			</main>
		);
	const capability = !liveMessageHandler(window)
		? fragmentValue(window.location.hash, "live-connect")
		: null;
	return capability ? <BrowserConnect capability={capability} /> : <App />;
}

export function BrowserConnect({ capability }: { capability: string }) {
	const { apiKey, isLoggedIn, error: authError } = useAuthState();
	const { login, enterUrl } = useAuthActions();
	const [status, setStatus] = useState("checking");
	const [error, setError] = useState("");
	const active = useRef<AbortController | null>(null);
	const loginAttempted = useRef(false);
	useEffect(() => () => active.current?.abort(), []);

	useEffect(() => {
		// A browser window opened by Live may already hold a session. Never attach
		// it silently: the user explicitly confirms the displayed account below.
		const request = new AbortController();
		void authRequest("browser-status", capability, {
			method: "GET",
			signal: request.signal,
		})
			.then((result) => {
				if (request.signal.aborted) return;
				if (result.status === "delivered") {
					setStatus("done");
					return;
				}
				setStatus("ready");
				if (loginAttempted.current) return;
				loginAttempted.current = true;
				if (!isLoggedIn && !authError) login();
			})
			.catch(() => {
				if (!request.signal.aborted) {
					setStatus("expired");
					setError(
						"This connection is no longer waiting. Click Connect again in Live.",
					);
				}
			});
		return () => request.abort();
	}, [capability, isLoggedIn, authError, login]);

	async function connectToLive() {
		if (!apiKey || active.current || status !== "ready") return;
		const request = new AbortController();
		active.current = request;
		setStatus("sending");
		setError("");
		try {
			await authRequest("complete", capability, {
				apiKey,
				signal: request.signal,
			});
			while (!request.signal.aborted) {
				const result = await authRequest("browser-status", capability, {
					method: "GET",
					signal: request.signal,
				});
				if (request.signal.aborted) return;
				if (result.status === "delivered") {
					setStatus("done");
					window.history.replaceState({}, "", "/");
					return;
				}
				await pause(request.signal);
			}
		} catch {
			if (!request.signal.aborted) {
				setStatus("ready");
				setError(
					"Could not reach Live. Keep MIDIjourney open, or click Connect again in Live.",
				);
			}
		} finally {
			if (active.current === request) active.current = null;
		}
	}

	return (
		<main className="mx-auto max-w-5xl space-y-6 p-6">
			<div className="flex justify-end gap-3">
				<ColorModeToggle />
				{status !== "checking" && status !== "expired" ? (
					<AppUserMenu
						dashboardHref={`${enterUrl}/pollen`}
						labels={{ authorize: "Connect" }}
					/>
				) : null}
			</div>
			<Surface variant="panel" className="space-y-5">
				<Heading as="h1" size="title">
					Connect MIDIjourney to Live
				</Heading>
				{status === "done" ? (
					<Alert>
						Connected to Ableton Live. You can close this tab and return to
						MIDIjourney.
					</Alert>
				) : (
					<>
						<Text>
							Sign in with the account you want to use in Ableton Live, then
							confirm below. Keep the MIDIjourney window open in Live.
						</Text>
						<Button
							disabled={!isLoggedIn || status !== "ready"}
							onClick={connectToLive}
						>
							{status === "sending"
								? "Waiting for Live…"
								: "Connect to Ableton Live"}
						</Button>
					</>
				)}
				{authError ? (
					<Alert intent="danger">
						Sign-in did not finish. Return to Live and try Connect again.
					</Alert>
				) : null}
				{error ? <Alert intent="danger">{error}</Alert> : null}
			</Surface>
		</main>
	);
}

