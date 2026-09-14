export type Note = {
	pitch: number;
	start_time: number;
	duration: number;
	velocity: number;
};
export type CallEntry = {
	id: number;
	startedAt: string;
	requestedModel: string | null;
	model: string | null;
	status: string;
	durationMs: number;
	messageCount: number;
	finishReason: string | null;
	usage: {
		input: number | null;
		output: number | null;
		total: number | null;
		cached: number | null;
		reasoning: number | null;
	};
	error?: { code: string | null; httpStatus: number | null };
	output?: {
		validation: string;
		title?: string | null;
		key?: string | null;
		duration?: number;
		noteCount?: number;
		pitchRange?: number[] | null;
		notes?: Note[];
		omittedNotes?: number;
	};
};
export type HistoryEntry = {
	role: "user" | "assistant";
	content: string;
	contextContent: string;
};
export type MidiResult = {
	title: string;
	explanation: string;
	key: string | null;
	duration: number;
	notes: Note[];
	history: HistoryEntry[];
};
export type LiveContext = {
	connected: boolean;
	destination?: string;
	source?: { title: string; duration: number; notes: Note[] } | null;
	error?: string;
};
