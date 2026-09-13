const { execFile } = require("child_process");
const { Pollinations, PollinationsError } = require("@pollinations/sdk");
const { CONFIG, hasConfiguredAppKey } = require("./config.js");
const { createCredentialStore } = require("./credentialStore.js");

const POLLINATIONS_ENTER_ORIGIN = "https://enter.pollinations.ai";
const BROWSER_LAUNCH_TIMEOUT_MS = 15_000;
const APP_KEY_LOOKUP_TIMEOUT_MS = 8_000;

function abortError() {
  return Object.assign(new Error("Device authorization cancelled."), { name: "AbortError" });
}

function credentialStoreError(action) {
  return {
    code: "CREDENTIAL_STORE_ERROR",
    message: `MIDIjourney could not ${action} the saved Pollinations connection.`,
  };
}

function normalizedOAuthCode(error) {
  return String(error?.code || error?.details?.error || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function safeUser(user) {
  if (!user || typeof user !== "object") return null;
  const preferredUsername =
    typeof user.preferred_username === "string" ? user.preferred_username : null;
  return {
    id: typeof user.sub === "string" ? user.sub : null,
    name:
      (typeof user.name === "string" && user.name) ||
      preferredUsername ||
      (typeof user.githubUsername === "string" && user.githubUsername) ||
      null,
    githubUsername:
      preferredUsername ||
      (typeof user.githubUsername === "string" ? user.githubUsername : null),
    tier: typeof user.tier === "string" ? user.tier : null,
  };
}

function classifyAuthError(error) {
  const oauthCode = normalizedOAuthCode(error);
  if (
    error?.name === "AbortError" ||
    error?.status === 499 ||
    oauthCode === "canceled" ||
    oauthCode === "cancelled"
  ) {
    return { code: "CANCELED", message: "Connection canceled." };
  }
  if (["access_denied", "authorization_denied", "denied"].includes(oauthCode)) {
    return { code: "AUTHORIZATION_DENIED", message: "Pollinations authorization was denied." };
  }
  if (
    ["expired_token", "device_code_expired", "authorization_expired"].includes(oauthCode)
  ) {
    return {
      code: "AUTHORIZATION_EXPIRED",
      message: "Pollinations authorization expired. Please connect again.",
    };
  }
  if (["invalid_client", "unauthorized_client"].includes(oauthCode)) {
    return {
      code: "APP_KEY_INVALID",
      message: "MIDIjourney's Pollinations App Key was rejected.",
    };
  }
  if (error instanceof PollinationsError) {
    if (error.status === 401) {
      return { code: "AUTHORIZATION_REQUIRED", message: "Reconnect to Pollinations." };
    }
    if (error.status === 402) {
      return { code: "INSUFFICIENT_POLLEN", message: "Your Pollinations balance is too low." };
    }
    if (error.status === 403) {
      return { code: "AUTHORIZATION_DENIED", message: "Pollinations authorization was denied." };
    }
    if (error.status === 429) {
      return { code: "RATE_LIMITED", message: "Pollinations is busy. Please try again shortly." };
    }
    if (error.status >= 500) {
      return { code: "PROVIDER_UNAVAILABLE", message: "Pollinations is temporarily unavailable." };
    }
    return {
      code: "POLLINATIONS_ERROR",
      message: "Pollinations could not complete the connection.",
    };
  }
  return {
    code: "CONNECTION_ERROR",
    message: "Could not connect to Pollinations.",
  };
}

function isCredentialRejection(safeError) {
  return (
    safeError?.code === "AUTHORIZATION_REQUIRED" ||
    safeError?.code === "AUTHORIZATION_DENIED" ||
    safeError?.code === "AUTHORIZATION_EXPIRED"
  );
}

function parseAuthorizationUrl(url, { allowRelative = false } = {}) {
  const parsed = allowRelative ? new URL(url, POLLINATIONS_ENTER_ORIGIN) : new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "enter.pollinations.ai" ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Refusing to open an unexpected authorization URL.");
  }
  return parsed;
}

async function checkAppKeyRegistration(
  appKey,
  {
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = APP_KEY_LOOKUP_TIMEOUT_MS,
  } = {},
) {
  if (!hasConfiguredAppKey(appKey) || typeof fetchImpl !== "function") return null;
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL("/api/app-lookup", POLLINATIONS_ENTER_ORIGIN);
    url.searchParams.set("app_key", appKey);
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.found === true) return true;
    if (payload?.found === false) return false;
    return null;
  } catch {
    if (signal?.aborted) throw abortError();
    // Lookup is a compatibility guard, not an availability dependency. If it
    // times out or the endpoint is temporarily unavailable, preserve normal
    // SDK behavior and let the device-flow request return the real error.
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function openExternalUrl(
  url,
  {
    execFileImpl = execFile,
    platform = process.platform,
    timeoutMs = BROWSER_LAUNCH_TIMEOUT_MS,
  } = {},
) {
  const parsed = parseAuthorizationUrl(url);
  const safeUrl = parsed.toString();

  let executable;
  let args;
  if (platform === "darwin") {
    executable = "/usr/bin/open";
    args = [safeUrl];
  } else if (platform === "win32") {
    executable = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", safeUrl];
  } else {
    executable = "xdg-open";
    args = [safeUrl];
  }

  return new Promise((resolve, reject) => {
    execFileImpl(executable, args, { timeout: timeoutMs, killSignal: "SIGTERM" }, (error) => {
      if (error) {
        reject(new Error("MIDIjourney could not open the Pollinations authorization page."));
        return;
      }
      resolve();
    });
  });
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

class PollinationsAuth {
  constructor({
    appKey = CONFIG.appKey,
    authScope = CONFIG.authScope,
    credentialStore = createCredentialStore(),
    sdk = Pollinations,
    deviceAuthorizer,
    appKeyVerifier,
    onState = () => {},
    autoOpenBrowser = true,
    browserLauncher = openExternalUrl,
  } = {}) {
    this.credentialStore = credentialStore;
    this.appKey = hasConfiguredAppKey(appKey) ? appKey : null;
    this.authScope = typeof authScope === "string" ? authScope.trim() : "";
    this.sdk = sdk;
    this.deviceAuthorizer = deviceAuthorizer || sdk.authorizeDevice.bind(sdk);
    // Keep isolated SDK fakes deterministic in tests while production uses a
    // read-only provider lookup to avoid opening a known-blocked consent page.
    this.appKeyVerifier =
      appKeyVerifier === undefined
        ? sdk === Pollinations
          ? checkAppKeyRegistration
          : null
        : appKeyVerifier;
    this.onState = onState;
    this.autoOpenBrowser = autoOpenBrowser;
    this.browserLauncher = browserLauncher;
    this.client = null;
    this.storedToken = null;
    this.abortController = null;
    this.activeOperation = null;
    this.cancellationEpoch = 0;
    this.connectionRequest = null;
    this.initializationPromise = null;
    this.lifecycleQueue = Promise.resolve();
    this.state = {
      status: "disconnected",
      persistent: Boolean(credentialStore.persistent),
      user: null,
    };
  }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.onState(this.getState());
    return this.getState();
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  createClient(token) {
    return new this.sdk({
      apiKey: token,
      // SDK 5.0.0 retries its own 499 cancellation response. Keep each SDK
      // call to one attempt; MIDIjourney owns the abort-aware retry policy.
      maxRetries: 1,
      textTimeout: CONFIG.textTimeoutMs,
    });
  }

  enqueueLifecycle(operation) {
    const task = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = task.catch(() => {});
    return task;
  }

  isCurrent(epoch) {
    return epoch === this.cancellationEpoch;
  }

  ensureCurrent(epoch, signal) {
    if (!this.isCurrent(epoch) || signal?.aborted) throw abortError();
  }

  setActiveOperation(operation) {
    this.activeOperation = operation;
    this.abortController = operation.controller;
  }

  clearActiveOperation(operation) {
    if (this.activeOperation === operation) this.activeOperation = null;
    if (this.abortController === operation.controller) this.abortController = null;
  }

  isCurrentCancellation(operation, type) {
    return (
      operation.cancellation === type &&
      operation.cancellationEpoch === this.cancellationEpoch
    );
  }

  async restoreCredential(token) {
    if (token) await this.credentialStore.save(token);
    else await this.credentialStore.clear();
    this.storedToken = token || null;
  }

  async finishCanceledConnection(operation, saveAttempted) {
    if (this.isCurrentCancellation(operation, "cancel")) {
      if (saveAttempted) {
        try {
          await this.restoreCredential(operation.previous.storedToken);
        } catch (rollbackError) {
          if (!this.isCurrentCancellation(operation, "cancel")) {
            this.client = null;
            this.storedToken = null;
            throw Object.assign(abortError(), { code: "CANCELED" });
          }
          this.client = null;
          this.storedToken = null;
          const storeError = credentialStoreError("restore");
          this.emit({
            status: "error",
            user: null,
            userCode: null,
            verificationUri: null,
            expiresAt: null,
            error: storeError,
          });
          throw Object.assign(new Error(storeError.message), storeError, {
            cause: rollbackError,
          });
        }
        if (!this.isCurrentCancellation(operation, "cancel")) {
          this.client = null;
          this.storedToken = null;
          throw Object.assign(abortError(), { code: "CANCELED" });
        }
      }
      this.client = operation.previous.client;
      this.storedToken = operation.previous.storedToken;
    } else {
      this.client = null;
      this.storedToken = null;
    }
    throw Object.assign(abortError(), { code: "CANCELED" });
  }

  initialize() {
    if (this.initializationPromise) return this.initializationPromise;
    const epoch = this.cancellationEpoch;
    this.initializationPromise = this.enqueueLifecycle(() => this.initializeAtEpoch(epoch));
    return this.initializationPromise;
  }

  async initializeAtEpoch(epoch) {
    if (!this.isCurrent(epoch)) return this.getState();

    const controller = new AbortController();
    const operation = { type: "initialize", epoch, controller };
    this.setActiveOperation(operation);
    this.emit({ status: "checking", error: null });

    try {
      let token;
      try {
        token = await this.credentialStore.load();
      } catch {
        if (!this.isCurrent(epoch)) return this.getState();
        const error = credentialStoreError("read");
        this.client = null;
        this.storedToken = null;
        return this.emit({ status: "error", user: null, error });
      }

      if (!this.isCurrent(epoch)) return this.getState();
      if (!token) {
        this.client = null;
        this.storedToken = null;
        return this.emit({ status: "disconnected", user: null, error: null });
      }

      const client = this.createClient(token);
      try {
        const user = await client.userInfo({ signal: controller.signal });
        if (!this.isCurrent(epoch)) return this.getState();
        this.client = client;
        this.storedToken = token;
        return this.emit({ status: "connected", user: safeUser(user), error: null });
      } catch (error) {
        if (!this.isCurrent(epoch)) return this.getState();
        const safeError = classifyAuthError(error);
        if (safeError.code === "CANCELED") return this.getState();
        if (isCredentialRejection(safeError)) {
          this.client = null;
          try {
            await this.credentialStore.clear();
          } catch {
            if (!this.isCurrent(epoch)) return this.getState();
            const storeError = credentialStoreError("remove");
            return this.emit({ status: "error", user: null, error: storeError });
          }
          if (!this.isCurrent(epoch)) return this.getState();
          this.storedToken = null;
          return this.emit({ status: "disconnected", user: null, error: safeError });
        }

        // A temporary outage must not silently sign the user out. Keep the
        // credential and client so a later request can retry normally.
        this.client = client;
        this.storedToken = token;
        return this.emit({ status: "offline", user: null, error: safeError });
      }
    } catch (error) {
      if (!this.isCurrent(epoch)) return this.getState();
      const safeError = classifyAuthError(error);
      this.client = null;
      return this.emit({ status: "error", user: null, error: safeError });
    } finally {
      this.clearActiveOperation(operation);
    }
  }

  connect() {
    if (this.connectionRequest) {
      return Promise.resolve().then(() => this.getState());
    }

    const request = {
      canceled: false,
      epoch: this.cancellationEpoch,
      promise: null,
    };
    const task = this.enqueueLifecycle(() => this.connectAtEpoch(request));
    request.promise = task;
    this.connectionRequest = request;
    const clearRequest = () => {
      if (this.connectionRequest === request) this.connectionRequest = null;
    };
    task.then(clearRequest, clearRequest);
    return task;
  }

  async connectAtEpoch(request) {
    const { epoch } = request;
    if (request.canceled || !this.isCurrent(epoch)) return this.getState();
    if (this.state.status === "connected") return this.getState();

    const previous = {
      client: this.client,
      state: this.getState(),
      storedToken: this.storedToken,
    };
    const controller = new AbortController();
    const operation = { type: "connect", epoch, controller, previous, request };
    this.setActiveOperation(operation);
    this.emit({ status: "connecting", error: null, user: null });
    let candidateClient = null;
    let issuedToken = null;
    let receivedToken = false;
    let saveAttempted = false;
    let savedToken = false;
    let persistent = Boolean(this.credentialStore.persistent);

    try {
      let clientId = this.appKey;
      if (clientId && typeof this.appKeyVerifier === "function") {
        const registered = await this.appKeyVerifier(clientId, {
          signal: controller.signal,
        });
        this.ensureCurrent(epoch, controller.signal);
        // authorizeDevice() officially supports an omitted clientId and then
        // uses the SDK's registered device client. This preserves a working
        // BYOP login when a configured attribution key was revoked or mistyped
        // without mutating that key or weakening a valid registration.
        if (registered === false) clientId = null;
      }
      const authorization = await this.deviceAuthorizer({
        ...(clientId ? { clientId } : {}),
        ...(this.authScope ? { scope: this.authScope } : {}),
        signal: controller.signal,
      });
      this.ensureCurrent(epoch, controller.signal);
      const verificationUri = parseAuthorizationUrl(authorization.verificationUri).toString();
      this.emit({
        status: "awaiting_approval",
        userCode: authorization.userCode,
        verificationUri,
        expiresAt: authorization.expiresAt.toISOString(),
      });
      // Opening the system browser is bounded, but it can still take up to
      // that bound. Race it with this operation's abort signal so Cancel or
      // Disconnect can release the serialized auth lifecycle immediately.
      if (this.autoOpenBrowser) {
        await raceWithAbort(this.browserLauncher(verificationUri), controller.signal);
      }
      this.ensureCurrent(epoch, controller.signal);

      // The SDK currently checks cancellation between polling attempts but its
      // internal delay and token request are not themselves abortable. Race
      // the poll so Cancel/Disconnect releases our serialized lifecycle queue
      // immediately; the superseded SDK promise can never mutate our state.
      const token = await raceWithAbort(authorization.poll(), controller.signal);
      this.ensureCurrent(epoch, controller.signal);
      issuedToken = token;
      receivedToken = true;
      candidateClient = this.createClient(token);
      saveAttempted = true;
      try {
        await this.credentialStore.save(token);
        savedToken = true;
      } catch {
        persistent = false;
      }
      this.ensureCurrent(epoch, controller.signal);
      const user = await candidateClient.userInfo({ signal: controller.signal });
      this.ensureCurrent(epoch, controller.signal);
      this.client = candidateClient;
      if (savedToken) this.storedToken = token;
      return this.emit({
        status: "connected",
        user: safeUser(user),
        persistent,
        userCode: null,
        verificationUri: null,
        expiresAt: null,
        error: null,
      });
    } catch (error) {
      const safeError = classifyAuthError(error);
      if (!this.isCurrent(epoch) || safeError.code === "CANCELED") {
        return this.finishCanceledConnection(operation, saveAttempted);
      }
      const issuedCredentialRejected = receivedToken && isCredentialRejection(safeError);
      if (issuedCredentialRejected) {
        this.client = null;
        try {
          await this.credentialStore.clear();
        } catch (error) {
          if (!this.isCurrent(epoch)) {
            return this.finishCanceledConnection(operation, saveAttempted);
          }
          const storeError = credentialStoreError("remove");
          this.emit({
            status: "error",
            persistent,
            user: null,
            userCode: null,
            verificationUri: null,
            expiresAt: null,
            error: storeError,
          });
          throw Object.assign(new Error(storeError.message), storeError, { cause: error });
        }
        if (!this.isCurrent(epoch)) {
          return this.finishCanceledConnection(operation, saveAttempted);
        }
        this.storedToken = null;
      } else if (safeError.code === "CANCELED" || !receivedToken) {
        this.client = previous.client;
        this.storedToken = previous.storedToken;
      } else {
        this.client = candidateClient;
        if (savedToken) this.storedToken = issuedToken;
      }
      this.emit({
        status:
          safeError.code === "CANCELED"
            ? "disconnected"
            : receivedToken && !issuedCredentialRejected
              ? "offline"
              : "error",
        userCode: null,
        verificationUri: null,
        expiresAt: null,
        ...(receivedToken ? { persistent } : {}),
        error: safeError,
      });
      throw Object.assign(new Error(safeError.message), safeError);
    } finally {
      this.clearActiveOperation(operation);
    }
  }

  cancel() {
    const operation = this.activeOperation;
    if (operation?.type !== "connect") {
      if (this.connectionRequest) {
        this.connectionRequest.canceled = true;
        this.connectionRequest = null;
      }
      return this.getState();
    }
    if (operation.cancellation === "disconnect") return this.getState();

    this.cancellationEpoch += 1;
    operation.cancellation = "cancel";
    operation.cancellationEpoch = this.cancellationEpoch;
    operation.request.canceled = true;
    if (this.connectionRequest === operation.request) this.connectionRequest = null;
    operation.controller.abort();
    this.abortController = null;
    this.client = operation.previous.client;
    this.storedToken = operation.previous.storedToken;
    return this.emit({
      ...operation.previous.state,
      userCode: null,
      verificationUri: null,
      expiresAt: null,
    });
  }

  disconnect() {
    return this.clearAuthorization();
  }

  invalidate() {
    return this.clearAuthorization({
      code: "AUTHORIZATION_REQUIRED",
      message: "Reconnect to Pollinations.",
    });
  }

  clearAuthorization(error = null) {
    this.cancellationEpoch += 1;
    const epoch = this.cancellationEpoch;
    if (this.connectionRequest) this.connectionRequest.canceled = true;
    this.connectionRequest = null;
    if (this.activeOperation) {
      this.activeOperation.cancellation = "disconnect";
      this.activeOperation.cancellationEpoch = this.cancellationEpoch;
      this.activeOperation.controller.abort();
    }
    this.abortController = null;
    this.client = null;
    this.storedToken = null;
    this.emit({
      status: "disconnected",
      user: null,
      userCode: null,
      verificationUri: null,
      expiresAt: null,
      error,
    });
    return this.enqueueLifecycle(async () => {
      try {
        await this.credentialStore.clear();
      } catch (error) {
        if (!this.isCurrent(epoch)) return this.getState();
        const safeError = credentialStoreError("remove");
        this.emit({ status: "error", user: null, error: safeError });
        throw Object.assign(new Error(safeError.message), safeError, { cause: error });
      }
      return this.getState();
    });
  }

  requireClient() {
    if (!this.client) {
      const error = new Error("Connect to Pollinations before generating MIDI.");
      error.code = "AUTHORIZATION_REQUIRED";
      throw error;
    }
    return this.client;
  }
}

exports.PollinationsAuth = PollinationsAuth;
exports.checkAppKeyRegistration = checkAppKeyRegistration;
exports.classifyAuthError = classifyAuthError;
exports.isCredentialRejection = isCredentialRejection;
exports.openExternalUrl = openExternalUrl;
exports.raceWithAbort = raceWithAbort;
exports.safeUser = safeUser;
