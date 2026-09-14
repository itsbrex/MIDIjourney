import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ROOT, verifyBuild, sha256 } from "./release-lib.mjs";
import { resolve } from "node:path";

await verifyBuild();
const patch = await readFile(resolve(ROOT, "dist/MIDI Journey.maxpat"), "utf8");
assert.doesNotMatch(patch, /\/Users\/|\/private\/|persistent\/|extension\/|node_modules\//, "Source patch must use relative runtime filenames");
const source = await readFile(resolve(ROOT, "dist/midijourney-server.js"), "utf8");
assert.doesNotMatch(source, /\/Users\/comsom\/|extensions-sdk|config\.release\.js/, "Compiled runtime must not depend on development paths");
assert.equal(sha256(await readFile(resolve(ROOT, "vendor/pollinations-ui-0.1.0-alpha.1.tgz"))), "7b0d607eaf8f9900bfd6a5097d642b91b63bdebd86454445cdc81ce6f8853743");
console.log("Source build, relative dependencies, and pinned Pollinations UI archive verified.");
