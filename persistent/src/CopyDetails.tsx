import { ClipboardIcon, CopyButton, Text } from "@pollinations/ui";
import { useState } from "react";
import { copyDetails } from "./copy-details.mjs";
import type { CallEntry, MidiResult } from "./types";

export function CopyDetails({
	calls,
	result,
	basedOn,
}: {
	calls: CallEntry[];
	result?: MidiResult;
	basedOn?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2">
			{failed ? (
				<Text size="xs" role="status">
					Copy unavailable in this window. Please try again.
				</Text>
			) : null}
			<CopyButton
				aria-label="Copy response"
				title="Copy full response, MIDI data, and call details"
				value={() => copyDetails({ calls, result, basedOn })}
				className="mj-copy-details"
				tooltip={null}
				onCopied={() => setFailed(false)}
				onCopyError={() => setFailed(true)}
			>
				{(copied) => (
					<span className="inline-flex items-center gap-1.5" role="status">
						<span>{copied ? "Copied" : "Response"}</span>
						<ClipboardIcon aria-hidden="true" className="h-3 w-3" />
					</span>
				)}
			</CopyButton>
		</div>
	);
}
