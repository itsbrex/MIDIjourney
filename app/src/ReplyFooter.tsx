import { Alert, Button, Tooltip } from "@pollinations/ui";
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
	if (turn.status === "pending" || (!turn.result && !turn.writeError))
		return null;
	const disabledReason = sending
		? "The clip is being created."
		: unavailableReason ||
			(disabled ? "Wait for the current operation to finish." : "");
	const createButton = (
		<Button
			size="md"
			type="button"
			onClick={onSend}
			className="mj-create-clip shrink-0"
			aria-label={`Create clip from reply ${replyNumber}`}
			disabled={Boolean(disabledReason)}
		>
			{sending ? "Creating…" : "Create clip"}
		</Button>
	);
	return (
		<footer className="space-y-2">
			{turn.writeError ? (
				<Alert intent="danger">{turn.writeError}</Alert>
			) : null}
			<div className="flex min-w-0 justify-end">
				{turn.result ? (
					disabledReason ? (
						<Tooltip
							triggerAs="span"
							tapEnabled
							ariaLabel="Why Create clip is unavailable"
							content={disabledReason}
						>
							{createButton}
						</Tooltip>
					) : (
						createButton
					)
				) : null}
			</div>
		</footer>
	);
}
