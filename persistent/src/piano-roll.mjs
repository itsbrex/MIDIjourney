export const ROLL_WIDTH = 640;
export const ROLL_HEIGHT = 128;
export const KEY_WIDTH = 24;

// Read-only geometry. Guard saved/malformed data against invalid SVG coordinates.
export function pianoRoll(notes, duration) {
	const valid = (Array.isArray(notes) ? notes : [])
		.slice(0, 2048)
		.filter(
			(note) =>
				Number.isInteger(note?.pitch) &&
				note.pitch >= 0 &&
				note.pitch <= 127 &&
				Number.isFinite(note.start_time) &&
				note.start_time >= 0 &&
				Number.isFinite(note.duration) &&
				note.duration > 0 &&
				Number.isFinite(note.velocity),
		);
	if (!valid.length) return null;
	const pitches = valid.map((note) => note.pitch);
	const lowest = Math.min(...pitches),
		highest = Math.max(...pitches);
	const span = Math.min(128, Math.max(12, highest - lowest + 5));
	const low = Math.max(
		0,
		Math.min(128 - span, Math.floor((lowest + highest - span + 1) / 2)),
	);
	const high = Math.min(127, low + span - 1);
	const rows = high - low + 1;
	const rowHeight = ROLL_HEIGHT / rows;
	const end = Math.max(
		1,
		Number.isFinite(duration) ? duration : 0,
		...valid.map((note) => note.start_time + note.duration),
	);
	const scale = (ROLL_WIDTH - KEY_WIDTH) / end;
	const step = Math.max(1, 2 ** Math.ceil(Math.log2(end / 16)));
	return {
		low,
		high,
		rows: Array.from({ length: rows }, (_, index) => {
			const pitch = high - index;
			return {
				pitch,
				y: index * rowHeight,
				height: rowHeight,
				black: [1, 3, 6, 8, 10].includes(pitch % 12),
			};
		}),
		grid: Array.from(
			{ length: Math.ceil(end / step) },
			(_, i) => KEY_WIDTH + i * step * scale,
		),
		notes: valid.map((note, index) => ({
			id: index,
			pitch: note.pitch,
			velocity: note.velocity,
			x: KEY_WIDTH + note.start_time * scale,
			y: (high - note.pitch) * rowHeight + rowHeight * 0.12,
			width: Math.min(
				ROLL_WIDTH - KEY_WIDTH - note.start_time * scale,
				Math.max(0.8, note.duration * scale),
			),
			height: rowHeight * 0.76,
			opacity: 0.4 + (Math.max(0, Math.min(127, note.velocity)) / 127) * 0.6,
		})),
	};
}
