#!/usr/bin/env node

"use strict";

// Strictly verifies Max's frozen candidate while it is still in the isolated
// staging project. This intentionally runs before the candidate replaces the
// tracked MIDIjourney.amxd.

const crypto = require("crypto");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { MAX_AMXD_BYTES, inspectFrozenAmxd } = require("./max-release-portability");
const {
  STAGING_MANIFEST_FORMAT,
  STAGING_MANIFEST_NAME,
  STAGING_MANIFEST_VERSION,
  releaseSourceInputRecords,
  stagedAssetRecords,
  stagedProjectRecord,
} = require("./prepare-max-release-project");

const root = path.resolve(__dirname, "..");
const sourceDevicePath = path.join(root, "MIDIjourney.source.amxd");
const releaseBundlePath = path.join(root, "js", "midiJourney.release.js");
const canonicalRuntimeEntry = "node_content/midijourney-v3-runtime.js";
const canonicalTopLevelPatcherEntry = "patchers/MIDIjourney V3.maxpat";
const canonicalNodePatcherEntry =
  "patchers/midijourney_v3_release_node.maxpat";
const audioEffectAmxdType = 0x61616161;
const minimumLiveVersion = "12.0.0";
const minimumMaxVersion = "9.0.0";
const pollinationsConnectionLabelStates = new Set([
  JSON.stringify(["Connect", "Connected"]),
  JSON.stringify(["Connect", "Connect"]),
  JSON.stringify(["Connected", "Connected"]),
  JSON.stringify(["Connecting...", "Connecting..."]),
]);
const canonicalProjectName = "MIDIjourney V3 Release";
const canonicalRuntimeName = path.posix.basename(canonicalRuntimeEntry);
const canonicalNodePatcherName = path.posix.basename(canonicalNodePatcherEntry);
const testHookMarkers = [
  Buffer.from("obj-pollinations-e2e-"),
  Buffer.from("MIDIjourney_E2E_"),
];
const maxAppleDoublePrefix = Buffer.from(
  "00051607000200004d6163204f5320582020202020202020000200000009000000320000007100000002000000a300000000000000000000000000000000000000000000000000000000000000000000000000004154545200000000000000a3000000980000000b00000000000000000000000000000001000000980000000b000015636f6d2e6170706c652e70726f76656e616e636500010200",
  "hex",
);

function readSourceDevice(file = sourceDevicePath, suppliedBuffer = null) {
  const buffer = suppliedBuffer || fs.readFileSync(file);
  if (
    buffer.subarray(0, 4).toString("ascii") !== "ampf" ||
    buffer.subarray(24, 28).toString("ascii") !== "ptch" ||
    buffer.readUInt32LE(28) !== buffer.length - 32
  ) {
    throw new Error("Cannot derive canonical dependencies from MIDIjourney.source.amxd");
  }
  try {
    return JSON.parse(buffer.subarray(32).toString("utf8").replace(/\0+$/, ""));
  } catch {
    throw new Error("MIDIjourney.source.amxd contains invalid JSON");
  }
}

function requireLeafName(name, description, suffix) {
  if (
    typeof name !== "string" ||
    name !== path.basename(name) ||
    !name.endsWith(suffix) ||
    name.length <= suffix.length
  ) {
    throw new Error(`Canonical ${description} has an invalid name`);
  }
}

function canonicalEntryNames(sourceDevice = readSourceDevice()) {
  const expected = new Set([canonicalTopLevelPatcherEntry]);
  const declaredDependencies = new Set();
  let runtimeCount = 0;
  let nodePatcherCount = 0;

  for (const dependency of sourceDevice.patcher?.dependency_cache || []) {
    if (declaredDependencies.has(dependency.name)) {
      throw new Error(`Canonical source declares duplicate dependency ${dependency.name}`);
    }
    declaredDependencies.add(dependency.name);
    if (dependency.name === "midiJourney.release.js" && dependency.type === "TEXT") {
      runtimeCount += 1;
      expected.add(canonicalRuntimeEntry);
      continue;
    }
    if (dependency.type === "JSON" && dependency.name?.endsWith(".maxpat")) {
      requireLeafName(dependency.name, "patcher dependency", ".maxpat");
      if (dependency.name === "mj_nodeJS.maxpat") {
        nodePatcherCount += 1;
        expected.add(canonicalNodePatcherEntry);
      } else {
        expected.add(`patchers/${dependency.name}`);
      }
      continue;
    }
    if (dependency.type === "svg" && dependency.name?.endsWith(".svg")) {
      requireLeafName(dependency.name, "image dependency", ".svg");
      expected.add(`images/${dependency.name}`);
      continue;
    }
    throw new Error(`Unexpected canonical release dependency ${dependency.name || "<unnamed>"}`);
  }

  if (runtimeCount !== 1) {
    throw new Error("Canonical source must declare exactly one release runtime");
  }
  if (nodePatcherCount !== 1) {
    throw new Error("Canonical source must declare exactly one Node patcher");
  }
  return expected;
}

