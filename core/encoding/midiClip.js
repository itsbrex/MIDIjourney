const { CONFIG } = require("../config.js");

const MIDI_CLIP_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "explanation", "key", "duration", "notes"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: CONFIG.maxTitleLength },
    explanation: { type: "string", maxLength: 1000 },
    key: { type: ["string", "null"], maxLength: 40 },
    duration: { type: "number", exclusiveMinimum: 0, maximum: CONFIG.maxClipBeats },
    notes: {
      type: "array",
      minItems: 1,
      maxItems: CONFIG.maxOutputNotes,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pitch", "start_time", "duration", "velocity"],
        properties: {
          pitch: { type: "integer", minimum: 0, maximum: 127 },
          start_time: { type: "number", minimum: 0, maximum: CONFIG.maxClipBeats },
          duration: {
            type: "number",
            exclusiveMinimum: 0,
            maximum: CONFIG.maxClipBeats,
          },
          velocity: { type: "integer", minimum: 1, maximum: 127 },
        },
      },
    },
  },
});

class MidiValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "MidiValidationError";
    this.code = "INVALID_MIDI_RESPONSE";
    this.details = details;
  }
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateNote(note, index) {
  const errors = [];
  if (!note || typeof note !== "object" || Array.isArray(note)) {
    return [`notes[${index}] must be an object`];
  }
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) {
    errors.push(`notes[${index}].pitch must be an integer from 0 to 127`);
  }
  if (
    !isFiniteNumber(note.start_time) ||
    note.start_time < 0 ||
    note.start_time > CONFIG.maxClipBeats
  ) {
    errors.push(
      `notes[${index}].start_time must be between 0 and ${CONFIG.maxClipBeats}`,
    );
  }
  if (
    !isFiniteNumber(note.duration) ||
    note.duration <= 0 ||
    note.duration > CONFIG.maxClipBeats
  ) {
    errors.push(
      `notes[${index}].duration must be greater than 0 and no more than ${CONFIG.maxClipBeats}`,
    );
  }
  if (
    isFiniteNumber(note.start_time) &&
    isFiniteNumber(note.duration) &&
    note.start_time + note.duration > CONFIG.maxClipBeats
  ) {
    errors.push(`notes[${index}] must end by beat ${CONFIG.maxClipBeats}`);
  }
  if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) {
    errors.push(`notes[${index}].velocity must be an integer from 1 to 127`);
  }
  return errors;
}

function validateNotes(notes, { maxNotes = CONFIG.maxOutputNotes } = {}) {
  if (!Array.isArray(notes)) return ["notes must be an array"];
  if (notes.length === 0) return ["notes must contain at least one note"];
  if (notes.length > maxNotes) return [`notes cannot contain more than ${maxNotes} notes`];
  return notes.flatMap((note, index) => validateNote(note, index));
}

function validateSourceNote(note, index) {
  const errors = [];
  if (!note || typeof note !== "object" || Array.isArray(note)) {
    return [`notes[${index}] must be an object`];
  }
  if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) {
    errors.push(`notes[${index}].pitch must be an integer from 0 to 127`);
  }
  if (
    !isFiniteNumber(note.start_time) ||
    note.start_time < 0 ||
    note.start_time > CONFIG.maxClipBeats
  ) {
    errors.push(
      `notes[${index}].start_time must be between 0 and ${CONFIG.maxClipBeats}`,
    );
  }
  if (
    !isFiniteNumber(note.duration) ||
    note.duration <= 0 ||
    note.duration > CONFIG.maxClipBeats
  ) {
    errors.push(
      `notes[${index}].duration must be greater than 0 and no more than ${CONFIG.maxClipBeats}`,
    );
  }
  if (
    isFiniteNumber(note.start_time) &&
    isFiniteNumber(note.duration) &&
    note.start_time + note.duration > CONFIG.maxClipBeats
  ) {
    errors.push(`notes[${index}] must end by beat ${CONFIG.maxClipBeats}`);
  }
  if (!isFiniteNumber(note.velocity) || note.velocity < 0 || note.velocity > 127) {
    errors.push(`notes[${index}].velocity must be a finite number from 0 to 127`);
  }
  if (
    note.mute !== undefined &&
    note.mute !== false &&
    note.mute !== true &&
    note.mute !== 0 &&
    note.mute !== 1
  ) {
    errors.push(`notes[${index}].mute must be 0, 1, false, or true`);
  }
  return errors;
}

