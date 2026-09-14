import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startUiServer } from "../ui-server.mjs";
import { get } from "node:http";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

function rawStatus(url, headers) {
  return new Promise((done, reject) => {
    get(url, { headers }, (response) => { response.resume(); response.on("end", () => done(response.statusCode)); }).on("error", reject);
  });
}

test("local UI server restricts host, methods, context access and filesystem paths", async (t) => {
  const server = await startUiServer({
    directory: fileURLToPath(new URL("../../dist/ui/", import.meta.url)), port: 0,
    getContext: () => ({ connected: true, destination: "MIDI · empty slot 1" }),
  });
  t.after(() => server.close());
  const response = await fetch(server.url + "api/context");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).connected, true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await rawStatus(server.url, { host: "attacker.invalid" }), 403);
  assert.equal(await rawStatus(server.url + "api/context", { "sec-fetch-site": "cross-site" }), 403);
  assert.equal((await fetch(server.url, { method: "POST" })).status, 405);
  assert.equal((await fetch(server.url + "api/commit", { method: "POST" })).status, 405);
  assert.equal((await fetch(server.url + "%2e%2e%2fpackage.json")).status, 404);
  // OAuth comes back from Enter as a top-level cross-site navigation; don't
  // break login by applying the API restriction to the public app document.
  assert.equal((await fetch(server.url + "?code=consumed-test&state=test", { headers: { "sec-fetch-site": "cross-site" } })).status, 200);
});

test("bundled server does not depend on a host-provided global URL constructor", async (t) => {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../ui-server.mjs", import.meta.url))],
    bundle: true, platform: "node", format: "cjs", write: false });
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, { module, exports: module.exports,
    require: createRequire(import.meta.url) });
  const server = await module.exports.startUiServer({
    directory: fileURLToPath(new URL("../../dist/ui/", import.meta.url)), port: 0,
    getContext: () => ({ connected: true }),
  });
  t.after(() => server.close());
  const response = await fetch(server.url + "api/context");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).connected, true);
  assert.equal((await fetch(server.url)).status, 200);
});

test("embedded UI works with no assets directory and exposes only declared assets", async (t) => {
  const server = await startUiServer({ directory: "/", port: 0, getContext: () => ({}), assets: {
    "index.html": Buffer.from("<title>MIDI Journey</title>").toString("base64"),
    "assets/font.woff2": Buffer.from([1, 2, 3]).toString("base64"),
  } });
  t.after(() => server.close());
  assert.match(await (await fetch(server.url)).text(), /MIDI Journey/);
  assert.deepEqual(Buffer.from(await (await fetch(server.url + "assets/font.woff2")).arrayBuffer()), Buffer.from([1, 2, 3]));
  for (const path of ["missing.js", "%2e%2e%2findex.html", "etc/hosts", "__proto__"])
    assert.equal((await fetch(server.url + path)).status, 404);
});
