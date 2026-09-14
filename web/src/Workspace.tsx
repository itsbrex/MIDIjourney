import {
	Alert,
	Button,
	Collapsible,
	Field,
	Heading,
	Surface,
	Text,
	Textarea,
} from "@pollinations/ui";
import { useMemo, useState } from "react";
import { CallLog } from "./CallLog";
import type { CallEntry, HistoryEntry, LiveContext, MidiResult } from "./types";

type Props = {
	prompt: string;
	calls: CallEntry[];
	history: HistoryEntry[];
	result: MidiResult | null;
	live: LiveContext;
	loggedIn: boolean;
	busy: boolean;
	sending: boolean;
	canSend: boolean;
	error: string;
	storageWarning: boolean;
	onPrompt: (text: string) => void;
	onGenerate: () => void;
	onCancel: () => void;
	onSend: () => void;
};

export function Workspace(props: Props) {
	const [historyOpen, setHistoryOpen] = useState(false);
	const prompts = props.history.filter((entry) => entry.role === "user");
	const historyRows = useMemo(() => {
		const occurrences = new Map<string, number>();
		return props.history.map((entry) => {
			const identity = `${entry.role}:${entry.contextContent}`;
			const occurrence = occurrences.get(identity) ?? 0;
			occurrences.set(identity, occurrence + 1);
			return { ...entry, id: `${identity}:${occurrence}` };
		});
	}, [props.history]);
	return (
		<main className="mx-auto min-h-0 w-full min-w-0 max-w-5xl flex-1 space-y-3 overflow-y-auto px-4 pb-4">
			{props.live.connected ? (
				<Surface variant="card" className="polli:px-3 polli:py-2">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<Text as="span" size="xs" tone="muted">
							MIDI destination
						</Text>
						<Text as="span" size="sm" weight="medium">
							{props.live.destination}
						</Text>
					</div>
					{props.live.source ? (
						<Text size="xs" tone="soft">
							Inspired by {props.live.source.title}
						</Text>
					) : null}
				</Surface>
			) : (
				<Alert title="Live is not connected">
					Open MIDIjourney from an empty MIDI slot or MIDI clip in the
					Extensions-enabled Live beta. You can generate here, but this browser
					preview cannot write to your Set.
				</Alert>
			)}
			{props.live.error ? (
				<Alert intent="danger">{props.live.error}</Alert>
			) : null}

			<Surface variant="panel" className="polli:p-4">
				<form
					className="min-w-0 space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						props.onGenerate();
					}}
				>
					<Field.Root className="flex min-w-0 flex-col gap-1.5">
						<Field.Label htmlFor="midi-prompt">
							<Text as="span" size="sm" weight="medium">
								Text prompt
							</Text>
						</Field.Label>
						<Textarea
							id="midi-prompt"
							value={props.prompt}
							onChange={(event) => props.onPrompt(event.target.value)}
							placeholder="A gentle piano phrase in A minor, with room to breathe…"
							className="mj-prompt polli:min-w-0 polli:text-sm polli:leading-relaxed"
							rows={4}
							wrap="soft"
							maxLength={12000}
							required
							disabled={props.busy || props.sending}
						/>
					</Field.Root>
					<div className="flex flex-wrap items-center justify-between gap-2">
						{props.busy ? (
							<Button type="button" size="md" onClick={props.onCancel}>
								Cancel generation
							</Button>
						) : (
							<Button
								type="submit"
								size="md"
								disabled={
									!props.loggedIn || !props.prompt.trim() || props.sending
								}
							>
								Generate MIDI
							</Button>
						)}
					</div>
					{!props.loggedIn ? (
						<Text size="xs" tone="muted">
							Connect to Pollinations above to generate.
						</Text>
					) : null}
				</form>
			</Surface>

			{props.error ? <Alert intent="danger">{props.error}</Alert> : null}
			{props.busy ? (
				<Text size="sm" role="status">
					Creating your musical idea…
				</Text>
			) : null}
			{props.result ? (
				<Surface variant="panel" className="polli:p-4 space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<Heading size="card">{props.result.title}</Heading>
					</div>
					<Text size="sm" className="whitespace-pre-wrap">
						{props.result.explanation}
					</Text>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							onClick={props.onSend}
							disabled={!props.canSend || props.busy || props.sending}
						>
							{props.sending ? "Sending…" : "Create clip & close"}
						</Button>
						<Text size="xs" tone="muted">
							{props.canSend
								? "Creates a new clip. Your source clip stays untouched."
								: "Open through Ableton Extensions to create this clip in Live."}
						</Text>
					</div>
				</Surface>
			) : null}

			<Collapsible
				triggerClassName="polli:text-sm"
				label={`History${prompts.length ? ` · ${prompts.length}` : ""}`}
				expanded={historyOpen}
				onToggle={() => setHistoryOpen((open) => !open)}
			>
				{props.history.length ? (
					<div className="space-y-3">
						{historyRows.map((entry) => (
							<Surface key={entry.id} variant="card" className="polli:p-3">
								<Text size="xs" tone="muted">
									{entry.role === "user" ? "Prompt" : "Response"}
								</Text>
								<Text size="sm" className="whitespace-pre-wrap break-words">
									{entry.content}
								</Text>
							</Surface>
						))}
					</div>
				) : (
					<Text size="sm" tone="muted">
						Your prompts and responses will appear here. Browser history is
						separate from the existing Max device.
					</Text>
				)}
			</Collapsible>
			<CallLog calls={props.calls} />
			{props.storageWarning ? (
				<Alert intent="warning">
					This browser could not save your history. Keep this window open to
					retain this session.
				</Alert>
			) : null}
		</main>
	);
}
