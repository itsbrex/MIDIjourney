import test from "node:test";
import assert from "node:assert/strict";
import { captureTarget, parseDialogResult } from "../src/live-target.mjs";

let nextId = 0n;
class DataModelObject { handle = { id: ++nextId }; parent = null; }
class MidiTrack extends DataModelObject { name = "MIDI"; clipSlots = []; }
class MidiClip extends DataModelObject { name = "Source"; duration = 8; notes = [{ pitch: 64, startTime: 0, duration: 1, velocity: 80 }]; }
class ClipSlot extends DataModelObject {
  clip = null;
  async createMidiClip(length) {
    this.clip = new MidiClip(); this.clip.duration = length; this.clip.parent = this;
    return this.clip;
  }
}
const sdk = { DataModelObject, MidiTrack, MidiClip, ClipSlot };
const valid = { title: "New phrase", explanation: "", key: null, duration: 4, notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 100 }] };

function fixture(withSource = false) {
  const track = new MidiTrack();
  const a = new ClipSlot(); const b = new ClipSlot();
  a.parent = track; b.parent = track; track.clipSlots = [a, b];
  if (withSource) { a.clip = new MidiClip(); a.clip.parent = a; }
  const objects = new Map([track, a, b, a.clip].filter(Boolean).map((object) => [object.handle.id, object]));
  const context = {
    getObjectFromHandle: (handle) => {
      const object = objects.get(handle.id) || [a.clip, b.clip].find((clip) => clip?.handle.id === handle.id);
      if (!object) throw new Error("Deleted target"); return object;
    },
    withinTransaction: (action) => action(),
  };
  return { track, a, b, context, objects };
}

test("SDK adapter creates an empty-slot MIDI clip with camelCase note fields", async () => {
  const { a, context } = fixture();
  const target = captureTarget(context, a.handle, sdk);
  const result = await target.create(valid);
  assert.equal(result.noteCount, 1);
  assert.equal(a.clip.name, "New phrase");
  assert.deepEqual(a.clip.notes[0], { pitch: 60, startTime: 0, duration: 1, velocity: 100 });
  assert.equal(a.clip.looping, true);
});

test("source clip stays intact; variations target a captured empty slot", async () => {
  const { a, b, context } = fixture(true);
  const original = structuredClone(a.clip.notes);
  const target = captureTarget(context, a.clip.handle, sdk);
  assert.equal(target.publicContext.source.notes[0].start_time, 0);
  await target.create(valid);
  assert.deepEqual(a.clip.notes, original);
  assert.equal(a.clip.name, "Source");
  assert.equal(b.clip.name, "New phrase");
});

test("occupied, deleted and moved destinations cannot be overwritten", async () => {
  for (const situation of ["occupied", "deleted", "moved"]) {
    const { a, context, objects } = fixture();
    const target = captureTarget(context, a.handle, sdk);
    if (situation === "occupied") a.clip = new MidiClip();
    if (situation === "deleted") objects.delete(a.handle.id);
    if (situation === "moved") a.parent = new MidiTrack();
    await assert.rejects(target.create(valid), /no longer empty|Deleted|destination changed/);
    if (a.clip) assert.equal(a.clip.name, "Source");
  }
});

test("invalid provider MIDI is rejected before any clip is created", async () => {
  const { a, context } = fixture();
  const target = captureTarget(context, a.handle, sdk);
  await assert.rejects(target.create({ ...valid, notes: [{ pitch: 999 }] }), /invalid MIDI/);
  assert.equal(a.clip, null);
});

test("double apply never replaces the first generated clip", async () => {
  const { a, context } = fixture();
  const target = captureTarget(context, a.handle, sdk);
  await target.create(valid);
  await assert.rejects(target.create(valid), /already received/);
});

test("no empty slots and non-MIDI targets are rejected", () => {
  const { a, b, context, track } = fixture(true);
  b.clip = new MidiClip();
  assert.throws(() => captureTarget(context, a.handle, sdk), /no empty clip slot/);
  a.parent = new DataModelObject();
  assert.throws(() => captureTarget(context, a.handle, sdk), /MIDI track/);
  assert.equal(track.name, "MIDI");
});

test("dialog cancel is harmless; malformed/oversize messages cannot create a clip", () => {
  assert.equal(parseDialogResult(""), null);
  assert.equal(parseDialogResult('{"action":"cancel"}'), null);
  assert.throws(() => parseDialogResult("not json"), /invalid/);
  assert.throws(() => parseDialogResult("x".repeat(1_000_001)), /too large/);
  assert.throws(() => parseDialogResult('{"action":"delete"}'), /did not return/);
  assert.deepEqual(parseDialogResult(JSON.stringify({ action: "create", clip: valid })), valid);
});
