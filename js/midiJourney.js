const {
  addHandlers,
  errorToMax,
  outletToMax,
  postToMax,
  registerShutdownHook,
} = require("./maxUtils/max.js");
const { PollinationsAuth } = require("./pollinationsAuth.js");
const { PollinationsMidiClient } = require("./pollinationsClient.js");
const { stripSensitiveFields } = require("./sanitize.js");
const { getColorCodeForScale } = require("./scaleColors.js");
const { AccountPanel } = require("./accountPanel.js");
let accountPanel;

function safeLog(event, metadata = {}) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) =>
      ["string", "number", "boolean"].includes(typeof value),
    ),
  );
  postToMax("MIDIjourney", event, safeMetadata);
}

function outputAuthState(state) {
  // The compact device needs only the state atom to render Connect/Connected.
  // Passing the full object through Max creates a temporary dictionary whose
  // lifetime can end before a hot-swapped root patcher consumes it.
  const delivery = outletToMax("auth", state.status);
  safeLog("auth_state", { status: state.status });
  accountPanel?.state(state);
  return delivery;
}

const auth = new PollinationsAuth({
  onState: outputAuthState,
});
accountPanel = new AccountPanel({
  auth,
  send: (...message) => outletToMax("account", ...message),
});
const midiClient = new PollinationsMidiClient({
  auth,
  onEvent: (event) => {
    outletToMax("status", event);
    safeLog(event.type, {
      model: event.model,
      durationMs: event.durationMs,
      code: event.error?.code,
    });
  },
});

const ready = auth.initialize().catch((error) => {
  safeLog("auth_initialization_failed", { code: error.code || "CONNECTION_ERROR" });
});

function sanitizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error("MIDIjourney expected a request dictionary.");
    error.code = "INVALID_REQUEST";
    throw error;
  }
  return stripSensitiveFields(input);
}

async function prompt(input) {
  await ready;
  const request = sanitizeInput(input);
  outletToMax("processing", request);
  const result = await midiClient.generate(request);
  return {
    ...result,
    color: getColorCodeForScale(result.key),
  };
}

async function handlePrompt(input) {
  try {
    const result = await prompt(input);
    outletToMax("result", result);
  } catch (error) {
    if (error.code !== "CANCELED") {
      errorToMax(error.code || "GENERATION_ERROR", error.message);
    }
  } finally {
    // Refresh after a request so the visible allowance tracks actual spending.
    void accountPanel.refresh();
  }
}

async function handleConnect() {
  try {
    await ready;
    await auth.connect();
  } catch (error) {
    if (error.code !== "CANCELED") {
      errorToMax(error.code || "CONNECTION_ERROR", error.message);
    }
  }
}

async function handleDisconnect() {
  try {
    // Disconnect is also a generation boundary. Do not let a request that was
    // authorized by the old session finish later and create a clip after the
    // user has explicitly disconnected.
    midiClient.cancel();
    await outletToMax("cancel");
    await auth.disconnect();
  } catch {
    errorToMax("CREDENTIAL_STORE_ERROR", "MIDIjourney could not remove local authorization.");
  }
}

async function handleToggleConnection() {
  await ready;
  const status = auth.getState().status;
  safeLog("connection_toggle_requested", { status });
  if (status === "connecting" || status === "awaiting_approval") {
    auth.cancel();
    return;
  }
  if (status === "connected" || status === "offline") {
    await handleDisconnect();
    return;
  }
  await handleConnect();
}

addHandlers({
  prompt: handlePrompt,
  connect: handleConnect,
  toggleConnection: handleToggleConnection,
  disconnect: handleDisconnect,
  accountRefresh: async () => {
    await ready;
    await accountPanel.refresh();
  },
  accountDashboard: async () => {
    try {
      await accountPanel.openDashboard();
    } catch (error) {
      if (error.code !== "CANCELED") errorToMax(error.code || "ACCOUNT_ACTION_ERROR", "Could not open the Pollinations dashboard. Please try again.");
    }
  },
  authStatus: async () => {
    await ready;
    await outputAuthState(auth.getState());
  },
  models: async () => {
    try {
      outletToMax("models", await midiClient.models());
    } catch (error) {
      errorToMax(error.code || "MODEL_LIST_ERROR", error.message);
    }
  },
  cancel: () => midiClient.cancel(),
  cancelConnection: () => auth.cancel(),
});

function handleShutdown() {
  // Closing the device must stop in-flight work without deleting the user's
  // saved Pollinations authorization.
  midiClient.cancel();
  auth.cancel();
}

registerShutdownHook(handleShutdown);

exports.auth = auth;
exports.handleConnect = handleConnect;
exports.handleDisconnect = handleDisconnect;
exports.handlePrompt = handlePrompt;
exports.handleShutdown = handleShutdown;
exports.handleToggleConnection = handleToggleConnection;
exports.midiClient = midiClient;
exports.prompt = prompt;
exports.sanitizeInput = sanitizeInput;
