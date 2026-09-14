import midiStudio from "./assets/midi-studio.png";

export function ChatBottomScene() {
	return (
		<div className="mj-chat-bottom-scene" aria-hidden="true">
			<img
				src={midiStudio}
				alt=""
				width={2172}
				height={724}
				decoding="async"
				draggable={false}
			/>
		</div>
	);
}
