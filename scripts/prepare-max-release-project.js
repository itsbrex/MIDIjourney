#!/usr/bin/env node

// Prepares an ignored Max project whose top-level file is an editable Max
// patcher. Max can then export/freeze that project into the release AMXD.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const devicePath = path.join(root, "MIDIjourney.source.amxd");
const bundlePath = path.join(root, "js", "midiJourney.release.js");
const defaultProjectName = "MIDIjourney V3 Release";
const defaultReleaseRoot = process.env.MIDIJOURNEY_MAX_RELEASE_ROOT
  ? path.resolve(process.env.MIDIJOURNEY_MAX_RELEASE_ROOT)
  : path.join(root, ".release-max-project");
const patcherName = "MIDIjourney V3.maxpat";
const defaultStagingDeviceName = "MIDIjourney V3 Release Candidate.amxd";
const defaultRuntimeName = "midijourney-v3-runtime.js";
const defaultNodePatcherName = "midijourney_v3_release_node.maxpat";
const STAGING_MANIFEST_NAME = "midijourney-release-manifest.json";
const STAGING_MANIFEST_FORMAT = "midijourney-max-release-staging";
const STAGING_MANIFEST_VERSION = 1;
const RELEASE_BUNDLE_SOURCE_PATHS = [
  "js/build-release.js",
  "js/config.js",
  "js/credentialStore.js",
  "js/encoding/midiClip.js",
  "js/history.js",
  "js/maxUtils/max.js",
  "js/midiJourney.js",
  "js/package-lock.json",
  "js/package.json",
  "js/pollinationsAuth.js",
  "js/pollinationsClient.js",
  "js/sanitize.js",
  "js/scaleColors.js",
  "js/system-prompt.md",
  "js/systemPrompt.js",
];
// Max stores the Audio Effect project type as the four-character code "aaaa".
// MIDIjourney intentionally remains an audio device so it can live on Main/Master
// while creating and editing MIDI clips through the Live Object Model.
const AUDIO_EFFECT_AMXD_TYPE = 0x61616161;

function replaceNodeAbstraction(patcher, nodePatcherName) {
  let replaced = false;
  for (const { box } of patcher.boxes || []) {
    if (box.maxclass === "newobj" && box.text === "mj_nodeJS") {
      box.text = path.basename(nodePatcherName, ".maxpat");
      replaced = true;
    }
    if (box.patcher && replaceNodeAbstraction(box.patcher, nodePatcherName)) {
      replaced = true;
    }
  }
  return replaced;
}

function readDevicePatcher(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) {
    throw new Error("MIDIjourney.source.amxd is truncated");
  }
  if (buffer.subarray(0, 4).toString("ascii") !== "ampf") {
    throw new Error("MIDIjourney.source.amxd is not an AMPF container");
  }
  if (buffer.subarray(24, 28).toString("ascii") !== "ptch") {
    throw new Error("MIDIjourney.source.amxd has an unsupported container layout");
  }
  if (
    buffer.readUInt32LE(4) !== 4 ||
    buffer.subarray(8, 12).toString("ascii") !== "aaaa" ||
    buffer.subarray(12, 16).toString("ascii") !== "meta" ||
    buffer.readUInt32LE(16) !== 4 ||
    buffer.readUInt32LE(20) !== 1
  ) {
    throw new Error("MIDIjourney.source.amxd is not a canonical Max Audio Effect source");
  }

  const declaredLength = buffer.readUInt32LE(28);
  if (declaredLength !== buffer.length - 32) {
    throw new Error("MIDIjourney.source.amxd has an invalid patch chunk length");
  }
  return JSON.parse(buffer.subarray(32).toString("utf8").replace(/\0+$/, ""));
}

function writePrivateCopy(contents, destination) {
  fs.writeFileSync(destination, contents, { mode: 0o600 });
  fs.chmodSync(destination, 0o600);
}

function validatedLeafName(value, description, suffix = "") {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length <= suffix.length ||
    value === "." ||
    value === ".." ||
    /[\0-\x1f\x7f]/.test(value) ||
    value !== path.basename(value) ||
    (suffix && !value.endsWith(suffix))
  ) {
    throw new Error(`${description} must be a single${suffix ? ` ${suffix}` : ""} name`);
  }
  return value;
}

