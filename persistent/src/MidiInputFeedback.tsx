import { AudioIcon, Surface, Text } from "@pollinations/ui";
import type { MidiAttachment, MidiInputSummary } from "./types";

function MidiBadge({ summary }: { summary: MidiInputSummary }) {
	return (
		<Surface
			variant="card"
			className="mj-midi-badge"
			title={summary.title || "Untitled MIDI clip"}
		>
			<AudioIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<Text size="xs" weight="medium" className="truncate">
					{summary.title || "Untitled MIDI clip"}
				</Text>
				<Text size="xs" tone="muted">
					{summary.noteCount} {summary.noteCount === 1 ? "note" : "notes"}
				</Text>
			</div>
		</Surface>
	);
}

export function MidiInputFeedback({
	items,
	error,
	checking,
}: {
	items: MidiAttachment[];
	error?: string;
	checking?: boolean;
}) {
	if (!items.length && !error && !checking) return null;
	return (
		<fieldset className="mj-midi-inputs" aria-label="Selected MIDI clips">
			{items.map((item) => (
				<MidiBadge key={item.key} summary={item.summary} />
			))}
			{error || checking ? (
				<Text size="xs" tone="muted" role="status" className="w-full">
					{error || "Reading MIDI…"}
				</Text>
			) : null}
		</fieldset>
	);
}

export function MessageMidiInput({ inputs }: { inputs: MidiInputSummary[] }) {
	return (
		<ul
			className="flex flex-wrap gap-2 mb-2"
			aria-label="MIDI clips sent with this message"
		>
			{inputs
				.filter((input) => input.kind !== "none")
				.map((input, index) => (
					<li key={`${index}:${input.title}`} className="min-w-0 max-w-full">
						<MidiBadge summary={input} />
					</li>
				))}
		</ul>
	);
}