function sanitizeInputNotes(notes) {
  if (!Array.isArray(notes)) return [];
  const safeNotes = notes.slice(0, CONFIG.maxInputNotes).flatMap((note, index) => {
    const normalized = {
      pitch: Number(note?.pitch),
      start_time: Number(note?.start_time),
      duration: Number(note?.duration),
      velocity: note?.velocity,
      mute: note?.mute,
    };
    const errors = validateSourceNote(normalized, index);
    if (errors.length > 0) throw new MidiValidationError("The selected clip contains invalid MIDI.", errors);
    if (normalized.mute === true || normalized.mute === 1) return [];
    return [{
      pitch: normalized.pitch,
      start_time: normalized.start_time,
      duration: normalized.duration,
      velocity: normalized.velocity,
    }];
  });
  return safeNotes.sort(
    (a, b) => a.start_time - b.start_time || a.pitch - b.pitch || a.duration - b.duration,
  );
}

function stripCodeFence(content) {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseMidiClipResponse(content) {
  if (typeof content !== "string" || content.trim() === "") {
    throw new MidiValidationError("Pollinations returned an empty MIDI response.");
  }

  let payload;
  try {
    payload = JSON.parse(stripCodeFence(content));
  } catch {
    throw new MidiValidationError("Pollinations returned MIDI in an unreadable format.");
  }
  return normalizeMidiClip(payload);
}

function normalizeMidiClip(payload) {
  const details = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MidiValidationError("The generated MIDI response must be an object.");
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) details.push("title is required");
  if (title.length > CONFIG.maxTitleLength) {
    details.push(`title cannot exceed ${CONFIG.maxTitleLength} characters`);
  }

  const explanation =
    typeof payload.explanation === "string" ? payload.explanation.trim() : "";
  const key = typeof payload.key === "string" && payload.key.trim() ? payload.key.trim() : null;
  if (explanation.length > 1000) details.push("explanation cannot exceed 1000 characters");
  if (key && key.length > 40) details.push("key cannot exceed 40 characters");
  if (
    !isFiniteNumber(payload.duration) ||
    payload.duration <= 0 ||
    payload.duration > CONFIG.maxClipBeats
  ) {
    details.push(
      `duration must be a positive finite number no greater than ${CONFIG.maxClipBeats} beats`,
    );
  }

  details.push(...validateNotes(payload.notes));
  if (details.length > 0) {
    throw new MidiValidationError("Pollinations returned invalid MIDI.", details);
  }

  const notes = payload.notes
    .map((note) => ({
      pitch: note.pitch,
      start_time: note.start_time,
      duration: note.duration,
      velocity: note.velocity,
      mute: 0,
    }))
    .sort((a, b) => a.start_time - b.start_time || a.pitch - b.pitch || a.duration - b.duration);

  const noteEnd = Math.max(...notes.map((note) => note.start_time + note.duration));
  const duration = Math.max(payload.duration, noteEnd);

  return { title, explanation, key, duration, notes };
}

exports.MIDI_CLIP_RESPONSE_SCHEMA = MIDI_CLIP_RESPONSE_SCHEMA;
exports.MidiValidationError = MidiValidationError;
exports.normalizeMidiClip = normalizeMidiClip;
exports.parseMidiClipResponse = parseMidiClipResponse;
exports.sanitizeInputNotes = sanitizeInputNotes;
exports.validateNote = validateNote;
exports.validateNotes = validateNotes;
exports.validateSourceNote = validateSourceNote;