function sameFileIdentity(left, right) {
  if (left.ino !== 0n || right.ino !== 0n) {
    return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
  }
  return (
    left.dev === right.dev &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function readStableManifestInput(file, logicalPath) {
  const before = fs.lstatSync(file, { bigint: true });
  if (before.isSymbolicLink()) {
    throw new Error(`Release manifest input must not be a symbolic link: ${logicalPath}`);
  }
  if (!before.isFile()) {
    throw new Error(`Release manifest input is not a file: ${logicalPath}`);
  }

  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new Error(`Release manifest input changed while opening: ${logicalPath}`);
    }
    const buffer = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      !sameFileIdentity(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      BigInt(buffer.length) !== after.size
    ) {
      throw new Error(`Release manifest input changed while reading: ${logicalPath}`);
    }
    return buffer;
  } finally {
    fs.closeSync(descriptor);
  }
}

function digestRecordsOnce(files) {
  const seen = new Set();
  return files
    .map(({ logicalPath, file }) => {
      if (seen.has(logicalPath)) {
        throw new Error(`Duplicate release manifest input ${logicalPath}`);
      }
      seen.add(logicalPath);
      const buffer = readStableManifestInput(file, logicalPath);
      return {
        path: logicalPath,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      };
    })
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
}

function digestRecords(files) {
  const first = digestRecordsOnce(files);
  const second = digestRecordsOnce(files);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("Release manifest inputs changed while their snapshot was created");
  }
  return first;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readExpectedSourceInput(file, logicalPath, expectedDigests) {
  const buffer = readStableManifestInput(file, logicalPath);
  if (expectedDigests.get(logicalPath) !== sha256(buffer)) {
    throw new Error(`Release source changed while staging: ${logicalPath}`);
  }
  return buffer;
}

function releaseBundleSourceFiles(repositoryRoot) {
  const logicalPaths = [...RELEASE_BUNDLE_SOURCE_PATHS];
  if (fs.existsSync(path.join(repositoryRoot, "js", "config.release.js"))) {
    logicalPaths.push("js/config.release.js");
  }
  return logicalPaths.map((logicalPath) => ({
    logicalPath,
    file: path.join(repositoryRoot, ...logicalPath.split("/")),
  }));
}

function releaseSourceInputRecords(
  sourceDevice,
  {
    repositoryRoot = root,
    sourceDeviceFile = devicePath,
    releaseBundleFile = bundlePath,
    prepareScriptFile = __filename,
  } = {},
) {
  const files = [
    { logicalPath: "MIDIjourney.source.amxd", file: sourceDeviceFile },
    { logicalPath: "js/midiJourney.release.js", file: releaseBundleFile },
    {
      logicalPath: "scripts/prepare-max-release-project.js",
      file: prepareScriptFile,
    },
    ...releaseBundleSourceFiles(repositoryRoot),
  ];

  for (const dependency of sourceDevice.patcher?.dependency_cache || []) {
    if (dependency.name === "midiJourney.release.js" && dependency.type === "TEXT") {
      continue;
    }
    if (dependency.type === "JSON" && dependency.name?.endsWith(".maxpat")) {
      validatedLeafName(dependency.name, "release patcher dependency", ".maxpat");
      files.push({
        logicalPath: `patchers/${dependency.name}`,
        file: path.join(repositoryRoot, "patchers", dependency.name),
      });
      continue;
    }
    if (dependency.type === "svg" && dependency.name?.endsWith(".svg")) {
      validatedLeafName(dependency.name, "release image dependency", ".svg");
      files.push({
        logicalPath: `images/${dependency.name}`,
        file: path.join(repositoryRoot, "images", dependency.name),
      });
      continue;
    }
    throw new Error(`Unexpected release dependency ${dependency.name || "<unnamed>"}`);
  }
  return digestRecords(files);
}

function stagedAssetRecords(projectDirectory) {
  const files = [];
  for (const directoryName of ["images", "node_content", "patchers"]) {
    const directory = path.join(projectDirectory, directoryName);
    const directoryStatus = fs.lstatSync(directory);
    if (directoryStatus.isSymbolicLink() || !directoryStatus.isDirectory()) {
      throw new Error(`Staged release directory is not a plain directory: ${directoryName}`);
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) {
        throw new Error(`Unexpected staged release asset ${directoryName}/${entry.name}`);
      }
      files.push({
        logicalPath: `${directoryName}/${entry.name}`,
        file: path.join(directory, entry.name),
      });
    }
  }
  return digestRecords(files);
}

