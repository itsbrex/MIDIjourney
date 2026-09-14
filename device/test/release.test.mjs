import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyBuild, verifyPatcher } from "../../scripts/release-lib.mjs";
import { makeDevice } from "../../scripts/device.mjs";
import frozen from "../../scripts/frozen-amxd.cjs";

test("build manifest binds every production output, and an editable device is not a frozen release", async () => {
  await verifyBuild();
  const source = await readFile(new URL("../../dist/MIDI Journey.source.amxd", import.meta.url));
  frozen.assertAmpfContainer(source);
  assert.throws(() => frozen.inspectFrozenAmxd(source), /frozen Max metadata/);
});

test("frozen patch validation rejects missing connections, UI changes, and stale runtime paths", () => {
  const expected = makeDevice().patcher;
  verifyPatcher(structuredClone(expected), expected);
  const disconnected = structuredClone(expected); disconnected.lines.pop();
  assert.throws(() => verifyPatcher(disconnected, expected), /patch cords/);
  const renamed = structuredClone(expected); renamed.boxes[0].box.text = "Old UI";
  assert.throws(() => verifyPatcher(renamed, expected), /changed/);
  const stale = structuredClone(expected);
  stale.boxes.find(({box}) => box.id === "server").box.text = "node.script /old/path.js";
  assert.throws(() => verifyPatcher(stale, expected), /changed/);
});
