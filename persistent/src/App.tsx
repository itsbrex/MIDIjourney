import { Pollinations } from "@pollinations/sdk";
import { useAuthActions, useAuthState } from "@pollinations/sdk/react";
import { Alert, ColorModeToggle, Heading } from "@pollinations/ui";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	CONFIG,
	PollinationsMidiClient,
	redactSecrets,
} from "../.generated/midi-core.mjs";
import { observeChat } from "./call-log.mjs";
import { createChatSession } from "./chat-session.mjs";
import { currentContext, isJweb, subscribeContext } from "./jweb.mjs";
import { LiveAccount } from "./LiveAccount";
import {
	browserStorage,
	loadChat,
	saveChat,
	sendClipToLive,
} from "./session.mjs";
import type { CallEntry, ChatState, LiveContext } from "./types";
import { Workspace } from "./Workspace";

export function App() {
	const { apiKey, isLoggedIn, error: authError } = useAuthState();
	const { logout } = useAuthActions();
	const callId = useRef(0);
	const [live, setLive] = useState<LiveContext>({
		connected: false,
		checking: true,
	});
	const session = useMemo(() => {
		const storage = browserStorage();
		const client = apiKey
			? new Pollinations({ apiKey, textTimeout: CONFIG.textTimeoutMs })
			: null;
		return createChatSession({
			initial: loadChat(storage),
			save: (value: ChatState) => saveChat(storage, value),
			readContext: async () => {
				try {
					return await currentContext(window, true);
				} catch (failure) {
					// Do not silently replace an unreadable Live input with a chat reply.
					if (isJweb(window)) throw failure;
					return { connected: false };
				}
			},
			writeClip: (result: unknown, target: string) =>
				sendClipToLive(window, result, target),
			createGenerator: (onCall: (entry: CallEntry) => void) => {
				if (!client) throw new Error("Connect to Pollinations first.");
				const observed = observeChat(client, onCall, () => ++callId.current);
				return new PollinationsMidiClient({
					auth: { requireClient: () => observed, invalidate: logout },
				});
			},
		});
	}, [apiKey, logout]);
	const chat = useSyncExternalStore(
		session.subscribe,
		session.getSnapshot,
	) as ChatState;
	useEffect(() => {
		session.activate();
		return () => session.dispose();
	}, [session]);
	useEffect(() => subscribeContext(window, setLive), []);
	useEffect(() => {
		if (!isJweb(window)) return;
		const openExternal = (event: MouseEvent) => {
			const anchor = (event.target as Element)?.closest?.("a[href]");
			if (!anchor) return;
			const url = new URL(anchor.getAttribute("href") || "", location.href);
			if (url.origin === "https://enter.pollinations.ai") {
				event.preventDefault();
				(
					window as unknown as { max: { outlet: (message: string) => void } }
				).max.outlet("dashboard");
			}
		};
		document.addEventListener("click", openExternal, true);
		return () => document.removeEventListener("click", openExternal, true);
	}, []);
	return (
		<div
			data-theme="blue"
			className="flex h-dvh flex-col bg-app-bg text-sm text-theme-text-base"
		>
			<header className="z-30 shrink-0 bg-app-bg">
				<div className="mj-app-width mx-auto flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
					<Heading
						as="h1"
						size="section"
						className="polli:shrink-0 polli:font-medium"
					>
						MIDI Journey
					</Heading>
					<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
						<ColorModeToggle />
						<LiveAccount
							revision={
								chat.turns.filter((turn) => turn.status === "complete").length
							}
						/>
					</div>
				</div>
			</header>
			{authError ? (
				<div className="mj-app-width mx-auto mb-2 px-4">
					<Alert intent="danger">{redactSecrets(authError.message)}</Alert>
				</div>
			) : null}
			<Workspace
				chat={chat}
				live={live}
				loggedIn={isLoggedIn}
				onPrompt={session.setDraft}
				onGenerate={() => void session.generate()}
				onCancel={session.cancel}
				onNewChat={session.newChat}
				onSend={(id) => void session.send(id, live)}
			/>
		</div>
	);
}
