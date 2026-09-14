import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startUiServer } from "../ui-server.mjs";

const directory = fileURLToPath(new URL("../../dist/ui/", import.meta.url));
async function setup(t, options = {}) {
  let browserUrl;
  const server = await startUiServer({ directory, port: 0, getContext: () => ({ connected: true }),
    openBrowser: async (url) => { browserUrl = url; }, ...options });
  t.after(() => server.close());
  const capability = new URL(server.editorUrl).hash.split("=")[1];
  const origin = new URL(server.url).origin;
  const call = (action, key = capability, body = {}, headers = {}) => fetch(server.url + "api/auth/" + action, {
    method: action.endsWith("status") ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, Origin: origin, "Content-Type": "application/json", ...headers },
    ...(action.endsWith("status") ? {} : { body: JSON.stringify(body) }),
  });
  return { server, call, capability, browser: () => new URL(browserUrl) };
}

test("browser handoff is bound to Live, acknowledged once and never exposed in URLs/context", async (t) => {
  const { server, call, capability, browser } = await setup(t);
  assert.equal((await call("start")).status, 200);
  const pair = browser().hash.split("=")[1];
  assert.notEqual(pair, capability);
  assert.equal(browser().origin, new URL(server.url).origin);
  assert.equal(browser().search, "");
  assert.equal((await call("start")).status, 409);
  assert.equal((await call("complete", capability, { apiKey: "fake-test-session" })).status, 403);
  assert.equal((await call("status", pair)).status, 403);
  assert.equal((await call("complete", pair, { apiKey: "fake-test-session" })).status, 200);
  assert.equal((await call("complete", pair, { apiKey: "different-fake-session" })).status, 409);
  assert.equal((await call("complete", pair, { apiKey: "fake-test-session" })).status, 200);
  assert.deepEqual(await (await call("browser-status", pair)).json(), { status: "received" });
  assert.deepEqual(await (await call("status")).json(), { status: "received", apiKey: "fake-test-session" });
  const context = await (await fetch(server.url + "api/context")).text();
  assert.doesNotMatch(context, /fake-test-session|live-session|live-connect/);
  assert.equal((await call("finish")).status, 200);
  assert.deepEqual(await (await call("status")).json(), { status: "delivered", apiKey: null });
  assert.equal((await call("complete", pair, { apiKey: "fake-test-session" })).status, 409);
});

test("handoff rejects other sites, missing/wrong capabilities, malformed or oversized tokens", async (t) => {
  const { server, call, browser } = await setup(t);
  assert.equal((await fetch(server.url + "api/auth/status")).status, 403);
  assert.equal((await call("start", "wrong")).status, 403);
  assert.equal((await call("start", undefined, {}, { Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await call("start", undefined, {}, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await call("start", undefined, {}, { "Content-Type": "text/plain" })).status, 403);
  assert.equal((await fetch(server.url + "api/auth/start")).status, 405);
  await call("start");
  const pair = browser().hash.split("=")[1];
  assert.equal((await call("complete", pair, {})).status, 400);
  assert.equal((await call("complete", pair, { apiKey: "not a token" })).status, 400);
  assert.equal((await call("complete", pair, { apiKey: "x".repeat(9000) })).status, 413);
  assert.deepEqual(await (await call("status")).json(), { status: "pending", apiKey: null });
});

test("cancel, timeout and browser-launch failure leave no transferable session", async (t) => {
  let now = 0;
  const { call, browser } = await setup(t, { now: () => now });
  await call("start");
  const oldPair = browser().hash.split("=")[1];
  await call("cancel");
  await call("start");
  assert.equal((await call("complete", oldPair, { apiKey: "fake-session" })).status, 403);
  const pair = browser().hash.split("=")[1];
  await call("complete", pair, { apiKey: "fake-session" });
  now = 600_001;
  assert.deepEqual(await (await call("status")).json(), { status: "expired" });
  assert.equal((await call("complete", pair, { apiKey: "fake-session" })).status, 403);
  const failure = await setup(t, { openBrowser: async () => { throw new Error("private failure detail"); } });
  const response = await failure.call("start");
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private failure detail/);
  assert.deepEqual(await (await failure.call("status")).json(), { status: "expired" });
});