function stagedProjectRecord(projectDirectory, projectName = path.basename(projectDirectory)) {
  const logicalPath = `${projectName}.maxproj`;
  return digestRecords([
    { logicalPath, file: path.join(projectDirectory, logicalPath) },
  ])[0];
}

function hasValidDigestRecords(records) {
  if (!Array.isArray(records)) return false;
  const paths = records.map((record) => record?.path);
  return (
    new Set(paths).size === paths.length &&
    records.every(
      (record) =>
        record &&
        Object.keys(record).sort().join(",") === "path,sha256" &&
        typeof record.path === "string" &&
        record.path.length > 0 &&
        /^[a-f0-9]{64}$/.test(record.sha256),
    )
  );
}

function isOwnedStagingManifest(manifest, projectName) {
  const expectedProjectKeys = [
    "candidateName",
    "nodePatcherName",
    "projectName",
    "runtimeName",
    "topLevelPatcherName",
  ];
  return (
    manifest &&
    Object.keys(manifest).sort().join(",") ===
      "format,project,projectFile,sourceInputs,stagedAssets,version" &&
    manifest.format === STAGING_MANIFEST_FORMAT &&
    manifest.version === STAGING_MANIFEST_VERSION &&
    manifest.project &&
    Object.keys(manifest.project).sort().join(",") === expectedProjectKeys.join(",") &&
    manifest.project.projectName === projectName &&
    manifest.projectFile &&
    Object.keys(manifest.projectFile).sort().join(",") === "path,sha256" &&
    manifest.projectFile?.path === `${projectName}.maxproj` &&
    /^[a-f0-9]{64}$/.test(manifest.projectFile?.sha256 || "") &&
    Array.isArray(manifest.sourceInputs) &&
    manifest.sourceInputs.length > 0 &&
    Array.isArray(manifest.stagedAssets) &&
    manifest.stagedAssets.length > 0 &&
    hasValidDigestRecords(manifest.sourceInputs) &&
    hasValidDigestRecords(manifest.stagedAssets)
  );
}

function assertReplaceableProjectDirectory(projectDirectory, projectName) {
  if (!fs.existsSync(projectDirectory)) return;
  const status = fs.lstatSync(projectDirectory);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error("Max release project target must be a plain directory");
  }
  const entries = fs.readdirSync(projectDirectory);
  if (entries.length === 0) return;

  const manifestPath = path.join(projectDirectory, STAGING_MANIFEST_NAME);
  let manifest;
  try {
    manifest = JSON.parse(
      readStableManifestInput(manifestPath, STAGING_MANIFEST_NAME).toString("utf8"),
    );
  } catch {
    throw new Error(
      "Refusing to replace a nonempty Max release target without a valid ownership manifest",
    );
  }
  if (!isOwnedStagingManifest(manifest, projectName)) {
    throw new Error(
      "Refusing to replace a nonempty Max release target owned by another project",
    );
  }
}

function dependencyBootpath(dependency, directories, runtimeName) {
  if (dependency.name === runtimeName) return directories.nodeContentDirectory;
  if (dependency.type === "JSON" && dependency.name?.endsWith(".maxpat")) {
    return directories.patcherDirectory;
  }
  if (dependency.type === "svg" && dependency.name?.endsWith(".svg")) {
    return directories.imageDirectory;
  }
  return null;
}

function setStagingBootpaths(value, directories, runtimeName) {
  if (Array.isArray(value)) {
    for (const item of value) setStagingBootpaths(item, directories, runtimeName);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value.dependency_cache)) {
    for (const dependency of value.dependency_cache) {
      const bootpath = dependencyBootpath(dependency, directories, runtimeName);
      if (bootpath) dependency.bootpath = bootpath;
    }
  }
  for (const item of Object.values(value)) {
    setStagingBootpaths(item, directories, runtimeName);
  }
}

function stagingPatcher(
  source,
  logicalPath,
  expectedDigests,
  directories,
  runtimeName,
) {
  const sourceBuffer = readExpectedSourceInput(
    source,
    logicalPath,
    expectedDigests,
  );
  const document = JSON.parse(sourceBuffer.toString("utf8"));
  setStagingBootpaths(document, directories, runtimeName);
  return document;
}

