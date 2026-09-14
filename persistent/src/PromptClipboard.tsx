import { Button, ClipboardIcon } from "@pollinations/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	clipboardOperation,
	copyPromptText,
	insertClipboardText,
	readPromptClipboard,
	writePromptClipboard,
} from "./prompt-clipboard.mjs";

export function PromptClipboard({
	input,
	onChange,
	getRevision,
	disabled,
}: {
	input: RefObject<HTMLTextAreaElement | null>;
	onChange: (value: string) => void;
	getRevision: () => number;
	disabled: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const active = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	async function run(action: "copy" | "paste") {
		const editor = input.current;
		if (!editor || disabled || active.current) return;
		active.current = true;
		setBusy(true);
		const revision = getRevision();
		const { value, selectionStart: start, selectionEnd: end } = editor;
		try {
			if (action === "copy") {
				const text = copyPromptText(editor);
				if (!text) {
					return;
				}
				await clipboardOperation(() => writePromptClipboard(window, text));
			} else {
				const text = await clipboardOperation(() =>
					readPromptClipboard(window),
				);
				if (!mounted.current || !editor.isConnected) return;
				if (getRevision() !== revision || editor.value !== value) {
					return;
				}
				let next: { value: string; cursor: number } | null;
				try {
					next = insertClipboardText(value, start, end, text, editor.maxLength);
				} catch {
					return;
				}
				if (!next) {
					return;
				}
				onChange(next.value);
				requestAnimationFrame(() => {
					if (
						!mounted.current ||
						!editor.isConnected ||
						editor.value !== next.value
					)
						return;
					editor.focus();
					editor.setSelectionRange(next.cursor, next.cursor);
				});
			}
		} catch {
			// Never log clipboard content or provider error payloads.
		} finally {
			active.current = false;
			if (mounted.current) setBusy(false);
		}
	}
	return (
		<div className="mr-auto flex min-w-0 flex-wrap items-center gap-2">
			{(["copy", "paste"] as const).map((action) => (
				<Button
					key={action}
					type="button"
					size="sm"
					className="mj-prompt-clipboard"
					disabled={disabled || busy}
					aria-label={`${action === "copy" ? "Copy" : "Paste"} prompt`}
					title={
						action === "copy"
							? "Copy selected text, or the whole prompt"
							: "Paste at the cursor or replace selected text"
					}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => void run(action)}
				>
					{action === "copy" ? (
						<ClipboardIcon aria-hidden="true" className="h-4 w-4" />
					) : (
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="h-4 w-4"
						>
							<rect x="8" y="3" width="8" height="4" rx="1" />
							<path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h6" />
						</svg>
					)}
				</Button>
			))}
		</div>
	);
}
