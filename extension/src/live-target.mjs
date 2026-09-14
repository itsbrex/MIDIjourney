// @ts-check
import { parseMidiClipResponse } from "../../web/.generated/midi-core.mjs";

/** @param {import('@ableton-extensions/sdk').DataModelObject<'1.0.0'> | null | undefined} a @param {import('@ableton-extensions/sdk').DataModelObject<'1.0.0'> | null | undefined} b */
function sameObject(a, b) { return a != null && b != null && a.handle.id === b.handle.id; }

/** @param {import('@ableton-extensions/sdk').DataModelObject<'1.0.0'> | null} object @param {typeof import('@ableton-extensions/sdk').MidiTrack} MidiTrack */
function containingTrack(object, MidiTrack) {
  let current = object;
  for (let depth = 0; current && depth < 8; depth++, current = current.parent) {
    if (current instanceof MidiTrack) return current;
  }
  throw new Error("Choose a MIDI clip or an empty slot on a MIDI track.");
}

/**
 * @param {import('@ableton-extensions/sdk').ExtensionContext<'1.0.0'>} context
 * @param {import('@ableton-extensions/sdk').Handle} handle
 * @param {Pick<typeof import('@ableton-extensions/sdk'), 'DataModelObject'|'ClipSlot'|'MidiClip'|'MidiTrack'>} sdk
 */
export function captureTarget(context, handle, { DataModelObject, ClipSlot, MidiClip, MidiTrack }) {
  const selected = context.getObjectFromHandle(handle, DataModelObject);
  if (!(selected instanceof ClipSlot) && !(selected instanceof MidiClip)) throw new Error("Choose a MIDI clip or an empty MIDI slot.");
  const track = containingTrack(selected, MidiTrack);
  const source = selected instanceof MidiClip ? selected : selected instanceof ClipSlot ? selected.clip : null;
  if (source && !(source instanceof MidiClip)) throw new Error("Audio clips cannot be used as a MIDI prompt.");
  const slot = selected instanceof ClipSlot && !selected.clip
    ? selected
    : track.clipSlots.find((candidate) => !candidate.clip);
  if (!slot) throw new Error("There is no empty clip slot on this MIDI track. Add an empty scene and try again.");

  const snapshot = source ? {
    title: source.name,
    duration: source.duration,
    notes: source.notes.slice(0, 2048).filter((note) => !note.muted).map((note) => ({
      pitch: note.pitch, start_time: note.startTime, duration: note.duration,
      velocity: note.velocity ?? 100,
    })),
  } : null;

  let submitted = false;
  return {
    publicContext: {
      connected: true,
      destination: `${track.name} · empty slot ${track.clipSlots.findIndex((candidate) => sameObject(candidate, slot)) + 1}`,
      source: snapshot,
    },
    /** @param {unknown} raw */
    async create(raw) {
      if (submitted) throw new Error("This destination has already received a create request. Reopen MIDIjourney before sending again.");
      // Validate before touching Live. Ignore any browser-provided object handles.
      const clip = parseMidiClipResponse(JSON.stringify(raw));
      const currentSlot = context.getObjectFromHandle(slot.handle, ClipSlot);
      const currentTrack = containingTrack(currentSlot, MidiTrack);
      if (!sameObject(currentTrack, track)) throw new Error("The destination changed. Reopen MIDIjourney on the intended track.");
      if (currentSlot.clip) throw new Error("The destination slot is no longer empty. No clip was overwritten.");

      submitted = true;
      const created = await currentSlot.createMidiClip(clip.duration);
      // Creation is asynchronous: don't modify a different clip if the slot changed.
      const freshSlot = context.getObjectFromHandle(slot.handle, ClipSlot);
      if (!sameObject(freshSlot.clip, created)) throw new Error("The destination changed after clip creation. Check Live; a new empty clip may need Undo.");
      const notes = clip.notes.map(/** @param {{ pitch: number, start_time: number, duration: number, velocity: number }} note */ ({ pitch, start_time, duration, velocity }) => ({
        pitch, startTime: start_time, duration, velocity,
      }));
      try {
        context.withinTransaction(() => {
          created.notes = notes;
          created.name = clip.title;
          created.looping = true;
        });
      } catch {
        throw new Error("Live could not finish writing the new clip. Check the destination and use Undo before retrying.");
      }
      // Read back from the SDK before reporting success. Allow the host a short
      // time to reflect its queued setters; never repeat a write on timeout.
      for (let attempt = 0; attempt < 10; attempt++) {
        const current = context.getObjectFromHandle(created.handle, MidiClip);
        const actual = current.notes.slice().sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch || a.duration - b.duration);
        if (current.name === clip.title && current.duration >= clip.duration - 0.0001 && actual.length === notes.length &&
          actual.every((note, index) => note.pitch === notes[index].pitch &&
            Math.abs(note.startTime - notes[index].startTime) < 0.0001 &&
            Math.abs(note.duration - notes[index].duration) < 0.0001 && note.velocity === notes[index].velocity)) {
          return { title: clip.title, noteCount: notes.length, duration: clip.duration };
        }
        await new Promise((done) => setTimeout(done, 100));
      }
      throw new Error("Live did not confirm all new MIDI notes. Check the created clip and use Undo if needed; no write was retried.");
    },
  };
}

/** @param {unknown} raw */
export function parseDialogResult(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 1_000_000) throw new Error("The MIDI result is too large.");
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error("The editor returned an invalid MIDI result."); }
  if (result?.action === "cancel") return null;
  if (result?.action !== "create" || !result.clip) throw new Error("The editor did not return a MIDI clip.");
  return result.clip;
}
