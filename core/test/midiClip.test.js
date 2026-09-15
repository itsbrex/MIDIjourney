const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MidiValidationError,
  normalizeMidiClip,
  parseMidiClipResponse,
  sanitizeInputNotes,
  validateNotes,
} = require("../encoding/midiClip.js");

const validClip = {
  title: "Night Pulse",
  explanation: "A syncopated minor pattern.",
  key: "C minor",
  duration: 4,
  notes: [
    { pitch: 60, start_time: 1, duration: 0.5, velocity: 80 },
    { pitch: 0, start_time: 0, duration: 1, velocity: 127 },
  ],
};

test("accepts MIDI boundary values and sorts notes", () => {
  const clip = normalizeMidiClip(validClip);
  assert.equal(clip.notes[0].pitch, 0);
  assert.equal(clip.notes[0].velocity, 127);
  assert.equal(clip.notes[0].mute, 0);
  assert.deepEqual(validateNotes(clip.notes), []);
});

test("reports every invalid note instead of only the last note", () => {
  const errors = validateNotes([
    { pitch: -1, start_time: -1, duration: 0, velocity: 0 },
    { pitch: 60, start_time: 1, duration: 1, velocity: 100 },
  ]);
  assert.equal(errors.length, 4);
  assert.match(errors.join(", "), /notes\[0\]\.pitch/);
});

test("keeps velocity zero invalid for generated MIDI", () => {
  assert.throws(
    () =>
      normalizeMidiClip({
        ...validClip,
        notes: [{ pitch: 60, start_time: 0, duration: 1, velocity: 0 }],
      }),
    (error) =>
      error instanceof MidiValidationError &&
      error.details.includes("notes[0].velocity must be an integer from 1 to 127"),
  );
});

test("rejects non-finite and out-of-range values", () => {
  assert.throws(
    () =>
      normalizeMidiClip({
        ...validClip,
        notes: [{ pitch: 128, start_time: Number.NaN, duration: -1, velocity: 200 }],
      }),
    MidiValidationError,
  );
});

test("rejects notes that extend beyond the release clip limit", () => {
  assert.throws(
    () =>
      normalizeMidiClip({
        ...validClip,
        duration: 4096,
        notes: [{ pitch: 60, start_time: 4095.5, duration: 1, velocity: 100 }],
      }),
    (error) =>
      error instanceof MidiValidationError &&
      error.details.some((detail) => detail.includes("must end by beat 4096")),
  );
});

test("enforces metadata limits even when provider schema enforcement is bypassed", () => {
  assert.throws(
    () => normalizeMidiClip({ ...validClip, key: "x".repeat(41) }),
    MidiValidationError,
  );
  assert.throws(
    () => normalizeMidiClip({ ...validClip, explanation: "x".repeat(1001) }),
    MidiValidationError,
  );
});

test("expands duration to cover the final note", () => {
  const clip = normalizeMidiClip({
    ...validClip,
    duration: 1,
    notes: [{ pitch: 64, start_time: 3, duration: 2, velocity: 90 }],
  });
  assert.equal(clip.duration, 5);
});

test("parses JSON with or without a JSON code fence", () => {
  const json = JSON.stringify(validClip);
  assert.equal(parseMidiClipResponse(json).title, validClip.title);
  assert.equal(parseMidiClipResponse(`\`\`\`json\n${json}\n\`\`\``).title, validClip.title);
});

test("rejects unreadable model output", () => {
  assert.throws(() => parseMidiClipResponse("not JSON"), MidiValidationError);
});

test("sanitizes source notes without mutating input order", () => {
  const source = [
    { pitch: 70, start_time: 2, duration: 1, velocity: 90, note_id: 99 },
    { pitch: 60, start_time: 0, duration: 1, velocity: 80 },
  ];
  const safe = sanitizeInputNotes(source);
  assert.equal(safe[0].pitch, 60);
  assert.equal(source[0].pitch, 70);
  assert.equal("note_id" in safe[1], false);
});

test("accepts Live source velocities and excludes muted source notes", () => {
  const safe = sanitizeInputNotes([
    { pitch: 60, start_time: 0, duration: 1, velocity: 0, mute: 0 },
    { pitch: 61, start_time: 1, duration: 1, velocity: 80, mute: 1 },
    { pitch: 62, start_time: 2, duration: 1, velocity: 90, mute: true },
    { pitch: 63, start_time: 3, duration: 1, velocity: 80.5, mute: false },
  ]);

  assert.deepEqual(safe, [
    { pitch: 60, start_time: 0, duration: 1, velocity: 0 },
    { pitch: 63, start_time: 3, duration: 1, velocity: 80.5 },
  ]);
});

test("rejects an ambiguous source mute value", () => {
  assert.throws(
    () =>
      sanitizeInputNotes([
        { pitch: 60, start_time: 0, duration: 1, velocity: 80, mute: 2 },
      ]),
    (error) =>
      error instanceof MidiValidationError &&
      error.details.includes("notes[0].mute must be 0, 1, false, or true"),
  );
});

test("rejects non-numeric source velocities instead of coercing them to zero", () => {
  for (const velocity of [null, false, "", "0"]) {
    assert.throws(
      () =>
        sanitizeInputNotes([
          { pitch: 60, start_time: 0, duration: 1, velocity, mute: 0 },
        ]),
      (error) =>
        error instanceof MidiValidationError &&
        error.details.includes("notes[0].velocity must be a finite number from 0 to 127"),
    );
  }
});
