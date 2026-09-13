// MIDIjourney is a Max for Live device that uses Pollinations to generate MIDI.
// written by Elliot Fouchy & Thomas Haferlach
// 2023, pixelynx.io
//
// MIT License
//
let max = null;

try {
  max = require("max-api");
} catch (error) {
  // Plain Node unit tests do not provide Max's injected module. Inside Max,
  // however, a failed import is a real runtime/ABI error: do not silently
  // replace the inlet handlers and leave a device whose buttons do nothing.
  if (process.env.MAX_ENV) throw error;
  max = {
    post: console.log,
    outlet: console.log,
    addHandlers: () => {},
    registerShutdownHook: () => {},
  };
}

function createMaxBridge(maxImplementation, { logger = console } = {}) {
  function safeBridgeFailure(operation) {
    // Never include rejected payloads here: a bridge error could carry a Max
    // dictionary containing prompt data. The operation name is sufficient.
    logger.error(`MIDIjourney Max bridge ${operation} failed.`);
  }

  function callMax(operation, ...args) {
    try {
      return Promise.resolve(maxImplementation[operation](...args)).catch(() => {
        safeBridgeFailure(operation);
      });
    } catch {
      safeBridgeFailure(operation);
      return Promise.resolve();
    }
  }

  function postToMax(...message) {
    return callMax("post", ...message);
  }

  function outletToMax(...message) {
    return callMax("outlet", ...message);
  }

  function reportHandlerFailure(selector) {
    postToMax("MIDIjourney", "handler_failed", { selector });
    outletToMax(
      "error",
      "INTERNAL_ERROR",
      "MIDIjourney could not complete that action. Please try again.",
    );
  }

  function wrapHandler(selector, handler) {
    return (...args) => {
      try {
        Promise.resolve(handler(...args)).catch(() => reportHandlerFailure(selector));
      } catch {
        reportHandlerFailure(selector);
      }
    };
  }

  function addHandlers(handlers) {
    const safeHandlers = Object.fromEntries(
      Object.entries(handlers).map(([selector, handler]) => [
        selector,
        wrapHandler(selector, handler),
      ]),
    );
    // Registration is synchronous. If it fails inside Max, allow node.script
    // to report the startup failure instead of pretending the device is usable.
    maxImplementation.addHandlers(safeHandlers);
  }

  function registerShutdownHook(handler) {
    if (typeof maxImplementation.registerShutdownHook === "function") {
      maxImplementation.registerShutdownHook(wrapHandler("shutdown", handler));
    }
  }

  function errorToMax(...errorMessage) {
    postToMax("error", ...errorMessage);
    outletToMax("error", ...errorMessage);
  }

  return {
    addHandlers,
    callMax,
    errorToMax,
    outletToMax,
    postToMax,
    registerShutdownHook,
    wrapHandler,
  };
}

/**
 * Outputs errors to Max.
 * @param {...any} errorMessage - Error message(s) to be sent to Max.
 */
const bridge = createMaxBridge(max);

exports.addHandlers = bridge.addHandlers;
exports.callMax = bridge.callMax;
exports.createMaxBridge = createMaxBridge;
exports.max = max;
exports.errorToMax = bridge.errorToMax;
exports.outletToMax = bridge.outletToMax;
exports.postToMax = bridge.postToMax;
exports.registerShutdownHook = bridge.registerShutdownHook;
exports.wrapHandler = bridge.wrapHandler;