function isolateDependencies(
  device,
  {
    patcherDirectory,
    nodeContentDirectory,
    imageDirectory,
    runtimeName,
    nodePatcherName,
    sourceInputDigests,
  },
) {
  const dependencies = device.patcher.dependency_cache || [];
  if (!replaceNodeAbstraction(device.patcher, nodePatcherName)) {
    throw new Error("Missing MIDIjourney Node abstraction in release device");
  }

  const embeddedProject = device.patcher.project || {};
  if (embeddedProject.amxdtype !== AUDIO_EFFECT_AMXD_TYPE) {
    throw new Error(
      "MIDIjourney.source.amxd must remain a Max Audio Effect for the Main/Master track",
    );
  }
  embeddedProject.searchpath = {
    0: {
      projectrelativepath: "./node_content",
      bootpath: nodeContentDirectory,
      label: "MIDIjourney runtime",
      recursive: 0,
      enabled: 1,
      includeincollective: 1,
    },
    1: {
      projectrelativepath: "./patchers",
      bootpath: patcherDirectory,
      label: "MIDIjourney patchers",
      recursive: 0,
      enabled: 1,
      includeincollective: 1,
    },
    2: {
      projectrelativepath: "./images",
      bootpath: imageDirectory,
      label: "MIDIjourney images",
      recursive: 0,
      enabled: 1,
      includeincollective: 1,
    },
  };
  embeddedProject.amxdtype = AUDIO_EFFECT_AMXD_TYPE;
  embeddedProject.devpathtype = 0;
  embeddedProject.devpath = ".";
  embeddedProject.includepackages = 0;
  device.patcher.project = embeddedProject;

  for (const dependency of dependencies) {
    if (dependency.name === "midiJourney.release.js") {
      dependency.name = runtimeName;
      dependency.bootpath = nodeContentDirectory;
      dependency.patcherrelativepath = "./node_content";
      continue;
    }

    if (dependency.type === "JSON" && dependency.name.endsWith(".maxpat")) {
      const sourceName = dependency.name;
      const source = path.join(root, "patchers", sourceName);
      if (!fs.existsSync(source)) {
        throw new Error(`Missing release patcher dependency ${sourceName}`);
      }
      if (sourceName === "mj_nodeJS.maxpat") {
        dependency.name = nodePatcherName;
        const nodePatcher = stagingPatcher(
          source,
          `patchers/${sourceName}`,
          sourceInputDigests,
          { patcherDirectory, nodeContentDirectory, imageDirectory },
          runtimeName,
        );
        const nodeScript = (nodePatcher.patcher.boxes || []).find(
          ({ box }) => box.id === "obj-273",
        )?.box;
        if (!nodeScript) throw new Error("Missing release node.script object");
        nodeScript.text = `node.script ${runtimeName} @watch 0`;
        fs.writeFileSync(
          path.join(patcherDirectory, nodePatcherName),
          `${JSON.stringify(nodePatcher, null, "\t")}\n`,
          { mode: 0o644 },
        );
      } else {
        const patcher = stagingPatcher(
          source,
          `patchers/${sourceName}`,
          sourceInputDigests,
          { patcherDirectory, nodeContentDirectory, imageDirectory },
          runtimeName,
        );
        fs.writeFileSync(
          path.join(patcherDirectory, sourceName),
          `${JSON.stringify(patcher, null, "\t")}\n`,
          { mode: 0o644 },
        );
      }
      dependency.bootpath = patcherDirectory;
      dependency.patcherrelativepath = "./patchers";
      continue;
    }

    if (dependency.type === "svg" && dependency.name.endsWith(".svg")) {
      const source = path.join(root, "images", dependency.name);
      if (!fs.existsSync(source)) {
        throw new Error(`Missing release image dependency ${dependency.name}`);
      }
      fs.writeFileSync(
        path.join(imageDirectory, dependency.name),
        readExpectedSourceInput(
          source,
          `images/${dependency.name}`,
          sourceInputDigests,
        ),
        { mode: 0o644 },
      );
      dependency.bootpath = imageDirectory;
      dependency.patcherrelativepath = "./images";
      continue;
    }

    throw new Error(`Unexpected release dependency ${dependency.name}`);
  }

  setStagingBootpaths(
    device,
    { patcherDirectory, nodeContentDirectory, imageDirectory },
    runtimeName,
  );
}

function writeStagingDevice(device, destination, original) {
  const encoded = Buffer.from(`${JSON.stringify(device, null, "\t")}\n\0`, "utf8");
  const header = Buffer.from(original.subarray(0, 32));
  header.writeUInt32LE(encoded.length, 28);
  fs.writeFileSync(destination, Buffer.concat([header, encoded]), { mode: 0o600 });
}

