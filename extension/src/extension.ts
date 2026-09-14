import { resolve } from "node:path";
import {
	type ActivationContext,
	ClipSlot,
	DataModelObject,
	type Handle,
	initialize,
	MidiClip,
	MidiTrack,
} from "@ableton-extensions/sdk";
import { captureTarget, parseDialogResult } from "./live-target.mjs";
import { startUiServer } from "./ui-server.mjs";

export function activate(activation: ActivationContext) {
	const context = initialize(activation, "1.0.0");
	let open = false;
	context.commands.registerCommand("midijourney.open", (handle: unknown) => {
		void openEditor(handle as Handle);
	});
	for (const scope of ["MidiClip", "ClipSlot"] as const) {
		void context.ui
			.registerContextMenuAction(
				scope,
				"Create with MIDIjourney",
				"midijourney.open",
			)
			.catch(() =>
				console.error("MIDIjourney could not register its Extensions menu."),
			);
	}

	async function openEditor(handle: Handle) {
		if (open) return;
		open = true;
		let server: Awaited<ReturnType<typeof startUiServer>> | undefined;
		try {
			let target: ReturnType<typeof captureTarget> | undefined;
			let error = "";
			try {
				target = captureTarget(context, handle, {
					DataModelObject,
					ClipSlot,
					MidiClip,
					MidiTrack,
				});
			} catch (failure) {
				error =
					failure instanceof Error
						? failure.message
						: "Choose an empty MIDI slot.";
			}
			server = await startUiServer({
				directory: resolve(__dirname, "ui"),
				getContext: () =>
					target
						? { ...target.publicContext, error }
						: { connected: false, error },
			});
			const raw = await context.ui.showModalDialog(server.editorUrl, 760, 620);
			const clip = parseDialogResult(raw);
			if (clip && target) {
				try {
					const result = await target.create(clip);
					console.log(
						`MIDIjourney created a clip: ${result.noteCount} notes, ${result.duration} beats.`,
					);
				} catch (failure) {
					// Reopen the same package UI with an actionable error, not a custom
					// Max dialog. History is preserved independently in browser storage.
					error =
						failure instanceof Error
							? failure.message
							: "Live could not create the clip.";
					target = undefined;
					await context.ui.showModalDialog(server.editorUrl, 760, 620);
				}
			}
		} catch {
			console.error(
				"MIDIjourney could not open its editor. Ensure the UI is built and port 5178 is free (stop the Vite preview before launching the extension).",
			);
		} finally {
			await server?.close();
			open = false;
		}
	}
}
