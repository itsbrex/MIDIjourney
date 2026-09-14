import { CodeBlock, Collapsible, Surface, Text } from "@pollinations/ui";
import { useState } from "react";
import type { CallEntry } from "./types";

const tokens = (value: number | null) =>
	value === null ? "Not reported" : value.toLocaleString();

export function CallLog({ calls }: { calls: CallEntry[] }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible
			triggerClassName="polli:text-sm"
			label={`Technical log${calls.length ? ` · ${calls.length}` : ""}`}
			expanded={open}
			onToggle={() => setOpen((value) => !value)}
		>
			<div className="space-y-3">
				<Text size="xs" tone="muted">
					Generation calls in this window, including retry attempts. Latest 30
					calls; not saved with your history. Token counts come from the
					provider. Canceled calls may still have incurred usage that was not
					reported.
				</Text>
				{calls.length ? (
					[...calls]
						.reverse()
						.map((call) => <CallRow key={call.id} call={call} />)
				) : (
					<Text size="sm" tone="muted">
						No generation calls yet.
					</Text>
				)}
			</div>
		</Collapsible>
	);
}

function CallRow({ call }: { call: CallEntry }) {
	const [details, setDetails] = useState(false);
	return (
		<Surface variant="card" className="polli:p-3 min-w-0 space-y-2">
			<div className="flex flex-wrap justify-between gap-2">
				<Text size="sm" weight="medium">
					Call {call.id} · {call.status}
				</Text>
				<Text size="xs" tone="muted">
					{new Date(call.startedAt).toLocaleTimeString()} ·{" "}
					{(call.durationMs / 1000).toFixed(1)}s
				</Text>
			</div>
			<Text size="sm" className="break-words">
				Model used: {call.model ?? "Not reported"}
			</Text>
			<Text size="sm" tone="soft">
				Tokens — Input: {tokens(call.usage.input)} · Output:{" "}
				{tokens(call.usage.output)} · Total: {tokens(call.usage.total)}
			</Text>
			{call.output ? (
				<Text size="sm" tone="soft">
					{call.output.validation}
					{call.output.noteCount !== undefined
						? ` · ${call.output.noteCount} notes`
						: ""}
				</Text>
			) : null}
			<Collapsible
				triggerClassName="polli:text-sm"
				label="Technical details"
				expanded={details}
				onToggle={() => setDetails((value) => !value)}
			>
				<CodeBlock
					code={JSON.stringify(
						{
							requestedModel: call.requestedModel,
							reportedModel: call.model,
							status: call.status,
							elapsedMs: call.durationMs,
							messageCount: call.messageCount,
							finishReason: call.finishReason,
							tokens: call.usage,
							error: call.error,
							output: call.output,
						},
						null,
						2,
					)}
				/>
			</Collapsible>
		</Surface>
	);
}
