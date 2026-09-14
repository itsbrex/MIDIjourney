#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const ncc = require(require.resolve("@vercel/ncc", {
  paths: [path.join(root, "js")],
}));
const { validateFrozenAmxd } = require("./max-release-portability");
const patcherDirectory = path.join(root, "patchers");
const sourceDevicePath = path.join(root, "MIDIjourney.source.amxd");
const releaseDevicePath = path.join(root, "MIDIjourney.amxd");
const releaseDeviceDigestPath = path.join(root, "MIDIjourney.amxd.sha256");
const releaseConfigPath = path.join(root, "js", "config.release.js");
const releaseBundlePath = path.join(root, "js", "midiJourney.release.js");
const releaseKeyDigestPath = path.join(root, "js", "release-app-key.sha256");
const credentialPattern = /\b(?:sk|pk)_[A-Za-z0-9_-]{12,}\b/g;
const publishableAppKeyPattern = /^pk_[A-Za-z0-9_-]{12,}$/;
const allowedPlaceholder = "pk_REPLACE_WITH_MIDIJOURNEY_APP_KEY";
const audioEffectAmxdType = 0x61616161;
const reviewedSdkFixtureDigest =
  "58a37f5dd729b3d50bddc997e67e9eb72248d94d9feb14fc5fda969287dffc31";

function verifyPatcher(patcher, location) {
  const boxes = patcher.boxes || [];
  const ids = new Set(boxes.map(({ box }) => box.id));
  if (ids.size !== boxes.length) throw new Error(`${location} contains duplicate object IDs`);

  for (const { patchline } of patcher.lines || []) {
    if (!ids.has(patchline.source[0])) {
      throw new Error(`${location} references missing source ${patchline.source[0]}`);
    }
    if (!ids.has(patchline.destination[0])) {
      throw new Error(`${location} references missing destination ${patchline.destination[0]}`);
    }
  }

  for (const { box } of boxes) {
    if (box.patcher) verifyPatcher(box.patcher, `${location}/${box.text || box.id}`);
  }
}

function boxById(patcher, id) {
  return (patcher.boxes || []).find(({ box }) => box.id === id)?.box;
}

function allBoxes(patcher) {
  return (patcher.boxes || []).flatMap(({ box }) => [
    box,
    ...(box.patcher ? allBoxes(box.patcher) : []),
  ]);
}

function verifyDynamicLiveObjects(patcher, location) {
  const persistentLiveObject = allBoxes(patcher).find(
    (box) =>
      box.text === "live.object" &&
      box.saved_object_attributes?._persistence !== 0,
  );
  if (persistentLiveObject) {
    throw new Error(
      `${location} must not persist dynamically assigned live.object IDs (${persistentLiveObject.id})`,
    );
  }
}

function hasLine(patcher, sourceId, destinationId, sourceOutlet = null, destinationInlet = null) {
  return (patcher.lines || []).some(
    ({ patchline }) =>
      patchline.source[0] === sourceId &&
      patchline.destination[0] === destinationId &&
      (sourceOutlet === null || patchline.source[1] === sourceOutlet) &&
      (destinationInlet === null || patchline.destination[1] === destinationInlet),
  );
}

function cordEndpointKey({ source, destination }) {
  return JSON.stringify([source[0], source[1], destination[0], destination[1]]);
}

function hasExactRelevantCords(patcher, expectedCords, isRelevant) {
  const actualKeys = (patcher.lines || [])
    .map(({ patchline }) => patchline)
    .filter(isRelevant)
    .map(cordEndpointKey)
    .sort();
  const expectedKeys = expectedCords
    .map(([sourceId, sourceOutlet, destinationId, destinationInlet]) => ({
      source: [sourceId, sourceOutlet],
      destination: [destinationId, destinationInlet],
    }))
    .map(cordEndpointKey)
    .sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);
}

function lineBy(patcher, sourceId, destinationId, sourceOutlet, destinationInlet) {
  return (patcher.lines || [])
    .map(({ patchline }) => patchline)
    .find(
      ({ source, destination }) =>
        source[0] === sourceId &&
        source[1] === sourceOutlet &&
        destination[0] === destinationId &&
        destination[1] === destinationInlet,
    );
}

function rectanglesOverlap(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length < 4 ||
    right.length < 4
  ) {
    return true;
  }
  return (
    left[0] < right[0] + right[2] &&
    left[0] + left[2] > right[0] &&
    left[1] < right[1] + right[3] &&
    left[1] + left[3] > right[1]
  );
}

async function verifyReleaseBundleIsCurrent() {
  // A clean checkout intentionally has no ignored release bundle. When one is
  // present for a freeze, prove it was generated from the current source.
  if (!fs.existsSync(releaseBundlePath)) return;
  if (!fs.existsSync(releaseConfigPath)) {
    throw new Error(
      "Cannot verify js/midiJourney.release.js without the ignored release configuration",
    );
  }

  let result;
  try {
    result = await ncc(path.join(root, "js", "midiJourney.js"), {
      cache: false,
      externals: ["max-api"],
      minify: true,
      quiet: true,
    });
  } catch {
    throw new Error("Could not compile the current Node source for release verification");
  }
  if (Object.keys(result.assets).length !== 0) {
    throw new Error("The current Node source compiles with an unexpected runtime asset");
  }

  const currentBundle = fs.readFileSync(releaseBundlePath);
  if (!Buffer.from(result.code, "utf8").equals(currentBundle)) {
    throw new Error(
      "js/midiJourney.release.js is stale; rebuild it from the current Node source before freezing Max",
    );
  }
}

