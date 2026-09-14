import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PollinationsError } from "@pollinations/sdk";
import { CONFIG, PollinationsMidiClient } from "../.generated/midi-core.mjs";
import { loadWorkspace, saveWorkspace, sendClipToLive, SESSION_KEY } from "../src/session.mjs";

const clip = { title: "Quiet idea", explanation: "A simple phrase.", key: "A minor", duration: 8,
  notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 92 }] };

test("browser core reuses generation validation and actual model attribution", async () => {
  let options;
  const midi = new PollinationsMidiClient({ auth: { requireClient: () => ({
    chat: async (_messages, request) => {
      options = request;
      return { model: "actual-serving-model", choices: [{ message: { content: JSON.stringify(clip) } }] };
    },
  }) } });
  const result = await midi.generate({ promptText: "A quiet idea", duration: 8 });
  assert.equal(options.model, "openai");
  assert.equal(result.notes.length, 1);
  assert.match(result.explanation, /Model: actual-serving-model$/);
  assert.equal(result.history.length, 2);
});

test("browser core and React app share the SDK error class", async () => {
  let invalidated = false;
  const midi = new PollinationsMidiClient({ auth: {
    requireClient: () => ({ chat: async () => { throw new PollinationsError("Denied", "AUTH", 401); } }),
    invalidate: () => { invalidated = true; },
  } });
  await assert.rejects(midi.generate({ promptText: "MIDI" }), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(invalidated, true);
});

test("canceled generation does not return a late result", async () => {
  let complete;
  const pending = new Promise((done) => { complete = done; });
  const midi = new PollinationsMidiClient({ auth: { requireClient: () => ({ chat: () => pending }) } });
  const request = midi.generate({ promptText: "MIDI" });
  midi.cancel();
  complete({ choices: [{ message: { content: JSON.stringify(clip) } }] });
  await assert.rejects(request, { code: "CANCELED" });
});

test("browser core contains no release config, keychain access or app key", async () => {
  const source = await readFile(new URL("../.generated/midi-core.mjs", import.meta.url), "utf8");
  assert.equal(CONFIG.appKey, undefined);
  assert.doesNotMatch(source, /config\.release|credentialStore|MIDIJOURNEY_POLLINATIONS_APP_KEY|\bpk_[A-Za-z0-9_-]{12,}/);
});

test("history is bounded, credential-redacted, restored and kept separate from SDK storage", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) };
  saveWorkspace(storage, { prompt: "Keep this melody", duration: 16, apiKey: "not-to-be-saved", history: [{ role: "user", content: "A melody" }] });
  assert.deepEqual([...data.keys()], [SESSION_KEY]);
  assert.equal(loadWorkspace(storage).prompt, "Keep this melody");
  assert.equal(loadWorkspace(storage).history.length, 1);
  assert.doesNotMatch(data.get(SESSION_KEY), /not-to-be-saved|apiKey/);
  data.set(SESSION_KEY, "invalid json");
  assert.equal(loadWorkspace(storage).history.length, 0);
  assert.equal(saveWorkspace({ setItem() { throw new Error("Storage denied"); } }, {}), false);
});

test("UI result crosses only the documented Ableton message bridge, without history or auth", () => {
  for (const platform of ["mac", "win"]) {
    let sent;
    const receiver = { postMessage: (message) => { sent = message; } };
    const host = platform === "mac" ? { webkit: { messageHandlers: { live: receiver } } } : { chrome: { webview: receiver } };
    sendClipToLive(host, { ...clip, history: [{ role: "user", content: "private context" }], apiKey: "not-to-be-sent" });
    assert.equal(sent.method, "close_and_send");
    assert.equal(JSON.parse(sent.params[0]).clip.notes[0].pitch, 60);
    assert.doesNotMatch(sent.params[0], /private context|apiKey|history/);
  }
  assert.throws(() => sendClipToLive({}, clip), /Extensions menu/);
});
