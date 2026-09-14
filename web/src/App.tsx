import { Pollinations } from "@pollinations/sdk";
import { useAuthActions, useAuthState } from "@pollinations/sdk/react";
import { Alert, ColorModeToggle, Heading } from "@pollinations/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	CONFIG,
	PollinationsMidiClient,
	redactSecrets,
} from "../.generated/midi-core.mjs";
import { observeChat, upsertCall } from "./call-log.mjs";
import { LiveAccount } from "./LiveAccount";
import {
	browserStorage,
	liveMessageHandler,
	loadWorkspace,
	saveWorkspace,
	sendClipToLive,
} from "./session.mjs";
import type { CallEntry, HistoryEntry, LiveContext, MidiResult } from "./types";
import { Workspace } from "./Workspace";

export function App() {
	const { apiKey, isLoggedIn, error: authError } = useAuthState();
	const { logout } = useAuthActions();
	const [saved] = useState(() => loadWorkspace(browserStorage()));
	const [prompt, setPrompt] = useState(saved.prompt);
	const duration = saved.duration;
	const [calls, setCalls] = useState<CallEntry[]>([]);
	const callId = useRef(0);
	const mounted = useRef(true);
	const [history, setHistory] = useState<HistoryEntry[]>(saved.history);
	const [result, setResult] = useState<MidiResult | null>(null);
	const [live, setLive] = useState<LiveContext>({ connected: false });
	const [busy, setBusy] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const [storageWarning, setStorageWarning] = useState(false);
	const active = useRef(0);
	const busyRef = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const midi = useMemo(() => {
		const client = apiKey
			? new Pollinations({ apiKey, textTimeout: CONFIG.textTimeoutMs })
			: null;
		const observed = client
			? observeChat(
					client,
					(entry: CallEntry) => {
						if (mounted.current)
							setCalls((entries) => upsertCall(entries, entry));
					},
					() => ++callId.current,
				)
			: null;
		return new PollinationsMidiClient({
			auth: {
				requireClient() {
					if (!client) throw new Error("Connect to Pollinations first.");
					return observed;
				},
				invalidate() {
					logout();
				},
			},
		});
	}, [apiKey, logout]);

	useEffect(() => {
		// Key changes/logout/unmount must cancel work; stale responses never update UI.
		busyRef.current = false;
		setBusy(false);
		return () => {
			active.current++;
			midi.cancel();
		};
	}, [midi]);

	useEffect(() => {
		const abort = new AbortController();
		fetch("./api/context", { signal: abort.signal, cache: "no-store" })
			.then(async (response) => {
				if (
					!response.ok ||
					!response.headers.get("content-type")?.includes("application/json")
				)
					return;
				const context = (await response.json()) as LiveContext;
				if (!abort.signal.aborted) setLive(context);
			})
			.catch(() => {
				/* Standalone preview has no Live context. */
			});
		return () => abort.abort();
	}, []);

	useEffect(() => {
		setStorageWarning(
			!saveWorkspace(browserStorage(), { prompt, duration, history }),
		);
	}, [prompt, duration, history]);

	async function generate() {
		if (busyRef.current || sending || !isLoggedIn || !prompt.trim()) return;
		busyRef.current = true;
		const request = ++active.current;
		setBusy(true);
		setError("");
		try {
			const next = await midi.generate({
				promptText: prompt,
				duration,
				history,
				historyStatus: true,
				notes: live.source?.notes || [],
				title: live.source?.title || "",
			});
			if (request !== active.current) return;
			setResult(next);
			setHistory(next.history);
		} catch (failure) {
			if (request === active.current)
				setError(
					redactSecrets(
						failure instanceof Error
							? failure.message
							: "MIDI generation failed.",
					),
				);
		} finally {
			if (request === active.current) {
				busyRef.current = false;
				setBusy(false);
			}
		}
	}

	function cancel() {
		active.current++;
		midi.cancel();
		busyRef.current = false;
		setBusy(false);
		setError("Generation canceled.");
	}

	function send() {
		if (!result || sending || busyRef.current || !live.connected) return;
		try {
			sendClipToLive(window, result);
			setSending(true);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Could not send MIDI to Live.",
			);
		}
	}

	return (
		<div
			data-theme="blue"
			className="flex h-dvh flex-col bg-app-bg text-sm text-theme-text-base"
		>
			<header className="z-30 shrink-0 bg-app-bg">
				<div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
					<Heading
						as="h1"
						size="title"
						className="polli:shrink-0 polli:text-2xl"
					>
						MIDIjourney
					</Heading>
					<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
						<ColorModeToggle />
						<LiveAccount revision={history.length} />
					</div>
				</div>
			</header>
			{authError ? (
				<div className="mx-auto mb-3 max-w-5xl px-4">
					<Alert intent="danger">{redactSecrets(authError.message)}</Alert>
				</div>
			) : null}
			<Workspace
				prompt={prompt}
				calls={calls}
				history={history}
				result={result}
				live={live}
				loggedIn={isLoggedIn}
				busy={busy}
				sending={sending}
				error={error}
				storageWarning={storageWarning}
				canSend={live.connected && Boolean(liveMessageHandler(window))}
				onPrompt={setPrompt}
				onGenerate={() => void generate()}
				onCancel={cancel}
				onSend={send}
			/>
		</div>
	);
}