function verifyPollinationsUi() {
  const preferencesPath = path.join(patcherDirectory, "mj_bp_preferences.maxpat");
  const preferencesText = fs.readFileSync(preferencesPath, "utf8");
  const preferences = JSON.parse(preferencesText).patcher;
  const historyButton = boxById(preferences, "obj-26");
  if (historyButton?.text !== "History" || historyButton.presentation !== 1) {
    throw new Error("The compact History control is missing");
  }
  const modelSelector = boxById(preferences, "obj-24");
  const modelFlow = boxById(preferences, "obj-22");
  const modelPatcher = modelFlow?.patcher;
  const modelIndex = modelPatcher && boxById(modelPatcher, "obj-1");
  const modelDefault = modelPatcher && boxById(modelPatcher, "obj-8");
  const modelField = modelPatcher && boxById(modelPatcher, "obj-54");
  const modelValues = modelSelector?.saved_attribute_attributes?.valueof;
  if (
    modelSelector?.maxclass !== "live.tab" ||
    JSON.stringify(modelValues?.parameter_enum) !== JSON.stringify(["Pollinations default"]) ||
    modelValues?.parameter_mmax !== 0 ||
    modelIndex?.text !== "sel 0" ||
    modelIndex?.numinlets !== 2 ||
    modelIndex?.numoutlets !== 2 ||
    modelDefault?.text !== "openai" ||
    modelField?.text !== "prepend replace gptModel" ||
    boxById(modelPatcher, "obj-9") !== undefined ||
    !hasLine(modelPatcher, modelIndex.id, modelDefault.id, 0, 0) ||
    !hasLine(modelPatcher, modelDefault.id, modelField.id, 0, 0)
  ) {
    throw new Error("Preferences must expose one Pollinations-default model choice");
  }
  const preferencesInterface = (preferences.boxes || [])
    .map(({ box }) => box)
    .filter((box) => box.maxclass === "inlet" || box.maxclass === "outlet");
  if (
    preferencesInterface.length !== 2 ||
    preferencesInterface.some((box) => box.index !== 1)
  ) {
    throw new Error("Preferences must expose only its settings/history inlet and outlet");
  }
  const obsoletePollinationsUi = allBoxes(preferences).find(
    (box) =>
      box.id?.startsWith("obj-pollinations") ||
      box.text === "p pollinations" ||
      box.varname === "pollinationsConnection" ||
      box.varname === "pollinationsFrame",
  );
  if (obsoletePollinationsUi) {
    throw new Error("The obsolete preferences-level Pollinations circuit must stay removed");
  }
  if (/pollinations/i.test(preferencesText.replace('"Pollinations default"', ""))) {
    throw new Error("Preferences must not retain obsolete Pollinations objects or color routes");
  }

  const editorPath = path.join(patcherDirectory, "mj_bp_historyControl.maxpat");
  const editorText = fs.readFileSync(editorPath, "utf8").toLowerCase();
  if (editorText.includes("pollinations") || editorText.includes("connect to")) {
    throw new Error("Pollinations connection UI must not appear in the expanded editor");
  }
}

function verifyInputClipTargeting() {
  const inputPath = path.join(patcherDirectory, "mj_inputClipData.maxpat");
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8")).patcher;
  const selectedTrackTrigger = boxById(input, "obj-87");
  const highlightedSlot = boxById(input, "obj-97");
  const highlightedSlotTrack = boxById(input, "obj-highlighted-slot-track");
  const midiTrackCheck = boxById(input, "obj-77");
  const highlightedSlotStore = boxById(input, "obj-122");
  const selectedClipState = boxById(input, "obj-35");
  const selectedSceneTrigger = boxById(input, "obj-63");
  const selectedTrackDefer = boxById(input, "obj-162");
  const targetObjectIds = new Set([
    selectedTrackTrigger?.id,
    highlightedSlot?.id,
    highlightedSlotTrack?.id,
    midiTrackCheck?.id,
  ]);
  const targetCordsAreExact = hasExactRelevantCords(
    input,
    [
      [selectedTrackDefer?.id, 0, selectedTrackTrigger?.id, 0],
      [selectedTrackTrigger?.id, 1, midiTrackCheck?.id, 0],
      [selectedTrackTrigger?.id, 0, highlightedSlot?.id, 0],
      [selectedSceneTrigger?.id, 0, highlightedSlot?.id, 0],
      [highlightedSlot?.id, 1, highlightedSlotStore?.id, 1],
      [highlightedSlot?.id, 1, highlightedSlotTrack?.id, 0],
      [highlightedSlotTrack?.id, 0, midiTrackCheck?.id, 0],
      [midiTrackCheck?.id, 0, selectedClipState?.id, 0],
    ],
    ({ source, destination }) =>
      targetObjectIds.has(source[0]) || targetObjectIds.has(destination[0]),
  );
  if (
    selectedTrackTrigger?.text !== "t b l" ||
    highlightedSlot?.text !==
      "live.path live_set view highlighted_clip_slot" ||
    highlightedSlotTrack?.text !== "mj_getFromId canonical_parent" ||
    highlightedSlotTrack?.numinlets !== 1 ||
    highlightedSlotTrack?.numoutlets !== 1 ||
    midiTrackCheck?.text !== "mj_getFromId has_midi_input" ||
    !targetCordsAreExact
  ) {
    throw new Error(
      "Clip targeting must preserve Arrangement validation and resolve a highlighted Session slot through its owning MIDI track",
    );
  }
}

function readDevice() {
  const buffer = fs.readFileSync(sourceDevicePath);
  if (buffer.subarray(0, 4).toString("ascii") !== "ampf") {
    throw new Error("MIDIjourney.source.amxd is not an AMPF container");
  }
  if (buffer.subarray(24, 28).toString("ascii") !== "ptch") {
    throw new Error("MIDIjourney.source.amxd uses an unsupported container layout");
  }
  const length = buffer.readUInt32LE(28);
  if (length !== buffer.length - 32) {
    throw new Error("MIDIjourney.source.amxd has an invalid chunk length");
  }
  return JSON.parse(buffer.subarray(32).toString("utf8").replace(/\0+$/, ""));
}

function embeddedZipEntries(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const entries = [];
  for (let offset = 0; (offset = buffer.indexOf(signature, offset)) >= 0; offset += 4) {
    if (offset + 30 > buffer.length) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if (!nameLength || nameLength > 4096 || offset + 30 + nameLength > buffer.length) continue;
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    if (/[^\x20-\x7e]/.test(name)) continue;
    const dataStart = offset + 30 + nameLength + extraLength;
    entries.push({ name, method, compressedSize, uncompressedSize, dataStart });
  }
  return entries;
}

