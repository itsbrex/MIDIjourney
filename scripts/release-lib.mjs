import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { sourceFingerprint } from "./source-fingerprint.mjs";

const require = createRequire(import.meta.url);
const { inspectFrozenAmxd } = require("./frozen-amxd.cjs");
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RUNTIME_FILES = ["midijourney-server.js", "midijourney-bridge.js", "midijourney-window.js", "midijourney-panel.js"];
export const BUILD_FILES = [...RUNTIME_FILES, "MIDI Journey.maxpat", "MIDI Journey.source.amxd"];
export const sha256 = value => createHash("sha256").update(value).digest("hex");

export async function verifyBuild(directory = resolve(ROOT, "dist"), { requireConfigured = false } = {}) {
  const manifest = JSON.parse(await readFile(resolve(directory, "build-manifest.json"), "utf8"));
  assert.equal(manifest.format, "midi-journey-build-v1");
  assert.equal(manifest.version, "3.0.0");
  const { CONFIG, hasConfiguredAppKey } = require("../core/config.js");
  assert.equal(manifest.source, await sourceFingerprint(ROOT, hasConfiguredAppKey() ? CONFIG.appKey : ""), "Source changed since the candidate was built; rebuild before freezing or verifying.");
  assert.deepEqual(Object.keys(manifest.files).sort(), [...BUILD_FILES].sort());
  if (requireConfigured) assert.equal(manifest.configured, true, "Release requires the existing authorized publishable app-key configuration.");
  for (const name of BUILD_FILES)
    assert.equal(sha256(await readFile(resolve(directory, name))), manifest.files[name], `Stale build: ${name}`);
  return manifest;
}

// Max may add editor metadata while freezing. Compare every functional box,
// nested patcher, UI property, and connection rather than incidental editor state.
export function verifyPatcher(actual, expected) {
  for (const key of ["devicewidth", "minimum_live_version", "minimum_max_version", "title"])
    if (expected[key] !== undefined) assert.deepEqual(actual[key], expected[key], `Patcher ${key} changed`);
  const boxes = new Map(actual.boxes.map(({ box }) => [box.id, box]));
  assert.equal(boxes.size, expected.boxes.length, "Frozen device box count changed");
  for (const { box } of expected.boxes) {
    const found = boxes.get(box.id);
    assert.ok(found, `Missing box ${box.id}`);
    for (const key of ["maxclass", "text", "texton", "varname", "presentation", "presentation_rect"])
      if (box[key] !== undefined) assert.deepEqual(found[key], box[key], `Box ${box.id}: ${key} changed`);
    if (box.patcher) verifyPatcher(found.patcher, box.patcher);
  }
  const connections = p => p.lines.map(({patchline: l}) => JSON.stringify([l.source, l.destination])).sort();
  assert.deepEqual(connections(actual), connections(expected), "Frozen patch cords changed");
}

export async function verifyFrozen(file, directory = resolve(ROOT, "dist")) {
  const manifest = await verifyBuild(directory, { requireConfigured: true });
  const buffer = await readFile(file);
  const frozen = inspectFrozenAmxd(buffer);
  const patcher = JSON.parse(await readFile(resolve(directory, "MIDI Journey.maxpat"), "utf8")).patcher;
  verifyPatcher(frozen.documents[0].patcher, patcher);
  assert.equal(frozen.validation.amxdType, 0x61616161, "Release must be a Max Audio Effect for Main");
  for (const name of RUNTIME_FILES) {
    const entries = frozen.entries.filter(entry => basename(entry.name) === name);
    assert.equal(entries.length, 1, `Expected exactly one embedded ${name}`);
    assert.equal(sha256(entries[0].data), manifest.files[name], `Embedded ${name} differs from the build`);
  }
  const unexpected = frozen.entries.filter(entry => !entry.name.endsWith("/") && !RUNTIME_FILES.includes(basename(entry.name)));
  assert.equal(unexpected.length, 0, "Unexpected files embedded in device");
  return { version: manifest.version, sha256: sha256(buffer), bytes: buffer.length, embeddedFiles: RUNTIME_FILES, validation: frozen.validation };
}
