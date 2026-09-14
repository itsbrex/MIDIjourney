import assert from "node:assert/strict";
import test from "node:test";
import { Pollinations } from "@pollinations/sdk";
import { PollinationsMidiClient } from "../.generated/midi-core.mjs";
import { observeChat } from "../src/call-log.mjs";
import { createChatSession } from "../src/chat-session.mjs";
import { copyDetails } from "../src/copy-details.mjs";
import { replyPresentation } from "../src/reply-presentation.mjs";
import { normalizeChat } from "../src/session.mjs";

const AGENT = "community/pollinations-router/midijourney";
const clip = {
	title: "Agent phrase",
	explanation: "A short musical variation.",
	key: "C major",
	duration: 8,
	notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 90 }],
};
const response = {
	model: "openai/gpt-6-astra",
	choices: [
		{ message: { content: JSON.stringify(clip) }, finish_reason: "stop" },
	],
	usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

test("the real chat session and SDK send the agent ID, fresh MIDI, and output contract", async (t) => {
	const requests = [];
	t.mock.method(globalThis, "fetch", async (url, init) => {
		assert.equal(new URL(url).pathname, "/v1/chat/completions");
		requests.push(JSON.parse(init.body));
		return Response.json(response);
	});
	const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
	let callId = 0;
	const session = createChatSession({
		initial: normalizeChat(null),
		save: () => true,
		readContext: async () => ({
			connected: true,
			target: "10:20:30:20",
			sourceId: "30",
			source: clip,
		}),
		writeClip: async () => assert.fail("Generation must not write to Live"),
		createGenerator: (onEntry) =>
			new PollinationsMidiClient({
				auth: {
					requireClient: () => observeChat(client, onEntry, () => ++callId),
				},
			}),
	});
	t.after(() => session.dispose());
	session.setDraft("Use GPT Astra model please");
	await session.generate();
	assert.equal(requests.length, 1);
	const body = requests[0];
	assert.equal(body.model, AGENT);
	assert.equal(body.stream, false);
	assert.equal(body.response_format.type, "json_schema");
	assert.deepEqual(
		JSON.parse(
			body.messages[0].content.split("Required output JSON schema:\n")[1],
		),
		body.response_format.json_schema.schema,
	);
	const input = JSON.parse(body.messages.at(-1).content);
	assert.equal(input.instruction, "Use GPT Astra model please");
	assert.deepEqual(input.sourceClip.notes, clip.notes);
	const turn = session.getSnapshot().turns.at(-1);
	assert.equal(turn.status, "complete");
	assert.equal(turn.calls[0].requestedModel, AGENT);
	assert.equal(replyPresentation(turn).model, response.model);
	const details = JSON.parse(copyDetails(turn));
	assert.equal(details.calls[0].requestedModel, AGENT);
	assert.equal(details.calls[0].reportedModel, response.model);
	assert.equal(details.calls[0].tokens.total, 150);
});

test("an SDK retry stays on the agent and never falls back to a direct model", async (t) => {
	const models = [];
	t.mock.method(globalThis, "fetch", async (_url, init) => {
		models.push(JSON.parse(init.body).model);
		return models.length === 1
			? Response.json(
					{ error: { message: "Temporarily unavailable" } },
					{ status: 503 },
				)
			: Response.json(response);
	});
	const client = new Pollinations({ apiKey: "test-only-not-a-credential" });
	const generator = new PollinationsMidiClient({
		auth: { requireClient: () => client },
	});
	const result = await generator.generate({
		promptText: "A short phrase",
		model: "openai",
	});
	assert.deepEqual(models, [AGENT, AGENT]);
	assert.equal(result.title, clip.title);
});
