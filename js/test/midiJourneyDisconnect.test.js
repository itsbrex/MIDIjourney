const test = require("node:test");
const assert = require("node:assert/strict");

test("disconnect cancels generation and notifies Max before clearing authorization", async (t) => {
  const events = [];
  let releaseMaxCancel;
  const maxCancelDelivered = new Promise((resolve) => {
    releaseMaxCancel = resolve;
  });

  const maxUtils = require("../maxUtils/max.js");
  const { PollinationsAuth } = require("../pollinationsAuth.js");
  const { PollinationsMidiClient } = require("../pollinationsClient.js");
  const midiJourneyPath = require.resolve("../midiJourney.js");

  t.mock.method(PollinationsAuth.prototype, "initialize", async () => ({
    status: "connected",
  }));
  t.mock.method(PollinationsAuth.prototype, "disconnect", async () => {
    events.push("auth.disconnect");
  });
  t.mock.method(PollinationsMidiClient.prototype, "cancel", () => {
    events.push("generation.cancel");
  });
  t.mock.method(maxUtils, "outletToMax", (...message) => {
    events.push(["max.outlet", ...message]);
    return maxCancelDelivered.then(() => {
      events.push("max.cancel.delivered");
    });
  });
  t.mock.method(maxUtils, "addHandlers", () => {});
  t.mock.method(maxUtils, "registerShutdownHook", () => {});

  delete require.cache[midiJourneyPath];
  t.after(() => {
    delete require.cache[midiJourneyPath];
  });
  const { handleDisconnect } = require(midiJourneyPath);

  const disconnecting = handleDisconnect();
  assert.deepEqual(events, [
    "generation.cancel",
    ["max.outlet", "cancel"],
  ]);

  releaseMaxCancel();
  await disconnecting;

  assert.deepEqual(events, [
    "generation.cancel",
    ["max.outlet", "cancel"],
    "max.cancel.delivered",
    "auth.disconnect",
  ]);
});

test("internal connection command preserves disconnect, connect, and cancel paths without touching real credentials", async (t) => {
  const maxUtils = require("../maxUtils/max.js");
  const { PollinationsAuth } = require("../pollinationsAuth.js");
  const { PollinationsMidiClient } = require("../pollinationsClient.js");
  const midiJourneyPath = require.resolve("../midiJourney.js");
  const events = [];
  let status = "connected", handlers;
  t.mock.method(PollinationsAuth.prototype, "initialize", async () => ({ status }));
  t.mock.method(PollinationsAuth.prototype, "getState", () => ({ status }));
  t.mock.method(PollinationsAuth.prototype, "connect", async () => events.push("connect"));
  t.mock.method(PollinationsAuth.prototype, "disconnect", async () => events.push("disconnect"));
  t.mock.method(PollinationsAuth.prototype, "cancel", () => events.push("cancel-connection"));
  t.mock.method(PollinationsMidiClient.prototype, "cancel", () => events.push("cancel-generation"));
  t.mock.method(maxUtils, "outletToMax", async (...args) => events.push(args.join(" ")));
  t.mock.method(maxUtils, "postToMax", () => {});
  t.mock.method(maxUtils, "addHandlers", (registered) => { handlers = registered; });
  t.mock.method(maxUtils, "registerShutdownHook", () => {});
  delete require.cache[midiJourneyPath];
  t.after(() => { delete require.cache[midiJourneyPath]; });
  require(midiJourneyPath);
  for (status of ["connected", "offline"]) {
    events.length = 0;
    await handlers.toggleConnection();
    assert.deepEqual(events, ["cancel-generation", "cancel", "disconnect"]);
  }
  for (status of ["disconnected", "error"]) {
    events.length = 0;
    await handlers.toggleConnection();
    assert.deepEqual(events, ["connect"]);
  }
  for (status of ["connecting", "awaiting_approval"]) {
    events.length = 0;
    await handlers.toggleConnection();
    assert.deepEqual(events, ["cancel-connection"]);
  }
});
