#!/usr/bin/env node

"use strict";

const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { finalizeMaxRelease, lockPathFor } = require("./finalize-max-release");
const {
  STAGING_MANIFEST_NAME,
  prepareMaxReleaseProject,
  readDevicePatcher,
} = require("./prepare-max-release-project");
const {
  MAX_AMXD_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  inspectFrozenAmxd,
  validateFrozenAmxd,
} = require("./max-release-portability");
const { synchronize } = require("./sync-amxd");
const {
  canonicalEntryNames,
  verifyCanonicalBundleIsCurrent,
  verifyMaxReleaseCandidate,
} = require("./verify-max-release-candidate");

const root = path.resolve(__dirname, "..");
const releaseDevicePath = path.join(root, "MIDIjourney.amxd");
const defaultRuntimeName = "midijourney-v3-runtime.js";
const defaultNodePatcherName = "midijourney_v3_release_node.maxpat";
const audioEffectAmxdType = 0x61616161;
const canonicalCandidateName = "MIDIjourney V3 Release Candidate.amxd";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoredZip(files, { deflate = false } = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const { name, data } of files) {
    const encodedName = Buffer.from(name, "utf8");
    const checksum = crc32(data);
    const compressed = deflate ? zlib.deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(encodedName.length, 26);
    localParts.push(localHeader, encodedName, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(encodedName.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, encodedName);
    localOffset += localHeader.length + encodedName.length + compressed.length;
  }

  const localData = Buffer.concat(localParts);
  const centralData = Buffer.concat(centralParts);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(files.length, 8);
  footer.writeUInt16LE(files.length, 10);
  footer.writeUInt32LE(centralData.length, 12);
  footer.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, footer]);
}

function nativeField(tag, payload) {
  const padding = Buffer.alloc((4 - (payload.length % 4)) % 4);
  const header = Buffer.alloc(8);
  header.write(tag, 0, "ascii");
  header.writeUInt32BE(header.length + payload.length + padding.length, 4);
  return Buffer.concat([header, payload, padding]);
}

function nativeNumberField(tag, value) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(value, 0);
  return nativeField(tag, payload);
}

function nativeDirectoryRecord({ type, name, size, offset, flag = 0, mdat = 0 }) {
  const fields = [
    nativeField("type", Buffer.from(type, "ascii")),
    nativeField("fnam", Buffer.from(`${name}\0`, "utf8")),
    nativeNumberField("sz32", size),
    nativeNumberField("of32", offset),
    nativeNumberField("vers", 0),
    nativeNumberField("flag", flag),
    nativeNumberField("mdat", mdat),
  ];
  const contents = Buffer.concat(fields);
  const header = Buffer.alloc(8);
  header.write("dire", 0, "ascii");
  header.writeUInt32BE(header.length + contents.length, 4);
  return Buffer.concat([header, contents]);
}

function nativeDependencyDirectory(records) {
  const contents = Buffer.concat(records.map(nativeDirectoryRecord));
  const header = Buffer.alloc(8);
  header.write("dlst", 0, "ascii");
  header.writeUInt32BE(header.length + contents.length, 4);
  return Buffer.concat([header, contents]);
}

function buildSyntheticFrozenCandidate(
  projectDirectory,
  {
    pretty = false,
    deflate = false,
    mutateDocuments = null,
    additionalFiles = [],
  } = {},
) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectDirectory, STAGING_MANIFEST_NAME), "utf8"),
  );
  const candidateName = manifest.project.candidateName;
  const files = [
    ...manifest.stagedAssets.map((record) => ({
      name: record.path,
      data: fs.readFileSync(path.join(projectDirectory, ...record.path.split("/"))),
    })),
    ...additionalFiles,
  ];
  const patcherFiles = files
    .filter(({ name }) => name.startsWith("patchers/") && name.endsWith(".maxpat"))
    .sort((left, right) => {
      if (left.name === "patchers/MIDIjourney V3.maxpat") return -1;
      if (right.name === "patchers/MIDIjourney V3.maxpat") return 1;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  const documents = patcherFiles.map(({ data }) => JSON.parse(data));
  if (mutateDocuments) mutateDocuments(documents);
  const documentBuffers = documents.map((document) =>
    Buffer.from(`${JSON.stringify(document, null, pretty ? 2 : 0)}\n`, "utf8"),
  );
  const metadataHeader = Buffer.alloc(16);
  metadataHeader.write("mx@c", 0, "ascii");
  metadataHeader.writeUInt32BE(16, 4);
  const metadataLength =
    metadataHeader.length + documentBuffers.reduce((total, item) => total + item.length, 0);
  const archiveGroups = ["node_content", "patchers", "images"].map((directory) => ({
    directory,
    files: files.filter(
      ({ name, archive }) => archive === directory || name.startsWith(`${directory}/`),
    ),
  }));
  assert.ok(archiveGroups.every(({ files: groupFiles }) => groupFiles.length > 0));
  const archives = archiveGroups.map(({ files: groupFiles }) =>
    buildStoredZip(groupFiles, { deflate }),
  );
  const zip = Buffer.concat(archives);
  const tailOffset = 32 + metadataLength + zip.length;
  metadataHeader.writeUInt32BE(tailOffset - 32, 12);
  const metadata = Buffer.concat([metadataHeader, ...documentBuffers]);

  const records = [];
  let documentOffset = metadataHeader.length;
  for (let index = 0; index < documentBuffers.length; index += 1) {
    records.push({
      type: "JSON",
      name:
        index === 0
          ? candidateName
          : path.basename(patcherFiles[index].name),
      size: documentBuffers[index].length,
      offset: documentOffset,
      flag: index === 0 ? 17 : 0,
      mdat: index === 0 ? 2 : 1,
    });
    documentOffset += documentBuffers[index].length;
  }
  let archiveOffset = metadata.length;
  for (let index = 0; index < archives.length; index += 1) {
    records.push({
      type: "fold",
      name: `${archiveGroups[index].directory}/zipfolder`,
      size: archives[index].length,
      offset: archiveOffset,
    });
    archiveOffset += archives[index].length;
  }
  const nativeDirectory = nativeDependencyDirectory(records);
  const header = Buffer.alloc(32);
  header.write("ampf", 0, "ascii");
  header.writeUInt32LE(4, 4);
  header.write("aaaa", 8, "ascii");
  header.write("meta", 12, "ascii");
  header.writeUInt32LE(4, 16);
  header.writeUInt32LE(7, 20);
  header.write("ptch", 24, "ascii");
  const candidate = Buffer.concat([header, metadata, zip, nativeDirectory]);
  candidate.writeUInt32LE(candidate.length - 32, 28);
  const candidatePath = path.join(projectDirectory, candidateName);
  fs.writeFileSync(candidatePath, candidate, { mode: 0o600 });
  return { candidate, candidatePath };
}

function hasLine(patcher, sourceId, destinationId, sourceOutlet = 0, destinationInlet = 0) {
  return (patcher.lines || []).some(
    ({ patchline }) =>
      patchline.source[0] === sourceId &&
      patchline.source[1] === sourceOutlet &&
      patchline.destination[0] === destinationId &&
      patchline.destination[1] === destinationInlet,
  );
}

function assertManualFloatingEditor(patcher) {
  const boxes = Object.fromEntries(
    (patcher.boxes || []).map(({ box }) => [box.id, box]),
  );
  const load = boxes["obj-midijourney-editor-window-load"];
  const defer = boxes["obj-midijourney-editor-window-defer"];
  const config = boxes["obj-midijourney-editor-window-config"];
  const journey = boxes["obj-45"];
  const ids = new Set([load?.id, defer?.id, config?.id]);
  const actualCords = (patcher.lines || [])
    .map(({ patchline }) => patchline)
    .filter(
      ({ source, destination }) =>
        ids.has(source[0]) || ids.has(destination[0]),
    )
    .map(({ source, destination }) =>
      JSON.stringify([source[0], source[1], destination[0], destination[1]]),
    )
    .sort();
  const expectedCords = [
    [load?.id, 0, defer?.id, 0],
    [defer?.id, 0, config?.id, 0],
    [config?.id, 0, journey?.id, 0],
  ]
    .map((cord) => JSON.stringify(cord))
    .sort();

  assert.equal(load?.text, "loadbang");
  assert.equal(load?.hidden, 1);
  assert.equal(defer?.text, "deferlow");
  assert.equal(defer?.hidden, 1);
  assert.equal(
    config?.text,
    "window flags float, window flags nominimize, window flags nogrow, window flags nozoom, window exec",
  );
  assert.equal(config?.hidden, 1);
  assert.deepEqual(actualCords, expectedCords);
  assert.equal(boxes["obj-7"], undefined);
  assert.equal(boxes["obj-12"], undefined);
  assert.equal(boxes["obj-10"], undefined);
}

function assertPatcherIntegrity(patcher) {
  const boxes = patcher.boxes || [];
  const ids = new Set(boxes.map(({ box }) => box.id));
  assert.equal(ids.size, boxes.length, "instrumented patcher contains duplicate object ids");
  for (const { patchline } of patcher.lines || []) {
    assert.ok(ids.has(patchline.source[0]), `missing source ${patchline.source[0]}`);
    assert.ok(ids.has(patchline.destination[0]), `missing destination ${patchline.destination[0]}`);
  }
  for (const { box } of boxes) {
    if (box.patcher) assertPatcherIntegrity(box.patcher);
  }
}

function filesBelow(directory, current = directory) {
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(directory, target));
    else files.push(path.relative(directory, target));
  }
  return files.sort();
}

function readStagingDevice(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "ampf");
  assert.equal(buffer.subarray(24, 28).toString("ascii"), "ptch");
  assert.equal(buffer.readUInt32LE(28), buffer.length - 32);
  return JSON.parse(buffer.subarray(32).toString("utf8").replace(/\0+$/, ""));
}

function forEachDependencyCache(value, callback) {
  if (Array.isArray(value)) {
    for (const item of value) forEachDependencyCache(item, callback);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.dependency_cache)) callback(value.dependency_cache);
  for (const item of Object.values(value)) forEachDependencyCache(item, callback);
}

function expectedDirectories(projectDirectory) {
  return {
    runtime: path.join(projectDirectory, "node_content"),
    patchers: path.join(projectDirectory, "patchers"),
    images: path.join(projectDirectory, "images"),
  };
}

