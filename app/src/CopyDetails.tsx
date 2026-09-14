import { Button, ClipboardIcon, CopyButton, Text } from "@pollinations/ui";
import { useEffect, useRef, useState } from "react";
import { copyDetails } from "./copy-details.mjs";
import { isJweb } from "./jweb.mjs";
import { writeResponseClipboard } from "./prompt-clipboard.mjs";
import type { CallEntry, MidiResult } from "./types";

function NativeCopy({
	value,
	onFailure,
}: {
	value: () => string;
	onFailure: (failed: boolean) => void;
}) {
	const [state, setState] = useState("idle");
	const active = useRef(false);
	const mounted = useRef(true);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			clearTimeout(timer.current);
		};
	}, []);
	async function copy() {
		if (active.current) return;
		active.current = true;
		clearTimeout(timer.current);
		setState("busy");
		try {
			await writeResponseClipboard(window, value());
			if (!mounted.current) return;
			onFailure(false);
			setState("copied");
			timer.current = setTimeout(() => setState("idle"), 2000);
		} catch {
			if (mounted.current) {
				onFailure(true);
				setState("idle");
			}
		} finally {
			active.current = false;
		}
	}
	return (
		<Button
			type="button"
			aria-label="Copy response"
			title="Copy full response, MIDI data, and call details"
			className="mj-copy-details"
			disabled={state === "busy"}
			onClick={() => void copy()}
		>
			<span className="inline-flex items-center gap-1.5" role="status">
				<span>{state === "copied" ? "Copied" : "Response"}</span>
				<ClipboardIcon aria-hidden="true" className="h-3 w-3" />
			</span>
		</Button>
	);
}

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
			{isJweb(window) ? (
				<NativeCopy
					value={() => copyDetails({ calls, result, basedOn })}
					onFailure={setFailed}
				/>
			) : (
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
			)}
		</div>
	);
}