function verifyReleaseDevice() {
  const buffer = fs.readFileSync(releaseDevicePath);
  const validation = validateFrozenAmxd(buffer);
  if (validation.amxdType !== audioEffectAmxdType) {
    throw new Error("Release AMXD must remain a Max Audio Effect for Main/Master");
  }
  if (
    validation.minimumLiveVersion !== "12.0.0" ||
    validation.minimumMaxVersion !== "9.0.0"
  ) {
    throw new Error("Release AMXD does not preserve its declared Live/Max minimums");
  }
  const frozenMetadata = buffer.subarray(32, validation.zipOffset);
  if (
    frozenMetadata.includes(Buffer.from("obj-pollinations-e2e-")) ||
    frozenMetadata.includes(Buffer.from("MIDIjourney_E2E_"))
  ) {
    throw new Error("Release AMXD contains a test-only E2E hook");
  }

  const entries = embeddedZipEntries(buffer);
  const names = new Set(entries.map((entry) => entry.name));
  if (names.size !== entries.length) {
    throw new Error("Release AMXD contains duplicate embedded dependency names");
  }
  const forbidden = entries.find((entry) =>
    /(?:^js\/|node_modules|config\.release|installModules|\/test\/|(?:^|\/)midiJourney(?:\.release)?\.js$|(?:^|\/)mj_nodeJS\.maxpat$|(?:^|\/)system-prompt\.md$)/i.test(
      entry.name,
    ),
  );
  if (forbidden) throw new Error(`Release AMXD contains forbidden asset ${forbidden.name}`);
  for (const required of [
    "node_content/midijourney-v3-runtime.js",
    "patchers/midijourney_v3_release_node.maxpat",
    "images/validate.svg",
  ]) {
    if (!names.has(required)) throw new Error(`Release AMXD is missing ${required}`);
  }

  const runtime = entries.find(
    (entry) => entry.name === "node_content/midijourney-v3-runtime.js",
  );
  const compressed = buffer.subarray(
    runtime.dataStart,
    runtime.dataStart + runtime.compressedSize,
  );
  const decoded = runtime.method === 8 ? zlib.inflateRawSync(compressed) : compressed;
  if (decoded.length !== runtime.uncompressedSize) {
    throw new Error("Release AMXD runtime has an invalid decoded length");
  }
  if (fs.existsSync(releaseBundlePath) && !decoded.equals(fs.readFileSync(releaseBundlePath))) {
    throw new Error("Release AMXD runtime does not match the current release bundle");
  }

  const expectedDigest = fs
    .readFileSync(releaseDeviceDigestPath, "utf8")
    .trim()
    .split(/\s+/)[0];
  const actualDigest = require("crypto").createHash("sha256").update(buffer).digest("hex");
  if (expectedDigest !== actualDigest) {
    throw new Error("MIDIjourney.amxd does not match MIDIjourney.amxd.sha256");
  }
}

function readApprovedReleaseAppKey() {
  if (!fs.existsSync(releaseConfigPath)) return null;

  const content = fs.readFileSync(releaseConfigPath, "utf8");
  const assignment = content.match(/exports\.appKey\s*=\s*("(?:[^"\\]|\\.)*")\s*;/);
  if (!assignment) throw new Error("js/config.release.js has an unsupported format");

  const appKey = JSON.parse(assignment[1]);
  if (!publishableAppKeyPattern.test(appKey) || appKey === allowedPlaceholder) {
    throw new Error("js/config.release.js does not contain a valid publishable App Key");
  }
  return appKey;
}

function releaseKeyDigest() {
  const digest = fs.readFileSync(releaseKeyDigestPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("js/release-app-key.sha256 must contain one SHA-256 digest");
  }
  return digest;
}

function digestCredential(value) {
  return require("crypto").createHash("sha256").update(value).digest("hex");
}

function scanCredentials(directory, approvedReleaseAppKey, approvedDigest) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".release-max-project", "node_modules"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanCredentials(target, approvedReleaseAppKey, approvedDigest);
      continue;
    }
    if (entry.name === "RELEASE_V3_PLAN.md") continue;
    const content = fs.readFileSync(target, "utf8");
    const matches = content.match(credentialPattern) || [];
    const unexpected = matches.filter(
      (match) =>
        match !== allowedPlaceholder &&
        !(
          [releaseConfigPath, releaseBundlePath].includes(target) &&
          match === approvedReleaseAppKey
        ) &&
        !(target === sourceDevicePath && digestCredential(match) === approvedDigest) &&
        !(
          target === releaseBundlePath &&
          digestCredential(match) === reviewedSdkFixtureDigest
        ),
    );
    if (unexpected.length) {
      throw new Error(`${path.relative(root, target)} contains a credential-like value`);
    }
  }
}

for (const file of fs.readdirSync(patcherDirectory).filter((name) => name.endsWith(".maxpat"))) {
  const document = JSON.parse(fs.readFileSync(path.join(patcherDirectory, file), "utf8"));
  verifyPatcher(document.patcher, file);
  verifyDynamicLiveObjects(document.patcher, file);
}
verifyPollinationsUi();
verifyInputClipTargeting();

const startPatcher = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_bp_start.maxpat"), "utf8"),
).patcher;
const startCancel = boxById(startPatcher, "obj-8");
const startCancelToUi = lineBy(startPatcher, "obj-8", "obj-23", 0, 0);
const startCancelToNode = lineBy(startPatcher, "obj-8", "obj-19", 0, 1);
const startCancelCords = (startPatcher.lines || []).filter(
  ({ patchline }) => patchline.source[0] === "obj-8" && patchline.source[1] === 0,
);
if (
  startCancel?.text !== "cancel" ||
  startCancelToUi?.order !== 0 ||
  startCancelToNode?.order !== 1 ||
  startCancelCords.length !== 2
) {
  throw new Error(
    "Clear must reset the Create UI before forwarding exactly one cancellation to Node",
  );
}

const genericRoute = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_route.maxpat"), "utf8"),
).patcher;
const genericRoutePass = boxById(genericRoute, "obj-6");
const bareSelectorRoute = boxById(genericRoute, "obj-preserve-bare-selector");
const bareSelectorMessage = boxById(genericRoute, "obj-selector-message");
if (
  genericRoutePass?.text !== "routepass #1" ||
  bareSelectorRoute?.text !== "route bang" ||
  bareSelectorRoute?.numinlets !== 2 ||
  bareSelectorRoute?.numoutlets !== 2 ||
  bareSelectorMessage?.text !== "#1" ||
  !hasLine(genericRoute, genericRoutePass.id, bareSelectorRoute.id, 0, 0) ||
  hasLine(genericRoute, genericRoutePass.id, "obj-15", 0, 0) ||
  hasLine(genericRoute, genericRoutePass.id, "obj-16", 0, 0) ||
  !hasLine(genericRoute, genericRoutePass.id, "obj-15", 1, 0) ||
  !hasLine(genericRoute, bareSelectorRoute.id, bareSelectorMessage.id, 0, 0) ||
  !hasLine(genericRoute, bareSelectorMessage.id, "obj-15", 0, 0) ||
  !hasLine(genericRoute, bareSelectorMessage.id, "obj-16", 0, 0) ||
  !hasLine(genericRoute, bareSelectorRoute.id, "obj-15", 1, 0) ||
  !hasLine(genericRoute, bareSelectorRoute.id, "obj-16", 1, 0)
) {
  throw new Error("mj_route must preserve bare matched selectors instead of emitting bang");
}

const clipClear = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_clipClear.maxpat"), "utf8"),
).patcher;
const clipImport = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_clipImport.maxpat"), "utf8"),
).patcher;
const clearMessages = new Set(allBoxes(clipClear).map((box) => box.text));
const importMessages = new Set(allBoxes(clipImport).map((box) => box.text));
if (
  !clearMessages.has("remove_notes_extended 0 128 0. $1") ||
  !clearMessages.has("remove_notes 0 0 $1 128") ||
  !importMessages.has("call get_notes 0 0 $1 128")
) {
  throw new Error("Live note ranges must include both MIDI pitch 0 and pitch 127");
}