function assertSearchPaths(searchpath, directories) {
  assert.equal(searchpath?.[0]?.bootpath, directories.runtime);
  assert.equal(searchpath?.[0]?.projectrelativepath, "./node_content");
  assert.equal(searchpath?.[1]?.bootpath, directories.patchers);
  assert.equal(searchpath?.[1]?.projectrelativepath, "./patchers");
  assert.equal(searchpath?.[2]?.bootpath, directories.images);
  assert.equal(searchpath?.[2]?.projectrelativepath, "./images");
}

function assertDependencyBootpaths(
  document,
  directories,
  runtimeName = defaultRuntimeName,
) {
  let checked = 0;
  forEachDependencyCache(document, (dependencies) => {
    for (const dependency of dependencies) {
      let expected = null;
      if (dependency.name === runtimeName) expected = directories.runtime;
      else if (dependency.type === "JSON" && dependency.name?.endsWith(".maxpat")) {
        expected = directories.patchers;
      } else if (dependency.type === "svg" && dependency.name?.endsWith(".svg")) {
        expected = directories.images;
      }
      if (!expected) continue;
      assert.equal(dependency.bootpath, expected);
      checked += 1;
    }
  });
  return checked;
}

function assertRootSpecificStaging(
  projectDirectory,
  forbiddenRoot,
  projectFileName = "MIDIjourney V3 Release.maxproj",
  deviceFileName = "MIDIjourney V3 Release Candidate.amxd",
  runtimeName = defaultRuntimeName,
  nodePatcherName = defaultNodePatcherName,
) {
  const directories = expectedDirectories(projectDirectory);
  const project = JSON.parse(
    fs.readFileSync(path.join(projectDirectory, projectFileName), "utf8"),
  );
  assert.equal(project.amxdtype, audioEffectAmxdType);
  assertSearchPaths(project.searchpath, directories);

  const device = readStagingDevice(path.join(projectDirectory, deviceFileName));
  assert.equal(device.patcher.project?.amxdtype, audioEffectAmxdType);
  assertSearchPaths(device.patcher.project?.searchpath, directories);
  const rootBoxes = Object.fromEntries(
    (device.patcher.boxes || []).map(({ box }) => [box.id, box]),
  );
  assertManualFloatingEditor(device.patcher);
  assert.equal(rootBoxes["obj-7"], undefined);
  assert.equal(rootBoxes["obj-12"], undefined);
  assert.equal(rootBoxes["obj-10"], undefined);
  assert.equal(rootBoxes["obj-33"]?.mode, 1);
  assert.equal(rootBoxes["obj-33"]?.parameter_enable, 0);
  assert.equal(device.patcher.parameters?.["obj-33"], undefined);
  assert.equal(device.patcher.parameters?.parameter_overrides?.["obj-33"], undefined);
  assert.equal(
    Object.values(rootBoxes).find((box) => box.text === "p midiJourney")?.patcher?.visible,
    0,
  );
  assert.equal(JSON.stringify(device).includes("MIDIjourney_E2E_"), false);
  let dependenciesChecked = assertDependencyBootpaths(device, directories, runtimeName);

  for (const name of fs
    .readdirSync(directories.patchers)
    .filter((entry) => entry.endsWith(".maxpat"))) {
    const patcher = JSON.parse(fs.readFileSync(path.join(directories.patchers, name), "utf8"));
    dependenciesChecked += assertDependencyBootpaths(patcher, directories, runtimeName);
  }
  assert.ok(dependenciesChecked > 30);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectDirectory, STAGING_MANIFEST_NAME), "utf8"),
  );
  assert.equal(manifest.format, "midijourney-max-release-staging");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.project.candidateName, deviceFileName);
  assert.equal(manifest.project.runtimeName, runtimeName);
  assert.equal(manifest.project.nodePatcherName, nodePatcherName);
  assert.equal(manifest.projectFile.path, projectFileName);
  assert.match(manifest.projectFile.sha256, /^[a-f0-9]{64}$/);
  for (const records of [manifest.sourceInputs, manifest.stagedAssets]) {
    assert.deepEqual(
      records.map((record) => record.path),
      records.map((record) => record.path).sort(),
    );
    assert.equal(new Set(records.map((record) => record.path)).size, records.length);
    assert.ok(records.every((record) => /^[a-f0-9]{64}$/.test(record.sha256)));
  }
  const sourceInputPaths = new Set(manifest.sourceInputs.map(({ path: name }) => name));
  for (const requiredInput of [
    "MIDIjourney.source.amxd",
    "js/build-release.js",
    "js/config.js",
    "js/midiJourney.js",
    "js/midiJourney.release.js",
    "js/package-lock.json",
    "js/package.json",
  ]) {
    assert.ok(
      sourceInputPaths.has(requiredInput),
      `staging manifest is missing ${requiredInput}`,
    );
  }
  assert.deepEqual(
    manifest.stagedAssets.map((record) => record.path),
    filesBelow(projectDirectory).filter(
      (name) =>
        name.startsWith("images/") ||
        name.startsWith("node_content/") ||
        name.startsWith("patchers/"),
    ),
  );

  for (const name of filesBelow(projectDirectory)) {
    const contents = fs.readFileSync(path.join(projectDirectory, name));
    assert.equal(contents.includes(Buffer.from(forbiddenRoot)), false);
    assert.equal(contents.includes(Buffer.from(root)), false);
  }
}

