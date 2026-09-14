import {
	Alert,
	Button,
	Field,
	Heading,
	PlusIcon,
	ScrollArea,
	Surface,
	Text,
	Textarea,
} from "@pollinations/ui";
import { useEffect, useMemo, useRef } from "react";
import { ChatBottomScene } from "./ChatBottomScene";
import { MessageMidiInput, MidiInputFeedback } from "./MidiInputFeedback";
import { midiInputsFeedback } from "./midi-input.mjs";
import { PianoRoll } from "./PianoRoll";
import { PromptClipboard } from "./PromptClipboard";
import { ReplyFooter } from "./ReplyFooter";
import {
	clipCreationUnavailable,
	replyPresentation,
} from "./reply-presentation.mjs";
import type { ChatState, LiveContext, MidiAttachment } from "./types";

type Props = {
	chat: ChatState;
	live: LiveContext;
	loggedIn: boolean;
	onPrompt: (text: string) => void;
	onGenerate: () => void;
	onCancel: () => void;
	onNewChat: () => void;
	onSend: (id: string) => void;
};
export function Workspace({
	chat,
	live,
	loggedIn,
	onPrompt,
	onGenerate,
	onCancel,
	onNewChat,
	onSend,
}: Props) {
	const scroll = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const composer = useRef<HTMLTextAreaElement>(null);
	const promptRevision = useRef(0);
	function changePrompt(value: string) {
		promptRevision.current++;
		onPrompt(value);
	}
	const last = chat.turns.at(-1);
	const creationUnavailable = clipCreationUnavailable(live);
	const input = useMemo(() => midiInputsFeedback(live), [live]) as {
		items: MidiAttachment[];
		error?: string;
		checking?: boolean;
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: These content changes trigger scrolling after React updates the conversation DOM.
	useEffect(() => {
		if (follow.current && scroll.current)
			scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [
		chat.turns.length,
		last?.status,
		last?.inputs,
		last?.notice,
		last?.writeError,
	]);
	function submit() {
		if (input.error || input.checking) return;
		promptRevision.current++;
		follow.current = true;
		onGenerate();
	}
	function fresh() {
		promptRevision.current++;
		follow.current = true;
		onNewChat();
		composer.current?.focus();
	}
	return (
		<main className="mj-app-width mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col px-4 pb-3">
			<div className="flex shrink-0 items-center justify-start gap-3 pt-3 pb-4">
				<Button
					size="md"
					type="button"
					className="mj-new-chat shrink-0"
					onClick={fresh}
					disabled={Boolean(chat.sendingId)}
					title="Clear this conversation and start fresh. Clips in Live are not changed."
				>
					<PlusIcon aria-hidden="true" className="h-4 w-4" />
					New chat
				</Button>
			</div>
			<Surface
				role="region"
				variant="panel"
				className="mj-chat-panel mj-scroll polli-scrollbar-subtle"
				data-scrollbar-active="true"
				aria-label="Musical conversation"
			>
				<ScrollArea
					ref={scroll}
					role="region"
					aria-label="Conversation"
					tabIndex={0}
					className="mj-scroll min-h-0 flex-1 space-y-5 pb-4"
					onScroll={(event) => {
						const el = event.currentTarget;
						follow.current =
							el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					}}
				>
					{!chat.turns.length ? (
						<Surface
							variant="panel"
							className="mj-assistant-reply mr-6 p-3 space-y-3"
							aria-label="Welcome from MIDI Journey"
						>
							<Text size="sm">🎹 Hi, I’m MIDI Journey.</Text>
							<ul className="list-disc space-y-1 pl-4">
								<li>
									<Text size="sm">
										<strong>Describe</strong> an idea, then ask for changes.
									</Text>
								</li>
								<li>
									<Text size="sm">
										<strong>Select a Live clip</strong> to use its MIDI as
										input.
									</Text>
								</li>
								<li>
									<Text size="sm">
										<strong>Create clip</strong> fills an empty slot or replaces
										the selected clip.
									</Text>
								</li>
							</ul>
						</Surface>
					) : (
						chat.turns.map((turn, index) => (
							<article
								key={turn.id}
								aria-label={`Exchange ${index + 1}`}
								className="space-y-2"
							>
								<Surface
									variant="card"
									className="mj-user-message ml-auto w-fit max-w-[88%] p-3"
									aria-label="Your message"
								>
									{turn.inputs?.length ||
									(turn.input?.kind && turn.input.kind !== "none") ? (
										<MessageMidiInput
											inputs={turn.inputs || (turn.input ? [turn.input] : [])}
										/>
									) : null}
									<Text size="sm" className="whitespace-pre-wrap break-words">
										{turn.prompt}
									</Text>
								</Surface>
								<Surface
									variant="panel"
									className="mj-assistant-reply mr-6 p-3 space-y-3"
									aria-label="Assistant reply"
								>
									{turn.status === "pending" ? (
										<Text
											size="sm"
											role="status"
											className="flex items-center gap-2"
										>
											<span className="mj-thinking-dots" aria-hidden="true">
												<span />
												<span />
												<span />
											</span>
											Creating your musical idea…
										</Text>
									) : null}
									{turn.error ? (
										<Alert
											intent={turn.status === "canceled" ? "warning" : "danger"}
										>
											{turn.error}
										</Alert>
									) : null}
									{turn.result ? (
										<>
											<Heading size="card" className="mj-reply-title">
												{turn.result.title}
											</Heading>
											<Text
												size="sm"
												className="whitespace-pre-wrap break-words"
											>
												{replyPresentation(turn).explanation}
											</Text>
											<PianoRoll clip={turn.result} />
										</>
									) : null}
									<ReplyFooter
										turn={turn}
										replyNumber={index + 1}
										sending={chat.sendingId === turn.id}
										unavailableReason={creationUnavailable}
										disabled={Boolean(chat.busyId || chat.sendingId)}
										onSend={() => onSend(turn.id)}
									/>
								</Surface>
							</article>
						))
					)}
				</ScrollArea>
				<form
					className="shrink-0 space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<Field.Root className="mj-composer flex min-w-0 flex-col">
						<MidiInputFeedback {...input} />
						<Field.Label htmlFor="chat-message" className="sr-only">
							<Text as="span" size="xs" tone="muted">
								Message
							</Text>
						</Field.Label>
						<Textarea
							ref={composer}
							id="chat-message"
							value={chat.draft}
							onChange={(event) => changePrompt(event.target.value)}
							className="mj-prompt mj-scroll polli-scrollbar-subtle polli:min-w-0 polli:text-sm polli:leading-relaxed"
							data-scrollbar-active="true"
							rows={2}
							maxLength={12000}
							required
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing
								) {
									event.preventDefault();
									if (
										loggedIn &&
										!chat.busyId &&
										!chat.sendingId &&
										chat.draft.trim()
									)
										submit();
								}
							}}
						/>
					</Field.Root>
					<div className="flex flex-wrap items-center justify-end gap-2">
						<PromptClipboard
							input={composer}
							onChange={changePrompt}
							getRevision={() => promptRevision.current}
							disabled={Boolean(chat.busyId || chat.sendingId)}
						/>
						{!loggedIn ? (
							<Text size="xs" tone="muted" className="mr-auto">
								Connect to Pollinations above to send a message.
							</Text>
						) : null}
						{chat.busyId ? (
							<Button size="md" type="button" onClick={onCancel}>
								Cancel
							</Button>
						) : (
							<Button
								size="md"
								type="submit"
								disabled={
									!loggedIn ||
									!chat.draft.trim() ||
									Boolean(chat.sendingId || input.error || input.checking)
								}
							>
								Send
							</Button>
						)}
					</div>
				</form>
				{chat.storageWarning ? (
					<Text size="xs" role="status">
						This chat could not be saved locally. Keep the window open to retain
						it.
					</Text>
				) : null}
				<ChatBottomScene />
			</Surface>
		</main>
	);
}
