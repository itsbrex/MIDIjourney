import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createClip, currentContext } from "../src/jweb.mjs";
import { createChatSession } from "../src/chat-session.mjs";
import { normalizeChat } from "../src/session.mjs";

const { buildRequest } = createRequire(import.meta.url)("../../core/history.js");
const { CONFIG } = createRequire(import.meta.url)("../../core/config.js");

const source = await readFile(new URL("../../device/bridge.js", import.meta.url), "utf8");
const fixture = { title: "Persistent bridge test", duration: 4, notes: [
  { pitch: 60, start_time: 0, duration: 1, velocity: 96 },
  { pitch: 67, start_time: 2, duration: 1, velocity: 104 },
] };
function harness() {
  const objects = new Map([
    [1, { selected_track: ["id", 10], highlighted_clip_slot: ["id", 20], detail_clip: ["id", 0] }],
    [2, {}], [3, { focused_document_view: ["Session"] }],
    [10, { name: ["One"], has_midi_input: [1], clip_slots: ["id", 20, "id", 21] }],
    [11, { name: ["Two"], has_midi_input: [1], clip_slots: ["id", 22] }],
    [12, { name: ["Audio"], has_midi_input: [0] }],
    [20, { canonical_parent: ["id", 10], has_clip: [0], clip: ["id", 0] }],
    [21, { canonical_parent: ["id", 10], has_clip: [0], clip: ["id", 0] }],
    [22, { canonical_parent: ["id", 11], has_clip: [0], clip: ["id", 0] }],
  ]);
  const calls = [], responses = [], queue = [], dicts = new Map();
  let counter = 100;
  class Dict {
    constructor(name) { this.name = name || `dict-${++counter}`; }
    parse(raw) { dicts.set(this.name, JSON.parse(raw)); }
    stringify() { return JSON.stringify(dicts.get(this.name)); }
    freepeer() { dicts.delete(this.name); }
  }
  class LiveAPI {
    constructor(_, path) { this.id = path === "live_set view" ? 1 : path === "live_set" ? 2 : path === "live_app view" ? 3 : Number(path.slice(3)); }
    get(name) { if (!objects.has(this.id)) throw new Error("Deleted"); return objects.get(this.id)[name]; }
    set(name, value) { calls.push([this.id, "set", name]); objects.get(this.id)[name] = [value]; }
    call(name, ...args) {
      calls.push([this.id, name]);
      const object = objects.get(this.id);
      if (!object) throw new Error("Deleted");
      if (name === "create_clip") {
        assert.equal(object.has_clip[0], 0);
        const id = ++counter;
        objects.set(id, { name: [""], is_midi_clip: [1], length: [args[0]], notes: [] });
        object.clip = ["id", id]; object.has_clip = [1];
        return;
      }
      if (name === "get_notes_extended" || name === "get_all_notes_extended") {
        if (name === "get_all_notes_extended") assert.equal(args.length, 0);
        const d = new Dict(); d.parse(JSON.stringify({ notes: object.notes })); return ["dictionary", d.name];
      }
      if (name === "add_new_notes") {
        assert.equal(args.length, 1, "JS LiveAPI takes one Dict, not a dictionary/name message");
        assert.ok(args[0] instanceof Dict);
        object.notes = structuredClone(dicts.get(args[0].name).notes);
        return;
      }
      throw new Error(`Unsupported Live API function: ${name}`);
    }
  }
  class Task {
    constructor(fn) { this.fn = fn; }
    schedule() { queue.push(this); }
    cancel() { this.canceled = true; }
  }
  const context = vm.createContext({ LiveAPI, Task, Dict, Array, JSON, arrayfromargs: args => Array.from(args),
    post() {},
    outlet: (...args) => { if (args[1] === "response") responses.push({ id: args[2], ...JSON.parse(args[3]) }); } });
  vm.runInContext(source, context);
  context.init();
  return { context, objects, calls, responses,
    select(track, slot) {
      objects.get(1).selected_track = ["id", track]; objects.get(1).highlighted_clip_slot = ["id", slot];
      objects.get(1).detail_clip = objects.get(slot)?.clip || ["id", 0];
    },
    target(fresh = false) { context.context("target", fresh); return responses.at(-1).context; },
    input(notes = fixture.notes) {
      objects.set(30, { name: [fixture.title], is_midi_clip: [1], length: [fixture.duration], notes: structuredClone(notes) });
      objects.get(20).has_clip = [1]; objects.get(20).clip = ["id", 30]; this.select(10, 20);
      return objects.get(30);
    },
    create(id = "create-one", target = this.target().target, clip = fixture) { context.create(id, JSON.stringify({ target, clip })); },
    flush() { let limit = 100; while (queue.length && --limit) { const t = queue.shift(); if (!t.canceled) t.fn(); } assert.ok(limit); },
  };
}
test("selection follows different slots/tracks without writing", () => {
  const h = harness(); assert.equal(h.target().destination, "One · empty slot 1");
  h.select(10, 21); assert.equal(h.target().destination, "One · empty slot 2");
  h.select(11, 22); assert.equal(h.target().destination, "Two · empty slot 1");
  assert.equal(h.calls.length, 0);
});