const clipCreate = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_clipCreate.maxpat"), "utf8"),
).patcher;
const createDurationReader = boxById(clipCreate, "obj-80");
const createDurationStore = boxById(clipCreate, "obj-81");
const createTrigger = boxById(clipCreate, "obj-9");
const createMessage = boxById(clipCreate, "obj-3");
const createLiveObject = boxById(clipCreate, "obj-38");
if (
  createDurationReader?.text !== "mj_getFromDict duration:" ||
  createDurationStore?.text !== "f" ||
  createTrigger?.text !== "t b l" ||
  createMessage?.text !== "call create_clip $1" ||
  !hasLine(clipCreate, "obj-4", createDurationReader.id, 0, 0) ||
  !hasLine(clipCreate, createDurationReader.id, createDurationStore.id, 1, 1) ||
  !hasLine(clipCreate, createDurationReader.id, createTrigger.id, 0, 0) ||
  !hasLine(clipCreate, createTrigger.id, createDurationStore.id, 0, 0) ||
  !hasLine(clipCreate, createTrigger.id, "obj-5", 1, 1) ||
  !hasLine(clipCreate, createDurationStore.id, createMessage.id, 0, 0) ||
  createLiveObject?.text !== "live.object" ||
  !hasLine(clipCreate, createMessage.id, createLiveObject.id, 0, 0)
) {
  throw new Error("New Session clips must use the validated generated duration");
}

const clipResize = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_clipResize.maxpat"), "utf8"),
).patcher;
const resizeTrigger = boxById(clipResize, "obj-8");
const resizeStart = boxById(clipResize, "obj-6");
const resizeEnd = boxById(clipResize, "obj-7");
const resizeCrop = boxById(clipResize, "obj-10");
const resizeEndDefer = boxById(clipResize, "obj-15");
const resizeCropDefer = boxById(clipResize, "obj-18");
const resizeLiveObject = boxById(clipResize, "obj-210");
const changesLoopMode = allBoxes(clipResize).some(
  (box) => typeof box.text === "string" && /^set looping\b/.test(box.text),
);
if (
  resizeTrigger?.text !== "t b f b" ||
  resizeStart?.text !== "set loop_start 0." ||
  resizeEnd?.text !== "set loop_end $1" ||
  resizeCrop?.text !== "call crop" ||
  resizeEndDefer?.text !== "deferlow" ||
  resizeCropDefer?.text !== "deferlow" ||
  resizeLiveObject?.text !== "live.object" ||
  changesLoopMode ||
  !hasLine(clipResize, resizeTrigger.id, resizeStart.id, 2, 0) ||
  !hasLine(clipResize, resizeTrigger.id, resizeEndDefer.id, 1, 0) ||
  !hasLine(clipResize, resizeEndDefer.id, "obj-13", 0, 0) ||
  !hasLine(clipResize, resizeTrigger.id, resizeCropDefer.id, 0, 0) ||
  !hasLine(clipResize, resizeCropDefer.id, resizeCrop.id, 0, 0) ||
  !hasLine(clipResize, resizeStart.id, resizeLiveObject.id, 0, 0) ||
  !hasLine(clipResize, resizeEnd.id, resizeLiveObject.id, 0, 0) ||
  !hasLine(clipResize, resizeCrop.id, resizeLiveObject.id, 0, 0)
) {
  throw new Error(
    "Clip resize must set its start boundary before its end, then crop without changing loop mode",
  );
}

const nodePatcher = JSON.parse(
  fs.readFileSync(path.join(patcherDirectory, "mj_nodeJS.maxpat"), "utf8"),
).patcher;
const nodeScript = boxById(nodePatcher, "obj-273");
const nodeCommandRoute = boxById(nodePatcher, "obj-pollinations-command-route");
const nodeConnectMessage = boxById(nodePatcher, "obj-pollinations-command-connect");
const nodeToggleMessage = boxById(nodePatcher, "obj-pollinations-command-toggle");
const nodeDisconnectMessage = boxById(
  nodePatcher,
  "obj-pollinations-command-disconnect",
);
const nodeStatusMessage = boxById(nodePatcher, "obj-pollinations-command-status");
const nodeCommandDefer = boxById(nodePatcher, "obj-pollinations-command-defer");
const nodeLoadendRoute = boxById(
  nodePatcher,
  "obj-pollinations-loadend-route",
);
const nodeLoadendSuccess = boxById(
  nodePatcher,
  "obj-pollinations-loadend-success",
);
const nodeLoadendDelay = boxById(
  nodePatcher,
  "obj-pollinations-loadend-delay",
);
const nodeLoadendObjectIds = new Set([
  nodeLoadendRoute?.id,
  nodeLoadendSuccess?.id,
  nodeLoadendDelay?.id,
]);
const nodeLoadendCordsAreExact = hasExactRelevantCords(
  nodePatcher,
  [
    [nodeScript?.id, 1, nodeLoadendRoute?.id, 0],
    [nodeLoadendRoute?.id, 0, nodeLoadendSuccess?.id, 0],
    [nodeLoadendSuccess?.id, 0, nodeLoadendDelay?.id, 0],
    [nodeLoadendDelay?.id, 0, nodeStatusMessage?.id, 0],
  ],
  ({ source, destination }) =>
    nodeLoadendObjectIds.has(source[0]) ||
    nodeLoadendObjectIds.has(destination[0]),
);
const nodeAuthPrepend = boxById(nodePatcher, "obj-auth-prepend");
const nodeOutputRoute = boxById(nodePatcher, "obj-268");
const nodeCancelOutput = boxById(nodePatcher, "obj-cancel-output");
const nodeOutputRouteCords = (nodePatcher.lines || []).filter(
  ({ patchline }) => patchline.source[0] === "obj-268",
);
const nodeCancelInputCords = (nodePatcher.lines || []).filter(
  ({ patchline }) => patchline.destination[0] === "obj-cancel-output",
);
const nodeCancelOutputCords = (nodePatcher.lines || []).filter(
  ({ patchline }) => patchline.source[0] === "obj-cancel-output",
);
const nodeOutlets = (nodePatcher.boxes || [])
  .map(({ box }) => box)
  .filter((box) => box.maxclass === "outlet");