function prepareMaxReleaseProject({
  releaseRoot = defaultReleaseRoot,
  releaseBundlePath = bundlePath,
  projectName = process.env.MIDIJOURNEY_MAX_RELEASE_PROJECT_NAME || defaultProjectName,
  stagingDeviceName =
    process.env.MIDIJOURNEY_MAX_RELEASE_DEVICE_NAME || defaultStagingDeviceName,
  runtimeName =
    process.env.MIDIJOURNEY_MAX_RELEASE_RUNTIME_NAME || defaultRuntimeName,
  nodePatcherName =
    process.env.MIDIJOURNEY_MAX_RELEASE_NODE_PATCHER_NAME || defaultNodePatcherName,
  quiet = false,
} = {}) {
  projectName = validatedLeafName(projectName, "Max release project name");
  stagingDeviceName = validatedLeafName(
    stagingDeviceName,
    "Max release candidate name",
    ".amxd",
  );
  runtimeName = validatedLeafName(runtimeName, "Max release runtime name", ".js");
  nodePatcherName = validatedLeafName(
    nodePatcherName,
    "Max release Node patcher name",
    ".maxpat",
  );
  if (nodePatcherName === patcherName) {
    throw new Error("Max release Node patcher name must not replace the top-level patcher");
  }
  if (
    nodePatcherName !== "mj_nodeJS.maxpat" &&
    fs.existsSync(path.join(root, "patchers", nodePatcherName))
  ) {
    throw new Error("Max release Node patcher name must not replace another source patcher");
  }
  const projectDirectory = path.join(path.resolve(releaseRoot), projectName);
  const patcherDirectory = path.join(projectDirectory, "patchers");
  const nodeContentDirectory = path.join(projectDirectory, "node_content");
  const imageDirectory = path.join(projectDirectory, "images");

  if (!fs.existsSync(releaseBundlePath)) {
    throw new Error("Run the release bundle build before preparing the Max project");
  }

  const sourceBuffer = readStableManifestInput(
    devicePath,
    "MIDIjourney.source.amxd",
  );
  const patcher = readDevicePatcher(sourceBuffer);
  const sourceInputs = releaseSourceInputRecords(patcher, {
    releaseBundleFile: releaseBundlePath,
  });
  const sourceInputDigests = new Map(
    sourceInputs.map(({ path: logicalPath, sha256: digest }) => [logicalPath, digest]),
  );
  if (sourceInputDigests.get("MIDIjourney.source.amxd") !== sha256(sourceBuffer)) {
    throw new Error("MIDIjourney.source.amxd changed while preparing the release project");
  }
  const releaseBundle = readExpectedSourceInput(
    releaseBundlePath,
    "js/midiJourney.release.js",
    sourceInputDigests,
  );

  assertReplaceableProjectDirectory(projectDirectory, projectName);
  const previousProjectDirectory = fs.existsSync(projectDirectory)
    ? path.join(
        path.dirname(projectDirectory),
        `.${path.basename(projectDirectory)}.previous-${process.pid}-${Date.now()}`,
      )
    : null;
  if (previousProjectDirectory) {
    if (fs.existsSync(previousProjectDirectory)) {
      throw new Error("Cannot preserve the previous Max release project safely");
    }
    fs.renameSync(projectDirectory, previousProjectDirectory);
  }
  let projectCreated = false;

  try {
    if (previousProjectDirectory) {
      // Revalidate the exact directory entry moved above before any eventual
      // recursive cleanup. If the target was swapped during the first check,
      // it is restored rather than deleted.
      assertReplaceableProjectDirectory(previousProjectDirectory, projectName);
    }
    fs.mkdirSync(path.dirname(projectDirectory), { recursive: true });
    fs.mkdirSync(projectDirectory);
    projectCreated = true;
    fs.mkdirSync(patcherDirectory);
    fs.mkdirSync(nodeContentDirectory);
    fs.mkdirSync(imageDirectory);

  isolateDependencies(patcher, {
    patcherDirectory,
    nodeContentDirectory,
    imageDirectory,
    runtimeName,
    nodePatcherName,
    sourceInputDigests,
  });
  fs.writeFileSync(
    path.join(patcherDirectory, patcherName),
    `${JSON.stringify(patcher, null, "\t")}\n`,
    { mode: 0o644 },
  );
  writePrivateCopy(releaseBundle, path.join(nodeContentDirectory, runtimeName));
  writeStagingDevice(
    patcher,
    path.join(projectDirectory, stagingDeviceName),
    sourceBuffer,
  );

  const patcherContents = Object.fromEntries(
    fs
      .readdirSync(patcherDirectory)
      .filter((name) => name.endsWith(".maxpat"))
      .sort()
      .map((name) => [
        name,
        name === patcherName
          ? { kind: "maxforlive", local: 1, toplevel: 1 }
          : { kind: "patcher", local: 1 },
      ]),
  );

  const project = {
    name: projectName,
    version: 1,
    creationdate: 0,
    modificationdate: 0,
    viewrect: [25.0, 111.0, 300.0, 500.0],
    autoorganize: 0,
    hideprojectwindow: 0,
    showdependencies: 1,
    autolocalize: 0,
    contents: {
      patchers: patcherContents,
      code: {
        [runtimeName]: { kind: "javascript", local: 1 },
      },
      media: {
        "validate.svg": { kind: "image", local: 1 },
      },
    },
    layout: {},
    // The candidate is loaded directly by Live/Max, whose dependency cache
    // requires real boot paths. Max owns the frozen AMXD metadata, so the
    // post-freeze finalizer validates the resulting bytes without rewriting it.
    searchpath: {
      0: {
        bootpath: nodeContentDirectory,
        projectrelativepath: "./node_content",
        label: "MIDIjourney release runtime",
        recursive: 0,
        enabled: 1,
        includeincollective: 1,
      },
      1: {
        bootpath: patcherDirectory,
        projectrelativepath: "./patchers",
        label: "MIDIjourney release patchers",
        recursive: 0,
        enabled: 1,
        includeincollective: 1,
      },
      2: {
        bootpath: imageDirectory,
        projectrelativepath: "./images",
        label: "MIDIjourney release images",
        recursive: 0,
        enabled: 1,
        includeincollective: 1,
      },
    },
    detailsvisible: 0,
    // Raw .maxproj four-character code for an Audio Effect ("aaaa").
    amxdtype: AUDIO_EFFECT_AMXD_TYPE,
    readonly: 0,
    devpathtype: 0,
    devpath: ".",
    sortmode: 0,
    viewmode: 0,
    includepackages: 0,
  };

  fs.writeFileSync(
    path.join(projectDirectory, `${projectName}.maxproj`),
    `${JSON.stringify(project, null, "\t")}\n`,
    { mode: 0o644 },
  );

  if (
    JSON.stringify(
      releaseSourceInputRecords(readDevicePatcher(sourceBuffer), {
        releaseBundleFile: releaseBundlePath,
      }),
    ) !== JSON.stringify(sourceInputs)
  ) {
    throw new Error("Release source inputs changed while preparing the Max project");
  }

  const manifest = {
    format: STAGING_MANIFEST_FORMAT,
    version: STAGING_MANIFEST_VERSION,
    project: {
      candidateName: stagingDeviceName,
      nodePatcherName,
      projectName,
      runtimeName,
      topLevelPatcherName: patcherName,
    },
    projectFile: stagedProjectRecord(projectDirectory, projectName),
    sourceInputs,
    stagedAssets: stagedAssetRecords(projectDirectory),
  };
  fs.writeFileSync(
    path.join(projectDirectory, STAGING_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o644 },
  );
  } catch (error) {
    const rollbackErrors = [];
    if (projectCreated) {
      try {
        fs.rmSync(projectDirectory, { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (previousProjectDirectory && fs.existsSync(previousProjectDirectory)) {
      try {
        fs.renameSync(previousProjectDirectory, projectDirectory);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    if (rollbackErrors.length) {
      error.message = `${error.message}; staging rollback also failed: ${rollbackErrors.join("; ")}`;
    }
    throw error;
  }

  if (previousProjectDirectory) {
    fs.rmSync(previousProjectDirectory, { recursive: true, force: true });
  }

  if (!quiet) {
    process.stdout.write(
      `Prepared isolated Max release project ${path.relative(root, projectDirectory)}\n`,
    );
  }
  return projectDirectory;
}

if (require.main === module) prepareMaxReleaseProject();

module.exports = {
  STAGING_MANIFEST_FORMAT,
  STAGING_MANIFEST_NAME,
  STAGING_MANIFEST_VERSION,
  prepareMaxReleaseProject,
  readDevicePatcher,
  releaseSourceInputRecords,
  stagedAssetRecords,
  stagedProjectRecord,
};
