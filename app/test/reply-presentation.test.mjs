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

test("creation feedback preserves connector and recording errors", () => {
	for (const error of [
		"The Live connector is not responding.",
		"Stop recording into the selected clip before replacing it.",
	])
		assert.equal(clipCreationUnavailable({ connected: false, error }), error);
});

test("legacy model attribution is hidden without changing stored response text", () => {
	const turn = {
		result: { explanation: "A gentle melody.\n\nModel: served-model" },
		calls: [{ status: "Received", model: "served-model" }],
	};
	const before = JSON.stringify(turn);
	assert.deepEqual(replyPresentation(turn), {
		explanation: "A gentle melody.",
	});
	assert.equal(JSON.stringify(turn), before);
});

test("requested models, actual models and earlier attempts never become visible labels", () => {
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
	assert.deepEqual(replyPresentation(turn), { explanation: "A phrase." });
	turn.calls[1].model = null;
	assert.deepEqual(replyPresentation(turn), { explanation: "A phrase." });
});

test("legacy appended attribution is removed while musical prose is preserved", () => {
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
		},
	);
	assert.deepEqual(
		replyPresentation({
			result: { explanation: "Model: part of the prose." },
			calls: [],
		}),
		{
			explanation: "Model: part of the prose.",
		},
	);
	assert.deepEqual(replyPresentation({ calls: [] }), {
		explanation: "",
	});
});

test("old replies containing only model attribution render an empty explanation", () => {
	for (const model of [
		"served-model",
		"9a0db868-29cb-4e78-9d44-ba2be6551337",
		"not reported",
	]) {
		const turn = {
			result: { explanation: `Model: ${model}` },
			calls: [{ status: "Received", model }],
		};
		const before = JSON.stringify(turn);
		assert.deepEqual(replyPresentation(turn), { explanation: "" });
		assert.equal(JSON.stringify(turn), before);
	}
	assert.deepEqual(
		replyPresentation({ result: { explanation: "Model: not reported" } }),
		{ explanation: "" },
	);
});