const obsoleteDelayedStart = ["obj-19", "obj-12", "obj-18", "obj-15"].some(
  (id) => boxById(nodePatcher, id),
);
const legacyInstaller = allBoxes(nodePatcher).find(
  (box) => typeof box.text === "string" && box.text.includes("installModules.js"),
);
if (
  nodeScript?.text !== "node.script midiJourney.release.js @watch 0" ||
  nodeScript.saved_object_attributes?.watch !== 0 ||
  nodeScript.saved_object_attributes?.autostart !== 1 ||
  nodeCommandRoute?.text !==
    "routepass connect toggleConnection disconnect authStatus" ||
  nodeCommandRoute?.numinlets !== 5 ||
  nodeCommandRoute?.numoutlets !== 5 ||
  nodeCommandRoute?.outlettype?.length !== 5 ||
  nodeConnectMessage?.text !== "connect" ||
  nodeToggleMessage?.text !== "toggleConnection" ||
  nodeDisconnectMessage?.text !== "disconnect" ||
  nodeStatusMessage?.text !== "authStatus" ||
  nodeCommandDefer?.text !== "deferlow" ||
  nodeLoadendRoute?.text !== "route loadend" ||
  nodeLoadendRoute?.numinlets !== 2 ||
  nodeLoadendRoute?.numoutlets !== 2 ||
  nodeLoadendSuccess?.text !== "sel success" ||
  nodeLoadendSuccess?.numinlets !== 2 ||
  nodeLoadendSuccess?.numoutlets !== 2 ||
  nodeLoadendDelay?.text !== "delay 250" ||
  nodeLoadendDelay?.numinlets !== 2 ||
  nodeLoadendDelay?.numoutlets !== 1 ||
  !nodeLoadendCordsAreExact ||
  obsoleteDelayedStart ||
  legacyInstaller ||
  hasLine(nodePatcher, "obj-36", "obj-8", 0, 0) ||
  !hasLine(nodePatcher, "obj-36", nodeCommandRoute.id, 0, 0) ||
  hasLine(nodePatcher, nodeCommandRoute.id, "obj-273") ||
  hasLine(nodePatcher, nodeCommandRoute.id, nodeCommandDefer.id) ||
  !hasLine(nodePatcher, nodeCommandRoute.id, nodeConnectMessage.id, 0, 0) ||
  !hasLine(nodePatcher, nodeCommandRoute.id, nodeToggleMessage.id, 1, 0) ||
  !hasLine(nodePatcher, nodeCommandRoute.id, nodeDisconnectMessage.id, 2, 0) ||
  !hasLine(nodePatcher, nodeCommandRoute.id, nodeStatusMessage.id, 3, 0) ||
  !hasLine(nodePatcher, nodeConnectMessage.id, nodeCommandDefer.id, 0, 0) ||
  !hasLine(nodePatcher, nodeToggleMessage.id, nodeCommandDefer.id, 0, 0) ||
  !hasLine(nodePatcher, nodeDisconnectMessage.id, nodeCommandDefer.id, 0, 0) ||
  !hasLine(nodePatcher, nodeStatusMessage.id, nodeCommandDefer.id, 0, 0) ||
  !hasLine(nodePatcher, nodeCommandDefer.id, "obj-273", 0, 0) ||
  !hasLine(nodePatcher, nodeCommandRoute.id, "obj-account-commands", 4, 0) ||
  boxById(nodePatcher, "obj-account-commands")?.text !== "routepass accountRefresh accountDashboard" ||
  !hasLine(nodePatcher, "obj-account-commands", nodeCommandDefer.id, 0, 0) ||
  !hasLine(nodePatcher, "obj-account-commands", nodeCommandDefer.id, 1, 0) ||
  !hasLine(nodePatcher, "obj-account-commands", "obj-8", 2, 0) ||
  [0, 1, 2, 3].some((outlet) =>
    hasLine(nodePatcher, nodeCommandRoute.id, "obj-8", outlet, 0),
  ) ||
  nodeAuthPrepend?.text !== "prepend auth" ||
  nodeOutputRoute?.text !== "route result processing error auth cancel" ||
  nodeOutputRoute?.numinlets !== 6 ||
  nodeOutputRoute?.numoutlets !== 6 ||
  nodeOutputRoute?.outlettype?.length !== 6 ||
  nodeCancelOutput?.text !== "cancel" ||
  nodeCancelOutput?.hidden !== 1 ||
  boxById(nodePatcher, "obj-auth-outlet") !== undefined ||
  nodeOutlets.length !== 1 ||
  nodeOutlets[0]?.id !== "obj-2" ||
  nodeOutlets[0]?.index !== 1 ||
  !hasLine(nodePatcher, "obj-268", nodeAuthPrepend.id, 3, 0) ||
  !hasLine(nodePatcher, nodeAuthPrepend.id, "obj-2", 0, 0) ||
  !hasLine(nodePatcher, "obj-268", nodeCancelOutput.id, 4, 0) ||
  !hasLine(nodePatcher, nodeCancelOutput.id, "obj-2", 0, 0) ||
  nodeOutputRouteCords.length !== 5 ||
  nodeOutputRouteCords.filter(
    ({ patchline }) => patchline.source[1] === 4,
  ).length !== 1 ||
  !hasLine(nodePatcher, nodeOutputRoute.id, "obj-account-output", 5, 0) ||
  boxById(nodePatcher, "obj-account-output")?.text !== "routepass account" ||
  !hasLine(nodePatcher, "obj-account-output", "obj-2", 0, 0) ||
  (nodePatcher.lines || []).some(({ patchline }) => patchline.source[0] === "obj-account-output" && patchline.source[1] !== 0) ||
  nodeCancelInputCords.length !== 1 ||
  nodeCancelInputCords[0]?.patchline.source[0] !== "obj-268" ||
  nodeCancelInputCords[0]?.patchline.source[1] !== 4 ||
  nodeCancelInputCords[0]?.patchline.destination[1] !== 0 ||
  nodeCancelOutputCords.length !== 1 ||
  nodeCancelOutputCords[0]?.patchline.destination[0] !== "obj-2" ||
  nodeCancelOutputCords[0]?.patchline.destination[1] !== 0 ||
  (nodePatcher.lines || []).filter(
    ({ patchline }) =>
      patchline.source[0] === "obj-268" && patchline.source[1] === 3,
  ).length !== 1 ||
  (nodePatcher.lines || []).filter(
    ({ patchline }) => patchline.source[0] === nodeAuthPrepend.id,
  ).length !== 1
) {
  throw new Error(
    "The Node patcher must autostart only the bundled release entry and expose safe Pollinations authorization state",
  );
}

