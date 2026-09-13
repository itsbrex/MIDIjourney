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
