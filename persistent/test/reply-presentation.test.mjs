import assert from "node:assert/strict";
import test from "node:test";
import {
	clipCreationUnavailable,
	replyPresentation,
} from "../src/reply-presentation.mjs";

test("creation feedback dims unavailable destinations without blocking empty MIDI slots", () => {
	assert.equal(
		clipCreationUnavailable({ connected: false }),
		"Please select a clip.",
	);
	assert.equal(
		clipCreationUnavailable({
			connected: false,
			error: "Select a MIDI clip or empty slot on a MIDI track.",
		}),
		"Please select a clip.",
	);
	assert.equal(
		clipCreationUnavailable({ connected: true, source: null }),
		undefined,
	);
	assert.equal(
		clipCreationUnavailable({ connected: true, source: { title: "Input" } }),
		undefined,
	);
	assert.equal(
		clipCreationUnavailable({ connected: true, checking: true }),
		"Checking Live…",
	);
});

test("creation feedback preserves connector and full-track errors", () => {
	for (const error of [
		"The Live connector is not responding.",
		"Add an empty scene on this track. Existing clips will not be overwritten.",
	])
		assert.equal(clipCreationUnavailable({ connected: false, error }), error);
});

test("model attribution moves to the footer without changing stored response text", () => {
	const turn = {
		result: { explanation: "A gentle melody.\n\nModel: served-model" },
		calls: [{ status: "Received", model: "served-model" }],
	};
	const before = JSON.stringify(turn);
	assert.deepEqual(replyPresentation(turn), {
		explanation: "A gentle melody.",
		model: "served-model",
	});
	assert.equal(JSON.stringify(turn), before);
});

test("final received metadata wins over requested aliases, prose and earlier attempts", () => {
	const turn = {
		result: { explanation: "A phrase.\n\nModel: old-label" },
		calls: [
			{ status: "Received", model: "first-model" },
			{
				status: "Received",
				model: "actual-final-model",
				requestedModel: "auto",
			},
		],
	};
	assert.equal(replyPresentation(turn).model, "actual-final-model");
	turn.calls[1].model = null;
	assert.equal(replyPresentation(turn).model, "not reported");
});

test("legacy appended attribution remains available and musical prose is preserved", () => {
	assert.deepEqual(
		replyPresentation({
			result: {
				explanation:
					"Model: a repeating motif.\n\nMore music.\n\nModel: legacy-model",
			},
			calls: [],
		}),
		{
			explanation: "Model: a repeating motif.\n\nMore music.",
			model: "legacy-model",
		},
	);
	assert.deepEqual(
		replyPresentation({
			result: { explanation: "Model: part of the prose." },
			calls: [],
		}),
		{
			explanation: "Model: part of the prose.",
			model: "not reported",
		},
	);
	assert.deepEqual(replyPresentation({ calls: [] }), {
		explanation: "",
		model: "not reported",
	});
});