const device = readDevice();
verifyPatcher(device.patcher, "MIDIjourney.source.amxd");
verifyDynamicLiveObjects(device.patcher, "MIDIjourney.source.amxd");
if (device.patcher.project?.amxdtype !== audioEffectAmxdType) {
  throw new Error(
    "MIDIjourney.source.amxd must remain a Max Audio Effect for the Main/Master track",
  );
}
const deviceDependencies = device.patcher.dependency_cache || [];
const dependencyNameList = deviceDependencies.map((dependency) => dependency.name);
const dependencyNames = new Set(dependencyNameList);
if (dependencyNames.size !== dependencyNameList.length) {
  throw new Error("MIDIjourney.source.amxd contains duplicate dependency entries");
}
if (
  !dependencyNames.has("midiJourney.release.js") ||
  dependencyNames.has("midiJourney.js") ||
  dependencyNames.has("installModules.js")
) {
  throw new Error("The AMXD must package the self-contained Node release entry");
}
const devicePreferences = (device.patcher.boxes || []).find(
  ({ box }) => box.maxclass === "bpatcher" && box.name === "mj_bp_preferences.maxpat",
)?.box;
const deviceJourney = (device.patcher.boxes || []).find(
  ({ box }) => box.maxclass === "newobj" && box.text === "p midiJourney",
)?.box;
const deviceNode = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.maxclass === "newobj" && box.text === "mj_nodeJS",
)?.box;
const deviceAuthOutlet = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.id === "obj-pollinations-auth-outlet",
)?.box;
const deviceSharedOutput = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.maxclass === "outlet" && box.index === 2,
)?.box;
const deviceAuthPrepend = boxById(
  deviceJourney?.patcher,
  "obj-pollinations-auth-prepend",
);
const deviceAuthRoute = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.id === "obj-pollinations-auth-route",
)?.box;
const deviceCancelMessage = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.id === "obj-pollinations-cancel-message",
)?.box;
const deviceAuthStatusLoad = boxById(
  deviceJourney?.patcher,
  "obj-pollinations-auth-status-load",
);
const deviceAuthStatusDefer = boxById(
  deviceJourney?.patcher,
  "obj-pollinations-auth-status-defer",
);
const deviceAuthStatusDelay = boxById(
  deviceJourney?.patcher,
  "obj-pollinations-auth-status-delay",
);
const deviceAuthStatusMessage = boxById(
  deviceJourney?.patcher,
  "obj-pollinations-auth-status-message",
);
const deviceStart = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.maxclass === "bpatcher" && box.name === "mj_bp_start.maxpat",
)?.box;
const deviceAuthDefer = deviceJourney?.patcher?.boxes?.find(
  ({ box }) => box.id === "obj-pollinations-auth-defer",
)?.box;
const deviceAuthRouteCords = (deviceJourney?.patcher?.lines || []).filter(
  ({ patchline }) => patchline.source[0] === deviceAuthRoute?.id,
);
const deviceCancelInputCords = (deviceJourney?.patcher?.lines || []).filter(
  ({ patchline }) => patchline.destination[0] === deviceCancelMessage?.id,
);
const deviceCancelOutputCords = (deviceJourney?.patcher?.lines || []).filter(
  ({ patchline }) => patchline.source[0] === deviceCancelMessage?.id,
);
const deviceConnect = boxById(device.patcher, "obj-pollinations-connect");
const deviceConnectLabel = boxById(device.patcher, "obj-pollinations-connect-label");
const deviceConnectHit = boxById(device.patcher, "obj-pollinations-connect-hit");
const deviceConnectFilter = boxById(device.patcher, "obj-pollinations-connect-filter");
const deviceToggleMessage = boxById(device.patcher, "obj-pollinations-toggle-message");
const deviceCommandDefer = boxById(device.patcher, "obj-pollinations-command-defer");
const deviceSharedOutputRoute = boxById(
  device.patcher,
  "obj-pollinations-shared-output-route",
);
const deviceStatusDefer = boxById(device.patcher, "obj-pollinations-status-defer");
const deviceStatusUnpack = boxById(device.patcher, "obj-pollinations-status-unpack");
const deviceStatusSelect = boxById(device.patcher, "obj-pollinations-status-select");
const deviceStatusConnected = boxById(device.patcher, "obj-pollinations-status-connected");
const deviceStatusPending = boxById(device.patcher, "obj-pollinations-status-pending");
const deviceStatusDisconnected = boxById(
  device.patcher,
  "obj-pollinations-status-disconnected",
);
const deviceStatusRequestObjectIds = new Set([
  "obj-pollinations-auth-status-load",
  "obj-pollinations-auth-status-defer",
  "obj-pollinations-auth-status-delay",
  "obj-pollinations-auth-status-message",
]);
const deviceStatusRequestCordsAreExact = hasExactRelevantCords(
  deviceJourney?.patcher,
  [
    [deviceAuthStatusLoad?.id, 0, deviceAuthStatusDefer?.id, 0],
    [deviceAuthStatusDefer?.id, 0, deviceAuthStatusDelay?.id, 0],
    [deviceAuthStatusDelay?.id, 0, deviceAuthStatusMessage?.id, 0],
    [deviceAuthStatusMessage?.id, 0, deviceNode?.id, 0],
  ],
  ({ source, destination }) =>
    deviceStatusRequestObjectIds.has(source[0]) ||
    deviceStatusRequestObjectIds.has(destination[0]),
);
const deviceConnectionObjectIds = new Set([
  "obj-pollinations-connect",
  "obj-pollinations-toggle-message",
  "obj-pollinations-command-defer",
  "obj-pollinations-shared-output-route",
  "obj-pollinations-status-unpack",
  "obj-pollinations-status-select",
  "obj-pollinations-status-connected",
  "obj-pollinations-status-pending",
  "obj-pollinations-status-disconnected",
]);
const deviceConnectionCordsAreExact = hasExactRelevantCords(
  device.patcher,
  [
    [deviceConnect?.id, 0, deviceToggleMessage?.id, 0],
    [deviceToggleMessage?.id, 0, deviceCommandDefer?.id, 0],
    [deviceCommandDefer?.id, 0, deviceJourney?.id, 1],
    [deviceJourney?.id, 1, deviceSharedOutputRoute?.id, 0],
    [deviceSharedOutputRoute?.id, 0, deviceStatusUnpack?.id, 0],
    [deviceSharedOutputRoute?.id, 1, "obj-account-route", 0],
    [deviceStatusUnpack?.id, 0, deviceStatusSelect?.id, 0],
    [deviceStatusSelect?.id, 0, deviceStatusConnected?.id, 0],
    [deviceStatusSelect?.id, 1, deviceStatusConnected?.id, 0],
    [deviceStatusSelect?.id, 2, deviceStatusPending?.id, 0],
    [deviceStatusSelect?.id, 3, deviceStatusPending?.id, 0],
    [deviceStatusSelect?.id, 4, deviceStatusPending?.id, 0],
    [deviceStatusSelect?.id, 5, deviceStatusDisconnected?.id, 0],
    [deviceStatusConnected?.id, 0, deviceConnect?.id, 0],
    [deviceStatusPending?.id, 0, deviceConnect?.id, 0],
    [deviceStatusDisconnected?.id, 0, deviceConnect?.id, 0],
  ],
  ({ source, destination }) =>
    deviceConnectionObjectIds.has(source[0]) ||
    deviceConnectionObjectIds.has(destination[0]) ||
    (source[0] === deviceJourney?.id && source[1] === 1),
);
const deviceCreate = boxById(device.patcher, "obj-33");
const deviceCreateCommand = boxById(device.patcher, "obj-5");
const devicePcontrol = boxById(device.patcher, "obj-31");
const deviceCreateReset = boxById(device.patcher, "obj-24");
const deviceEditorWindowLoad = boxById(
  device.patcher,
  "obj-midijourney-editor-window-load",
);
const deviceEditorWindowDefer = boxById(
  device.patcher,
  "obj-midijourney-editor-window-defer",
);
const deviceEditorWindowConfig = boxById(
  device.patcher,
  "obj-midijourney-editor-window-config",
);
const deviceEditorWindowObjectIds = new Set([
  deviceEditorWindowLoad?.id,
  deviceEditorWindowDefer?.id,
  deviceEditorWindowConfig?.id,
]);
const deviceEditorWindowCordsAreExact = hasExactRelevantCords(
  device.patcher,
  [
    [deviceEditorWindowLoad?.id, 0, deviceEditorWindowDefer?.id, 0],
    [deviceEditorWindowDefer?.id, 0, deviceEditorWindowConfig?.id, 0],
    [deviceEditorWindowConfig?.id, 0, deviceJourney?.id, 0],
  ],
  ({ source, destination }) =>
    deviceEditorWindowObjectIds.has(source[0]) ||
    deviceEditorWindowObjectIds.has(destination[0]),
);
const legacyAutoOpen = ["obj-7", "obj-12", "obj-10"].find((id) =>
  boxById(device.patcher, id),
);
const testOnlyE2eObject = allBoxes(device.patcher).find(
  (box) =>
    box.id?.startsWith("obj-pollinations-e2e-") ||
    (typeof box.text === "string" && box.text.includes("MIDIjourney_E2E_")),
);
if (testOnlyE2eObject) {
  throw new Error("MIDIjourney.source.amxd contains a test-only E2E hook");
}
const obsoleteConnectionParameterPaths = [
  "obj-8::obj-8",
  "obj-8::obj-48::obj-54",
];
const obsoleteConnectionParameter = obsoleteConnectionParameterPaths.find(
  (parameterPath) =>
    device.patcher.parameters?.[parameterPath] !== undefined ||
    device.patcher.parameters?.parameter_overrides?.[parameterPath] !== undefined,
);
const obsoleteDeviceConnectionIds = [
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
];
const obsoleteDeviceConnection = obsoleteDeviceConnectionIds.find((id) =>
  boxById(device.patcher, id),
);
if (
  devicePreferences?.numinlets !== 1 ||
  devicePreferences?.numoutlets !== 1 ||
  deviceJourney?.numoutlets !== 2 ||
  JSON.stringify(deviceJourney?.outlettype) !== JSON.stringify(["bang", ""]) ||
  deviceJourney?.patcher?.visible !== 0 ||
  deviceNode?.numoutlets !== 1 ||
  deviceNode?.outlettype?.length !== 1 ||
  deviceAuthOutlet !== undefined ||
  deviceSharedOutput?.index !== 2 ||
  deviceAuthPrepend?.text !== "prepend auth" ||
  deviceAuthPrepend?.numinlets !== 1 ||
  deviceAuthPrepend?.numoutlets !== 1 ||
  deviceAuthRoute?.text !== "route auth cancel" ||
  deviceAuthRoute?.numinlets !== 3 ||
  deviceAuthRoute?.numoutlets !== 3 ||
  deviceAuthRoute?.outlettype?.length !== 3 ||
  deviceCancelMessage?.text !== "cancel" ||
  deviceCancelMessage?.hidden !== 1 ||
  deviceAuthStatusLoad?.text !== "live.thisdevice" ||
  deviceAuthStatusLoad?.numinlets !== 1 ||
  deviceAuthStatusLoad?.numoutlets !== 3 ||
  JSON.stringify(deviceAuthStatusLoad?.outlettype) !==
    JSON.stringify(["bang", "int", "int"]) ||
  deviceAuthStatusDefer?.text !== "deferlow" ||
  deviceAuthStatusDefer?.numinlets !== 1 ||
  deviceAuthStatusDefer?.numoutlets !== 1 ||
  deviceAuthStatusDelay?.text !== "delay 250" ||
  deviceAuthStatusDelay?.numinlets !== 2 ||
  deviceAuthStatusDelay?.numoutlets !== 1 ||
  deviceAuthStatusMessage?.text !== "authStatus" ||
  deviceAuthDefer !== undefined ||
  hasLine(device.patcher, devicePreferences.id, deviceJourney.id, 1, 0) ||
  hasLine(device.patcher, devicePreferences.id, deviceJourney.id, 1, 1) ||
  !hasLine(deviceJourney.patcher, deviceNode.id, deviceAuthRoute.id, 0, 0) ||
  !hasLine(deviceJourney.patcher, deviceAuthRoute.id, deviceAuthPrepend.id, 0, 0) ||
  !hasLine(deviceJourney.patcher, deviceAuthPrepend.id, deviceSharedOutput.id, 0, 0) ||
  !hasLine(deviceJourney.patcher, deviceAuthRoute.id, deviceCancelMessage.id, 1, 0) ||
  !hasLine(deviceJourney.patcher, deviceCancelMessage.id, deviceStart.id, 0, 0) ||
  !deviceStatusRequestCordsAreExact ||
  !hasLine(deviceJourney.patcher, deviceAuthRoute.id, "obj-account-route", 2, 0) ||
  boxById(deviceJourney.patcher, "obj-account-route")?.text !== "route account" ||
  !hasLine(deviceJourney.patcher, "obj-account-route", "obj-account-prepend", 0, 0) ||
  boxById(deviceJourney.patcher, "obj-account-prepend")?.text !== "prepend account" ||
  !hasLine(deviceJourney.patcher, "obj-account-prepend", deviceSharedOutput.id, 0, 0) ||
  boxById(deviceJourney.patcher, "obj-account-panel") !== undefined ||
  !hasLine(device.patcher, "obj-account-route", "obj-account-panel", 0, 0) ||
  !hasLine(device.patcher, "obj-account-route", devicePreferences.id, 1, 0) ||
  !hasLine(device.patcher, "obj-account-panel", "obj-account-command-defer", 0, 0) ||
  !hasLine(device.patcher, "obj-account-command-defer", deviceJourney.id, 0, 1) ||
  !hasLine(deviceJourney.patcher, "obj-account-route", "obj-22", 1, 0) ||
  hasLine(deviceJourney.patcher, deviceAuthRoute.id, "obj-22") ||
  hasLine(deviceJourney.patcher, deviceNode.id, deviceSharedOutput.id) ||
  hasLine(deviceJourney.patcher, deviceNode.id, "obj-22") ||
  (deviceJourney.patcher.lines || []).filter(
    ({ patchline }) => patchline.source[0] === deviceNode.id,
  ).length !== 1 ||
  (deviceJourney.patcher.lines || []).filter(
    ({ patchline }) => patchline.source[0] === deviceAuthRoute.id,
  ).length !== 3 ||
  [0, 1, 2].some(
    (outlet) =>
      deviceAuthRouteCords.filter(
        ({ patchline }) => patchline.source[1] === outlet,
      ).length !== 1,
  ) ||
  deviceAuthRouteCords.some(
    ({ patchline }) => ![0, 1, 2].includes(patchline.source[1]),
  ) ||
  deviceCancelInputCords.length !== 1 ||
  deviceCancelInputCords[0]?.patchline.source[0] !== deviceAuthRoute.id ||
  deviceCancelInputCords[0]?.patchline.source[1] !== 1 ||
  deviceCancelInputCords[0]?.patchline.destination[1] !== 0 ||
  deviceCancelOutputCords.length !== 1 ||
  deviceCancelOutputCords[0]?.patchline.destination[0] !== deviceStart.id ||
  deviceCancelOutputCords[0]?.patchline.destination[1] !== 0 ||
  (deviceJourney.patcher.lines || []).filter(
    ({ patchline }) => patchline.source[0] === deviceCancelMessage.id,
  ).length !== 1 ||
  (deviceJourney.patcher.lines || []).some(
    ({ patchline }) =>
      patchline.source[0] === deviceNode.id && patchline.source[1] !== 0,
  ) ||
  hasLine(device.patcher, deviceJourney.id, devicePreferences.id, 2, 0) ||
  hasLine(device.patcher, deviceJourney.id, devicePreferences.id, 2, 1) ||
  rectanglesOverlap(boxById(device.patcher, "obj-account-panel")?.presentation_rect, deviceConnect?.presentation_rect) ||
  deviceConnect?.text !== "Connect" ||
  deviceConnect?.texton !== "Connected" ||
  deviceConnect?.active !== 1 ||
  deviceConnect?.presentation !== 1 ||
  deviceConnect?.hidden !== 0 ||
  devicePreferences?.presentation !== 0 ||
  deviceConnect?.mode !== 1 ||
  deviceConnect?.parameter_enable !== 0 ||
  deviceConnectHit !== undefined ||
  deviceConnectLabel !== undefined ||
  obsoleteConnectionParameter !== undefined ||
  obsoleteDeviceConnection !== undefined ||
  deviceConnectFilter !== undefined ||
  deviceToggleMessage?.text !== "connect" ||
  deviceCommandDefer?.text !== "deferlow" ||
  deviceSharedOutputRoute?.text !== "route auth" ||
  deviceSharedOutputRoute?.numinlets !== 2 ||
  deviceSharedOutputRoute?.numoutlets !== 2 ||
  deviceStatusDefer !== undefined ||
  deviceStatusUnpack?.text !== "deferlow" ||
  deviceStatusUnpack?.numinlets !== 1 ||
  deviceStatusUnpack?.numoutlets !== 1 ||
  deviceStatusSelect?.text !==
    "route connected offline checking connecting awaiting_approval" ||
  deviceStatusSelect?.numinlets !== 6 ||
  deviceStatusSelect?.numoutlets !== 6 ||
  deviceStatusConnected?.text !==
    "text Connected, texton Connected, set 0, active 0" ||
  deviceStatusPending?.text !==
    "text Connecting..., texton Connecting..., set 0, active 0" ||
  deviceStatusDisconnected?.text !==
    "text Connect, texton Connect, set 0, active 1" ||
  legacyAutoOpen !== undefined ||
  deviceCreate?.text !== "Create" ||
  deviceCreate?.mode !== 1 ||
  deviceCreate?.parameter_enable !== 0 ||
  device.patcher.parameters?.[deviceCreate.id] !== undefined ||
  device.patcher.parameters?.parameter_overrides?.[deviceCreate.id] !== undefined ||
  deviceCreateCommand?.text !== "p cmd" ||
  devicePcontrol?.text !== "pcontrol" ||
  deviceCreateReset?.text !== "set 0" ||
  deviceEditorWindowLoad?.text !== "loadbang" ||
  deviceEditorWindowLoad?.hidden !== 1 ||
  deviceEditorWindowDefer?.text !== "deferlow" ||
  deviceEditorWindowDefer?.hidden !== 1 ||
  deviceEditorWindowConfig?.text !==
    "window flags float, window flags nominimize, window flags nogrow, window flags nozoom, window exec" ||
  deviceEditorWindowConfig?.hidden !== 1 ||
  !deviceEditorWindowCordsAreExact ||
  !hasLine(device.patcher, deviceCreate.id, deviceCreateCommand.id, 0, 0) ||
  !hasLine(device.patcher, deviceCreateCommand.id, devicePcontrol.id, 0, 0) ||
  !hasLine(device.patcher, deviceJourney.id, deviceCreateReset.id, 0, 0) ||
  !hasLine(device.patcher, deviceCreateReset.id, deviceCreate.id, 0, 0) ||
  !deviceConnectionCordsAreExact
) {
  throw new Error(
    "The AMXD must keep manual Create control, configure its floating editor without auto-opening it, and own the inline Connect circuit",
  );
}
if (device.patcher.minimum_live_version !== "12.0.0") {
  throw new Error("MIDIjourney.source.amxd must declare Live 12.0.0 as its minimum");
}
if (device.patcher.minimum_max_version !== "9.0.0") {
  throw new Error("MIDIjourney.source.amxd must declare Max 9.0.0 as its minimum");
}
verifyReleaseDevice();
const approvedDigest = releaseKeyDigest();
const approvedReleaseAppKey = readApprovedReleaseAppKey();
if (
  approvedReleaseAppKey &&
  digestCredential(approvedReleaseAppKey) !== approvedDigest
) {
  throw new Error("The approved App Key does not match the tracked release digest");
}
scanCredentials(root, approvedReleaseAppKey, approvedDigest);

verifyReleaseBundleIsCurrent()
  .then(() => {
    process.stdout.write(
      "Max patchers, AMXD container, release bundle, and credential scan verified.\n",
    );
  })
  .catch((error) => {
    process.stderr.write(`Max release verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