function assertSafeArchiveName(name) {
  const withoutTrailingSlash = name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    !withoutTrailingSlash ||
    name.includes("\\") ||
    name.includes("\0") ||
    path.posix.isAbsolute(name) ||
    path.posix.normalize(withoutTrailingSlash) !== withoutTrailingSlash ||
    withoutTrailingSlash.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Frozen AMXD contains unsafe embedded path ${JSON.stringify(name)}`);
  }
}

function resourceForkTarget(name) {
  if (!name.startsWith("__MACOSX/") || name.endsWith("/")) return null;
  const parts = name.slice("__MACOSX/".length).split("/");
  const leaf = parts.at(-1);
  if (!leaf?.startsWith("._") || leaf.length === 2) return "";
  parts[parts.length - 1] = leaf.slice(2);
  return parts.join("/");
}

function assertKnownMaxAppleDouble(entry) {
  if (
    entry.data.length !== 163 ||
    !entry.data.subarray(0, maxAppleDoublePrefix.length).equals(maxAppleDoublePrefix)
  ) {
    throw new Error(`Frozen AMXD contains unsupported AppleDouble metadata ${entry.name}`);
  }
}

function hasTestHook(buffer) {
  return testHookMarkers.some((marker) => buffer.includes(marker));
}

function parsePatcher(entry, description) {
  try {
    const document = JSON.parse(entry.data.toString("utf8"));
    if (!document?.patcher) throw new Error();
    return document.patcher;
  } catch {
    throw new Error(`Frozen AMXD contains invalid ${description} JSON`);
  }
}

function allBoxes(patcher) {
  return (patcher.boxes || []).flatMap(({ box }) => [
    box,
    ...(box.patcher ? allBoxes(box.patcher) : []),
  ]);
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sameFileIdentity(left, right) {
  return (
    left.ino !== 0n &&
    right.ino !== 0n &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function sameOpenIdentity(left, right) {
  if (left.ino !== 0n || right.ino !== 0n) return sameFileIdentity(left, right);
  // Some Windows filesystems do not expose a stable inode. The open descriptor
  // still gives us size and timestamp checks for the same read operation.
  return (
    left.dev === right.dev &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function sameSnapshot(left, right) {
  return (
    sameOpenIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function readStableRegularFile(file, description, { maxBytes = null } = {}) {
  const before = fs.lstatSync(file, { bigint: true });
  if (before.isSymbolicLink()) throw new Error(`${description} must not be a symbolic link`);
  if (!before.isFile()) throw new Error(`${description} is not a file`);
  if (maxBytes !== null && before.size > BigInt(maxBytes)) {
    throw new Error(`${description} exceeds its size limit`);
  }

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameOpenIdentity(before, opened)) {
      throw new Error(`${description} changed while it was opened`);
    }
    const buffer = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameSnapshot(opened, after) || BigInt(buffer.length) !== after.size) {
      throw new Error(`${description} changed while it was read`);
    }
    return { buffer, stat: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

function realExistingPath(file, description, { directory = false } = {}) {
  const status = fs.lstatSync(file);
  if (status.isSymbolicLink()) throw new Error(`${description} must not be a symbolic link`);
  if (directory ? !status.isDirectory() : !status.isFile()) {
    throw new Error(`${description} is not ${directory ? "a directory" : "a file"}`);
  }
  return fs.realpathSync(file);
}

function assertUnlinkedPathBelow(parent, relativeName, description) {
  let current = parent;
  for (const part of relativeName.split("/")) {
    current = path.join(current, part);
    const status = fs.lstatSync(current);
    if (status.isSymbolicLink()) throw new Error(`${description} must not use symbolic links`);
  }
  const resolved = fs.realpathSync(current);
  if (!isWithin(parent, resolved)) throw new Error(`${description} escapes its staging project`);
  return resolved;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function compiledReleaseBundleDigest() {
  const sourceDirectory = path.join(root, "js");
  const script = [
    'const crypto = require("crypto");',
    'const path = require("path");',
    "const sourceDirectory = process.argv[1];",
    'const ncc = require(require.resolve("@vercel/ncc", { paths: [sourceDirectory] }));',
    'ncc(path.join(sourceDirectory, "midiJourney.js"), {',
    'cache: false, externals: ["max-api"], minify: true, quiet: true',
    "}).then((result) => {",
    "if (Object.keys(result.assets).length !== 0) process.exitCode = 2;",
    'else process.stdout.write(crypto.createHash("sha256").update(result.code).digest("hex"));',
    "}).catch(() => { process.exitCode = 1; });",
  ].join("");
  const result = childProcess.spawnSync(process.execPath, ["-e", script, sourceDirectory], {
    // ncc's module ids are context-sensitive; match build-release.js, which is
    // invoked by npm with the JavaScript package as its working directory.
    cwd: sourceDirectory,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  });
  const digest = result.stdout?.trim();
  if (result.error || result.status !== 0 || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Could not compile the current Node source for release verification");
  }
  return digest;
}

function verifyCanonicalBundleIsCurrent(
  bundle,
  bundleFile,
  compileDigest = compiledReleaseBundleDigest,
) {
  if (path.resolve(bundleFile) !== releaseBundlePath) return false;
  if (compileDigest() !== sha256(bundle)) {
    throw new Error(
      "Current release bundle is stale; rebuild it from the current Node source before freezing Max",
    );
  }
  return true;
}

function compareDigestRecords(actual, expected, description) {
  if (!Array.isArray(actual)) throw new Error(`${description} must be an array`);
  const normalized = actual.map((record) => {
    if (
      !record ||
      Object.keys(record).sort().join(",") !== "path,sha256" ||
      typeof record.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error(`${description} contains an invalid digest record`);
    }
    return { path: record.path, sha256: record.sha256 };
  });
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    throw new Error(`${description} does not match its expected digests`);
  }
}

function verifyStagingManifest({
  projectDirectory,
  candidatePath,
  sourceDevice,
  sourcePath,
  bundlePath,
  sourceInputs,
  stagedAssets,
}) {
  const manifestPath = assertUnlinkedPathBelow(
    projectDirectory,
    STAGING_MANIFEST_NAME,
    "Release staging manifest",
  );
  const manifestBytes = readStableRegularFile(
    manifestPath,
    "Release staging manifest",
  ).buffer;
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Release staging manifest contains invalid JSON");
  }
  if (
    !manifest ||
    Object.keys(manifest).sort().join(",") !==
      "format,project,projectFile,sourceInputs,stagedAssets,version" ||
    manifest.format !== STAGING_MANIFEST_FORMAT ||
    manifest.version !== STAGING_MANIFEST_VERSION
  ) {
    throw new Error("Release staging manifest has an unsupported format");
  }
  const expectedProject = {
    // A unique candidate filename is deliberately supported so Live/Max does
    // not reuse a cached device from an older staging run. The manifest,
    // candidate path, and Max-owned native metadata must still agree exactly.
    candidateName: path.basename(candidatePath),
    nodePatcherName: canonicalNodePatcherName,
    projectName: canonicalProjectName,
    runtimeName: canonicalRuntimeName,
    topLevelPatcherName: path.posix.basename(canonicalTopLevelPatcherEntry),
  };
  const projectMatches =
    manifest.project &&
    Object.keys(manifest.project).sort().join(",") ===
      Object.keys(expectedProject).sort().join(",") &&
    Object.entries(expectedProject).every(([key, value]) => manifest.project[key] === value);
  if (
    !projectMatches ||
    path.basename(projectDirectory) !== canonicalProjectName
  ) {
    throw new Error("Release staging manifest does not describe the canonical release project");
  }

  compareDigestRecords(manifest.sourceInputs, sourceInputs, "Release staging source inputs");
  compareDigestRecords(manifest.stagedAssets, stagedAssets, "Release staged assets");
  compareDigestRecords(
    [manifest.projectFile],
    [stagedProjectRecord(projectDirectory, canonicalProjectName)],
    "Release staging project file",
  );
  return { manifest, manifestDigest: sha256(manifestBytes) };
}

function normalizedDependencyValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizedDependencyValue(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const childKey of Object.keys(value).sort()) {
    // Max rewrites resolved boot paths and the editor build stamp while freezing;
    // neither changes the dependency's executable patcher graph.
    if (childKey === "bootpath" || childKey === "appversion") continue;
    if (childKey === "parameter_osc_name" && value[childKey] === "<default>") continue;
    result[childKey] = normalizedDependencyValue(value[childKey]);
  }
  return result;
}

const patcherDefaultsOmittedByMax = new Map([
  ["assistshowspatchername", 0],
  ["bglocked", 0],
  ["bottomtoolbarpinned", 0],
  ["boxanimatetime", 200],
  ["default_fontface", 0],
  ["default_fontname", "Arial"],
  ["default_fontsize", 12],
  ["description", ""],
  ["devicewidth", 0],
  ["digest", ""],
  ["enablehscroll", 1],
  ["enablevscroll", 1],
  ["gridonopen", 1],
  ["gridsnaponopen", 1],
  ["lefttoolbarpinned", 0],
  ["objectsnaponopen", 1],
  ["openinpresentation", 0],
  ["oscreceiveudpport", 0],
  ["righttoolbarpinned", 0],
  ["statusbarvisible", 2],
  ["style", ""],
  ["subpatcher_template", ""],
  ["tags", ""],
  ["tallnewobj", 0],
  ["toolbars_unpinned_last_save", 0],
  ["toolbarvisible", 1],
  ["toptoolbarpinned", 0],
  ["visible", 0],
]);

function isEmptyObject(value) {
  return value && !Array.isArray(value) && typeof value === "object" &&
    Object.keys(value).length === 0;
}

function normalizedMaxValue(value, ancestors = []) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizedMaxValue(item, ancestors));
  }
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const inDependencyCache = ancestors.includes("dependency_cache");
    const inProjectSearchPath =
      ancestors.includes("project") && ancestors.includes("searchpath");
    const inSavedAttributes =
      ancestors.includes("saved_attribute_attributes") ||
      ancestors.includes("saved_object_attributes");
    if (
      key === "appversion" ||
      key === "originid" ||
      (key === "bootpath" && (inDependencyCache || inProjectSearchPath)) ||
      (key === "projectrelativepath" && inProjectSearchPath) ||
      (key === "patcherrelativepath" && inDependencyCache) ||
      (key === "parameter_osc_name" &&
        inSavedAttributes &&
        value[key] === "<default>") ||
      (key === "expression" && inSavedAttributes && value[key] === "") ||
      (inSavedAttributes &&
        ((["description", "digest", "tags"].includes(key) && value[key] === "") ||
          (key === "legacy" && value[key] === 1)))
    ) {
      continue;
    }
    const normalized = normalizedMaxValue(value[key], [...ancestors, key]);
    if (
      isEmptyObject(normalized) &&
      (inSavedAttributes ||
        key === "saved_attribute_attributes" ||
        key === "saved_object_attributes" ||
        (key === "media" &&
          ancestors.at(-1) === "contents" &&
          ancestors.at(-2) === "project"))
    ) {
      continue;
    }
    result[key] = normalized;
  }
  return result;
}

function stableSortByJson(values) {
  return values.sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function normalizedThisPatcherSave(value) {
  if (!Array.isArray(value)) return normalizedMaxValue(value, ["save"]);
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    // Max for Live strips editor-only `window ... ;` directives while
    // freezing. Preserve every other thispatcher directive byte-for-byte.
    if (value[index] === "#Q" && value[index + 1] === "window") {
      index += 2;
      while (index < value.length && value[index] !== ";") index += 1;
      continue;
    }
    result.push(normalizedMaxValue(value[index], ["save"]));
  }
  return result;
}

function semanticPatcherGraph(patcher) {
  // Max expands the top-level device and rewrites a small set of editor/path
  // defaults. The Connect button's two captions are also runtime auth state:
  // Max snapshots whichever allowed state is visible when the device freezes.
  // Everything else, including object restore data, remains part of the active
  // graph and must match the staged patcher.
  const boxes = (patcher.boxes || []).map(({ box }) => {
    const semantic = {};
    const hasAllowedPollinationsConnectionLabels =
      box.id === "obj-pollinations-connect" &&
      box.maxclass === "live.text" &&
      pollinationsConnectionLabelStates.has(JSON.stringify([box.text, box.texton]));
    for (const key of Object.keys(box).sort()) {
      if (
        key === "patcher" ||
        key === "patching_rect" ||
        key === "outlettype" ||
        key === "linecount" ||
        (key === "mode" && box.maxclass === "live.text" && box[key] === 1) ||
        (key === "active" && box.maxclass === "live.text" && box[key] === 1) ||
        (key === "svg" && box[key] === "")
      ) {
        continue;
      }
      if (
        hasAllowedPollinationsConnectionLabels &&
        (key === "text" || key === "texton")
      ) {
        semantic[key] = "<runtime Pollinations connection status>";
        continue;
      }
      let sourceValue = box[key];
      if (
        key === "saved_attribute_attributes" &&
        box.parameter_enable === 0 &&
        sourceValue &&
        typeof sourceValue === "object" &&
        !Array.isArray(sourceValue)
      ) {
        const { valueof: _disabledParameterMetadata, ...remainingAttributes } =
          sourceValue;
        sourceValue = remainingAttributes;
      }
      const normalized =
        key === "save" && box.maxclass === "newobj" && box.text === "thispatcher"
          ? normalizedThisPatcherSave(sourceValue)
          : normalizedMaxValue(sourceValue, [key]);
      if (
        (key === "saved_attribute_attributes" || key === "saved_object_attributes") &&
        isEmptyObject(normalized)
      ) {
        continue;
      }
      semantic[key] = normalized;
    }
    if (box.patcher) semantic.patcher = semanticPatcherGraph(box.patcher);
    return semantic;
  });
  const lines = (patcher.lines || []).map(({ patchline }) => {
    const semantic = {};
    for (const key of Object.keys(patchline).sort()) {
      // Max may redraw cable bend points while freezing; all other patchline
      // fields can affect execution or visibility and remain release state.
      if (key === "midpoints") continue;
      semantic[key] = normalizedMaxValue(patchline[key], ["patchline", key]);
    }
    return semantic;
  });
  const semantic = {};
  for (const key of Object.keys(patcher).sort()) {
    if (
      key === "appversion" ||
      key === "boxes" ||
      key === "lines" ||
      key === "openrect" ||
      key === "originid" ||
      key === "rect"
    ) {
      continue;
    }
    if (
      patcherDefaultsOmittedByMax.has(key) &&
      patcherDefaultsOmittedByMax.get(key) === patcher[key]
    ) {
      continue;
    }
    let normalized = normalizedMaxValue(patcher[key], [key]);
    if (key === "dependency_cache" && Array.isArray(normalized)) {
      // Max 9 omits non-executable image cache entries from active frozen
      // metadata. Their staged declaration and exact embedded bytes are
      // verified separately before this semantic graph comparison.
      normalized = stableSortByJson(
        normalized.filter((dependency) => dependency.type !== "svg"),
      );
    }
    semantic[key] = normalized;
  }
  semantic.boxes = boxes;
  semantic.lines = stableSortByJson(lines);
  return semantic;
}

function verifyActiveFrozenPatchers(
  documents,
  nativeDirectory,
  entriesByName,
  expectedNames,
  candidateName,
) {
  const patcherNames = [...expectedNames]
    .filter((name) => name.startsWith("patchers/") && name.endsWith(".maxpat"))
    .sort();
  if (
    documents.length !== patcherNames.length ||
    nativeDirectory.documentNames[0] !== candidateName ||
    nativeDirectory.topLevelPatcherName !==
      path.posix.basename(canonicalTopLevelPatcherEntry)
  ) {
    throw new Error("Frozen AMXD active metadata does not contain every staged patcher");
  }

  const stagedTopLevel = parsePatcher(
    entriesByName.get(canonicalTopLevelPatcherEntry),
    "top-level patcher",
  );
  const activeTopLevel = documents[0]?.patcher;
  if (
    !activeTopLevel ||
    JSON.stringify(semanticPatcherGraph(activeTopLevel)) !==
      JSON.stringify(semanticPatcherGraph(stagedTopLevel))
  ) {
    throw new Error("Frozen AMXD active top-level graph does not match the staged release graph");
  }

  for (let index = 1; index < documents.length; index += 1) {
    const name = `patchers/${nativeDirectory.documentNames[index]}`;
    if (name === canonicalTopLevelPatcherEntry || !patcherNames.includes(name)) {
      throw new Error("Frozen AMXD active dependency metadata is stale or unexpected");
    }
    const staged = normalizedDependencyValue(
      JSON.parse(entriesByName.get(name).data.toString("utf8")),
    );
    const active = normalizedDependencyValue(documents[index]);
    if (JSON.stringify(active) !== JSON.stringify(staged)) {
      throw new Error("Frozen AMXD active dependency metadata is stale or unexpected");
    }
  }
}

function verifyCanonicalPatcherWiring(entriesByName, expectedNames) {
  const topLevel = parsePatcher(
    entriesByName.get(canonicalTopLevelPatcherEntry),
    "top-level patcher",
  );
  if (
    topLevel.project?.amxdtype !== audioEffectAmxdType ||
    topLevel.minimum_live_version !== minimumLiveVersion ||
    topLevel.minimum_max_version !== minimumMaxVersion
  ) {
    throw new Error("Embedded top-level patcher has unexpected release metadata");
  }

  const expectedDependencies = new Set(
    [...expectedNames]
      .filter((name) => name !== canonicalTopLevelPatcherEntry)
      .map((name) => path.posix.basename(name)),
  );
  const dependencies = topLevel.dependency_cache || [];
  const dependencyNames = new Set(dependencies.map(({ name }) => name));
  if (
    dependencyNames.size !== dependencies.length ||
    dependencyNames.size !== expectedDependencies.size ||
    [...expectedDependencies].some((name) => !dependencyNames.has(name))
  ) {
    throw new Error("Embedded top-level patcher does not declare canonical dependencies");
  }

  const topLevelBoxes = allBoxes(topLevel);
  const releaseNodeName = path.posix.basename(canonicalNodePatcherEntry, ".maxpat");
  if (
    !topLevelBoxes.some((box) => box.maxclass === "newobj" && box.text === releaseNodeName) ||
    topLevelBoxes.some((box) => box.maxclass === "newobj" && box.text === "mj_nodeJS")
  ) {
    throw new Error("Embedded top-level patcher does not use the canonical release Node patcher");
  }

  const nodePatcher = parsePatcher(
    entriesByName.get(canonicalNodePatcherEntry),
    "release Node patcher",
  );
  const expectedNodeScript = `node.script ${path.posix.basename(canonicalRuntimeEntry)} @watch 0`;
  const nodeScripts = allBoxes(nodePatcher).filter(
    (box) => box.maxclass === "newobj" && box.text?.startsWith("node.script "),
  );
  if (nodeScripts.length !== 1 || nodeScripts[0].text !== expectedNodeScript) {
    throw new Error("Release Node patcher does not start the canonical runtime with watch disabled");
  }
}

function verifyMaxReleaseCandidate({
  devicePath,
  projectDirectory,
  bundlePath = releaseBundlePath,
  sourcePath = sourceDevicePath,
  requireExternal = true,
  quiet = false,
} = {}) {
  if (!devicePath) throw new Error("A frozen candidate path is required");
  devicePath = path.resolve(devicePath);
  projectDirectory = path.resolve(projectDirectory || path.dirname(devicePath));
  bundlePath = path.resolve(bundlePath);
  sourcePath = path.resolve(sourcePath);

  const realRoot = fs.realpathSync(root);
  const realProjectDirectory = realExistingPath(
    projectDirectory,
    "Release staging project",
    { directory: true },
  );
  const realDevicePath = realExistingPath(devicePath, "Frozen candidate");
  if (
    requireExternal &&
    (isWithin(realRoot, realDevicePath) || isWithin(realRoot, realProjectDirectory))
  ) {
    throw new Error("Verify the frozen candidate in an external staging project before replacement");
  }
  if (!isWithin(realProjectDirectory, realDevicePath)) {
    throw new Error("Frozen candidate must be inside its staging project");
  }

  const candidateSnapshot = readStableRegularFile(realDevicePath, "Frozen candidate", {
    maxBytes: MAX_AMXD_BYTES,
  });
  if (requireExternal && fs.existsSync(path.join(root, "MIDIjourney.amxd"))) {
    const trackedStatus = fs.lstatSync(path.join(root, "MIDIjourney.amxd"), {
      bigint: true,
    });
    if (
      !trackedStatus.isSymbolicLink() &&
      trackedStatus.isFile() &&
      sameFileIdentity(candidateSnapshot.stat, trackedStatus)
    ) {
      throw new Error("Frozen candidate must not be the tracked release file or its hard link");
    }
  }
  const bundleSnapshot = readStableRegularFile(bundlePath, "Current release bundle");
  const sourceSnapshot = readStableRegularFile(sourcePath, "Current source device");
  const sourceDevice = readSourceDevice(sourcePath, sourceSnapshot.buffer);
  const expectedNames = canonicalEntryNames(sourceDevice);
  const sourceInputOptions = {
    repositoryRoot: root,
    sourceDeviceFile: sourcePath,
    releaseBundleFile: bundlePath,
    prepareScriptFile: path.join(root, "scripts", "prepare-max-release-project.js"),
  };
  const inputsBeforeCompilation = releaseSourceInputRecords(
    sourceDevice,
    sourceInputOptions,
  );
  if (
    inputsBeforeCompilation.find(({ path: name }) => name === "MIDIjourney.source.amxd")
      ?.sha256 !== sha256(sourceSnapshot.buffer) ||
    inputsBeforeCompilation.find(({ path: name }) => name === "js/midiJourney.release.js")
      ?.sha256 !== sha256(bundleSnapshot.buffer)
  ) {
    throw new Error("Current release inputs changed before bundle freshness verification");
  }
  const bundleBuildVerified = verifyCanonicalBundleIsCurrent(
    bundleSnapshot.buffer,
    bundlePath,
  );
  const inputsAfterCompilation = releaseSourceInputRecords(
    sourceDevice,
    sourceInputOptions,
  );
  if (JSON.stringify(inputsAfterCompilation) !== JSON.stringify(inputsBeforeCompilation)) {
    throw new Error("Current release inputs changed during bundle freshness verification");
  }
  const buffer = candidateSnapshot.buffer;
  if (hasTestHook(buffer)) {
    throw new Error("Frozen candidate contains a test-only E2E hook");
  }
  const inspection = inspectFrozenAmxd(buffer);
  const { validation, entries, documents, nativeDirectory } = inspection;
  if (
    validation.amxdType !== audioEffectAmxdType ||
    validation.minimumLiveVersion !== minimumLiveVersion ||
    validation.minimumMaxVersion !== minimumMaxVersion
  ) {
    throw new Error("Frozen candidate has unexpected device type or Live/Max minimums");
  }
  if (
    validation.zipArchiveCount !== 3 ||
    JSON.stringify(nativeDirectory.folderNames) !==
      JSON.stringify([
        "node_content/zipfolder",
        "patchers/zipfolder",
        "images/zipfolder",
      ])
  ) {
    throw new Error("Frozen candidate does not use the canonical Max archive topology");
  }
  const seenNames = new Set();
  const entriesByName = new Map();
  const stagedAssets = [];
  const allowedDirectories = new Set(["images/", "node_content/", "patchers/"]);

  for (const entry of entries) {
    assertSafeArchiveName(entry.name);
    if (seenNames.has(entry.name)) {
      throw new Error(`Frozen candidate contains duplicate embedded path ${entry.name}`);
    }
    seenNames.add(entry.name);
    if (hasTestHook(entry.data)) {
      throw new Error(`Frozen candidate contains a test-only E2E hook in ${entry.name}`);
    }

    if (entry.name.endsWith("/")) {
      if (!allowedDirectories.has(entry.name) || entry.data.length !== 0) {
        throw new Error(`Frozen candidate contains unexpected directory ${entry.name}`);
      }
      continue;
    }
    const forkTarget = resourceForkTarget(entry.name);
    if (forkTarget !== null) {
      if (!forkTarget || !expectedNames.has(forkTarget)) {
        throw new Error(`Frozen candidate contains unexpected resource fork ${entry.name}`);
      }
      assertKnownMaxAppleDouble(entry);
      continue;
    }
    if (!expectedNames.has(entry.name)) {
      throw new Error(`Frozen candidate contains unexpected asset ${entry.name}`);
    }
    entriesByName.set(entry.name, entry);
  }

  for (const name of expectedNames) {
    const entry = entriesByName.get(name);
    if (!entry) throw new Error(`Frozen candidate is missing canonical asset ${name}`);
    let stagedPath;
    try {
      stagedPath = assertUnlinkedPathBelow(
        realProjectDirectory,
        name,
        `Staged release asset ${name}`,
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Staging project is missing canonical asset ${name}`);
      }
      throw error;
    }
    const staged = readStableRegularFile(
      stagedPath,
      `Staged release asset ${name}`,
    ).buffer;
    if (!entry.data.equals(staged)) {
      throw new Error(`Frozen candidate does not contain the staged bytes for ${name}`);
    }
    stagedAssets.push({ path: name, sha256: sha256(staged) });
  }
  stagedAssets.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

  const currentBundle = bundleSnapshot.buffer;
  if (!entriesByName.get(canonicalRuntimeEntry).data.equals(currentBundle)) {
    throw new Error("Frozen candidate runtime does not match the current release bundle");
  }
  verifyCanonicalPatcherWiring(entriesByName, expectedNames);
  const manifestValidation = verifyStagingManifest({
    projectDirectory: realProjectDirectory,
    candidatePath: realDevicePath,
    sourceDevice,
    sourcePath,
    bundlePath,
    sourceInputs: inputsAfterCompilation,
    stagedAssets,
  });
  verifyActiveFrozenPatchers(
    documents,
    nativeDirectory,
    entriesByName,
    expectedNames,
    manifestValidation.manifest.project.candidateName,
  );

  const finalManifestPath = assertUnlinkedPathBelow(
    realProjectDirectory,
    STAGING_MANIFEST_NAME,
    "Release staging manifest",
  );
  if (
    sha256(readStableRegularFile(finalManifestPath, "Release staging manifest").buffer) !==
    manifestValidation.manifestDigest
  ) {
    throw new Error("Release staging manifest changed during verification");
  }
  compareDigestRecords(
    manifestValidation.manifest.sourceInputs,
    releaseSourceInputRecords(sourceDevice, sourceInputOptions),
    "Release staging source inputs",
  );
  compareDigestRecords(
    manifestValidation.manifest.stagedAssets,
    stagedAssetRecords(realProjectDirectory),
    "Release staged assets",
  );
  compareDigestRecords(
    [manifestValidation.manifest.projectFile],
    [stagedProjectRecord(realProjectDirectory, canonicalProjectName)],
    "Release staging project file",
  );
  if (
    !readStableRegularFile(bundlePath, "Current release bundle").buffer.equals(
      bundleSnapshot.buffer,
    ) ||
    !readStableRegularFile(sourcePath, "Current source device").buffer.equals(
      sourceSnapshot.buffer,
    )
  ) {
    throw new Error("Current release inputs changed during candidate verification");
  }
  const finalCandidateSnapshot = readStableRegularFile(
    realDevicePath,
    "Frozen candidate",
    { maxBytes: MAX_AMXD_BYTES },
  );
  if (
    !sameSnapshot(candidateSnapshot.stat, finalCandidateSnapshot.stat) ||
    !candidateSnapshot.buffer.equals(finalCandidateSnapshot.buffer)
  ) {
    throw new Error("Frozen candidate changed during candidate verification");
  }

  const result = {
    ...validation,
    bundleBuildVerified,
    canonicalAssetCount: expectedNames.size,
    candidateDigest: sha256(buffer),
  };
  Object.defineProperty(result, "verifiedBuffer", {
    configurable: false,
    enumerable: false,
    value: buffer,
    writable: false,
  });
  if (!quiet) {
    process.stdout.write(
      `Strictly verified external frozen candidate (${result.canonicalAssetCount} canonical assets, exact staged bytes, no E2E hooks).\n`,
    );
  }
  return result;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.length > 2) {
      throw new Error(
        "Usage: node scripts/verify-max-release-candidate.js <candidate.amxd> [staging-project-directory]",
      );
    }
    verifyMaxReleaseCandidate({
      devicePath: args[0],
      projectDirectory: args[1] || path.dirname(path.resolve(args[0])),
    });
  } catch (error) {
    process.stderr.write(`External release candidate verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  canonicalEntryNames,
  semanticPatcherGraph,
  verifyCanonicalBundleIsCurrent,
  verifyMaxReleaseCandidate,
};
