import { Alert, Button, Text } from "@pollinations/ui";
import { useId } from "react";
import { CopyDetails } from "./CopyDetails";
import { replyPresentation } from "./reply-presentation.mjs";
import type { ChatTurn } from "./types";

export function ReplyFooter({
	turn,
	replyNumber,
	sending,
	disabled,
	unavailableReason,
	onSend,
}: {
	turn: ChatTurn;
	replyNumber: number;
	sending: boolean;
	disabled: boolean;
	unavailableReason?: string;
	onSend: () => void;
}) {
	const reasonId = useId();
	if (turn.status === "pending") return null;
	return (
		<footer className="space-y-2">
			{turn.writeError ? (
				<Alert intent="danger">{turn.writeError}</Alert>
			) : null}
			<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
				{turn.calls.length || turn.result ? (
					<div className="mj-reply-meta flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1">
						{turn.result ? (
							<Text
								size="xs"
								tone="muted"
								className="min-w-0 break-all"
								aria-label="Model used"
							>
								Model: {replyPresentation(turn).model}
							</Text>
						) : null}
						<CopyDetails
							calls={turn.calls}
							result={turn.result}
							basedOn={turn.basedOn}
						/>
					</div>
				) : null}
				{turn.result ? (
					<div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
						{unavailableReason ? (
							<Text
								id={reasonId}
								size="xs"
								tone="muted"
								className="max-w-48 break-words"
							>
								{unavailableReason}
							</Text>
						) : null}
						<Button
							size="md"
							type="button"
							onClick={onSend}
							className="mj-create-clip shrink-0"
							aria-label={`Create clip from reply ${replyNumber}`}
							aria-describedby={unavailableReason ? reasonId : undefined}
							title="Select a MIDI clip or empty slot in Live. Creates a new clip; existing clips stay untouched."
							disabled={disabled || Boolean(unavailableReason)}
						>
							{sending ? "Creating…" : "Create clip"}
						</Button>
					</div>
				) : null}
			</div>
		</footer>
	);
}