test("native writer accepts the shared output limits and rejects values beyond them", () => {
  const h = harness();
  const longClip = {...fixture, title: "x".repeat(CONFIG.maxTitleLength), duration: CONFIG.maxClipBeats};
  assert.equal(h.context.validate(longClip).duration, CONFIG.maxClipBeats);
  assert.throws(() => h.context.validate({...longClip, duration: CONFIG.maxClipBeats + 1}), /Invalid MIDI clip/);
  assert.throws(() => h.context.validate({...longClip, title: longClip.title + "x"}), /Invalid MIDI clip/);
  assert.throws(() => h.context.validate({...fixture, notes: [{...fixture.notes[0], velocity: 80.5}]}), /Invalid MIDI note/);
});
test("audio selection invalidates the previous MIDI target", () => {
  const h = harness(); h.target(); h.select(12, 20); assert.equal(h.target().connected, false);
  h.select(11, 20); assert.equal(h.target().connected, false);
});
test("stale destinations and malformed notes never mutate Live", () => {
  const h = harness(), old = h.target().target; h.select(11, 22); h.create("old", old);
  assert.match(h.responses.at(-1).error, /selection changed/);
  h.create("invalid", h.target().target, { ...fixture, notes: [{ ...fixture.notes[0], pitch: -1 }] });
  assert.match(h.responses.at(-1).error, /Invalid MIDI note/);
  assert.equal(h.calls.length, 0);
});
test("create acknowledges verified notes, stays available, and prevents replay", () => {
  const h = harness(); h.create(); h.flush();
  assert.equal(h.responses.at(-1).ok, true); assert.equal(h.responses.at(-1).noteCount, 2);
  const creations = () => h.calls.filter(c => c[1] === "create_clip").length;
  h.create(); assert.equal(creations(), 1);
  h.select(11, 22); h.create("create-two"); h.flush();
  assert.equal(creations(), 2); assert.equal(h.responses.at(-1).destination, "Two · empty slot 1");
  assert.equal(h.calls.filter(c => /undo_step/.test(c[1])).length, 0);
});
test("selection changes while writing do not redirect the write", () => {
  const h = harness(); h.create(); h.select(11, 22); h.flush();
  assert.equal(h.objects.get(22).has_clip[0], 0); assert.equal(h.responses.at(-1).destination, "One · empty slot 1");
});
test("clip replaced before acknowledgement is never written again", () => {
  const h = harness(); h.create();
  h.objects.get(20).clip = ["id", 999];
  h.flush(); assert.equal(h.responses.at(-1).ok, false);
  assert.equal(h.calls.filter(c => c[1] === "add_new_notes").length, 1);
});
test("read-back mismatch reports the exact field without silently accepting it", () => {
  const h = harness(); h.create();
  const created = h.objects.get(h.objects.get(20).clip[1]);
  created.notes[0].duration += 0.01;
  h.flush();
  assert.equal(h.responses.at(-1).ok, false);
  assert.match(h.responses.at(-1).error, /duration differs by 0.010000/);
  assert.equal(h.calls.filter(c => c[1] === "add_new_notes").length, 1);
});
test("occupied source clip stays unchanged and the next empty slot is used", () => {
  const h = harness(); h.create(); h.flush();
  h.select(10, 20);
  const original = h.objects.get(h.objects.get(20).clip[1]);
  const before = structuredClone(original);
  const target = h.target();
  assert.equal(target.destination, "One · empty slot 2");
  assert.equal(target.source.notes.length, 2);
  h.create("next", target.target); h.flush();
  assert.equal(h.responses.at(-1).ok, true);
  assert.deepEqual(original, before);
  assert.equal(h.target().connected, false);
  assert.equal(h.target().source.notes.length, 2, "a full track must not hide MIDI input");
});

