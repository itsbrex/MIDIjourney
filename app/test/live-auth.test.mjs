import test from "node:test";
import assert from "node:assert/strict";
import { authRequest, fragmentValue, liveAuthCapability, pause } from "../src/live-auth.mjs";

test("only a real Live bridge may use a correctly shaped window capability", () => {
  const nonce = "a".repeat(64);
  const location = { hash: `#live-session=${nonce}` };
  assert.equal(fragmentValue(location.hash, "live-session"), nonce);
  assert.equal(fragmentValue("#live-session=invalid", "live-session"), null);
  assert.equal(liveAuthCapability({ location }), null);
  assert.equal(liveAuthCapability({ location, webkit: { messageHandlers: { live: { postMessage() {} } } } }), null);
  assert.equal(liveAuthCapability({ location, max: { outlet() {}, bindInlet() {} } }), nonce);
  assert.equal(liveAuthCapability({ location, max: { outlet() {} } }), null);
});

test("handoff credentials use headers/body, never URLs; remote error bodies are not surfaced", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let called;
  globalThis.fetch = async (url, options) => { called = { url, options }; return new Response('{"status":"received"}'); };
  assert.deepEqual(await authRequest("complete", "fake-nonce", { apiKey: "fake-session" }), { status: "received" });
  assert.equal(called.url, "/api/auth/complete");
  assert.equal(called.options.headers.Authorization, "Bearer fake-nonce");
  assert.equal(called.options.body, '{"apiKey":"fake-session"}');
  globalThis.fetch = async () => new Response("private failure detail", { status: 403 });
  await assert.rejects(authRequest("complete", "fake-nonce"), /connection expired/);
});

test("polling cancels promptly and works with an already aborted signal", async () => {
  const abort = new AbortController();
  const waiting = pause(abort.signal, 60_000);
  abort.abort();
  await assert.rejects(waiting, /Canceled/);
  await assert.rejects(pause(abort.signal), /Canceled/);
});
