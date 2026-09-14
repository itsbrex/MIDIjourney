// Additive UI verification entry: preserves the original chat fixture and uses
// its fake SDK/network. No actual Live writes or paid generation requests.
import "./chat-fixture";
import { createRoot } from "react-dom/client";

let mode = "live",
	notes = 4;
let receive: (id: string, raw: string) => void;
const host = window as unknown as {
	max: {
		bindInlet: (name: string, callback: typeof receive) => void;
		outlet: (...values: string[]) => void;
	};
};
const original = host.max;
host.max = {
	bindInlet(name, callback) {
		receive = callback;
		original.bindInlet(name, callback);
	},
	outlet(action, id, raw) {
		// UI verification only: emulate the native clipboard reply using the test browser.
		if (action === "clipboard_read" || action === "clipboard_write") {
			void (async () => {
				try {
					const text =
						action === "clipboard_read"
							? await navigator.clipboard.readText()
							: undefined;
					if (action === "clipboard_write")
						await navigator.clipboard.writeText(JSON.parse(raw).text);
					receive(id, JSON.stringify({ ok: true, text }));
				} catch {
					receive(id, JSON.stringify({ ok: false, error: "Clipboard denied" }));
				}
			})();
			return;
		}
		if (action !== "context") return original.outlet(action, id, raw);
		const source = ["live", "full", "other"].includes(mode)
			? {
					title:
						mode === "other"
							? "Other selected clip"
							: "Little Ballad in 7/4 (Syncopated Piano: LH/RH)",
					duration: 8,
					notes: Array.from({ length: notes + 1 }, (_, i) => ({
						pitch: (mode === "other" ? 72 : 60) + i,
						start_time: i,
						duration: 0.5,
						velocity: 85.5,
						mute: i === notes ? 1 : 0,
					})),
				}
			: null;
		queueMicrotask(() =>
			receive(
				id,
				JSON.stringify({
					ok: true,
					context: {
						connected: mode !== "full" && mode !== "unselected",
						target: "track-1",
						destination: "MIDI 1 · empty slot 2",
						source,
						sourceId: source ? (mode === "other" ? "31" : "30") : "",
						...(mode === "unselected"
							? { error: "Select a MIDI clip or empty slot on a MIDI track." }
							: {}),
						...(mode === "error"
							? { sourceError: "The Live connector is not responding." }
							: {}),
						...(mode === "full"
							? {
									error:
										"Add an empty scene on this track. Existing clips will not be overwritten.",
								}
							: {}),
					},
				}),
			),
		);
	},
};
const fakeFetch = window.fetch;
window.fetch = async (input, options) => {
	if (options?.body && typeof options.body === "string") {
		const request = JSON.parse(options.body);
		const message = request.messages?.at(-1);
		if (message) {
			const data = JSON.parse(message.content);
			const output = document.getElementById("input-request");
			if (output)
				output.textContent = `Request MIDI: ${
					(data.sourceClips || (data.sourceClip ? [data.sourceClip] : []))
						.map(
							(clip: { title: string; notes: unknown[] }) =>
								`${clip.title} · ${clip.notes.length} notes`,
						)
						.join(" | ") || "none"
				}`;
		}
	}
	return fakeFetch(input, options);
};
const controls = document.getElementById("input-controls");
if (!controls) throw new Error("Missing input fixture controls");
createRoot(controls).render(
	<section
		aria-label="Input test controls"
		style={{ fontSize: 11, minHeight: 48 }}
	>
		{["live", "other", "none", "unselected", "full", "error"].map((value) => (
			<button
				key={value}
				type="button"
				onClick={() => {
					mode = value;
				}}
			>
				Input: {value}
			</button>
		))}
		<button
			type="button"
			onClick={() => {
				notes = notes === 4 ? 7 : 4;
			}}
		>
			Edit selected notes
		</button>
		<div id="input-request">Request MIDI: not sent</div>
		<style>
			{
				"#root > div:nth-child(2) > div { height: calc(100dvh - 92px) !important; }"
			}
		</style>
	</section>,
);
