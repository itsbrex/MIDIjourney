const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: waitForImmediate } = require("node:timers/promises");
const { createMaxBridge } = require("../maxUtils/max.js");

test("Max post and outlet rejections are contained without logging payloads", async () => {
  const errors = [];
  const privateValue = "private-prompt-payload";
  const bridge = createMaxBridge(
    {
      post: async () => {
        throw new Error(privateValue);
      },
      outlet: async () => {
        throw new Error(privateValue);
      },
      addHandlers: () => {},
    },
    { logger: { error: (message) => errors.push(message) } },
  );

  await Promise.all([
    bridge.postToMax(privateValue),
    bridge.outletToMax(privateValue),
  ]);

  assert.deepEqual(errors, [
    "MIDIjourney Max bridge post failed.",
    "MIDIjourney Max bridge outlet failed.",
  ]);
  assert.equal(errors.join(" ").includes(privateValue), false);
});

test("registered Max handlers contain synchronous and asynchronous failures", async () => {
  const messages = [];
  let handlers;
  const bridge = createMaxBridge({
    post: (...args) => messages.push(["post", ...args]),
    outlet: (...args) => messages.push(["outlet", ...args]),
    addHandlers: (registered) => {
      handlers = registered;
    },
  });

  bridge.addHandlers({
    syncFailure: () => {
      throw new Error("private sync error");
    },
    asyncFailure: async () => {
      throw new Error("private async error");
    },
  });

  assert.doesNotThrow(() => handlers.syncFailure());
  assert.doesNotThrow(() => handlers.asyncFailure());
  await waitForImmediate();

  const internalErrors = messages.filter(
    (message) => message[0] === "outlet" && message[1] === "error",
  );
  assert.equal(internalErrors.length, 2);
  assert.ok(internalErrors.every((message) => message[2] === "INTERNAL_ERROR"));
  assert.equal(JSON.stringify(messages).includes("private"), false);
});
test("shutdown hooks also contain asynchronous cleanup failures", async () => {
  const messages = [];
  let shutdown;
  const bridge = createMaxBridge({
    post: (...args) => messages.push(["post", ...args]),
    outlet: (...args) => messages.push(["outlet", ...args]),
    addHandlers: () => {},
    registerShutdownHook: (handler) => {
      shutdown = handler;
    },
  });

  bridge.registerShutdownHook(async () => {
    throw new Error("private shutdown error");
  });
  assert.doesNotThrow(() => shutdown());
  await waitForImmediate();

  assert.ok(
    messages.some(
      (message) =>
        message[0] === "outlet" &&
        message[1] === "error" &&
        message[2] === "INTERNAL_ERROR",
    ),
  );
  assert.equal(JSON.stringify(messages).includes("private"), false);
});
