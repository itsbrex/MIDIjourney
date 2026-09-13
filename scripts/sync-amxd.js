#!/usr/bin/env node

// Keeps the small amount of top-level wiring stored inside the AMXD container
// synchronized with the editable patcher abstractions in this repository.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const devicePath = path.join(root, "MIDIjourney.source.amxd");
const temporaryPath = path.join(root, ".MIDIjourney.source.amxd.tmp");

function boxBy(boxes, predicate, description) {
  const match = boxes.find(({ box }) => predicate(box));
  if (!match) throw new Error(`Could not find ${description} in MIDIjourney.source.amxd`);
  return match.box;
}

function removePatchline(patcher, source, destination) {
  patcher.lines = patcher.lines.filter(
    ({ patchline }) =>
      !(
        patchline.source[0] === source[0] &&
        patchline.source[1] === source[1] &&
        patchline.destination[0] === destination[0] &&
        patchline.destination[1] === destination[1]
      ),
  );
}

function ensurePatchline(patcher, source, destination) {
  const exists = patcher.lines.some(
    ({ patchline }) =>
      patchline.source[0] === source[0] &&
      patchline.source[1] === source[1] &&
      patchline.destination[0] === destination[0] &&
      patchline.destination[1] === destination[1],
  );
  if (!exists) patcher.lines.push({ patchline: { source, destination } });
}

function ensureBox(patcher, id, definition) {
  let box = patcher.boxes.find(({ box }) => box.id === id)?.box;
  if (!box) {
    box = { id, ...definition };
    patcher.boxes.push({ box });
  } else {
    Object.assign(box, definition);
  }
  return box;
}

const E2E_OBJECT_PREFIX = "obj-pollinations-e2e-";
const E2E_LOG_MARKER = "MIDIjourney_E2E_";

function removeTestHooks(patcher) {
  for (const { box } of patcher.boxes || []) {
    if (box.patcher) removeTestHooks(box.patcher);
  }
  const removedIds = new Set(
    (patcher.boxes || [])
      .map(({ box }) => box)
      .filter(
        (box) =>
          box.id?.startsWith(E2E_OBJECT_PREFIX) ||
          (typeof box.text === "string" && box.text.includes(E2E_LOG_MARKER)),
      )
      .map((box) => box.id),
  );
  if (removedIds.size === 0) return;
  patcher.boxes = patcher.boxes.filter(({ box }) => !removedIds.has(box.id));
  patcher.lines = (patcher.lines || []).filter(
    ({ patchline }) =>
      !removedIds.has(patchline.source[0]) &&
      !removedIds.has(patchline.destination[0]),
  );
}