function testResolvableStaging() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "midijourney-release-test-"));
  try {
    const dummyBundle = path.join(temporaryRoot, "runtime.js");
    fs.writeFileSync(dummyBundle, 'require("max-api");\n', { mode: 0o600 });
    const sourceBuffer = fs.readFileSync(path.join(root, "MIDIjourney.source.amxd"));
    const wrongSourceType = Buffer.from(sourceBuffer);
    wrongSourceType.write("iiii", 8, "ascii");
    assert.throws(
      () => readDevicePatcher(wrongSourceType),
      /not a canonical Max Audio Effect source/,
    );
    const linkedBundle = path.join(temporaryRoot, "linked-runtime.js");
    fs.symlinkSync(dummyBundle, linkedBundle);
    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: path.join(temporaryRoot, "linked-bundle-target"),
          releaseBundlePath: linkedBundle,
          quiet: true,
        }),
      /Release manifest input must not be a symbolic link: js\/midiJourney\.release\.js/,
    );
    const unknownReleaseRoot = path.join(temporaryRoot, "unknown-target");
    const unknownProject = path.join(unknownReleaseRoot, "MIDIjourney V3 Release");
    const sentinel = path.join(unknownProject, "do-not-delete.txt");
    fs.mkdirSync(unknownProject, { recursive: true });
    fs.writeFileSync(sentinel, "belongs to another workflow\n");
    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: unknownReleaseRoot,
          releaseBundlePath: dummyBundle,
          quiet: true,
        }),
      /Refusing to replace a nonempty Max release target/,
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "belongs to another workflow\n");

    const forgedReleaseRoot = path.join(temporaryRoot, "forged-target");
    const forgedProject = path.join(forgedReleaseRoot, "MIDIjourney V3 Release");
    const forgedSentinel = path.join(forgedProject, "do-not-delete.txt");
    fs.mkdirSync(forgedProject, { recursive: true });
    fs.writeFileSync(forgedSentinel, "still belongs to another workflow\n");
    fs.writeFileSync(
      path.join(forgedProject, STAGING_MANIFEST_NAME),
      JSON.stringify({
        format: "midijourney-max-release-staging",
        version: 1,
        project: { projectName: "MIDIjourney V3 Release" },
      }),
    );
    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: forgedReleaseRoot,
          releaseBundlePath: dummyBundle,
          quiet: true,
        }),
      /Refusing to replace a nonempty Max release target owned by another project/,
    );
    assert.equal(
      fs.readFileSync(forgedSentinel, "utf8"),
      "still belongs to another workflow\n",
    );

    const left = prepareMaxReleaseProject({
      releaseRoot: path.join(temporaryRoot, "left"),
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
    const right = prepareMaxReleaseProject({
      releaseRoot: path.join(temporaryRoot, "a", "different", "depth", "right"),
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
    assert.deepEqual(filesBelow(left), filesBelow(right));
    assertRootSpecificStaging(left, right);
    assertRootSpecificStaging(right, left);
    assert.ok(
      fs
        .readFileSync(path.join(left, "node_content", "midijourney-v3-runtime.js"))
        .equals(
          fs.readFileSync(path.join(right, "node_content", "midijourney-v3-runtime.js")),
        ),
    );
    const leftManifest = fs.readFileSync(path.join(left, STAGING_MANIFEST_NAME));
    const rightManifest = fs.readFileSync(path.join(right, STAGING_MANIFEST_NAME));
    assert.deepEqual(
      JSON.parse(leftManifest).sourceInputs,
      JSON.parse(rightManifest).sourceInputs,
    );
    prepareMaxReleaseProject({
      releaseRoot: path.join(temporaryRoot, "left"),
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
    assert.ok(
      fs.readFileSync(path.join(left, STAGING_MANIFEST_NAME)).equals(leftManifest),
      "staging manifests must be deterministic when regenerated at the same root",
    );
    assert.ok(
      fs
        .readFileSync(path.join(left, "images", "validate.svg"))
        .equals(fs.readFileSync(path.join(right, "images", "validate.svg"))),
    );

    const recoveryRoot = path.join(temporaryRoot, "recoverable-preparation");
    const recoverableProject = prepareMaxReleaseProject({
      releaseRoot: recoveryRoot,
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
    const recoverableManifest = fs.readFileSync(
      path.join(recoverableProject, STAGING_MANIFEST_NAME),
    );
    const originalWriteFileSync = fs.writeFileSync;
    let injectedPreparationFailure = false;
    fs.writeFileSync = function injectedWrite(file, ...args) {
      if (
        !injectedPreparationFailure &&
        path.resolve(String(file)) ===
          path.join(recoverableProject, "patchers", "MIDIjourney V3.maxpat")
      ) {
        injectedPreparationFailure = true;
        throw new Error("injected staging write failure");
      }
      return originalWriteFileSync.call(fs, file, ...args);
    };
    try {
      assert.throws(
        () =>
          prepareMaxReleaseProject({
            releaseRoot: recoveryRoot,
            releaseBundlePath: dummyBundle,
            quiet: true,
          }),
        /injected staging write failure/,
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
    }
    assert.ok(injectedPreparationFailure);
    assert.ok(
      fs
        .readFileSync(path.join(recoverableProject, STAGING_MANIFEST_NAME))
        .equals(recoverableManifest),
      "a caught preparation failure must restore the prior staging project",
    );
    prepareMaxReleaseProject({
      releaseRoot: recoveryRoot,
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function testBundleFreshnessGate() {
  const canonicalBundlePath = path.join(root, "js", "midiJourney.release.js");
  const bundle = Buffer.from("deterministic compiled release bundle\n");
  const bundleDigest = crypto.createHash("sha256").update(bundle).digest("hex");
  assert.equal(
    verifyCanonicalBundleIsCurrent(bundle, canonicalBundlePath, () => bundleDigest),
    true,
  );
  assert.throws(
    () =>
      verifyCanonicalBundleIsCurrent(
        bundle,
        canonicalBundlePath,
        () => "0".repeat(64),
      ),
    /Current release bundle is stale/,
  );
  assert.equal(
    verifyCanonicalBundleIsCurrent(
      bundle,
      path.join(os.tmpdir(), "noncanonical-release-bundle.js"),
      () => {
        throw new Error("noncanonical bundles must not invoke ncc");
      },
    ),
    false,
  );
}

function testCacheBustingStagingName() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "midijourney-cache-test-"));
  try {
    const dummyBundle = path.join(temporaryRoot, "runtime.js");
    fs.writeFileSync(dummyBundle, 'require("max-api");\n', { mode: 0o600 });
    const projectName = "MIDIjourney V3 Runtime Test 20260912";
    const deviceName = `${projectName}.amxd`;
    const runtimeName = "midijourney-v3-runtime-20260912.js";
    const nodePatcherName = "midijourney_v3_release_node_20260912.maxpat";
    const projectDirectory = prepareMaxReleaseProject({
      releaseRoot: temporaryRoot,
      releaseBundlePath: dummyBundle,
      projectName,
      stagingDeviceName: deviceName,
      runtimeName,
      nodePatcherName,
      quiet: true,
    });

    assert.equal(projectDirectory, path.join(temporaryRoot, projectName));
    assert.ok(fs.existsSync(path.join(projectDirectory, deviceName)));
    assert.ok(fs.existsSync(path.join(projectDirectory, `${projectName}.maxproj`)));
    assertRootSpecificStaging(
      projectDirectory,
      path.join(temporaryRoot, "not-this-build"),
      `${projectName}.maxproj`,
      deviceName,
      runtimeName,
      nodePatcherName,
    );

    const directories = expectedDirectories(projectDirectory);
    assert.ok(fs.existsSync(path.join(directories.runtime, runtimeName)));
    assert.equal(fs.existsSync(path.join(directories.runtime, defaultRuntimeName)), false);
    assert.ok(fs.existsSync(path.join(directories.patchers, nodePatcherName)));
    assert.equal(fs.existsSync(path.join(directories.patchers, defaultNodePatcherName)), false);

    const project = JSON.parse(
      fs.readFileSync(path.join(projectDirectory, `${projectName}.maxproj`), "utf8"),
    );
    assert.deepEqual(project.contents.code, {
      [runtimeName]: { kind: "javascript", local: 1 },
    });
    assert.ok(project.contents.patchers[nodePatcherName]);
    assert.equal(project.contents.patchers[defaultNodePatcherName], undefined);

    const device = readStagingDevice(path.join(projectDirectory, deviceName));
    const serializedDevice = JSON.stringify(device);
    assert.equal(serializedDevice.includes(defaultRuntimeName), false);
    assert.equal(serializedDevice.includes(defaultNodePatcherName), false);
    assert.ok(serializedDevice.includes(runtimeName));
    assert.ok(serializedDevice.includes(path.basename(nodePatcherName, ".maxpat")));

    const nodePatcher = JSON.parse(
      fs.readFileSync(path.join(directories.patchers, nodePatcherName), "utf8"),
    );
    const nodeScript = nodePatcher.patcher.boxes.find(
      ({ box }) => box.id === "obj-273",
    )?.box;
    assert.equal(nodeScript?.text, `node.script ${runtimeName} @watch 0`);

    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: temporaryRoot,
          releaseBundlePath: dummyBundle,
          projectName: "invalid-runtime-name",
          runtimeName: "../escape.js",
          quiet: true,
        }),
      /runtime name must be a single \.js name/,
    );
    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: temporaryRoot,
          releaseBundlePath: dummyBundle,
          projectName: "invalid-node-name",
          nodePatcherName: "not-javascript.js",
          quiet: true,
        }),
      /Node patcher name must be a single \.maxpat name/,
    );
    assert.throws(
      () =>
        prepareMaxReleaseProject({
          releaseRoot: temporaryRoot,
          releaseBundlePath: dummyBundle,
          projectName: "..",
          quiet: true,
        }),
      /project name must be a single name/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function testChecksumOnlyFinalization() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "midijourney-finalize-test-"));
  try {
    const devicePath = path.join(temporaryRoot, "candidate.amxd");
    const digestPath = path.join(temporaryRoot, "candidate.amxd.sha256");
    fs.copyFileSync(releaseDevicePath, devicePath);
    const before = fs.readFileSync(devicePath);
    const expectedValidation = validateFrozenAmxd(before);
    assert.equal(expectedValidation.amxdType, audioEffectAmxdType);
    assert.equal(expectedValidation.minimumLiveVersion, "12.0.0");
    assert.equal(expectedValidation.minimumMaxVersion, "9.0.0");

    const result = finalizeMaxRelease({ devicePath, digestPath, quiet: true });
    const after = fs.readFileSync(devicePath);
    assert.ok(after.equals(before), "finalization must not rewrite Max's frozen bytes");
    assert.deepEqual(result.validation, expectedValidation);

    const expectedDigest = crypto.createHash("sha256").update(before).digest("hex");
    assert.equal(result.digest, expectedDigest);
    assert.equal(
      fs.readFileSync(digestPath, "utf8"),
      `${expectedDigest}  ${path.basename(devicePath)}\n`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function testStrictExternalCandidateVerification() {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "midijourney-candidate-test-"),
  );
  try {
    assert.throws(
      () => inspectFrozenAmxd(Buffer.alloc(MAX_AMXD_BYTES + 1)),
      /AMXD exceeds the release size limit/,
    );
    const dummyBundle = path.join(temporaryRoot, "runtime.js");
    fs.writeFileSync(dummyBundle, 'require("max-api");\n', { mode: 0o600 });
    const projectDirectory = prepareMaxReleaseProject({
      releaseRoot: temporaryRoot,
      releaseBundlePath: dummyBundle,
      quiet: true,
    });
    const oversizedCandidatePath = path.join(projectDirectory, "oversized-candidate.amxd");
    fs.writeFileSync(oversizedCandidatePath, "");
    fs.truncateSync(oversizedCandidatePath, MAX_AMXD_BYTES + 1);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: oversizedCandidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /Frozen candidate exceeds its size limit/,
    );
    fs.rmSync(oversizedCandidatePath);
    const { candidate, candidatePath } = buildSyntheticFrozenCandidate(projectDirectory);
    const expectedNames = canonicalEntryNames();
    const result = verifyMaxReleaseCandidate({
      devicePath: candidatePath,
      projectDirectory,
      bundlePath: dummyBundle,
      quiet: true,
    });
    assert.equal(result.amxdType, audioEffectAmxdType);
    assert.equal(result.zipArchiveCount, 3);
    assert.equal(result.nativeDirectoryRecordCount, result.jsonDocumentCount + 3);
    assert.equal(result.canonicalAssetCount, expectedNames.size);
    assert.equal(result.candidateDigest, crypto.createHash("sha256").update(candidate).digest("hex"));
    assert.ok(result.verifiedBuffer.equals(candidate));

    const cacheIsolatedProject = prepareMaxReleaseProject({
      releaseRoot: path.join(temporaryRoot, "cache-isolated-candidate"),
      releaseBundlePath: dummyBundle,
      stagingDeviceName: "MIDIjourney V3 Cache-Isolated Candidate.amxd",
      quiet: true,
    });
    const cacheIsolated = buildSyntheticFrozenCandidate(cacheIsolatedProject);
    assert.equal(
      verifyMaxReleaseCandidate({
        devicePath: cacheIsolated.candidatePath,
        projectDirectory: cacheIsolatedProject,
        bundlePath: dummyBundle,
        quiet: true,
      }).canonicalAssetCount,
      expectedNames.size,
    );

    const maxNormalized = buildSyntheticFrozenCandidate(projectDirectory, {
      mutateDocuments(documents) {
        const active = documents[0].patcher;
        active.appversion = { major: 99, minor: 0, revision: 0 };
        active.originid = "max-generated-origin";
        for (const dependency of active.dependency_cache || []) {
          dependency.bootpath = ".";
          delete dependency.patcherrelativepath;
        }
        for (const searchPath of Object.values(active.project?.searchpath || {})) {
          searchPath.bootpath = ".";
          searchPath.projectrelativepath = `/max-rewritten/${path.basename(
            searchPath.projectrelativepath,
          )}`;
        }
        active.dependency_cache = (active.dependency_cache || []).filter(
          (dependency) => dependency.type !== "svg",
        );
        const create = active.boxes.find(({ box }) => box.id === "obj-33")?.box;
        assert.ok(create);
        delete create.mode;
        delete create.saved_attribute_attributes.valueof;
        const connect = active.boxes.find(
          ({ box }) => box.id === "obj-pollinations-connect",
        )?.box;
        assert.ok(connect);
        delete connect.mode;
        delete connect.active;
        connect.text = "Connected";
        connect.texton = "Connected";
        connect.svg = "";
        connect.saved_attribute_attributes = {
          activebgcolor: { expression: "" },
          legacy: 1,
        };
        const journey = active.boxes.find(({ box }) => box.id === "obj-45")?.box
          .patcher;
        assert.ok(journey);
        delete journey.visible;
        const thispatcher = journey.boxes.find(
          ({ box }) => box.id === "obj-39",
        )?.box;
        assert.ok(thispatcher);
        thispatcher.linecount = 3;
        thispatcher.save = [
          "#N",
          "thispatcher",
          ";",
          "#Q",
          "savewindow",
          1,
          ";",
          "#Q",
          "end",
          ";",
        ];
      },
    });
    assert.equal(
      verifyMaxReleaseCandidate({
        devicePath: maxNormalized.candidatePath,
        projectDirectory,
        bundlePath: dummyBundle,
        quiet: true,
      }).canonicalAssetCount,
      expectedNames.size,
    );

    const deflated = buildSyntheticFrozenCandidate(projectDirectory, { deflate: true });
    const deflatedResult = verifyMaxReleaseCandidate({
      devicePath: deflated.candidatePath,
      projectDirectory,
      bundlePath: dummyBundle,
      quiet: true,
    });
    assert.equal(deflatedResult.zipArchiveCount, 3);
    assert.equal(deflatedResult.canonicalAssetCount, expectedNames.size);
    const deflatedInspection = inspectFrozenAmxd(deflated.candidate);
    assert.throws(
      () =>
        inspectFrozenAmxd(deflated.candidate, {
          maxTotalUncompressedBytes:
            deflatedInspection.entries[0].uncompressedSize,
        }),
      /ZIP payload exceeds the uncompressed size limit/,
    );

    const tooManyEntries = buildSyntheticFrozenCandidate(projectDirectory, {
      additionalFiles: Array.from({ length: MAX_ZIP_ENTRIES }, (_, index) => ({
        name: `node_content/entry-limit-${index}.txt`,
        data: Buffer.alloc(0),
      })),
    });
    assert.throws(
      () => inspectFrozenAmxd(tooManyEntries.candidate),
      /too many embedded ZIP entries/,
    );

    const payloadDirectory = buildSyntheticFrozenCandidate(projectDirectory, {
      additionalFiles: [{ name: "node_content/", data: Buffer.from("payload") }],
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: payloadDirectory.candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /unexpected directory node_content\//,
    );

    const opaqueAppleDouble = buildSyntheticFrozenCandidate(projectDirectory, {
      additionalFiles: [
        {
          archive: "node_content",
          name: "__MACOSX/node_content/._midijourney-v3-runtime.js",
          data: Buffer.from("opaque auxiliary payload"),
        },
      ],
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: opaqueAppleDouble.candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /unsupported AppleDouble metadata/,
    );
    fs.writeFileSync(candidatePath, candidate);

    const promotedDevicePath = path.join(temporaryRoot, "promoted", "MIDIjourney.amxd");
    const promotedDigestPath = `${promotedDevicePath}.sha256`;
    fs.mkdirSync(path.dirname(promotedDevicePath), { recursive: true });
    fs.writeFileSync(promotedDevicePath, Buffer.from("previous release bytes"));
    fs.writeFileSync(promotedDigestPath, "previous checksum\n");

    const previousDevice = fs.readFileSync(promotedDevicePath);
    const previousDigest = fs.readFileSync(promotedDigestPath);
    const canonicalPromotedDevicePath = path.join(
      fs.realpathSync(path.dirname(promotedDevicePath)),
      path.basename(promotedDevicePath),
    );
    const canonicalPromotedDigestPath = path.join(
      fs.realpathSync(path.dirname(promotedDigestPath)),
      path.basename(promotedDigestPath),
    );
    const injectedFileSystem = Object.create(fs);
    injectedFileSystem.renameSync = (source, destination) => {
      if (destination === canonicalPromotedDigestPath) {
        const error = new Error("injected checksum replacement failure");
        error.code = "EIO";
        throw error;
      }
      return fs.renameSync(source, destination);
    };
    assert.throws(
      () =>
        finalizeMaxRelease({
          candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          devicePath: promotedDevicePath,
          digestPath: promotedDigestPath,
          fileSystem: injectedFileSystem,
          quiet: true,
        }),
      /injected checksum replacement failure/,
    );
    assert.ok(fs.readFileSync(promotedDevicePath).equals(previousDevice));
    assert.ok(fs.readFileSync(promotedDigestPath).equals(previousDigest));
    assert.equal(
      fs
        .readdirSync(path.dirname(promotedDevicePath))
        .some((name) => name.includes(".tmp-")),
      false,
    );
    assert.equal(fs.existsSync(lockPathFor(canonicalPromotedDevicePath)), false);

    let deviceRenameCompleted = false;
    let failDeviceParentSync = true;
    const syncFailingFileSystem = Object.create(fs);
    syncFailingFileSystem.renameSync = (source, destination) => {
      fs.renameSync(source, destination);
      if (destination === canonicalPromotedDevicePath) deviceRenameCompleted = true;
    };
    syncFailingFileSystem.fsyncSync = (descriptor) => {
      if (deviceRenameCompleted && failDeviceParentSync) {
        failDeviceParentSync = false;
        const error = new Error("injected parent directory sync failure");
        error.code = "EIO";
        throw error;
      }
      return fs.fsyncSync(descriptor);
    };
    assert.throws(
      () =>
        finalizeMaxRelease({
          candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          devicePath: promotedDevicePath,
          digestPath: promotedDigestPath,
          fileSystem: syncFailingFileSystem,
          quiet: true,
        }),
      /injected parent directory sync failure/,
    );
    assert.ok(fs.readFileSync(promotedDevicePath).equals(previousDevice));
    assert.ok(fs.readFileSync(promotedDigestPath).equals(previousDigest));
    assert.equal(fs.existsSync(lockPathFor(canonicalPromotedDevicePath)), false);

    const releaseLock = lockPathFor(canonicalPromotedDevicePath);
    fs.writeFileSync(releaseLock, "simulated concurrent finalizer\n");
    assert.throws(
      () =>
        finalizeMaxRelease({
          candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          devicePath: promotedDevicePath,
          digestPath: promotedDigestPath,
          quiet: true,
        }),
      /Another release finalization is active/,
    );
    assert.ok(fs.readFileSync(promotedDevicePath).equals(previousDevice));
    assert.ok(fs.readFileSync(promotedDigestPath).equals(previousDigest));
    fs.rmSync(releaseLock);

    let tamperInstalledDigest = true;
    const tamperingFileSystem = Object.create(fs);
    tamperingFileSystem.renameSync = (source, destination) => {
      fs.renameSync(source, destination);
      if (destination === canonicalPromotedDigestPath && tamperInstalledDigest) {
        tamperInstalledDigest = false;
        fs.writeFileSync(destination, "tampered after atomic rename\n");
      }
    };
    assert.throws(
      () =>
        finalizeMaxRelease({
          candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          devicePath: promotedDevicePath,
          digestPath: promotedDigestPath,
          fileSystem: tamperingFileSystem,
          quiet: true,
        }),
      /failed their final recheck/,
    );
    assert.ok(fs.readFileSync(promotedDevicePath).equals(previousDevice));
    assert.ok(fs.readFileSync(promotedDigestPath).equals(previousDigest));
    assert.equal(fs.existsSync(releaseLock), false);
    assert.equal(
      fs
        .readdirSync(path.dirname(promotedDevicePath))
        .some((name) => name.includes(".tmp-")),
      false,
    );

    const promotion = finalizeMaxRelease({
      candidatePath,
      projectDirectory,
      bundlePath: dummyBundle,
      devicePath: promotedDevicePath,
      digestPath: promotedDigestPath,
      quiet: true,
    });
    assert.equal(promotion.promoted, true);
    assert.equal(promotion.candidateValidation.canonicalAssetCount, expectedNames.size);
    assert.ok(fs.readFileSync(promotedDevicePath).equals(candidate));
    assert.equal(
      fs.readFileSync(promotedDigestPath, "utf8"),
      `${promotion.digest}  MIDIjourney.amxd\n`,
    );

    const promotedBeforeFailure = fs.readFileSync(promotedDevicePath);
    fs.appendFileSync(candidatePath, "not a frozen candidate");
    assert.throws(
      () =>
        finalizeMaxRelease({
          candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          devicePath: promotedDevicePath,
          digestPath: promotedDigestPath,
          quiet: true,
        }),
      /length|metadata|archive|AMXD/i,
    );
    assert.ok(fs.readFileSync(promotedDevicePath).equals(promotedBeforeFailure));
    fs.writeFileSync(candidatePath, candidate);

    const stagedPatcher = path.join(projectDirectory, "patchers", "mj_route.maxpat");
    const originalPatcher = fs.readFileSync(stagedPatcher);
    fs.appendFileSync(stagedPatcher, "\n");
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /does not contain the staged bytes for patchers\/mj_route\.maxpat/,
    );
    fs.writeFileSync(stagedPatcher, originalPatcher);

    fs.appendFileSync(stagedPatcher, "\n");
    buildSyntheticFrozenCandidate(projectDirectory);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /staged assets does not match its expected digests/,
    );
    fs.writeFileSync(stagedPatcher, originalPatcher);
    fs.writeFileSync(candidatePath, candidate);

    const wrongBundle = path.join(temporaryRoot, "wrong-runtime.js");
    fs.writeFileSync(wrongBundle, "// deliberately not the release bundle\n");
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: wrongBundle,
          quiet: true,
        }),
      /runtime does not match the current release bundle/,
    );

    const linkedBundle = path.join(temporaryRoot, "linked-runtime.js");
    fs.symlinkSync(dummyBundle, linkedBundle);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: linkedBundle,
          quiet: true,
        }),
      /Current release bundle must not be a symbolic link/,
    );

    const inspection = inspectFrozenAmxd(candidate);
    const outerTypeMutation = Buffer.from(candidate);
    outerTypeMutation.write("iiii", 8, "ascii");
    assert.throws(
      () => inspectFrozenAmxd(outerTypeMutation),
      /unexpected Max container metadata/,
    );
    const outerMetadataMutation = Buffer.from(candidate);
    outerMetadataMutation.write("xxxx", 12, "ascii");
    assert.throws(
      () => inspectFrozenAmxd(outerMetadataMutation),
      /unexpected Max container metadata/,
    );
    const marker = Buffer.from("MIDIjourney_E2E_TEST_ONLY");
    const markedCandidate = Buffer.concat([
      candidate.subarray(0, inspection.validation.zipOffset),
      marker,
      candidate.subarray(inspection.validation.zipOffset),
    ]);
    markedCandidate.writeUInt32LE(markedCandidate.length - 32, 28);
    fs.writeFileSync(candidatePath, markedCandidate);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /contains a test-only E2E hook/,
    );
    fs.writeFileSync(candidatePath, candidate);

    const activeMutation = Buffer.from(candidate);
    const activeNeedle = Buffer.from("route auth cancel");
    const activeOffset = activeMutation.indexOf(activeNeedle, 32);
    assert.ok(activeOffset > 32 && activeOffset < inspection.validation.zipOffset);
    Buffer.from("route xxxx cancel").copy(activeMutation, activeOffset);
    fs.writeFileSync(candidatePath, activeMutation);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active top-level graph does not match/,
    );
    fs.writeFileSync(candidatePath, candidate);

    buildSyntheticFrozenCandidate(projectDirectory, {
      mutateDocuments(documents) {
        const connect = documents[0].patcher.boxes.find(
          ({ box }) => box.id === "obj-pollinations-connect",
        )?.box;
        assert.ok(connect);
        connect.texton = "Broken connection state";
      },
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active top-level graph does not match/,
    );
    fs.writeFileSync(candidatePath, candidate);

    buildSyntheticFrozenCandidate(projectDirectory, {
      mutateDocuments(documents) {
        const create = documents[0].patcher.boxes.find(
          ({ box }) => box.id === "obj-33",
        )?.box;
        assert.ok(create);
        create.parameter_enable = 1;
      },
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active top-level graph does not match/,
    );
    fs.writeFileSync(candidatePath, candidate);

    buildSyntheticFrozenCandidate(projectDirectory, {
      mutateDocuments(documents) {
        documents[0].patcher.project.devpath = "unexpected-active-project-state";
        const connect = documents[0].patcher.boxes.find(
          ({ box }) => box.id === "obj-pollinations-connect",
        )?.box;
        assert.ok(connect);
        connect.args = ["unexpected-active-object-state"];
      },
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active top-level graph does not match/,
    );
    fs.writeFileSync(candidatePath, candidate);

    buildSyntheticFrozenCandidate(projectDirectory, {
      mutateDocuments(documents) {
        documents[0].patcher.lines[0].patchline.disabled = 1;
      },
    });
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active top-level graph does not match/,
    );
    fs.writeFileSync(candidatePath, candidate);

    const dependencyMutation = Buffer.from(candidate);
    const dependencyNeedle = Buffer.from("routepass #1");
    const dependencyOffset = dependencyMutation.indexOf(dependencyNeedle, 32);
    assert.ok(
      dependencyOffset > 32 && dependencyOffset < inspection.validation.zipOffset,
    );
    Buffer.from("routepass #x").copy(dependencyMutation, dependencyOffset);
    fs.writeFileSync(candidatePath, dependencyMutation);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /active dependency metadata is stale or unexpected/,
    );
    fs.writeFileSync(candidatePath, candidate);

    const centralMutation = Buffer.from(candidate);
    const centralOffset = centralMutation.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(centralOffset > 0);
    centralMutation[centralOffset + 46] ^= 1;
    assert.throws(
      () => inspectFrozenAmxd(centralMutation),
      /ZIP index contains an inconsistent entry/,
    );

    const flagsMutation = Buffer.from(candidate);
    flagsMutation.writeUInt16LE(2, inspection.validation.zipOffset + 6);
    assert.throws(
      () => inspectFrozenAmxd(flagsMutation),
      /ZIP entries use unsupported flags/,
    );

    const symlinkAttributeMutation = Buffer.from(candidate);
    symlinkAttributeMutation.writeUInt16LE(0x0315, centralOffset + 4);
    symlinkAttributeMutation.writeUInt32LE(0xa1ff0000, centralOffset + 38);
    assert.throws(
      () => inspectFrozenAmxd(symlinkAttributeMutation),
      /ZIP index has unsupported file attributes/,
    );

    const footerMutation = Buffer.from(candidate);
    const footerOffset = footerMutation.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(footerOffset > 0);
    footerMutation.writeUInt16LE(0xffff, footerOffset + 20);
    assert.throws(
      () => inspectFrozenAmxd(footerMutation),
      /ZIP footer comments are unsupported/,
    );

    const indexOffsetMutation = Buffer.from(candidate);
    indexOffsetMutation.writeUInt32LE(
      indexOffsetMutation.readUInt32LE(footerOffset + 16) + 1,
      footerOffset + 16,
    );
    assert.throws(
      () => inspectFrozenAmxd(indexOffsetMutation),
      /ZIP index does not match its local entries/,
    );

    const bombMutation = Buffer.from(deflated.candidate);
    bombMutation.writeUInt32LE(1, deflatedInspection.validation.zipOffset + 22);
    assert.throws(
      () => inspectFrozenAmxd(bombMutation),
      /ZIP entry cannot be decoded/,
    );

    const oversizedEntryMutation = Buffer.from(deflated.candidate);
    oversizedEntryMutation.writeUInt32LE(
      MAX_ZIP_ENTRY_BYTES + 1,
      deflatedInspection.validation.zipOffset + 22,
    );
    assert.throws(
      () => inspectFrozenAmxd(oversizedEntryMutation),
      /ZIP entry exceeds the uncompressed size limit/,
    );

    const nativeHeaderMutation = Buffer.from(candidate);
    nativeHeaderMutation.writeUInt32BE(
      nativeHeaderMutation.readUInt32BE(inspection.validation.zipTailOffset + 4) - 4,
      inspection.validation.zipTailOffset + 4,
    );
    assert.throws(
      () => inspectFrozenAmxd(nativeHeaderMutation),
      /native dependency directory has an invalid header/,
    );

    const metadataHeaderMutation = Buffer.from(candidate);
    metadataHeaderMutation.writeUInt32BE(
      metadataHeaderMutation.readUInt32BE(44) + 1,
      44,
    );
    assert.throws(
      () => inspectFrozenAmxd(metadataHeaderMutation),
      /invalid Max metadata directory header/,
    );

    const nativeFlagMutation = Buffer.from(candidate);
    const firstNativeFlag = nativeFlagMutation.indexOf(
      Buffer.from("flag"),
      inspection.validation.zipTailOffset,
    );
    assert.ok(firstNativeFlag > inspection.validation.zipTailOffset);
    nativeFlagMutation.writeUInt32BE(0, firstNativeFlag + 8);
    assert.throws(
      () => inspectFrozenAmxd(nativeFlagMutation),
      /native dependency directory has unexpected record flags/,
    );

    const nativeOffsetMutation = Buffer.from(candidate);
    const folderNameOffset = nativeOffsetMutation.indexOf(
      Buffer.from("node_content/zipfolder"),
      inspection.validation.zipTailOffset,
    );
    const folderOffsetField = nativeOffsetMutation.indexOf(
      Buffer.from("of32"),
      folderNameOffset,
    );
    assert.ok(folderNameOffset > inspection.validation.zipTailOffset);
    assert.ok(folderOffsetField > folderNameOffset);
    nativeOffsetMutation.writeUInt32BE(
      nativeOffsetMutation.readUInt32BE(folderOffsetField + 8) + 1,
      folderOffsetField + 8,
    );
    assert.throws(
      () => inspectFrozenAmxd(nativeOffsetMutation),
      /native dependency directory has stale ZIP offsets/,
    );

    const realCandidatePath = path.join(projectDirectory, "Real Candidate.amxd");
    fs.renameSync(candidatePath, realCandidatePath);
    fs.symlinkSync(realCandidatePath, candidatePath);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /must not be a symbolic link/,
    );
    fs.rmSync(candidatePath);
    fs.renameSync(realCandidatePath, candidatePath);

    const linkedProjectPath = path.join(temporaryRoot, "Linked Release Project");
    fs.symlinkSync(projectDirectory, linkedProjectPath);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: path.join(linkedProjectPath, canonicalCandidateName),
          projectDirectory: linkedProjectPath,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /staging project must not be a symbolic link/,
    );
    fs.rmSync(linkedProjectPath);

    const stagedPatcherTarget = `${stagedPatcher}.real`;
    fs.renameSync(stagedPatcher, stagedPatcherTarget);
    fs.symlinkSync(stagedPatcherTarget, stagedPatcher);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /must not use symbolic links/,
    );
    fs.rmSync(stagedPatcher);
    fs.renameSync(stagedPatcherTarget, stagedPatcher);

    const projectFilePath = path.join(projectDirectory, "MIDIjourney V3 Release.maxproj");
    const originalProjectFile = fs.readFileSync(projectFilePath);
    fs.appendFileSync(projectFilePath, "\n");
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /Release staging project file does not match its expected digests/,
    );
    fs.writeFileSync(projectFilePath, originalProjectFile);

    const manifestPath = path.join(projectDirectory, STAGING_MANIFEST_NAME);
    const originalManifest = fs.readFileSync(manifestPath);
    const staleManifest = JSON.parse(originalManifest);
    staleManifest.sourceInputs[0].sha256 = "0".repeat(64);
    fs.writeFileSync(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /source inputs does not match/,
    );
    fs.writeFileSync(manifestPath, originalManifest);

    const wrongCandidateManifest = JSON.parse(originalManifest);
    wrongCandidateManifest.project.candidateName = "Different Candidate.amxd";
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(wrongCandidateManifest, null, 2)}\n`,
    );
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          quiet: true,
        }),
      /manifest does not describe the canonical release project/,
    );
    fs.writeFileSync(manifestPath, originalManifest);

    const changedSourcePath = path.join(temporaryRoot, "Changed Source.amxd");
    const changedSourceDocument = readStagingDevice(
      path.join(root, "MIDIjourney.source.amxd"),
    );
    const sourceHeader = Buffer.from(
      fs.readFileSync(path.join(root, "MIDIjourney.source.amxd")).subarray(0, 32),
    );
    const changedSourceJson = Buffer.from(
      `${JSON.stringify(changedSourceDocument)}\n\0`,
      "utf8",
    );
    sourceHeader.writeUInt32LE(changedSourceJson.length, 28);
    fs.writeFileSync(
      changedSourcePath,
      Buffer.concat([sourceHeader, changedSourceJson]),
    );
    assert.throws(
      () =>
        verifyMaxReleaseCandidate({
          devicePath: candidatePath,
          projectDirectory,
          bundlePath: dummyBundle,
          sourcePath: changedSourcePath,
          quiet: true,
        }),
      /source inputs does not match its expected digests/,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function testSafeConnectHarness() {
  const sourceDevicePath = path.join(root, "MIDIjourney.source.amxd");
  const previousConnect = process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
  const previousNoStatus = process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
  try {
    process.env.MIDIJOURNEY_MAX_E2E_CONNECT = "1";
    delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
    const instrumented = synchronize(readStagingDevice(sourceDevicePath));
    const patcher = instrumented.patcher;
    const boxes = Object.fromEntries(
      (patcher.boxes || []).map(({ box }) => [box.id, box]),
    );
    const journeyBox = (patcher.boxes || []).find(
      ({ box }) => box.maxclass === "newobj" && box.text === "p midiJourney",
    )?.box;
    const journey = journeyBox?.patcher;
    const journeyBoxes = Object.fromEntries(
      (journey?.boxes || []).map(({ box }) => [box.id, box]),
    );
    const node = (journey?.boxes || []).find(
      ({ box }) => box.maxclass === "newobj" && box.text === "mj_nodeJS",
    )?.box;
    assert.equal(
      journeyBoxes["obj-pollinations-auth-status-load"]?.text,
      "live.thisdevice",
    );
    assert.equal(
      journeyBoxes["obj-pollinations-auth-status-load"]?.numoutlets,
      3,
    );
    assert.deepEqual(
      journeyBoxes["obj-pollinations-auth-status-load"]?.outlettype,
      ["bang", "int", "int"],
    );
    assert.equal(
      journeyBoxes["obj-pollinations-auth-status-defer"]?.text,
      "deferlow",
    );
    assert.equal(
      journeyBoxes["obj-pollinations-auth-status-delay"]?.text,
      "delay 250",
    );
    assert.equal(
      journeyBoxes["obj-pollinations-auth-status-message"]?.text,
      "authStatus",
    );
    assert.equal(boxes["obj-pollinations-connect"]?.active, 1);
    assert.equal(boxes["obj-pollinations-connect"]?.mode, 1);
    assert.equal(boxes["obj-pollinations-connect-filter"], undefined);
    assert.equal(
      boxes["obj-pollinations-status-select"]?.text,
      "route connected offline checking connecting awaiting_approval",
    );
    assert.equal(
      boxes["obj-pollinations-status-connected"]?.text,
      "text Connected, texton Connected, set 0, active 1",
    );
    assert.equal(
      boxes["obj-pollinations-status-pending"]?.text,
      "text Connecting..., texton Connecting..., set 0, active 0",
    );
    assert.equal(
      boxes["obj-pollinations-status-disconnected"]?.text,
      "text Connect, texton Connect, set 0, active 1",
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-connect",
        "obj-pollinations-toggle-message",
      ),
    );
    assert.ok(
      hasLine(
        journey,
        "obj-pollinations-auth-status-load",
        "obj-pollinations-auth-status-defer",
      ),
    );
    assert.ok(
      hasLine(
        journey,
        "obj-pollinations-auth-status-defer",
        "obj-pollinations-auth-status-delay",
      ),
    );
    assert.ok(
      hasLine(
        journey,
        "obj-pollinations-auth-status-delay",
        "obj-pollinations-auth-status-message",
      ),
    );
    assert.ok(
      hasLine(
        journey,
        "obj-pollinations-auth-status-message",
        node.id,
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-status-select",
        "obj-pollinations-status-pending",
        2,
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-status-select",
        "obj-pollinations-status-pending",
        3,
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-status-select",
        "obj-pollinations-status-pending",
        4,
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-status-pending",
        "obj-pollinations-connect",
      ),
    );
    assert.equal(boxes["obj-pollinations-e2e-load"], undefined);
    assert.equal(
      boxes["obj-pollinations-e2e-disconnected"]?.text,
      "sel disconnected",
    );
    assert.equal(boxes["obj-pollinations-e2e-onebang"]?.text, "onebang 1");
    assert.equal(boxes["obj-pollinations-e2e-delay"]?.text, "delay 250");
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-status-unpack",
        "obj-pollinations-e2e-disconnected",
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-e2e-disconnected",
        "obj-pollinations-e2e-onebang",
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-e2e-onebang",
        "obj-pollinations-e2e-delay",
      ),
    );
    assert.ok(
      hasLine(
        patcher,
        "obj-pollinations-e2e-delay",
        "obj-pollinations-connect",
      ),
    );
    assert.equal(
      (patcher.lines || []).some(
        ({ patchline }) =>
          patchline.source[0] === "obj-pollinations-e2e-disconnected" &&
          patchline.source[1] === 1,
      ),
      false,
    );

    delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    const cleaned = synchronize(instrumented);
    assert.equal(JSON.stringify(cleaned).includes("MIDIjourney_E2E_"), false);
    assert.equal(JSON.stringify(cleaned).includes("obj-pollinations-e2e-"), false);

    process.env.MIDIJOURNEY_MAX_E2E_CONNECT = "1";
    process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS = "1";
    assert.throws(
      () => synchronize(readStagingDevice(sourceDevicePath)),
      /requires authorization status wiring/,
    );
  } finally {
    if (previousConnect === undefined) delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    else process.env.MIDIJOURNEY_MAX_E2E_CONNECT = previousConnect;
    if (previousNoStatus === undefined) {
      delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
    } else {
      process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS = previousNoStatus;
    }
  }
}

function testDeterministicClipHarness() {
  const sourceDevicePath = path.join(root, "MIDIjourney.source.amxd");
  const previousClip = process.env.MIDIJOURNEY_MAX_E2E_CLIP;
  const previousConnect = process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
  const previousNoStatus = process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
  const id = (suffix) => `obj-pollinations-e2e-clip-${suffix}`;
  try {
    process.env.MIDIJOURNEY_MAX_E2E_CLIP = "1";
    delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
    const instrumented = synchronize(readStagingDevice(sourceDevicePath));
    assertPatcherIntegrity(instrumented.patcher);
    const rootPatcher = instrumented.patcher;
    const rootBoxes = Object.fromEntries(
      (rootPatcher.boxes || []).map(({ box }) => [box.id, box]),
    );
    assert.equal(rootBoxes["obj-33"]?.mode, 1);
    const journeyBox = Object.values(rootBoxes).find(
      (box) => box.text === "p midiJourney",
    );
    assert.ok(journeyBox?.patcher);
    const journey = journeyBox.patcher;
    const boxes = Object.fromEntries(
      (journey.boxes || []).map(({ box }) => [box.id, box]),
    );

    assert.equal(boxes[id("track-path")]?.text, "live.path live_set tracks 0");
    assert.equal(
      boxes[id("slot-path")]?.text,
      "live.path live_set tracks 0 clip_slots 0",
    );
    assert.equal(boxes[id("track-midi")]?.text, "mj_getFromId has_midi_input");
    assert.equal(boxes[id("slot-clip")]?.text, "mj_getFromId clip");
    assert.equal(boxes[id("live-version")]?.text, "liveVersion 1");
    assert.equal(boxes[id("result-filter")]?.text, "routepass dictionary");
    assert.equal(boxes[id("query-notes")]?.text, "call get_all_notes_extended");
    assert.equal(boxes[id("notes-getsize")]?.text, "getsize notes");
    assert.equal(boxes[id("verify-object")]?.saved_object_attributes?._persistence, 0);

    const fixture = JSON.parse(JSON.parse(boxes[id("fixture-message")].text));
    assert.equal(fixture.title, "MIDIjourney E2E");
    assert.equal(fixture.duration, 4);
    assert.equal(fixture.color, 5111762);
    assert.deepEqual(
      fixture.notes.map(({ pitch, start_time, duration }) => [
        pitch,
        start_time,
        duration,
      ]),
      [
        [60, 0, 1],
        [63, 1, 1],
        [67, 2, 1],
        [72, 3, 1],
      ],
    );

    // live.path emits while resolving at load. Closed gates prevent that
    // unsolicited traffic from running the test before the delayed request;
    // each response closes its own gate before continuing.
    assert.equal(boxes[id("track-gate")]?.text, "gate 1 0");
    assert.equal(boxes[id("slot-gate")]?.text, "gate 1 0");
    assert.ok(hasLine(journey, id("onebang"), id("track-start")));
    assert.ok(hasLine(journey, id("track-start"), id("track-gate"), 1, 0));
    assert.ok(hasLine(journey, id("track-start"), id("track-path"), 0, 0));
    assert.ok(hasLine(journey, id("track-path"), id("track-gate"), 0, 1));
    assert.ok(hasLine(journey, id("track-gate"), id("track-gate-close"), 0, 0));
    assert.ok(hasLine(journey, id("track-gate-close"), id("track-gate"), 1, 0));
    assert.ok(hasLine(journey, id("track-gate-close"), id("track-route"), 0, 0));
    assert.ok(hasLine(journey, id("track-midi-select"), id("slot-start"), 0, 0));
    assert.ok(hasLine(journey, id("slot-start"), id("slot-gate"), 1, 0));
    assert.ok(hasLine(journey, id("slot-start"), id("slot-path"), 0, 0));
    assert.ok(hasLine(journey, id("slot-path"), id("slot-gate"), 0, 1));
    assert.ok(hasLine(journey, id("slot-gate"), id("slot-gate-close"), 0, 0));
    assert.ok(hasLine(journey, id("slot-gate-close"), id("slot-gate"), 1, 0));
    assert.ok(hasLine(journey, id("slot-gate-close"), id("slot-route"), 0, 0));
    for (const pathId of [id("track-path"), id("slot-path")]) {
      assert.equal(
        (journey.lines || []).some(
          ({ patchline }) => patchline.source[0] === pathId && patchline.source[1] !== 0,
        ),
        false,
      );
    }

    // The fixture can enter the production pipeline only after the absolute
    // target exists, belongs to a MIDI track, and reports clip id 0.
    assert.ok(hasLine(journey, id("track-route"), id("track-missing"), 0, 0));
    assert.ok(hasLine(journey, id("track-missing"), id("track-id"), 1, 0));
    assert.ok(hasLine(journey, id("track-id"), id("track-midi")));
    assert.ok(hasLine(journey, id("slot-route"), id("slot-missing"), 0, 0));
    assert.ok(hasLine(journey, id("slot-missing"), id("slot-id"), 1, 0));
    assert.ok(hasLine(journey, id("slot-trigger"), id("slot-symbol"), 1, 0));
    assert.ok(hasLine(journey, id("slot-trigger"), id("slot-clip"), 0, 0));
    assert.ok(hasLine(journey, id("slot-clip"), id("existing-route")));
    assert.ok(hasLine(journey, id("existing-route"), id("empty-select"), 0, 0));
    assert.ok(hasLine(journey, id("empty-select"), id("run"), 0, 0));
    assert.ok(hasLine(journey, id("empty-select"), id("abort-occupied"), 1, 0));
    assert.equal(
      (journey.lines || []).filter(
        ({ patchline }) =>
          patchline.destination[0] === id("run") && patchline.destination[1] === 0,
      ).length,
      1,
    );
    assert.ok(hasLine(journey, id("run"), id("live-version"), 1, 0));
    assert.ok(hasLine(journey, id("live-version"), "obj-22"));
    assert.ok(hasLine(journey, id("run"), id("fixture-dict"), 0, 0));
    assert.ok(hasLine(journey, id("fixture-dict"), "obj-22"));
    assert.deepEqual(
      (journey.lines || [])
        .filter(
          ({ patchline }) =>
            patchline.destination[0] === "obj-22" &&
            patchline.source[0].startsWith(`${id("")}`),
        )
        .map(({ patchline }) => patchline.source[0])
        .sort(),
      [id("fixture-dict"), id("live-version")].sort(),
    );

    // Verification starts from mj_clipFill's completion dictionary and joins
    // the two real LOM responses before printing PASS or FAIL.
    assert.ok(hasLine(journey, "obj-245", id("result-filter")));
    assert.ok(hasLine(journey, id("result-filter"), id("detail-reader"), 0, 0));
    assert.ok(hasLine(journey, id("detail-reader"), id("detail-fromsymbol"), 1, 0));
    assert.ok(hasLine(journey, id("verify-trigger"), id("verify-object"), 1, 1));
    assert.ok(hasLine(journey, id("query-length"), id("verify-object")));
    assert.ok(hasLine(journey, id("query-notes"), id("verify-object")));
    assert.ok(hasLine(journey, id("response-route"), id("length-check"), 0, 0));
    assert.ok(hasLine(journey, id("response-route"), id("notes-trigger"), 1, 0));
    assert.ok(hasLine(journey, id("notes-size-route"), id("count-check"), 0, 0));
    assert.ok(hasLine(journey, id("length-check"), id("assertions"), 0, 0));
    assert.ok(hasLine(journey, id("count-check"), id("assertions"), 0, 1));
    assert.ok(hasLine(journey, id("assertions"), id("assertion-pack"), 1, 1));
    assert.ok(hasLine(journey, id("assertions"), id("assertion-pack"), 0, 0));
    assert.equal(boxes[id("assertion-check")]?.text, "zl.sum");
    assert.equal(boxes[id("pass-select")]?.text, "sel 2");
    assert.equal(
      boxes[id("pass-message")]?.text,
      "PASS track=1 scene=1 notes=4 duration=4",
    );

    delete process.env.MIDIJOURNEY_MAX_E2E_CLIP;
    const cleaned = synchronize(instrumented);
    assertPatcherIntegrity(cleaned.patcher);
    const serializedCleaned = JSON.stringify(cleaned);
    assert.equal(serializedCleaned.includes("MIDIjourney_E2E_"), false);
    assert.equal(serializedCleaned.includes("obj-pollinations-e2e-"), false);
    const cleanedRootBoxes = Object.fromEntries(
      (cleaned.patcher.boxes || []).map(({ box }) => [box.id, box]),
    );
    assert.equal(cleanedRootBoxes["obj-33"]?.mode, 1);
  } finally {
    if (previousClip === undefined) delete process.env.MIDIJOURNEY_MAX_E2E_CLIP;
    else process.env.MIDIJOURNEY_MAX_E2E_CLIP = previousClip;
    if (previousConnect === undefined) delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    else process.env.MIDIJOURNEY_MAX_E2E_CONNECT = previousConnect;
    if (previousNoStatus === undefined) {
      delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
    } else {
      process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS = previousNoStatus;
    }
  }
}

function testProviderClipHarness() {
  const sourceDevicePath = path.join(root, "MIDIjourney.source.amxd");
  const previousProvider = process.env.MIDIJOURNEY_MAX_E2E_PROVIDER;
  const previousClip = process.env.MIDIJOURNEY_MAX_E2E_CLIP;
  const previousConnect = process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
  const previousNoStatus = process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
  const id = (suffix) => `obj-pollinations-e2e-provider-${suffix}`;
  try {
    process.env.MIDIJOURNEY_MAX_E2E_PROVIDER = "1";
    delete process.env.MIDIJOURNEY_MAX_E2E_CLIP;
    delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;

    const instrumented = synchronize(readStagingDevice(sourceDevicePath));
    assertPatcherIntegrity(instrumented.patcher);
    const rootPatcher = instrumented.patcher;
    const rootBoxes = Object.fromEntries(
      (rootPatcher.boxes || []).map(({ box }) => [box.id, box]),
    );
    const preferences = Object.values(rootBoxes).find(
      (box) => box.maxclass === "bpatcher" && box.name === "mj_bp_preferences.maxpat",
    );
    const journeyBox = Object.values(rootBoxes).find(
      (box) => box.text === "p midiJourney",
    );
    assert.ok(preferences);
    assert.ok(journeyBox?.patcher);
    const journey = journeyBox.patcher;
    const boxes = Object.fromEntries(
      (journey.boxes || []).map(({ box }) => [box.id, box]),
    );
    const node = Object.values(boxes).find(
      (box) => box.maxclass === "newobj" && box.text === "mj_nodeJS",
    );
    const authRoute = boxes["obj-pollinations-auth-route"];
    const authPrepend = boxes["obj-pollinations-auth-prepend"];
    const cancelMessage = boxes["obj-pollinations-cancel-message"];
    const start = Object.values(boxes).find(
      (box) => box.maxclass === "bpatcher" && box.name === "mj_bp_start.maxpat",
    );
    const promptOutlet = Object.values(boxes).find(
      (box) => box.maxclass === "outlet" && box.index === 2,
    );
    assert.ok(node);
    assert.ok(authRoute);
    assert.ok(authPrepend);
    assert.ok(cancelMessage);
    assert.ok(start);
    assert.ok(promptOutlet);

    // Auth state, cancellation, and generated dictionaries share the Node
    // abstraction's original, proven outlet. The embedded route separates
    // them before any pipeline sees the wrong message. Authorization then
    // reuses the parent subpatcher's established dictionary outlet instead
    // of relying on a newly-added third outlet that Max did not expose
    // reliably after freezing.
    assert.equal(node.numoutlets, 1);
    assert.equal(node.outlettype?.length, 1);
    assert.equal(authRoute.text, "route auth cancel");
    assert.equal(authRoute.numinlets, 3);
    assert.equal(authRoute.numoutlets, 3);
    assert.equal(cancelMessage.text, "cancel");
    assert.equal(authPrepend.text, "prepend auth");
    assert.ok(hasLine(journey, node.id, authRoute.id, 0, 0));
    assert.ok(hasLine(journey, authRoute.id, authPrepend.id, 0, 0));
    assert.ok(hasLine(journey, authPrepend.id, promptOutlet.id, 0, 0));
    assert.ok(hasLine(journey, authRoute.id, cancelMessage.id, 1, 0));
    assert.ok(hasLine(journey, cancelMessage.id, start.id, 0, 0));
    assert.ok(hasLine(journey, authRoute.id, "obj-22", 2, 0));
    assert.equal(hasLine(journey, node.id, "obj-22", 0, 0), false);
    assert.equal(
      (journey.lines || []).filter(
        ({ patchline }) => patchline.source[0] === node.id,
      ).length,
      1,
    );
    assert.deepEqual(
      (journey.lines || [])
        .filter(({ patchline }) => patchline.source[0] === authRoute.id)
        .map(({ patchline }) => [patchline.source[1], patchline.destination[0]])
        .sort(),
      [
        [0, authPrepend.id],
        [0, id("auth-state")],
        [1, cancelMessage.id],
        [2, "obj-22"],
      ].sort(),
    );
    assert.equal(
      (journey.lines || []).some(
        ({ patchline }) =>
          patchline.source[0] === node.id && patchline.source[1] !== 0,
      ),
      false,
    );

    // Authorization is read-only for this harness: a nested loadbang requests
    // settled status through the real Node command path and starts a bounded
    // timeout in the same patcher. Only `connected` can run.
    assert.equal(boxes[id("auth-state")]?.text, "sel connected");
    assert.equal(boxes[id("auth-timeout")]?.text, "delay 15000");
    assert.equal(boxes[id("auth-candidate")]?.text, "t b s");
    assert.equal(boxes[id("auth-race")]?.text, "onebang 1");
    assert.equal(boxes[id("auth-register")]?.text, "zl.reg");
    assert.equal(boxes[id("auth-result")]?.text, "sel connected timeout");
    assert.ok(hasLine(journey, authRoute.id, id("auth-state"), 0, 0));
    assert.equal(hasLine(journey, node.id, id("auth-state"), 0, 0), false);
    assert.ok(hasLine(journey, id("auth-state"), id("connected-message"), 0, 0));
    assert.ok(hasLine(journey, id("auth-query-start"), id("auth-timeout"), 1, 0));
    assert.ok(hasLine(journey, id("connected-message"), id("auth-candidate")));
    assert.ok(hasLine(journey, id("auth-timeout"), id("timeout-message")));
    assert.ok(hasLine(journey, id("timeout-message"), id("auth-candidate")));
    // Both symbols are stored before their bang reaches onebang. Only the
    // winning bang recalls its saved symbol, so auth-result never sees a bare
    // bang and the losing outcome cannot produce a second result.
    assert.ok(
      hasLine(journey, id("auth-candidate"), id("auth-register"), 1, 1),
    );
    assert.ok(hasLine(journey, id("auth-candidate"), id("auth-race"), 0, 0));
    assert.ok(hasLine(journey, id("auth-race"), id("auth-register"), 0, 0));
    assert.ok(hasLine(journey, id("auth-register"), id("auth-result"), 0, 0));
    assert.equal(
      hasLine(journey, id("connected-message"), id("auth-race")),
      false,
    );
    assert.equal(hasLine(journey, id("timeout-message"), id("auth-race")), false);
    assert.equal(hasLine(journey, id("auth-race"), id("auth-result")), false);
    assert.ok(hasLine(journey, id("auth-result"), id("initialize"), 0, 0));
    assert.ok(hasLine(journey, id("initialize"), id("start-delay"), 0, 0));
    assert.ok(hasLine(journey, id("auth-result"), id("abort-auth"), 1, 0));
    assert.equal(
      (journey.lines || []).some(
        ({ patchline }) =>
          patchline.source[0] === id("auth-state") && patchline.source[1] === 1,
      ),
      false,
    );
    assert.equal(
      (journey.lines || []).some(
        ({ patchline }) =>
          patchline.source[0] === id("auth-result") && patchline.source[1] === 2,
      ),
      false,
    );
    const providerHarnessIds = new Set(
      Object.keys(boxes).filter((boxId) => boxId.startsWith(id(""))),
    );
    assert.equal(
      Object.values(boxes).some(
        (box) =>
          providerHarnessIds.has(box.id) &&
          ["connect", "toggleConnection", "disconnect"].includes(box.text),
      ),
      false,
    );
    assert.equal(
      (journey.lines || []).some(
        ({ patchline }) =>
          providerHarnessIds.has(patchline.source[0]) &&
          patchline.destination[0] === "obj-pollinations-connect",
      ),
      false,
    );

    // The absolute target is Track 1 / Scene 2. Startup live.path traffic is
    // blocked, and both the track type and current clip id gate the request.
    assert.equal(boxes[id("track-path")]?.text, "live.path live_set tracks 0");
    assert.equal(
      boxes[id("slot-path")]?.text,
      "live.path live_set tracks 0 clip_slots 1",
    );
    assert.equal(boxes[id("track-gate")]?.text, "gate 1 0");
    assert.equal(boxes[id("slot-gate")]?.text, "gate 1 0");
    assert.equal(boxes[id("track-midi")]?.text, "mj_getFromId has_midi_input");
    assert.equal(boxes[id("slot-clip")]?.text, "mj_getFromId clip");
    assert.ok(hasLine(journey, id("track-start"), id("track-gate"), 1, 0));
    assert.ok(hasLine(journey, id("track-start"), id("track-path"), 0, 0));
    assert.ok(hasLine(journey, id("track-path"), id("track-gate"), 0, 1));
    assert.ok(hasLine(journey, id("track-gate"), id("track-gate-close")));
    assert.ok(hasLine(journey, id("track-gate-close"), id("track-gate"), 1, 0));
    assert.ok(hasLine(journey, id("track-midi-select"), id("slot-start"), 0, 0));
    assert.ok(hasLine(journey, id("slot-start"), id("slot-gate"), 1, 0));
    assert.ok(hasLine(journey, id("slot-start"), id("slot-path"), 0, 0));
    assert.ok(hasLine(journey, id("slot-path"), id("slot-gate"), 0, 1));
    assert.ok(hasLine(journey, id("slot-gate"), id("slot-gate-close")));
    assert.ok(hasLine(journey, id("slot-gate-close"), id("slot-gate"), 1, 0));
    for (const pathId of [id("track-path"), id("slot-path")]) {
      assert.equal(
        (journey.lines || []).some(
          ({ patchline }) => patchline.source[0] === pathId && patchline.source[1] !== 0,
        ),
        false,
      );
    }
    assert.ok(hasLine(journey, id("slot-trigger"), id("slot-symbol"), 1, 0));
    assert.ok(hasLine(journey, id("slot-trigger"), id("slot-clip"), 0, 0));
    assert.ok(hasLine(journey, id("existing-route"), id("empty-select"), 0, 0));
    assert.ok(hasLine(journey, id("empty-select"), id("run"), 0, 0));
    assert.ok(hasLine(journey, id("empty-select"), id("abort-occupied"), 1, 0));
    assert.equal(
      (journey.lines || []).filter(
        ({ patchline }) =>
          patchline.destination[0] === id("run") && patchline.destination[1] === 0,
      ).length,
      1,
    );

    // The machine supplies only the fixed prompt/target data. It then enters
    // the real production path at the preferences inlet used by Text Prompt.
    const fixture = JSON.parse(JSON.parse(boxes[id("fixture-message")].text));
    assert.equal(fixture.duration, 4);
    assert.equal(fixture.e2eProviderRun, 1);
    assert.equal(fixture.gptModel, "openai");
    assert.equal(fixture.historyStatus, 0);
    assert.equal(fixture.liveVersion, 1);
    assert.equal(fixture.temperature, 0);
    assert.match(fixture.promptText, /four-beat monophonic MIDI clip/);
    assert.equal(fixture.notes, undefined);
    assert.equal(fixture.highlightedSlot, undefined);
    assert.ok(hasLine(journey, id("slot-replace"), id("fixture-dict"), 0, 1));
    assert.ok(hasLine(journey, id("run"), id("fixture-dict"), 0, 0));
    assert.ok(hasLine(journey, id("fixture-dict"), promptOutlet.id, 0, 0));
    const sharedOutputRoute = rootBoxes["obj-pollinations-shared-output-route"];
    assert.equal(sharedOutputRoute?.text, "route auth");
    assert.ok(hasLine(rootPatcher, journeyBox.id, sharedOutputRoute.id, 1, 0));
    assert.ok(hasLine(rootPatcher, sharedOutputRoute.id, preferences.id, 1, 0));
    assert.ok(
      hasLine(
        rootPatcher,
        sharedOutputRoute.id,
        "obj-pollinations-status-unpack",
        0,
        0,
      ),
    );
    assert.equal(
      (journey.lines || []).filter(
        ({ patchline }) => patchline.source[0] === id("fixture-dict"),
      ).length,
      1,
    );

    // Verification begins only after the production fill stage reports its
    // completion and requires both a non-zero length and one or more notes.
    const journeyBoxes = boxes;
    assert.equal(journeyBox.numoutlets, 2);
    assert.deepEqual(journeyBox.outlettype, ["bang", ""]);
    assert.equal(journeyBoxes[id("auth-query-load")]?.text, "loadbang");
    assert.equal(journeyBoxes[id("auth-query-message")]?.text, "authStatus");
    assert.ok(
      hasLine(journey, id("auth-query-load"), id("auth-query-start"), 0, 0),
    );
    assert.ok(
      hasLine(journey, id("auth-query-start"), id("auth-timeout"), 1, 0),
    );
    assert.ok(
      hasLine(journey, id("auth-query-message"), node.id, 0, 0),
    );
    assert.equal(journeyBoxes[id("result-filter")]?.text, "routepass dictionary");
    assert.equal(
      journeyBoxes[id("query-notes")]?.text,
      "call get_all_notes_extended",
    );
    assert.equal(journeyBoxes[id("length-check")]?.text, "expr $f1 > 0.");
    assert.equal(journeyBoxes[id("count-check")]?.text, "> 0");
    assert.equal(journeyBoxes[id("pass-select")]?.text, "sel 2");
    assert.equal(
      journeyBoxes[id("pass-message")]?.text,
      "PASS track=1 scene=2 nonempty_midi_clip",
    );
    assert.equal(
      journeyBoxes[id("verify-object")]?.saved_object_attributes?._persistence,
      0,
    );
    assert.ok(hasLine(journey, "obj-245", id("result-filter")));
    assert.ok(hasLine(journey, id("result-filter"), id("result-trigger"), 0, 0));
    assert.ok(hasLine(journey, id("result-trigger"), id("result-register"), 1, 1));
    assert.ok(hasLine(journey, id("result-trigger"), id("marker-reader"), 0, 0));
    assert.equal(
      journeyBoxes[id("marker-reader")]?.text,
      "mj_getFromDict e2eProviderRun:",
    );
    assert.ok(hasLine(journey, id("marker-reader"), id("marker-select"), 1, 0));
    assert.ok(hasLine(journey, id("marker-select"), id("result-register"), 0, 0));
    assert.ok(hasLine(journey, id("result-register"), id("detail-reader"), 0, 0));
    assert.ok(hasLine(journey, id("verify-trigger"), id("verify-object"), 1, 1));
    assert.ok(hasLine(journey, id("response-route"), id("length-check"), 0, 0));
    assert.ok(hasLine(journey, id("response-route"), id("notes-trigger"), 1, 0));
    assert.ok(hasLine(journey, id("length-check"), id("assertions"), 0, 0));
    assert.ok(hasLine(journey, id("count-check"), id("assertions"), 0, 1));

    delete process.env.MIDIJOURNEY_MAX_E2E_PROVIDER;
    const cleaned = synchronize(instrumented);
    assertPatcherIntegrity(cleaned.patcher);
    const serializedCleaned = JSON.stringify(cleaned);
    assert.equal(serializedCleaned.includes("MIDIjourney_E2E_"), false);
    assert.equal(serializedCleaned.includes("obj-pollinations-e2e-"), false);

    process.env.MIDIJOURNEY_MAX_E2E_PROVIDER = "1";
    process.env.MIDIJOURNEY_MAX_E2E_CLIP = "1";
    assert.throws(
      () => synchronize(readStagingDevice(sourceDevicePath)),
      /cannot run together/,
    );

    delete process.env.MIDIJOURNEY_MAX_E2E_CLIP;
    process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS = "1";
    assert.throws(
      () => synchronize(readStagingDevice(sourceDevicePath)),
      /requires authorization status wiring/,
    );
  } finally {
    if (previousProvider === undefined) {
      delete process.env.MIDIJOURNEY_MAX_E2E_PROVIDER;
    } else {
      process.env.MIDIJOURNEY_MAX_E2E_PROVIDER = previousProvider;
    }
    if (previousClip === undefined) delete process.env.MIDIJOURNEY_MAX_E2E_CLIP;
    else process.env.MIDIJOURNEY_MAX_E2E_CLIP = previousClip;
    if (previousConnect === undefined) delete process.env.MIDIJOURNEY_MAX_E2E_CONNECT;
    else process.env.MIDIJOURNEY_MAX_E2E_CONNECT = previousConnect;
    if (previousNoStatus === undefined) {
      delete process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS;
    } else {
      process.env.MIDIJOURNEY_MAX_E2E_NO_STATUS = previousNoStatus;
    }
  }
}

try {
  testResolvableStaging();
  testBundleFreshnessGate();
  testCacheBustingStagingName();
  testChecksumOnlyFinalization();
  testStrictExternalCandidateVerification();
  testSafeConnectHarness();
  testDeterministicClipHarness();
  testProviderClipHarness();
  process.stdout.write(
    "Max staging manifests, active frozen graphs, ZIP indexes, and rollback-safe file promotion verified.\n",
  );
} catch (error) {
  process.stderr.write(`Max release portability test failed: ${error.message}\n`);
  process.exitCode = 1;
}