test("Session input clears on an empty slot even when detail_clip still contains the old MIDI", () => {
  const h = harness(); h.input();
  assert.equal(h.target().sourceId, "30");
  h.select(10, 21); h.objects.get(1).detail_clip = ["id", 30];
  assert.equal(h.target().source, null);
  assert.equal(h.target().sourceId, "");
  h.select(10, 20); assert.equal(h.target().sourceId, "30");
  h.select(12, 20); h.objects.get(1).detail_clip = ["id", 30];
  assert.equal(h.target().source, null);
  h.select(11, 20); assert.equal(h.target().source, null, "a stale slot on another track is not input");
  h.select(10, 0); assert.equal(h.target().source, null);
});

test("Session input changes with the highlighted clip, without reusing stale detail MIDI", () => {
  const h = harness(); h.input();
  h.objects.set(31, { name: ["Chords"], is_midi_clip: [1], length: [8], notes: [{ ...fixture.notes[0], pitch: 72 }] });
  h.objects.get(22).has_clip = [1]; h.objects.get(22).clip = ["id", 31];
  h.select(11, 22); h.objects.get(1).detail_clip = ["id", 30];
  assert.equal(h.target().sourceId, "31");
  assert.equal(h.target().source.notes[0].pitch, 72);
  assert.equal(h.target().connected, false, "input stays readable even on a full track");
});

test("Arrangement input still follows detail_clip independently of the Session output slot", () => {
  const h = harness(); h.input();
  h.objects.get(3).focused_document_view = ["Arranger"];
  h.select(11, 22);
  h.objects.get(1).detail_clip = ["id", 30];
  const target = h.target();
  assert.equal(target.destination, "Two · empty slot 1");
  assert.equal(target.sourceId, "30");
  assert.deepEqual(target.source.notes, fixture.notes);
  h.select(12, 0); h.objects.get(1).detail_clip = ["id", 30];
  assert.equal(h.target().connected, false);
  assert.deepEqual(h.target().source.notes, fixture.notes);
  assert.ok(h.calls.every(call => call[1] === "get_all_notes_extended"));
});

test("fresh input rereads in-place edits, and clearing or selecting audio removes old input", () => {
  const h = harness(), clip = h.input();
  assert.equal(h.target().source.notes[0].pitch, 60);
  clip.notes[0].pitch = 42; clip.name = ["Edited in Live"];
  assert.equal(h.target(true).source.notes[0].pitch, 42);
  assert.equal(h.target().source.title, "Edited in Live");
  h.objects.get(1).detail_clip = ["id", 0];
  h.select(10, 21);
  assert.equal(h.target().source, null);
  clip.is_midi_clip = [0]; h.select(10, 20);
  assert.equal(h.target().source, null);
  assert.ok(h.calls.every(call => call[1] === "get_all_notes_extended"));
});

