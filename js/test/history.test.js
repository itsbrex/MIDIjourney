const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendHistory,
  buildContext,
  buildRequest,
  normalizeHistory,
  redactSecrets,
} = require("../history.js");
const { CONFIG } = require("../config.js");

test("redacts Pollinations credentials from history", () => {
  const secret = ["sk", "abcdefghijklmnopqrstuvwxyz"].join("_");
  const publishable = ["pk", "abcdefghijklmnopqrstuvwxyz"].join("_");
  assert.equal(redactSecrets(`token ${secret}`), "token [redacted credential]");
  const history = normalizeHistory([
    { role: "user", content: publishable },
  ]);
  assert.equal(history[0].content, "[redacted credential]");
});

test("builds a safe structured request", () => {
  const request = buildRequest({
    promptText: "Create a bass line",
    duration: 8,
    notes: [{ pitch: 36, start_time: 0, duration: 1, velocity: 100, note_id: 7 }],
  });
  assert.equal(request.instruction, "Create a bass line");
  assert.equal(request.sourceClip.notes[0].pitch, 36);
  assert.equal("note_id" in request.sourceClip.notes[0], false);
});

test("bounds invalid requested clip durations", () => {
  assert.equal(buildRequest({ promptText: "Create a groove", duration: 5000 }).requestedDuration, 8);
  assert.equal(buildRequest({ promptText: "Create a groove", duration: -2 }).requestedDuration, 8);
});

test("does not send history when history mode is disabled", () => {
  const history = [{ role: "user", content: "old prompt" }];
  assert.deepEqual(buildContext(history, false), []);
  assert.equal(buildContext(history, true).length, 1);
});

test("keeps display history separate from model context", () => {
  const request = buildRequest({ promptText: "Create chords", duration: 4 });
  const clip = {
    title: "Soft Chords",
    explanation: "Warm voicings.",
    key: "C major",
    duration: 4,
    notes: [{ pitch: 60, start_time: 0, duration: 4, velocity: 80 }],
  };
  const history = appendHistory([], request, clip);
  assert.match(history[0].content, /# Prompt/);
  assert.deepEqual(JSON.parse(history[0].contextContent), request);
  assert.match(history[1].content, /notation:/);
  assert.deepEqual(JSON.parse(history[1].contextContent), clip);
});

test("bounds both stored entries and total model context", () => {
  const oversized = "x".repeat(CONFIG.maxHistoryEntryLength + 1000);
  const normalized = normalizeHistory([{ role: "user", content: oversized }]);
  assert.equal(normalized[0].content.length, CONFIG.maxHistoryEntryLength);
  assert.equal(normalized[0].contextContent.length, CONFIG.maxContextEntryLength);

  const context = buildContext(
    Array.from({ length: CONFIG.maxContextMessages }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: "x".repeat(CONFIG.maxContextEntryLength),
    })),
    true,
  );
  assert.ok(
    context.reduce((total, entry) => total + entry.content.length, 0) <=
      CONFIG.maxContextCharacters,
  );
  assert.ok(context.length < CONFIG.maxContextMessages);
});

test("keeps large MIDI context as valid bounded JSON", () => {
  const notes = Array.from({ length: CONFIG.maxOutputNotes }, (_, index) => ({
    pitch: 36 + (index % 48),
    start_time: index,
    duration: 0.25,
    velocity: 100,
  }));
  const request = {
    instruction: "Continue this dense clip",
    requestedDuration: 4096,
    sourceClip: { title: "Dense", key: null, duration: 4096, notes },
  };
  const clip = {
    title: "Dense Result",
    explanation: "A bounded stress-test result.",
    key: null,
    duration: 4096,
    notes,
  };
  const history = appendHistory([], request, clip);

  for (const entry of history) {
    assert.ok(entry.contextContent.length <= CONFIG.maxContextEntryLength);
    assert.doesNotThrow(() => JSON.parse(entry.contextContent));
  }
  assert.ok(JSON.parse(history[1].contextContent).notes.length < notes.length);
});