function maxQuotedJson(value) {
  return `"${JSON.stringify(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function addDeterministicClipHarness(journey) {
  const pipelineInput = boxBy(
    journey.boxes,
    (box) => box.id === "obj-22" && box.text === "mj_getClipDuration",
    "the generated MIDI result pipeline",
  );
  const clipFill = boxBy(
    journey.boxes,
    (box) => box.id === "obj-245" && box.text === "mj_clipFill",
    "the MIDI clip fill stage",
  );
  const fixture = {
    title: "MIDIjourney E2E",
    explanation: "Deterministic Max for Live clip pipeline test.",
    key: "C minor",
    duration: 4,
    notes: [
      { pitch: 60, start_time: 0, duration: 1, velocity: 100, mute: 0 },
      { pitch: 63, start_time: 1, duration: 1, velocity: 96, mute: 0 },
      { pitch: 67, start_time: 2, duration: 1, velocity: 92, mute: 0 },
      { pitch: 72, start_time: 3, duration: 1, velocity: 88, mute: 0 },
    ],
    color: 5111762,
    history: [],
    historyStatus: 0,
    promptText: "MIDIjourney deterministic E2E",
  };
  const add = (suffix, definition) =>
    ensureBox(journey, `${E2E_OBJECT_PREFIX}clip-${suffix}`, definition);
  const newObject = (suffix, text, patchingRect, numinlets, numoutlets, outlettype) =>
    add(suffix, {
      maxclass: "newobj",
      numinlets,
      numoutlets,
      outlettype,
      patching_rect: patchingRect,
      text,
    });
  const message = (suffix, text, patchingRect) =>
    add(suffix, {
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: patchingRect,
      text,
    });

  const load = newObject("load", "loadbang", [20, 620, 60, 22], 1, 1, ["bang"]);
  const initialize = newObject("initialize", "t b b", [90, 620, 45, 22], 1, 2, [
    "bang",
    "bang",
  ]);
  const fixtureMessage = message(
    "fixture-message",
    maxQuotedJson(fixture),
    [145, 590, 510, 22],
  );
  const deserialize = newObject(
    "deserialize",
    "dict.deserialize",
    [665, 590, 95, 22],
    1,
    1,
    ["dictionary"],
  );
  const fixtureDict = newObject(
    "fixture-dict",
    "dict @quiet 1",
    [770, 590, 82, 22],
    2,
    4,
    ["dictionary", "", "", ""],
  );
  fixtureDict.saved_object_attributes = {
    embed: 0,
    parameter_enable: 0,
    parameter_mappable: 0,
  };
  const startDelay = newObject("delay", "delay 6000", [145, 620, 72, 22], 2, 1, [
    "bang",
  ]);
  const onebang = newObject("onebang", "onebang 1", [227, 620, 70, 22], 2, 1, [
    "bang",
  ]);
  const trackStart = newObject("track-start", "t b 1", [307, 590, 42, 22], 1, 2, [
    "bang",
    "int",
  ]);
  const trackPath = newObject(
    "track-path",
    "live.path live_set tracks 0",
    [359, 620, 176, 22],
    1,
    3,
    ["", "", ""],
  );
  const trackGate = newObject("track-gate", "gate 1 0", [545, 620, 55, 22], 2, 1, [
    "",
  ]);
  const trackGateClose = newObject(
    "track-gate-close",
    "t l 0",
    [610, 620, 42, 22],
    1,
    2,
    ["", "int"],
  );
  const trackRoute = newObject("track-route", "route id", [662, 620, 55, 22], 2, 2, [
    "",
    "",
  ]);
  const trackMissing = newObject("track-missing", "sel 0", [727, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const trackId = newObject("track-id", "prepend id", [779, 620, 70, 22], 1, 1, [""]);
  const trackMidi = newObject(
    "track-midi",
    "mj_getFromId has_midi_input",
    [859, 620, 172, 22],
    1,
    1,
    [""],
  );
  const trackMidiSelect = newObject(
    "track-midi-select",
    "sel 1",
    [1041, 620, 42, 22],
    2,
    2,
    ["bang", ""],
  );
  const slotStart = newObject("slot-start", "t b 1", [1093, 590, 42, 22], 1, 2, [
    "bang",
    "int",
  ]);
  const slotPath = newObject(
    "slot-path",
    "live.path live_set tracks 0 clip_slots 0",
    [1145, 620, 235, 22],
    1,
    3,
    ["", "", ""],
  );
  const slotGate = newObject("slot-gate", "gate 1 0", [1390, 620, 55, 22], 2, 1, [
    "",
  ]);
  const slotGateClose = newObject(
    "slot-gate-close",
    "t l 0",
    [1455, 620, 42, 22],
    1,
    2,
    ["", "int"],
  );
  const slotRoute = newObject("slot-route", "route id", [1507, 620, 55, 22], 2, 2, [
    "",
    "",
  ]);
  const slotMissing = newObject("slot-missing", "sel 0", [1572, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const slotId = newObject("slot-id", "prepend id", [1286, 620, 70, 22], 1, 1, [""]);
  const slotTrigger = newObject("slot-trigger", "t l l", [1366, 620, 42, 22], 1, 2, [
    "",
    "",
  ]);
  const slotSymbol = newObject("slot-symbol", "tosymbol", [1418, 590, 62, 22], 1, 1, [
    "",
  ]);
  const slotReplace = newObject(
    "slot-replace",
    "prepend replace highlightedSlot",
    [1490, 590, 190, 22],
    1,
    1,
    [""],
  );
  const slotClip = newObject(
    "slot-clip",
    "mj_getFromId clip",
    [1418, 620, 106, 22],
    1,
    1,
    [""],
  );
  const existingRoute = newObject(
    "existing-route",
    "route id",
    [1534, 620, 55, 22],
    2,
    2,
    ["", ""],
  );
  const emptySelect = newObject("empty-select", "sel 0", [1599, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const run = newObject("run", "t b b", [1651, 620, 45, 22], 1, 2, [
    "bang",
    "bang",
  ]);
  const liveVersion = message("live-version", "liveVersion 1", [1706, 650, 82, 22]);

  const abortPrint = newObject(
    "abort-print",
    `print ${E2E_LOG_MARKER}CLIP`,
    [1070, 680, 190, 22],
    1,
    0,
    [],
  );
  const abortTrackMissing = message(
    "abort-track-missing",
    "ABORT track_1_not_found",
    [20, 680, 155, 22],
  );
  const abortTrackNotMidi = message(
    "abort-track-not-midi",
    "ABORT track_1_not_midi",
    [185, 680, 155, 22],
  );
  const abortSlotMissing = message(
    "abort-slot-missing",
    "ABORT scene_1_slot_not_found",
    [350, 680, 185, 22],
  );
  const abortOccupied = message(
    "abort-occupied",
    "ABORT track_1_scene_1_occupied",
    [545, 680, 215, 22],
  );

  ensurePatchline(journey, [load.id, 0], [initialize.id, 0]);
  ensurePatchline(journey, [initialize.id, 1], [fixtureMessage.id, 0]);
  ensurePatchline(journey, [fixtureMessage.id, 0], [deserialize.id, 0]);
  ensurePatchline(journey, [deserialize.id, 0], [fixtureDict.id, 1]);
  ensurePatchline(journey, [initialize.id, 0], [startDelay.id, 0]);
  ensurePatchline(journey, [startDelay.id, 0], [onebang.id, 0]);
  ensurePatchline(journey, [onebang.id, 0], [trackStart.id, 0]);
  // live.path resolves automatically during device load. Keep that startup
  // traffic behind a closed gate, open it only for the delayed explicit
  // request, and close it again before evaluating the response.
  ensurePatchline(journey, [trackStart.id, 1], [trackGate.id, 0]);
  ensurePatchline(journey, [trackStart.id, 0], [trackPath.id, 0]);
  // Use live.path's explicit-request outlet. Its middle outlet is a Live
  // notification, and Live does not permit set mutations from notifications.
  ensurePatchline(journey, [trackPath.id, 0], [trackGate.id, 1]);
  ensurePatchline(journey, [trackGate.id, 0], [trackGateClose.id, 0]);
  ensurePatchline(journey, [trackGateClose.id, 1], [trackGate.id, 0]);
  ensurePatchline(journey, [trackGateClose.id, 0], [trackRoute.id, 0]);
  ensurePatchline(journey, [trackRoute.id, 0], [trackMissing.id, 0]);
  ensurePatchline(journey, [trackRoute.id, 1], [abortTrackMissing.id, 0]);
  ensurePatchline(journey, [trackMissing.id, 0], [abortTrackMissing.id, 0]);
  ensurePatchline(journey, [trackMissing.id, 1], [trackId.id, 0]);
  ensurePatchline(journey, [trackId.id, 0], [trackMidi.id, 0]);
  ensurePatchline(journey, [trackMidi.id, 0], [trackMidiSelect.id, 0]);
  ensurePatchline(journey, [trackMidiSelect.id, 0], [slotStart.id, 0]);
  ensurePatchline(journey, [trackMidiSelect.id, 1], [abortTrackNotMidi.id, 0]);
  ensurePatchline(journey, [slotStart.id, 1], [slotGate.id, 0]);
  ensurePatchline(journey, [slotStart.id, 0], [slotPath.id, 0]);
  ensurePatchline(journey, [slotPath.id, 0], [slotGate.id, 1]);
  ensurePatchline(journey, [slotGate.id, 0], [slotGateClose.id, 0]);
  ensurePatchline(journey, [slotGateClose.id, 1], [slotGate.id, 0]);
  ensurePatchline(journey, [slotGateClose.id, 0], [slotRoute.id, 0]);
  ensurePatchline(journey, [slotRoute.id, 0], [slotMissing.id, 0]);
  ensurePatchline(journey, [slotRoute.id, 1], [abortSlotMissing.id, 0]);
  ensurePatchline(journey, [slotMissing.id, 0], [abortSlotMissing.id, 0]);
  ensurePatchline(journey, [slotMissing.id, 1], [slotId.id, 0]);
  ensurePatchline(journey, [slotId.id, 0], [slotTrigger.id, 0]);
  // `trigger` fires right-to-left: persist the exact ClipSlot id before asking
  // whether it is empty, so the successful branch can safely run immediately.
  ensurePatchline(journey, [slotTrigger.id, 1], [slotSymbol.id, 0]);
  ensurePatchline(journey, [slotSymbol.id, 0], [slotReplace.id, 0]);
  ensurePatchline(journey, [slotReplace.id, 0], [fixtureDict.id, 1]);
  ensurePatchline(journey, [slotTrigger.id, 0], [slotClip.id, 0]);
  ensurePatchline(journey, [slotClip.id, 0], [existingRoute.id, 0]);
  ensurePatchline(journey, [existingRoute.id, 0], [emptySelect.id, 0]);
  ensurePatchline(journey, [existingRoute.id, 1], [abortOccupied.id, 0]);
  ensurePatchline(journey, [emptySelect.id, 0], [run.id, 0]);
  ensurePatchline(journey, [emptySelect.id, 1], [abortOccupied.id, 0]);
  // The right outlet runs first and configures the Live 11+ note API gates.
  // Only then does the left outlet emit the staged result dictionary.
  ensurePatchline(journey, [run.id, 1], [liveVersion.id, 0]);
  ensurePatchline(journey, [liveVersion.id, 0], [pipelineInput.id, 0]);
  ensurePatchline(journey, [run.id, 0], [fixtureDict.id, 0]);
  ensurePatchline(journey, [fixtureDict.id, 0], [pipelineInput.id, 0]);
  for (const abortMessage of [
    abortTrackMissing,
    abortTrackNotMidi,
    abortSlotMissing,
    abortOccupied,
  ]) {
    ensurePatchline(journey, [abortMessage.id, 0], [abortPrint.id, 0]);
  }

  const resultFilter = newObject(
    "result-filter",
    "routepass dictionary",
    [20, 735, 116, 22],
    2,
    2,
    ["", ""],
  );
  const detailReader = newObject(
    "detail-reader",
    "mj_getFromDict detailClip:",
    [146, 735, 150, 22],
    1,
    2,
    ["", ""],
  );
  const detailFromSymbol = newObject(
    "detail-fromsymbol",
    "fromsymbol",
    [306, 735, 72, 22],
    1,
    1,
    [""],
  );
  const verifyTrigger = newObject("verify-trigger", "t b l", [388, 735, 42, 22], 1, 2, [
    "bang",
    "",
  ]);
  const verifyDelay = newObject("verify-delay", "delay 100", [440, 735, 65, 22], 2, 1, [
    "bang",
  ]);
  const queryTrigger = newObject("query-trigger", "t b b", [515, 735, 45, 22], 1, 2, [
    "bang",
    "bang",
  ]);
  const queryLength = message("query-length", "get length", [570, 720, 68, 22]);
  const queryNotes = message(
    "query-notes",
    "call get_all_notes_extended",
    [570, 750, 165, 22],
  );
  const verifyObject = newObject("verify-object", "live.object", [745, 735, 70, 22], 2, 1, [
    "",
  ]);
  verifyObject.saved_object_attributes = { _persistence: 0 };
  const responseRoute = newObject(
    "response-route",
    "route length get_all_notes_extended",
    [825, 735, 205, 22],
    3,
    3,
    ["", "", ""],
  );
  const lengthPrint = newObject(
    "length-print",
    `print ${E2E_LOG_MARKER}CLIP_LENGTH`,
    [1040, 710, 220, 22],
    1,
    0,
    [],
  );
  const lengthCheck = newObject(
    "length-check",
    "expr abs($f1 - 4.) < 0.0001",
    [1040, 740, 172, 22],
    1,
    1,
    ["int"],
  );
  const notesTrigger = newObject("notes-trigger", "t b l", [1040, 770, 42, 22], 1, 2, [
    "bang",
    "",
  ]);
  const notesDict = newObject(
    "notes-dict",
    "dict @quiet 1",
    [1092, 770, 82, 22],
    2,
    4,
    ["dictionary", "", "", ""],
  );
  notesDict.saved_object_attributes = {
    embed: 0,
    parameter_enable: 0,
    parameter_mappable: 0,
  };
  const notesGetSize = message("notes-getsize", "getsize notes", [1184, 770, 85, 22]);
  const notesSizeRoute = newObject(
    "notes-size-route",
    "route notes",
    [1279, 770, 68, 22],
    2,
    2,
    ["", ""],
  );
  const countPrint = newObject(
    "count-print",
    `print ${E2E_LOG_MARKER}NOTE_COUNT`,
    [1357, 750, 215, 22],
    1,
    0,
    [],
  );
  const countCheck = newObject("count-check", "== 4", [1357, 780, 42, 22], 2, 1, [
    "int",
  ]);
  const assertions = newObject("assertions", "buddy 2", [1222, 820, 55, 22], 2, 2, [
    "",
    "",
  ]);
  const assertionPack = newObject(
    "assertion-pack",
    "pack 0 0",
    [1287, 820, 58, 22],
    2,
    1,
    ["list"],
  );
  const assertionCheck = newObject(
    "assertion-check",
    "zl.sum",
    [1355, 820, 100, 22],
    1,
    1,
    ["int"],
  );
  const passSelect = newObject("pass-select", "sel 2", [1465, 820, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const passMessage = message(
    "pass-message",
    "PASS track=1 scene=1 notes=4 duration=4",
    [1517, 805, 245, 22],
  );
  const failMessage = message(
    "fail-message",
    "FAIL track=1 scene=1 expected_notes=4 expected_duration=4",
    [1517, 835, 355, 22],
  );
  const resultPrint = newObject(
    "result-print",
    `print ${E2E_LOG_MARKER}CLIP`,
    [1772, 805, 190, 22],
    1,
    0,
    [],
  );

  // mj_clipFill emits its result only after Live acknowledges add_new_notes.
  // That completion dictionary, rather than a second timer, starts verification.
  ensurePatchline(journey, [clipFill.id, 0], [resultFilter.id, 0]);
  ensurePatchline(journey, [resultFilter.id, 0], [detailReader.id, 0]);
  ensurePatchline(journey, [detailReader.id, 1], [detailFromSymbol.id, 0]);
  ensurePatchline(journey, [detailFromSymbol.id, 0], [verifyTrigger.id, 0]);
  ensurePatchline(journey, [verifyTrigger.id, 1], [verifyObject.id, 1]);
  ensurePatchline(journey, [verifyTrigger.id, 0], [verifyDelay.id, 0]);
  ensurePatchline(journey, [verifyDelay.id, 0], [queryTrigger.id, 0]);
  ensurePatchline(journey, [queryTrigger.id, 1], [queryNotes.id, 0]);
  ensurePatchline(journey, [queryTrigger.id, 0], [queryLength.id, 0]);
  ensurePatchline(journey, [queryNotes.id, 0], [verifyObject.id, 0]);
  ensurePatchline(journey, [queryLength.id, 0], [verifyObject.id, 0]);
  ensurePatchline(journey, [verifyObject.id, 0], [responseRoute.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 0], [lengthPrint.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 0], [lengthCheck.id, 0]);
  ensurePatchline(journey, [lengthCheck.id, 0], [assertions.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 1], [notesTrigger.id, 0]);
  ensurePatchline(journey, [notesTrigger.id, 1], [notesDict.id, 1]);
  ensurePatchline(journey, [notesTrigger.id, 0], [notesGetSize.id, 0]);
  ensurePatchline(journey, [notesGetSize.id, 0], [notesDict.id, 0]);
  ensurePatchline(journey, [notesDict.id, 1], [notesSizeRoute.id, 0]);
  ensurePatchline(journey, [notesSizeRoute.id, 0], [countPrint.id, 0]);
  ensurePatchline(journey, [notesSizeRoute.id, 0], [countCheck.id, 0]);
  ensurePatchline(journey, [countCheck.id, 0], [assertions.id, 1]);
  // buddy emits right-to-left; pack's right inlet is cold, so this produces
  // one combined assertion only after both real LOM responses have arrived.
  ensurePatchline(journey, [assertions.id, 1], [assertionPack.id, 1]);
  ensurePatchline(journey, [assertions.id, 0], [assertionPack.id, 0]);
  ensurePatchline(journey, [assertionPack.id, 0], [assertionCheck.id, 0]);
  ensurePatchline(journey, [assertionCheck.id, 0], [passSelect.id, 0]);
  ensurePatchline(journey, [passSelect.id, 0], [passMessage.id, 0]);
  ensurePatchline(journey, [passSelect.id, 1], [failMessage.id, 0]);
  ensurePatchline(journey, [passMessage.id, 0], [resultPrint.id, 0]);
  ensurePatchline(journey, [failMessage.id, 0], [resultPrint.id, 0]);
}

function addProviderClipHarness(journey, node, authRoute) {
  const clipFill = boxBy(
    journey.boxes,
    (box) => box.id === "obj-245" && box.text === "mj_clipFill",
    "the MIDI clip fill stage",
  );
  const promptOutlet = boxBy(
    journey.boxes,
    (box) => box.maxclass === "outlet" && box.index === 2,
    "the preferences request outlet",
  );
  const fixture = {
    duration: 4,
    e2eProviderRun: 1,
    gptModel: "openai",
    history: [],
    historyStatus: 0,
    liveVersion: 1,
    promptText:
      "Create a four-beat monophonic MIDI clip containing exactly four quarter notes: C4 at beat 0, E-flat4 at beat 1, G4 at beat 2, and C5 at beat 3. Use velocity 96 and title it MIDIjourney Provider E2E.",
    temperature: 0,
  };
  const requestedAuthTimeout = Number.parseInt(
    process.env.MIDIJOURNEY_MAX_E2E_AUTH_TIMEOUT_MS || "15000",
    10,
  );
  if (
    !Number.isSafeInteger(requestedAuthTimeout) ||
    requestedAuthTimeout < 1_000 ||
    requestedAuthTimeout > 600_000
  ) {
    throw new Error(
      "MIDIJOURNEY_MAX_E2E_AUTH_TIMEOUT_MS must be an integer from 1000 to 600000",
    );
  }
  const addRoot = (suffix, definition) =>
    ensureBox(journey, `${E2E_OBJECT_PREFIX}provider-${suffix}`, definition);
  const addJourney = (suffix, definition) =>
    ensureBox(journey, `${E2E_OBJECT_PREFIX}provider-${suffix}`, definition);
  const rootObject = (suffix, text, patchingRect, numinlets, numoutlets, outlettype) =>
    addRoot(suffix, {
      maxclass: "newobj",
      numinlets,
      numoutlets,
      outlettype,
      patching_rect: patchingRect,
      text,
    });
  const rootMessage = (suffix, text, patchingRect) =>
    addRoot(suffix, {
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: patchingRect,
      text,
    });
  const journeyObject = (
    suffix,
    text,
    patchingRect,
    numinlets,
    numoutlets,
    outlettype,
  ) =>
    addJourney(suffix, {
      maxclass: "newobj",
      numinlets,
      numoutlets,
      outlettype,
      patching_rect: patchingRect,
      text,
    });
  const journeyMessage = (suffix, text, patchingRect) =>
    addJourney(suffix, {
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: patchingRect,
      text,
    });

  // This harness deliberately does not initiate authorization. A nested
  // loadbang (reliable during Live hot-swap) asks the real Node service for its
  // settled auth status and simultaneously starts a bounded root-level wait.
  // Only restored `connected` initializes the fixture and provider request.
  const authQueryLoad = journeyObject(
    "auth-query-load",
    "loadbang",
    [20, 1160, 60, 22],
    1,
    1,
    ["bang"],
  );
  const authQueryStart = journeyObject(
    "auth-query-start",
    "t b b",
    [90, 1160, 45, 22],
    1,
    2,
    ["bang", "bang"],
  );
  const authQueryDelay = journeyObject(
    "auth-query-delay",
    "delay 1000",
    [145, 1160, 72, 22],
    2,
    1,
    ["bang"],
  );
  const authQueryMessage = journeyMessage(
    "auth-query-message",
    "authStatus",
    [227, 1160, 70, 22],
  );
  const initialize = rootObject("initialize", "t b b", [670, 620, 45, 22], 1, 2, [
    "bang",
    "bang",
  ]);
  const fixtureMessage = rootMessage(
    "fixture-message",
    maxQuotedJson(fixture),
    [725, 590, 650, 22],
  );
  const deserialize = rootObject(
    "deserialize",
    "dict.deserialize",
    [1385, 590, 95, 22],
    1,
    1,
    ["dictionary"],
  );
  const fixtureDict = rootObject(
    "fixture-dict",
    "dict @quiet 1",
    [1490, 590, 82, 22],
    2,
    4,
    ["dictionary", "", "", ""],
  );
  fixtureDict.saved_object_attributes = {
    embed: 0,
    parameter_enable: 0,
    parameter_mappable: 0,
  };
  const authTimeout = rootObject(
    "auth-timeout",
    `delay ${requestedAuthTimeout}`,
    [725, 620, 78, 22],
    2,
    1,
    ["bang"],
  );
  const authState = rootObject(
    "auth-state",
    "sel connected",
    [813, 620, 86, 22],
    2,
    2,
    ["bang", ""],
  );
  const connectedMessage = rootMessage(
    "connected-message",
    "connected",
    [909, 605, 68, 22],
  );
  const timeoutMessage = rootMessage("timeout-message", "timeout", [909, 635, 58, 22]);
  const authCandidate = rootObject("auth-candidate", "t b s", [987, 620, 42, 22], 1, 2, [
    "bang",
    "",
  ]);
  const authRace = rootObject("auth-race", "onebang 1", [1039, 605, 70, 22], 2, 1, [
    "",
  ]);
  const authRegister = rootObject("auth-register", "zl.reg", [1039, 635, 45, 22], 2, 2, [
    "",
    "",
  ]);
  const authResult = rootObject(
    "auth-result",
    "sel connected timeout",
    [1119, 620, 130, 22],
    3,
    3,
    ["bang", "bang", ""],
  );
  const startDelay = rootObject("start-delay", "delay 1000", [1207, 605, 72, 22], 2, 1, [
    "bang",
  ]);
  const trackStart = rootObject("track-start", "t b 1", [1289, 605, 42, 22], 1, 2, [
    "bang",
    "int",
  ]);
  const trackPath = rootObject(
    "track-path",
    "live.path live_set tracks 0",
    [1341, 620, 176, 22],
    1,
    3,
    ["", "", ""],
  );
  const trackGate = rootObject("track-gate", "gate 1 0", [1527, 620, 55, 22], 2, 1, [
    "",
  ]);
  const trackGateClose = rootObject(
    "track-gate-close",
    "t l 0",
    [1592, 620, 42, 22],
    1,
    2,
    ["", "int"],
  );
  const trackRoute = rootObject("track-route", "route id", [1644, 620, 55, 22], 2, 2, [
    "",
    "",
  ]);
  const trackMissing = rootObject("track-missing", "sel 0", [1709, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const trackId = rootObject("track-id", "prepend id", [1761, 620, 70, 22], 1, 1, [""]);
  const trackMidi = rootObject(
    "track-midi",
    "mj_getFromId has_midi_input",
    [1841, 620, 172, 22],
    1,
    1,
    [""],
  );
  const trackMidiSelect = rootObject(
    "track-midi-select",
    "sel 1",
    [2023, 620, 42, 22],
    2,
    2,
    ["bang", ""],
  );
  const slotStart = rootObject("slot-start", "t b 1", [2075, 605, 42, 22], 1, 2, [
    "bang",
    "int",
  ]);
  const slotPath = rootObject(
    "slot-path",
    "live.path live_set tracks 0 clip_slots 1",
    [2127, 620, 235, 22],
    1,
    3,
    ["", "", ""],
  );
  const slotGate = rootObject("slot-gate", "gate 1 0", [2372, 620, 55, 22], 2, 1, [""]);
  const slotGateClose = rootObject(
    "slot-gate-close",
    "t l 0",
    [2437, 620, 42, 22],
    1,
    2,
    ["", "int"],
  );
  const slotRoute = rootObject("slot-route", "route id", [2489, 620, 55, 22], 2, 2, [
    "",
    "",
  ]);
  const slotMissing = rootObject("slot-missing", "sel 0", [2554, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const slotId = rootObject("slot-id", "prepend id", [2606, 620, 70, 22], 1, 1, [""]);
  const slotTrigger = rootObject("slot-trigger", "t l l", [2686, 620, 42, 22], 1, 2, [
    "",
    "",
  ]);
  const slotSymbol = rootObject("slot-symbol", "tosymbol", [2738, 590, 62, 22], 1, 1, [
    "",
  ]);
  const slotReplace = rootObject(
    "slot-replace",
    "prepend replace highlightedSlot",
    [2810, 590, 190, 22],
    1,
    1,
    [""],
  );
  const slotClip = rootObject("slot-clip", "mj_getFromId clip", [2738, 620, 106, 22], 1, 1, [
    "",
  ]);
  const existingRoute = rootObject(
    "existing-route",
    "route id",
    [2854, 620, 55, 22],
    2,
    2,
    ["", ""],
  );
  const emptySelect = rootObject("empty-select", "sel 0", [2919, 620, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const run = rootObject("run", "t b b", [2971, 620, 45, 22], 1, 2, [
    "bang",
    "bang",
  ]);
  const runMessage = rootMessage(
    "run-message",
    "RUN track=1 scene=2 provider_request",
    [3026, 590, 240, 22],
  );
  const resultPrint = rootObject(
    "result-print",
    `print ${E2E_LOG_MARKER}PROVIDER`,
    [3276, 590, 220, 22],
    1,
    0,
    [],
  );

  const abortAuth = rootMessage(
    "abort-auth",
    "ABORT authorization_not_connected",
    [600, 680, 215, 22],
  );
  const abortTrackMissing = rootMessage(
    "abort-track-missing",
    "ABORT track_1_not_found",
    [825, 680, 155, 22],
  );
  const abortTrackNotMidi = rootMessage(
    "abort-track-not-midi",
    "ABORT track_1_not_midi",
    [990, 680, 155, 22],
  );
  const abortSlotMissing = rootMessage(
    "abort-slot-missing",
    "ABORT scene_2_slot_not_found",
    [1155, 680, 185, 22],
  );
  const abortOccupied = rootMessage(
    "abort-occupied",
    "ABORT track_1_scene_2_occupied",
    [1350, 680, 215, 22],
  );

  ensurePatchline(journey, [initialize.id, 1], [fixtureMessage.id, 0]);
  ensurePatchline(journey, [fixtureMessage.id, 0], [deserialize.id, 0]);
  ensurePatchline(journey, [deserialize.id, 0], [fixtureDict.id, 1]);
  ensurePatchline(journey, [authQueryLoad.id, 0], [authQueryStart.id, 0]);
  // `trigger` fires right-to-left: start the timeout before the delayed status
  // query reaches Node, so a broken status return cannot leave the probe hung.
  ensurePatchline(journey, [authQueryStart.id, 1], [authTimeout.id, 0]);
  ensurePatchline(journey, [authQueryStart.id, 0], [authQueryDelay.id, 0]);
  ensurePatchline(journey, [authQueryDelay.id, 0], [authQueryMessage.id, 0]);
  ensurePatchline(journey, [authQueryMessage.id, 0], [node.id, 0]);
  ensurePatchline(journey, [authRoute.id, 0], [authState.id, 0]);
  ensurePatchline(journey, [authState.id, 0], [connectedMessage.id, 0]);
  ensurePatchline(journey, [connectedMessage.id, 0], [authCandidate.id, 0]);
  ensurePatchline(journey, [authTimeout.id, 0], [timeoutMessage.id, 0]);
  ensurePatchline(journey, [timeoutMessage.id, 0], [authCandidate.id, 0]);
  // `trigger` fires right-to-left: save the complete outcome symbol first,
  // then let onebang admit only the first candidate. Its bang recalls the
  // winning symbol from zl.reg so the selector receives connected or timeout,
  // rather than the uninformative bang emitted by onebang itself.
  ensurePatchline(journey, [authCandidate.id, 1], [authRegister.id, 1]);
  ensurePatchline(journey, [authCandidate.id, 0], [authRace.id, 0]);
  ensurePatchline(journey, [authRace.id, 0], [authRegister.id, 0]);
  ensurePatchline(journey, [authRegister.id, 0], [authResult.id, 0]);
  ensurePatchline(journey, [authResult.id, 0], [initialize.id, 0]);
  ensurePatchline(journey, [authResult.id, 1], [abortAuth.id, 0]);
  ensurePatchline(journey, [initialize.id, 0], [startDelay.id, 0]);
  ensurePatchline(journey, [startDelay.id, 0], [trackStart.id, 0]);
  // live.path resolves automatically during load. Closed gates admit only the
  // two explicit requests made after connected authorization wins the race.
  ensurePatchline(journey, [trackStart.id, 1], [trackGate.id, 0]);
  ensurePatchline(journey, [trackStart.id, 0], [trackPath.id, 0]);
  ensurePatchline(journey, [trackPath.id, 0], [trackGate.id, 1]);
  ensurePatchline(journey, [trackGate.id, 0], [trackGateClose.id, 0]);
  ensurePatchline(journey, [trackGateClose.id, 1], [trackGate.id, 0]);
  ensurePatchline(journey, [trackGateClose.id, 0], [trackRoute.id, 0]);
  ensurePatchline(journey, [trackRoute.id, 0], [trackMissing.id, 0]);
  ensurePatchline(journey, [trackRoute.id, 1], [abortTrackMissing.id, 0]);
  ensurePatchline(journey, [trackMissing.id, 0], [abortTrackMissing.id, 0]);
  ensurePatchline(journey, [trackMissing.id, 1], [trackId.id, 0]);
  ensurePatchline(journey, [trackId.id, 0], [trackMidi.id, 0]);
  ensurePatchline(journey, [trackMidi.id, 0], [trackMidiSelect.id, 0]);
  ensurePatchline(journey, [trackMidiSelect.id, 0], [slotStart.id, 0]);
  ensurePatchline(journey, [trackMidiSelect.id, 1], [abortTrackNotMidi.id, 0]);
  ensurePatchline(journey, [slotStart.id, 1], [slotGate.id, 0]);
  ensurePatchline(journey, [slotStart.id, 0], [slotPath.id, 0]);
  ensurePatchline(journey, [slotPath.id, 0], [slotGate.id, 1]);
  ensurePatchline(journey, [slotGate.id, 0], [slotGateClose.id, 0]);
  ensurePatchline(journey, [slotGateClose.id, 1], [slotGate.id, 0]);
  ensurePatchline(journey, [slotGateClose.id, 0], [slotRoute.id, 0]);
  ensurePatchline(journey, [slotRoute.id, 0], [slotMissing.id, 0]);
  ensurePatchline(journey, [slotRoute.id, 1], [abortSlotMissing.id, 0]);
  ensurePatchline(journey, [slotMissing.id, 0], [abortSlotMissing.id, 0]);
  ensurePatchline(journey, [slotMissing.id, 1], [slotId.id, 0]);
  ensurePatchline(journey, [slotId.id, 0], [slotTrigger.id, 0]);
  ensurePatchline(journey, [slotTrigger.id, 1], [slotSymbol.id, 0]);
  ensurePatchline(journey, [slotSymbol.id, 0], [slotReplace.id, 0]);
  ensurePatchline(journey, [slotReplace.id, 0], [fixtureDict.id, 1]);
  ensurePatchline(journey, [slotTrigger.id, 0], [slotClip.id, 0]);
  ensurePatchline(journey, [slotClip.id, 0], [existingRoute.id, 0]);
  ensurePatchline(journey, [existingRoute.id, 0], [emptySelect.id, 0]);
  ensurePatchline(journey, [existingRoute.id, 1], [abortOccupied.id, 0]);
  ensurePatchline(journey, [emptySelect.id, 0], [run.id, 0]);
  ensurePatchline(journey, [emptySelect.id, 1], [abortOccupied.id, 0]);
  // `trigger` fires right-to-left: log the exact start before emitting the
  // request dictionary through Text Prompt's normal preferences outlet.
  ensurePatchline(journey, [run.id, 1], [runMessage.id, 0]);
  ensurePatchline(journey, [runMessage.id, 0], [resultPrint.id, 0]);
  ensurePatchline(journey, [run.id, 0], [fixtureDict.id, 0]);
  ensurePatchline(journey, [fixtureDict.id, 0], [promptOutlet.id, 0]);
  for (const abortMessage of [
    abortAuth,
    abortTrackMissing,
    abortTrackNotMidi,
    abortSlotMissing,
    abortOccupied,
  ]) {
    ensurePatchline(journey, [abortMessage.id, 0], [resultPrint.id, 0]);
  }

  // A provider response is successful only when the production fill stage has
  // completed and Live reports a non-zero clip length plus at least one note.
  const resultFilter = journeyObject(
    "result-filter",
    "routepass dictionary",
    [20, 1010, 116, 22],
    2,
    2,
    ["", ""],
  );
  const detailReader = journeyObject(
    "detail-reader",
    "mj_getFromDict detailClip:",
    [146, 1010, 150, 22],
    1,
    2,
    ["", ""],
  );
  const resultTrigger = journeyObject(
    "result-trigger",
    "t l l",
    [146, 980, 42, 22],
    1,
    2,
    ["", ""],
  );
  const resultRegister = journeyObject(
    "result-register",
    "zl.reg",
    [198, 980, 45, 22],
    2,
    2,
    ["", ""],
  );
  const markerReader = journeyObject(
    "marker-reader",
    "mj_getFromDict e2eProviderRun:",
    [253, 980, 185, 22],
    1,
    2,
    ["", ""],
  );
  const markerSelect = journeyObject("marker-select", "sel 1", [448, 980, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const detailFromSymbol = journeyObject(
    "detail-fromsymbol",
    "fromsymbol",
    [306, 1010, 72, 22],
    1,
    1,
    [""],
  );
  const verifyTrigger = journeyObject(
    "verify-trigger",
    "t b l",
    [388, 1010, 42, 22],
    1,
    2,
    ["bang", ""],
  );
  const verifyDelay = journeyObject(
    "verify-delay",
    "delay 100",
    [440, 1010, 65, 22],
    2,
    1,
    ["bang"],
  );
  const queryTrigger = journeyObject(
    "query-trigger",
    "t b b",
    [515, 1010, 45, 22],
    1,
    2,
    ["bang", "bang"],
  );
  const queryLength = journeyMessage("query-length", "get length", [570, 995, 68, 22]);
  const queryNotes = journeyMessage(
    "query-notes",
    "call get_all_notes_extended",
    [570, 1025, 165, 22],
  );
  const verifyObject = journeyObject(
    "verify-object",
    "live.object",
    [745, 1010, 70, 22],
    2,
    1,
    [""],
  );
  verifyObject.saved_object_attributes = { _persistence: 0 };
  const responseRoute = journeyObject(
    "response-route",
    "route length get_all_notes_extended",
    [825, 1010, 205, 22],
    3,
    3,
    ["", "", ""],
  );
  const lengthPrint = journeyObject(
    "length-print",
    `print ${E2E_LOG_MARKER}PROVIDER_LENGTH`,
    [1040, 985, 235, 22],
    1,
    0,
    [],
  );
  const lengthCheck = journeyObject(
    "length-check",
    "expr $f1 > 0.",
    [1040, 1015, 90, 22],
    1,
    1,
    ["int"],
  );
  const notesTrigger = journeyObject(
    "notes-trigger",
    "t b l",
    [1040, 1045, 42, 22],
    1,
    2,
    ["bang", ""],
  );
  const notesDict = journeyObject(
    "notes-dict",
    "dict @quiet 1",
    [1092, 1045, 82, 22],
    2,
    4,
    ["dictionary", "", "", ""],
  );
  notesDict.saved_object_attributes = {
    embed: 0,
    parameter_enable: 0,
    parameter_mappable: 0,
  };
  const notesGetSize = journeyMessage(
    "notes-getsize",
    "getsize notes",
    [1184, 1045, 85, 22],
  );
  const notesSizeRoute = journeyObject(
    "notes-size-route",
    "route notes",
    [1279, 1045, 68, 22],
    2,
    2,
    ["", ""],
  );
  const countPrint = journeyObject(
    "count-print",
    `print ${E2E_LOG_MARKER}PROVIDER_NOTE_COUNT`,
    [1357, 1025, 245, 22],
    1,
    0,
    [],
  );
  const countCheck = journeyObject("count-check", "> 0", [1357, 1055, 42, 22], 2, 1, [
    "int",
  ]);
  const assertions = journeyObject(
    "assertions",
    "buddy 2",
    [1222, 1095, 55, 22],
    2,
    2,
    ["", ""],
  );
  const assertionPack = journeyObject(
    "assertion-pack",
    "pack 0 0",
    [1287, 1095, 58, 22],
    2,
    1,
    ["list"],
  );
  const assertionCheck = journeyObject(
    "assertion-check",
    "zl.sum",
    [1355, 1095, 100, 22],
    1,
    1,
    ["int"],
  );
  const passSelect = journeyObject("pass-select", "sel 2", [1465, 1095, 42, 22], 2, 2, [
    "bang",
    "",
  ]);
  const passMessage = journeyMessage(
    "pass-message",
    "PASS track=1 scene=2 nonempty_midi_clip",
    [1517, 1080, 265, 22],
  );
  const failMessage = journeyMessage(
    "fail-message",
    "FAIL track=1 scene=2 empty_or_zero_length",
    [1517, 1110, 285, 22],
  );
  const verificationPrint = journeyObject(
    "verification-print",
    `print ${E2E_LOG_MARKER}PROVIDER`,
    [1812, 1080, 220, 22],
    1,
    0,
    [],
  );

  ensurePatchline(journey, [clipFill.id, 0], [resultFilter.id, 0]);
  // Preserve the completion dictionary, then verify only results carrying the
  // private test marker. Normal user generations cannot produce a false PASS.
  ensurePatchline(journey, [resultFilter.id, 0], [resultTrigger.id, 0]);
  ensurePatchline(journey, [resultTrigger.id, 1], [resultRegister.id, 1]);
  ensurePatchline(journey, [resultTrigger.id, 0], [markerReader.id, 0]);
  ensurePatchline(journey, [markerReader.id, 1], [markerSelect.id, 0]);
  ensurePatchline(journey, [markerSelect.id, 0], [resultRegister.id, 0]);
  ensurePatchline(journey, [resultRegister.id, 0], [detailReader.id, 0]);
  ensurePatchline(journey, [detailReader.id, 1], [detailFromSymbol.id, 0]);
  ensurePatchline(journey, [detailFromSymbol.id, 0], [verifyTrigger.id, 0]);
  ensurePatchline(journey, [verifyTrigger.id, 1], [verifyObject.id, 1]);
  ensurePatchline(journey, [verifyTrigger.id, 0], [verifyDelay.id, 0]);
  ensurePatchline(journey, [verifyDelay.id, 0], [queryTrigger.id, 0]);
  ensurePatchline(journey, [queryTrigger.id, 1], [queryNotes.id, 0]);
  ensurePatchline(journey, [queryTrigger.id, 0], [queryLength.id, 0]);
  ensurePatchline(journey, [queryNotes.id, 0], [verifyObject.id, 0]);
  ensurePatchline(journey, [queryLength.id, 0], [verifyObject.id, 0]);
  ensurePatchline(journey, [verifyObject.id, 0], [responseRoute.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 0], [lengthPrint.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 0], [lengthCheck.id, 0]);
  ensurePatchline(journey, [lengthCheck.id, 0], [assertions.id, 0]);
  ensurePatchline(journey, [responseRoute.id, 1], [notesTrigger.id, 0]);
  ensurePatchline(journey, [notesTrigger.id, 1], [notesDict.id, 1]);
  ensurePatchline(journey, [notesTrigger.id, 0], [notesGetSize.id, 0]);
  ensurePatchline(journey, [notesGetSize.id, 0], [notesDict.id, 0]);
  ensurePatchline(journey, [notesDict.id, 1], [notesSizeRoute.id, 0]);
  ensurePatchline(journey, [notesSizeRoute.id, 0], [countPrint.id, 0]);
  ensurePatchline(journey, [notesSizeRoute.id, 0], [countCheck.id, 0]);
  ensurePatchline(journey, [countCheck.id, 0], [assertions.id, 1]);
  ensurePatchline(journey, [assertions.id, 1], [assertionPack.id, 1]);
  ensurePatchline(journey, [assertions.id, 0], [assertionPack.id, 0]);
  ensurePatchline(journey, [assertionPack.id, 0], [assertionCheck.id, 0]);
  ensurePatchline(journey, [assertionCheck.id, 0], [passSelect.id, 0]);
  ensurePatchline(journey, [passSelect.id, 0], [passMessage.id, 0]);
  ensurePatchline(journey, [passSelect.id, 1], [failMessage.id, 0]);
  ensurePatchline(journey, [passMessage.id, 0], [verificationPrint.id, 0]);
  ensurePatchline(journey, [failMessage.id, 0], [verificationPrint.id, 0]);
}

function updateComments(patcher) {
  for (const { box } of patcher.boxes) {
    if (box.maxclass === "comment" && typeof box.text === "string") {
      box.text = box.text
        .replace(/MidiJourney/g, "MIDIjourney")
        .replace(/uses OpenAI's chatgpt to generate midi/gi, "uses Pollinations to generate MIDI");
    }
    if (box.patcher) updateComments(box.patcher);
  }
}

function updateReleaseDependency(patcher) {
  let cache = patcher.dependency_cache || [];
  const source = cache.find((dependency) => dependency.name === "midiJourney.js");
  let release = cache.find((dependency) => dependency.name === "midiJourney.release.js");
  if (source && release) cache = cache.filter((dependency) => dependency !== source);
  if (source && !release) {
    source.name = "midiJourney.release.js";
    release = source;
  }
  if (!release) {
    throw new Error("Could not find the Node release dependency in MIDIjourney.source.amxd");
  }

  cache = cache.filter(
    (dependency) =>
      dependency.name !== "system-prompt.md" && dependency.name !== "installModules.js",
  );
  patcher.dependency_cache = cache;
}

function synchronize(device) {
  if (
    (process.env.MIDIJOURNEY_MAX_E2E_CONNECT === "1" ||
      process.env.MIDIJOURNEY_MAX_E2E_PROVIDER === "1") &&
    process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS === "1"
  ) {
    throw new Error(
      "MIDIJOURNEY_MAX_E2E_CONNECT/PROVIDER requires authorization status wiring",
    );
  }
  if (
    process.env.MIDIJOURNEY_MAX_E2E_CLIP === "1" &&
    process.env.MIDIJOURNEY_MAX_E2E_PROVIDER === "1"
  ) {
    throw new Error(
      "MIDIJOURNEY_MAX_E2E_CLIP and MIDIJOURNEY_MAX_E2E_PROVIDER cannot run together",
    );
  }
  const rootPatcher = device.patcher;
  rootPatcher.description =
    "Generate and remix MIDI clips with Pollinations BYOP while preserving creative prompt history.";
  rootPatcher.digest = "MIDIjourney v3 — AI MIDI generation for Ableton Live";
  rootPatcher.tags = "MIDI, generator, Pollinations, BYOP, Max for Live";
  rootPatcher.minimum_live_version = "12.0.0";
  rootPatcher.minimum_max_version = "9.0.0";
  const journeyBox = boxBy(
    rootPatcher.boxes,
    (box) => box.maxclass === "newobj" && box.text === "p midiJourney",
    "the MIDIjourney subpatcher",
  );
  const preferences = boxBy(
    rootPatcher.boxes,
    (box) => box.maxclass === "bpatcher" && box.name === "mj_bp_preferences.maxpat",
    "the compact preferences controls",
  );
  const journey = journeyBox.patcher;
  // The embedded editor's saved visibility is independent of the explicit
  // pcontrol command below. Normalize it closed so a previously open Max
  // editor is not restored when Live loads or hot-swaps the device.
  journey.visible = 0;
  const node = boxBy(
    journey.boxes,
    (box) => box.maxclass === "newobj" && box.text === "mj_nodeJS",
    "the Node service",
  );
  // Node can restore authorization before Live has finished constructing and
  // restoring the parent device UI. Those initial outlet messages can then be
  // lost or overwritten, leaving the compact button on Connect even though the
  // backend is already connected. live.thisdevice fires after Live has
  // initialized the device; defer once more and query the settled state after
  // a short delay. The handler itself awaits Node authorization initialization,
  // so this also remains correct on a slow credential-store lookup.
  const authStatusLoad = ensureBox(journey, "obj-pollinations-auth-status-load", {
    id: "obj-pollinations-auth-status-load",
    maxclass: "newobj",
    numinlets: 1,
    numoutlets: 3,
    outlettype: ["bang", "int", "int"],
    patching_rect: [300.0, 625.0, 83.0, 22.0],
    text: "live.thisdevice",
  });
  const authStatusDefer = ensureBox(
    journey,
    "obj-pollinations-auth-status-defer",
    {
      id: "obj-pollinations-auth-status-defer",
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [393.0, 625.0, 55.0, 22.0],
      text: "deferlow",
    },
  );
  const authStatusDelay = ensureBox(journey, "obj-pollinations-auth-status-delay", {
    id: "obj-pollinations-auth-status-delay",
    maxclass: "newobj",
    numinlets: 2,
    numoutlets: 1,
    outlettype: ["bang"],
    patching_rect: [458.0, 625.0, 64.0, 22.0],
    text: "delay 250",
  });
  const authStatusMessage = ensureBox(
    journey,
    "obj-pollinations-auth-status-message",
    {
      id: "obj-pollinations-auth-status-message",
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [532.0, 625.0, 70.0, 22.0],
      text: "authStatus",
    },
  );
  for (const box of [
    authStatusLoad,
    authStatusDefer,
    authStatusDelay,
    authStatusMessage,
  ]) {
    journey.lines = (journey.lines || []).filter(
      ({ patchline }) =>
        patchline.source[0] !== box.id && patchline.destination[0] !== box.id,
    );
  }
  ensurePatchline(journey, [authStatusLoad.id, 0], [authStatusDefer.id, 0]);
  ensurePatchline(journey, [authStatusDefer.id, 0], [authStatusDelay.id, 0]);
  ensurePatchline(journey, [authStatusDelay.id, 0], [authStatusMessage.id, 0]);
  ensurePatchline(journey, [authStatusMessage.id, 0], [node.id, 0]);
  const resultPipeline = boxBy(
    journey.boxes,
    (box) => box.id === "obj-22" && box.text === "mj_getClipDuration",
    "the generated MIDI result pipeline",
  );
  const start = boxBy(
    journey.boxes,
    (box) => box.maxclass === "bpatcher" && box.name === "mj_bp_start.maxpat",
    "the Create controls",
  );
  const history = boxBy(
    journey.boxes,
    (box) => box.maxclass === "bpatcher" && box.name === "mj_bp_historyControl.maxpat",
    "the history controls",
  );
  // The history bpatcher owns a hidden Blob parameter that Live stores inside
  // each Set. Keep its hierarchical path in the root parameter map; otherwise
  // Max can load the pattr object while Live never serializes its value.
  const setHistoryParameterPath =
    `${journeyBox.id}::${history.id}::obj-history-set-pattr`;
  rootPatcher.parameters ||= {};
  rootPatcher.parameters[setHistoryParameterPath] = [
    "midijourneySetHistory",
    "Set History",
    0,
  ];
  rootPatcher.parameters.parameter_overrides ||= {};
  rootPatcher.parameters.parameter_overrides[setHistoryParameterPath] = {
    ...(rootPatcher.parameters.parameter_overrides[setHistoryParameterPath] || {}),
    parameter_invisible: 1,
    parameter_longname: "midijourneySetHistory",
  };
  const createButton = boxBy(
    rootPatcher.boxes,
    (box) => box.id === "obj-33" && box.maxclass === "live.text",
    "the compact Create control",
  );

  // Older devices opened the expanded editor half a second after every load.
  // Besides being surprising in normal use, this makes hot-swapping test
  // builds appear to resurrect a stale editor. Keep the user-driven Create
  // route intact and remove only the legacy loadbang -> delay -> toggle path.
  const legacyAutoOpenIds = new Set(["obj-7", "obj-12", "obj-10"]);
  rootPatcher.boxes = rootPatcher.boxes.filter(
    ({ box }) => !legacyAutoOpenIds.has(box.id),
  );
  rootPatcher.lines = rootPatcher.lines.filter(
    ({ patchline }) =>
      !legacyAutoOpenIds.has(patchline.source[0]) &&
      !legacyAutoOpenIds.has(patchline.destination[0]),
  );
  // Create is transient UI state, not an automatable Live parameter. If Live
  // restores its previous value as 1 during a swap, the normal pcontrol route
  // opens the editor even though the user did not click it.
  createButton.mode = 1;
  createButton.parameter_enable = 0;
  delete rootPatcher.parameters?.[createButton.id];
  delete rootPatcher.parameters?.parameter_overrides?.[createButton.id];

  // The removed auto-open circuit also used to configure the expanded editor
  // as a floating production window. Restore only that window setup: keep the
  // editor closed on load, then let the manual Create -> pcontrol path open it.
  // Sending these commands through the editor's first inlet reaches its
  // existing thispatcher object without touching Create or pcontrol.
  const editorWindowLoad = ensureBox(
    rootPatcher,
    "obj-midijourney-editor-window-load",
    {
      hidden: 1,
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: ["bang"],
      patching_rect: [325.0, 610.0, 60.0, 22.0],
      text: "loadbang",
    },
  );
  const editorWindowDefer = ensureBox(
    rootPatcher,
    "obj-midijourney-editor-window-defer",
    {
      hidden: 1,
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [395.0, 610.0, 55.0, 22.0],
      text: "deferlow",
    },
  );
  const editorWindowConfig = ensureBox(
    rootPatcher,
    "obj-midijourney-editor-window-config",
    {
      hidden: 1,
      maxclass: "message",
      numinlets: 2,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [460.0, 610.0, 520.0, 22.0],
      text:
        "window flags float, window flags nominimize, window flags nogrow, window flags nozoom, window exec",
    },
  );
  for (const box of [editorWindowLoad, editorWindowDefer, editorWindowConfig]) {
    rootPatcher.lines = (rootPatcher.lines || []).filter(
      ({ patchline }) =>
        patchline.source[0] !== box.id && patchline.destination[0] !== box.id,
    );
  }
  ensurePatchline(rootPatcher, [editorWindowLoad.id, 0], [editorWindowDefer.id, 0]);
  ensurePatchline(
    rootPatcher,
    [editorWindowDefer.id, 0],
    [editorWindowConfig.id, 0],
  );
  ensurePatchline(rootPatcher, [editorWindowConfig.id, 0], [journeyBox.id, 0]);

  // Connection controls belong to the compact Ableton device panel, not the
  // expanded MIDI editor where the history control lives.
  history.numoutlets = 1;
  history.outlettype = [""];
  removePatchline(journey, [history.id, 1], [node.id, 0]);

  // Preferences now contains only the existing settings/history route.
  // Pollinations authorization lives entirely at the device top level, so the
  // dead modal inlet/outlet cannot be reconnected into a feedback loop.
  preferences.numinlets = 1;
  preferences.numoutlets = 1;
  preferences.outlettype = ["dictionary"];
  // Keep the preferences bpatcher over the History button only. A bpatcher
  // captures clicks across its whole presentation rectangle, including empty
  // space, so the former 170-pixel width made the root Connect button visible
  // but unreachable.
  preferences.presentation_rect = [0.0, 80.0, 85.0, 90.0];
  removePatchline(rootPatcher, [preferences.id, 1], [journeyBox.id, 0]);
  removePatchline(rootPatcher, [preferences.id, 1], [journeyBox.id, 1]);

  // The removed connection modal used to expose an apiKey parameter and a
  // Validate button. Leaving their hierarchical parameter paths in the AMXD
  // makes Live restore parameters whose objects no longer exist on every
  // device load.
  const obsoleteConnectionParameterPaths = [
    "obj-8::obj-8",
    "obj-8::obj-48::obj-54",
  ];
  for (const parameterPath of obsoleteConnectionParameterPaths) {
    delete rootPatcher.parameters?.[parameterPath];
    delete rootPatcher.parameters?.parameter_overrides?.[parameterPath];
  }

  // Keep the external mj_nodeJS abstraction on its original, proven outlet.
  // Adding an outlet to a dependency while Live is resolving or hot-swapping
  // it can make Max delete the caller patch cord as "outlet out of range".
  // Auth and cancellation therefore return as tagged messages on outlet 0;
  // this embedded route sends authorization state to the compact button,
  // disconnect cancellation back into the Create UI, and only actual MIDI
  // dictionaries into the clip pipeline.
  node.numoutlets = 1;
  node.outlettype = [""];
  const authRoute = ensureBox(journey, "obj-pollinations-auth-route", {
    id: "obj-pollinations-auth-route",
    maxclass: "newobj",
    numinlets: 3,
    numoutlets: 3,
    outlettype: ["", "", ""],
    patching_rect: [200.0, 490.0, 105.0, 22.0],
    text: "route auth cancel",
  });
  const cancelMessage = ensureBox(journey, "obj-pollinations-cancel-message", {
    hidden: 1,
    id: "obj-pollinations-cancel-message",
    maxclass: "message",
    numinlets: 2,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [275.0, 525.0, 43.0, 22.0],
    text: "cancel",
  });
  const sharedOutput = boxBy(
    journey.boxes,
    (box) => box.maxclass === "outlet" && box.index === 2,
    "the shared preferences/auth output",
  );
  const authPrepend = ensureBox(journey, "obj-pollinations-auth-prepend", {
    id: "obj-pollinations-auth-prepend",
    maxclass: "newobj",
    numinlets: 1,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [200.0, 525.0, 82.0, 22.0],
    text: "prepend auth",
  });
  // Candidate E proved that the Node wrapper emitted `auth connected`, but
  // its newly-added third embedded-subpatch outlet did not deliver that state
  // to the parent UI reliably after freezing. Reuse the long-established
  // second outlet: authorization is tagged, existing dictionary messages pass
  // beside it, and the parent patcher separates them immediately.
  journey.boxes = journey.boxes.filter(
    ({ box }) => box.id !== "obj-pollinations-auth-outlet",
  );
  const obsoleteAuthDeferId = "obj-pollinations-auth-defer";
  journey.boxes = journey.boxes.filter(({ box }) => box.id !== obsoleteAuthDeferId);
  journey.lines = journey.lines.filter(
    ({ patchline }) =>
      patchline.source[0] !== obsoleteAuthDeferId &&
      patchline.destination[0] !== obsoleteAuthDeferId &&
      patchline.source[0] !== node.id &&
      patchline.source[0] !== authRoute.id &&
      patchline.destination[0] !== authRoute.id &&
      patchline.source[0] !== authPrepend.id &&
      patchline.destination[0] !== authPrepend.id &&
      patchline.source[0] !== "obj-pollinations-auth-outlet" &&
      patchline.destination[0] !== "obj-pollinations-auth-outlet" &&
      patchline.source[0] !== cancelMessage.id &&
      patchline.destination[0] !== cancelMessage.id,
  );
  ensurePatchline(journey, [node.id, 0], [authRoute.id, 0]);
  ensurePatchline(journey, [authRoute.id, 0], [authPrepend.id, 0]);
  ensurePatchline(journey, [authPrepend.id, 0], [sharedOutput.id, 0]);
  ensurePatchline(journey, [authRoute.id, 1], [cancelMessage.id, 0]);
  ensurePatchline(journey, [cancelMessage.id, 0], [start.id, 0]);
  ensurePatchline(journey, [authRoute.id, 2], [resultPipeline.id, 0]);
  journeyBox.numoutlets = 2;
  journeyBox.outlettype = ["bang", ""];
  removePatchline(rootPatcher, [journeyBox.id, 2], [preferences.id, 0]);
  removePatchline(rootPatcher, [journeyBox.id, 2], [preferences.id, 1]);
  const sharedOutputRoute = ensureBox(
    rootPatcher,
    "obj-pollinations-shared-output-route",
    {
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 2,
      outlettype: ["", ""],
      patching_rect: [445.0, 420.0, 68.0, 22.0],
      text: "route auth",
    },
  );
  rootPatcher.lines = rootPatcher.lines.filter(
    ({ patchline }) =>
      patchline.source[0] !== sharedOutputRoute.id &&
      patchline.destination[0] !== sharedOutputRoute.id &&
      !(
        patchline.source[0] === journeyBox.id &&
        patchline.source[1] === 1 &&
        patchline.destination[0] === preferences.id
      ),
  );
  ensurePatchline(rootPatcher, [journeyBox.id, 1], [sharedOutputRoute.id, 0]);
  ensurePatchline(rootPatcher, [sharedOutputRoute.id, 1], [preferences.id, 0]);

  const connectButton = ensureBox(rootPatcher, "obj-pollinations-connect", {
    active: 1,
    activebgoncolor: [0.252174, 0.811837, 1.0, 1.0],
    activetextoncolor: [0.008976, 0.0, 0.086957, 1.0],
    bgcolor: [0.164706, 0.164706, 0.164706, 1.0],
    bordercolor: [1.0, 1.0, 1.0, 1.0],
    fontname: "Ableton Sans Bold",
    fontsize: 12.0,
    maxclass: "live.text",
    mode: 1,
    numinlets: 1,
    numoutlets: 2,
    outlettype: ["", ""],
    parameter_enable: 0,
    patching_rect: [325.0, 420.0, 75.0, 70.0],
    presentation: 1,
    presentation_rect: [85.0, 90.0, 75.0, 70.0],
    rounded: 8.0,
    text: "Connect",
    texton: "Connected",
    varname: "pollinationsConnection",
  });
  // The visible live.text is also the hit target. Transparent overlays and
  // comments do not composite reliably over native Live controls.
  const obsoleteConnectIds = new Set([
    "obj-pollinations-connect-hit",
    "obj-pollinations-connect-label",
    "obj-pollinations-connect-filter",
    "obj-pollinations-status-defer",
    "obj-pollinations-connect-gate",
    "obj-pollinations-status-trigger",
    "obj-pollinations-status-close",
    "obj-pollinations-status-reopen-defer",
    "obj-pollinations-status-open",
    "obj-pollinations-action-unpack",
    "obj-pollinations-action-text",
    "obj-pollinations-action-offtext",
    "obj-pollinations-action-ontext",
  ]);
  rootPatcher.boxes = rootPatcher.boxes.filter(
    ({ box }) => !obsoleteConnectIds.has(box.id),
  );
  rootPatcher.lines = rootPatcher.lines.filter(
    ({ patchline }) =>
      !obsoleteConnectIds.has(patchline.source[0]) &&
      !obsoleteConnectIds.has(patchline.destination[0]),
  );
  const toggleMessage = ensureBox(rootPatcher, "obj-pollinations-toggle-message", {
    maxclass: "message",
    numinlets: 2,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [325.0, 535.0, 105.0, 22.0],
    text: "toggleConnection",
  });
  const commandDefer = ensureBox(rootPatcher, "obj-pollinations-command-defer", {
    maxclass: "newobj",
    numinlets: 1,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [325.0, 565.0, 55.0, 22.0],
    text: "deferlow",
  });
  const statusUnpack = ensureBox(rootPatcher, "obj-pollinations-status-unpack", {
    maxclass: "newobj",
    numinlets: 1,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [525.0, 420.0, 55.0, 22.0],
    text: "deferlow",
  });
  const statusSelect = ensureBox(rootPatcher, "obj-pollinations-status-select", {
    maxclass: "newobj",
    numinlets: 6,
    numoutlets: 6,
    outlettype: ["bang", "bang", "bang", "bang", "bang", ""],
    patching_rect: [445.0, 480.0, 330.0, 22.0],
    text: "route connected offline checking connecting awaiting_approval",
  });
  const statusConnected = ensureBox(rootPatcher, "obj-pollinations-status-connected", {
    maxclass: "message",
    numinlets: 2,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [445.0, 510.0, 290.0, 22.0],
    text: "text Connected, texton Connected, set 0, active 1",
  });
  const statusPending = ensureBox(rootPatcher, "obj-pollinations-status-pending", {
    maxclass: "message",
    numinlets: 2,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [445.0, 540.0, 310.0, 22.0],
    text: "text Connecting..., texton Connecting..., set 0, active 0",
  });
  const statusDisconnected = ensureBox(rootPatcher, "obj-pollinations-status-disconnected", {
    maxclass: "message",
    numinlets: 2,
    numoutlets: 1,
    outlettype: [""],
    patching_rect: [445.0, 570.0, 290.0, 22.0],
    text: "text Connect, texton Connect, set 0, active 1",
  });

  for (const box of [
    connectButton,
    toggleMessage,
    commandDefer,
    statusUnpack,
    statusSelect,
    statusConnected,
    statusPending,
    statusDisconnected,
  ]) {
    rootPatcher.lines = rootPatcher.lines.filter(
      ({ patchline }) =>
        patchline.source[0] !== box.id && patchline.destination[0] !== box.id,
    );
  }
  // Keep toggle mode for Live's rectangular control rendering, but make both
  // of its labels identical and reset its internal value to zero on every
  // status update. The visible text is therefore independent from toggle state.
  // Both Connect and Connected clicks invoke the same state-aware backend
  // command, and status updates cannot feed back into the action path. While startup
  // validation or device authorization is pending, disable the mouse target
  // and show Connecting... so an impatient second click cannot cancel a
  // healthy authorization attempt before its browser window appears.
  ensurePatchline(rootPatcher, [connectButton.id, 0], [toggleMessage.id, 0]);
  ensurePatchline(rootPatcher, [toggleMessage.id, 0], [commandDefer.id, 0]);
  ensurePatchline(rootPatcher, [commandDefer.id, 0], [journeyBox.id, 1]);
  if (process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS !== "1") {
    // Defer the safe authorization atom until Live's device UI is settled.
    // Connected and offline both mean a reusable local authorization exists.
    // Checking, connecting, and awaiting approval share a disabled pending
    // state; every other state renders the safe, retryable Connect state.
    ensurePatchline(rootPatcher, [sharedOutputRoute.id, 0], [statusUnpack.id, 0]);
    ensurePatchline(rootPatcher, [statusUnpack.id, 0], [statusSelect.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 0], [statusConnected.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 1], [statusConnected.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 2], [statusPending.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 3], [statusPending.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 4], [statusPending.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 5], [statusDisconnected.id, 0]);
    ensurePatchline(rootPatcher, [statusConnected.id, 0], [connectButton.id, 0]);
    ensurePatchline(rootPatcher, [statusPending.id, 0], [connectButton.id, 0]);
    ensurePatchline(rootPatcher, [statusDisconnected.id, 0], [connectButton.id, 0]);
  }

  // Every instrumentation object carries a reserved id prefix, while its log
  // objects also carry a marker. Strip both recursively before conditionally
  // adding a harness so normal synchronization cannot retain a stale circuit.
  removeTestHooks(rootPatcher);
  if (process.env.MIDIJOURNEY_MAX_E2E_STATUS_TRACE === "1") {
    const tracePrint = (patcher, suffix, label, patchingRect) =>
      ensureBox(patcher, `${E2E_OBJECT_PREFIX}status-${suffix}`, {
        hidden: 1,
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 0,
        patching_rect: patchingRect,
        text: `print MIDIjourney_E2E_STATUS_${label}`,
      });
    const childRoutePrint = tracePrint(
      journey,
      "child-route",
      "CHILD_ROUTE",
      [315.0, 490.0, 230.0, 22.0],
    );
    const childPrependPrint = tracePrint(
      journey,
      "child-prepend",
      "CHILD_PREPEND",
      [315.0, 525.0, 245.0, 22.0],
    );
    const rootRawPrint = tracePrint(
      rootPatcher,
      "root-raw",
      "ROOT_RAW",
      [785.0, 420.0, 215.0, 22.0],
    );
    const rootRoutePrint = tracePrint(
      rootPatcher,
      "root-route",
      "ROOT_ROUTE",
      [785.0, 450.0, 225.0, 22.0],
    );
    const deferredPrint = tracePrint(
      rootPatcher,
      "deferred",
      "DEFERRED",
      [785.0, 480.0, 215.0, 22.0],
    );
    const connectedMatchPrint = tracePrint(
      rootPatcher,
      "connected-match",
      "CONNECTED_MATCH",
      [785.0, 510.0, 260.0, 22.0],
    );
    const connectedMessagePrint = tracePrint(
      rootPatcher,
      "connected-message",
      "CONNECTED_MESSAGE",
      [785.0, 540.0, 275.0, 22.0],
    );
    const fallbackPrint = tracePrint(
      rootPatcher,
      "fallback",
      "FALLBACK",
      [785.0, 570.0, 215.0, 22.0],
    );
    ensurePatchline(journey, [authRoute.id, 0], [childRoutePrint.id, 0]);
    ensurePatchline(journey, [authPrepend.id, 0], [childPrependPrint.id, 0]);
    ensurePatchline(rootPatcher, [journeyBox.id, 1], [rootRawPrint.id, 0]);
    ensurePatchline(rootPatcher, [sharedOutputRoute.id, 0], [rootRoutePrint.id, 0]);
    ensurePatchline(rootPatcher, [statusUnpack.id, 0], [deferredPrint.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 0], [connectedMatchPrint.id, 0]);
    ensurePatchline(rootPatcher, [statusConnected.id, 0], [connectedMessagePrint.id, 0]);
    ensurePatchline(rootPatcher, [statusSelect.id, 5], [fallbackPrint.id, 0]);
  }
  if (process.env.MIDIJOURNEY_MAX_E2E_CONNECT === "1") {
    const e2eDisconnected = ensureBox(
      rootPatcher,
      "obj-pollinations-e2e-disconnected",
      {
        maxclass: "newobj",
        numinlets: 2,
        numoutlets: 2,
        outlettype: ["bang", ""],
        patching_rect: [600.0, 420.0, 105.0, 22.0],
        text: "sel disconnected",
      },
    );
    const e2eOnebang = ensureBox(rootPatcher, "obj-pollinations-e2e-onebang", {
      maxclass: "newobj",
      numinlets: 2,
      numoutlets: 1,
      outlettype: ["bang"],
      patching_rect: [715.0, 420.0, 70.0, 22.0],
      text: "onebang 1",
    });
    const e2eDelay = ensureBox(rootPatcher, "obj-pollinations-e2e-delay", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: ["bang"],
      patching_rect: [600.0, 450.0, 67.0, 22.0],
      text: "delay 250",
    });
    const e2eDelayPrint = ensureBox(rootPatcher, "obj-pollinations-e2e-delay-print", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [680.0, 450.0, 190.0, 22.0],
      text: "print MIDIjourney_E2E_DELAY",
    });
    const e2eButtonPrint = ensureBox(rootPatcher, "obj-pollinations-e2e-button-print", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [680.0, 480.0, 195.0, 22.0],
      text: "print MIDIjourney_E2E_BUTTON",
    });
    const e2eCommandPrint = ensureBox(rootPatcher, "obj-pollinations-e2e-command-print", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [680.0, 510.0, 210.0, 22.0],
      text: "print MIDIjourney_E2E_COMMAND",
    });
    const e2eDeferPrepend = ensureBox(rootPatcher, "obj-pollinations-e2e-defer-prepend", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 1,
      outlettype: [""],
      patching_rect: [600.0, 540.0, 210.0, 22.0],
      text: "prepend MIDIjourney_E2E_DEFER",
    });
    const e2eDeferPrint = ensureBox(rootPatcher, "obj-pollinations-e2e-defer-print", {
      maxclass: "newobj",
      numinlets: 1,
      numoutlets: 0,
      patching_rect: [820.0, 540.0, 190.0, 22.0],
      text: "print MIDIjourney_E2E_DEFER",
    });
    const nodeInlet = boxBy(
      journey.boxes,
      (box) => box.maxclass === "inlet" && box.index === 2,
      "the Node command inlet",
    );
    const e2eNodeInletPrepend = ensureBox(
      journey,
      "obj-pollinations-e2e-node-inlet-prepend",
      {
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 1,
        outlettype: [""],
        patching_rect: [235.0, 575.0, 235.0, 22.0],
        text: "prepend MIDIjourney_E2E_NODE_INLET",
      },
    );
    const e2eNodeInletPrint = ensureBox(
      journey,
      "obj-pollinations-e2e-node-inlet-print",
      {
        maxclass: "newobj",
        numinlets: 1,
        numoutlets: 0,
        patching_rect: [480.0, 575.0, 220.0, 22.0],
        text: "print MIDIjourney_E2E_NODE_INLET",
      },
    );
    // Never toggle a restored connection. Wait until initialization explicitly
    // reports `disconnected`, then exercise the real live.text path once.
    ensurePatchline(rootPatcher, [statusUnpack.id, 0], [e2eDisconnected.id, 0]);
    ensurePatchline(rootPatcher, [e2eDisconnected.id, 0], [e2eOnebang.id, 0]);
    ensurePatchline(rootPatcher, [e2eOnebang.id, 0], [e2eDelay.id, 0]);
    ensurePatchline(rootPatcher, [e2eDelay.id, 0], [e2eDelayPrint.id, 0]);
    // Exercise the real live.text output circuit in Live without depending on
    // external UI automation, which cannot click embedded Max device views.
    // A bang has the same toggle-mode output semantics as a mouse click.
    ensurePatchline(rootPatcher, [e2eDelay.id, 0], [connectButton.id, 0]);
    ensurePatchline(rootPatcher, [connectButton.id, 0], [e2eButtonPrint.id, 0]);
    ensurePatchline(rootPatcher, [toggleMessage.id, 0], [e2eCommandPrint.id, 0]);
    ensurePatchline(rootPatcher, [commandDefer.id, 0], [e2eDeferPrepend.id, 0]);
    ensurePatchline(rootPatcher, [e2eDeferPrepend.id, 0], [e2eDeferPrint.id, 0]);
    ensurePatchline(journey, [nodeInlet.id, 0], [e2eNodeInletPrepend.id, 0]);
    ensurePatchline(journey, [e2eNodeInletPrepend.id, 0], [e2eNodeInletPrint.id, 0]);
  }
  if (process.env.MIDIJOURNEY_MAX_E2E_CLIP === "1") {
    addDeterministicClipHarness(journey);
  }
  if (process.env.MIDIJOURNEY_MAX_E2E_PROVIDER === "1") {
    addProviderClipHarness(journey, node, authRoute);
  }
  updateReleaseDependency(rootPatcher);
  updateComments(rootPatcher);
  return device;
}

function main() {
  const original = fs.readFileSync(devicePath);
  if (original.subarray(0, 4).toString("ascii") !== "ampf") {
    throw new Error("MIDIjourney.source.amxd is not an AMPF container");
  }
  if (original.subarray(24, 28).toString("ascii") !== "ptch") {
    throw new Error("MIDIjourney.source.amxd has an unsupported container layout");
  }

  const declaredLength = original.readUInt32LE(28);
  const patchChunk = original.subarray(32, 32 + declaredLength);
  const jsonText = patchChunk.toString("utf8").replace(/\0+$/, "");
  const device = synchronize(JSON.parse(jsonText));
  const encoded = Buffer.from(`${JSON.stringify(device, null, "\t")}\n\0`, "utf8");
  const header = Buffer.from(original.subarray(0, 32));
  header.writeUInt32LE(encoded.length, 28);

  fs.writeFileSync(temporaryPath, Buffer.concat([header, encoded]), { mode: 0o644 });
  fs.renameSync(temporaryPath, devicePath);
  process.stdout.write(`Synchronized ${path.relative(root, devicePath)}\n`);
}

if (require.main === module) main();

module.exports = { synchronize };