test("original Max input technique and persistent request have matching MIDI semantics", async () => {
  function texts(patcher) {
    return patcher.boxes.flatMap(({ box }) => [box.text, ...(box.patcher ? texts(box.patcher) : [])]);
  }
  // Unmodified golden fixtures from archive commit 6f326a1, not runtime dependencies.
  const inputPatch = JSON.parse(await readFile(new URL("./fixtures/original-input.maxpat", import.meta.url))).patcher;
  const importPatch = JSON.parse(await readFile(new URL("./fixtures/original-import.maxpat", import.meta.url))).patcher;
  assert.ok(texts(inputPatch).includes("live.path live_set view detail_clip"));
  assert.ok(texts(importPatch).includes("call get_all_notes_extended"));
  // Keep the original shared sanitizer's limits, mute handling and fractional
  // velocity, rather than introducing a second 1024-beat/prefiltered read.
  const notes = Array.from({ length: CONFIG.maxInputNotes + 2 }, (_, i) => ({
    pitch: i % 128, start_time: i / 2, duration: 0.25, velocity: 81.5, mute: i === 0 ? 1 : 0,
  }));
  notes[1].start_time = 1500;
  const h = harness(), clip = h.input(notes);
  clip.length = [2048]; h.objects.get(21).has_clip = [1];
  const before = structuredClone(clip);
  const context = h.target(true);
  assert.equal(context.connected, false);
  assert.equal(context.source.notes.length, notes.length);
  const promptText = "Rework this MIDI";
  const original = buildRequest({ promptText, title: fixture.title, duration: 2048, notes });
  let actual;
  const session = createChatSession({
    initial: normalizeChat(null), save: () => true,
    readContext: async () => h.target(true),
    createGenerator: () => ({ generate: async input => {
      actual = buildRequest(input);
      return { ...fixture, explanation: "Test", key: null, history: [] };
    } }),
  });
  session.setDraft(promptText); await session.generate();
  assert.deepEqual(actual, original);
  assert.ok(actual.sourceClip.notes.some(note => note.start_time === 1500));
  assert.equal(actual.sourceClip.notes.length, CONFIG.maxInputNotes - 1);
  assert.equal(actual.sourceClip.notes[0].velocity, 81.5);
  assert.deepEqual(clip, before);
  assert.ok(h.calls.every(call => call[1] === "get_all_notes_extended"));
});

test("unreadable selected MIDI fails generation instead of silently using another source", async () => {
  const h = harness(), clip = h.input();
  h.target(); clip.notes = null;
  const context = h.target(true);
  assert.equal(context.connected, true, "output availability is independent of input errors");
  assert.equal(context.source, null);
  assert.match(context.sourceError, /Could not read the selected MIDI clip/);
  let calls = 0;
  const session = createChatSession({
    initial: normalizeChat(null), save: () => true,
    readContext: async () => h.target(true),
    createGenerator: () => { calls++; throw new Error("Must not run"); },
  });
  session.setDraft("Refine the selected clip"); await session.generate();
  assert.equal(calls, 0);
  assert.match(session.getSnapshot().turns[0].error, /Could not read/);
  h.context.notifydeleted();
  session.setDraft("Try after the connector stopped"); await session.generate();
  assert.equal(calls, 0);
  assert.match(session.getSnapshot().turns[1].error, /Could not read Live's MIDI input/);
});
test("in-flight duplicate requests and concurrent writes cannot create twice", () => {
  const h = harness(); h.create(); h.create(); h.create("another"); h.flush();
  assert.equal(h.calls.filter(c => c[1] === "create_clip").length, 1);
  assert.equal(h.responses.at(-1).ok, true);
});
test("Max list messages dispatch only explicitly supported bridge actions", () => {
  const h = harness(); h.context.list("context", "read-one", 0); assert.equal(h.responses.at(-1).ok, true);
  h.context.list("eval", "bad", "delete everything"); assert.equal(h.calls.length, 0);
});
test("jweb transport sends only musical data and waits for acknowledgement", async () => {
  let receive, sent;
  const host = { max: { bindInlet: (_, callback) => { receive = callback; }, outlet: (...args) => { sent = args; } } };
  const pending = createClip(host, { ...fixture, history: ["private prompt"], apiKey: "not-sent" }, "target");
  assert.equal(sent[0], "create"); assert.doesNotMatch(sent[2], /history|apiKey|close_and_send/);
  receive(sent[1], JSON.stringify({ ok: true, noteCount: 2 })); assert.equal((await pending).noteCount, 2);
  const next = currentContext(host); receive(sent[1], JSON.stringify({ ok: true, context: { connected: true } }));
  assert.equal((await next).connected, true);
});
