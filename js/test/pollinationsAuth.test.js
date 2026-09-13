const test = require("node:test");
const assert = require("node:assert/strict");
const { PollinationsError } = require("@pollinations/sdk");
const { MemoryCredentialStore } = require("../credentialStore.js");
const {
  PollinationsAuth,
  checkAppKeyRegistration,
  classifyAuthError,
  openExternalUrl,
  raceWithAbort,
  safeUser,
} = require("../pollinationsAuth.js");

const fakePublishableKey = ["pk", "test-midijourney-application"].join("_");
const fakeUserToken = ["sk", "test-user-authorization-token"].join("_");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeSdk {
  constructor(config) {
    this.config = config;
  }

  static async authorizeDevice(options) {
    FakeSdk.authorizeOptions = options;
    return {
      userCode: "ABCD-1234",
      verificationUri: "https://enter.pollinations.ai/device?user_code=ABCD-1234",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      poll: async () => fakeUserToken,
    };
  }

  async userInfo() {
    return {
      sub: "user-1",
      name: "Musician",
      email: "private@example.com",
      githubUsername: "music-maker",
      tier: "flower",
    };
  }
}

test("recognizes a registered Pollinations app key", async () => {
  let request;
  const registered = await checkAppKeyRegistration(fakePublishableKey, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return { found: true };
        },
      };
    },
  });

  assert.equal(registered, true);
  assert.equal(request.url.origin, "https://enter.pollinations.ai");
  assert.equal(request.url.pathname, "/api/app-lookup");
  assert.equal(request.url.searchParams.get("app_key"), fakePublishableKey);
  assert.deepEqual(request.options.headers, { Accept: "application/json" });
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("recognizes a definitively unregistered Pollinations app key", async () => {
  const registered = await checkAppKeyRegistration(fakePublishableKey, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { found: false };
      },
    }),
  });

  assert.equal(registered, false);
});

test("treats an unavailable app-key lookup as inconclusive", async () => {
  assert.equal(
    await checkAppKeyRegistration(fakePublishableKey, {
      fetchImpl: async () => {
        throw new Error("simulated provider outage");
      },
    }),
    null,
  );

  assert.equal(
    await checkAppKeyRegistration(fakePublishableKey, {
      fetchImpl: async () => ({ ok: false }),
    }),
    null,
  );
});

test("omits an unregistered app key from SDK device authorization", async () => {
  let verifiedKey;
  let verificationSignal;
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: new MemoryCredentialStore(),
    sdk: FakeSdk,
    appKeyVerifier: async (appKey, { signal }) => {
      verifiedKey = appKey;
      verificationSignal = signal;
      return false;
    },
    autoOpenBrowser: false,
  });

  assert.equal((await auth.connect()).status, "connected");
  assert.equal(verifiedKey, fakePublishableKey);
  assert.ok(verificationSignal instanceof AbortSignal);
  assert.equal(Object.hasOwn(FakeSdk.authorizeOptions, "clientId"), false);
});

test("preserves a registered app key in SDK device authorization", async () => {
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: new MemoryCredentialStore(),
    sdk: FakeSdk,
    appKeyVerifier: async () => true,
    autoOpenBrowser: false,
  });

  assert.equal((await auth.connect()).status, "connected");
  assert.equal(FakeSdk.authorizeOptions.clientId, fakePublishableKey);
});

test("connects through the SDK device flow with app attribution", async () => {
  const store = new MemoryCredentialStore();
  const states = [];
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  const state = await auth.connect();
  assert.equal(state.status, "connected");
  assert.equal(state.user.name, "Musician");
  assert.equal(state.user.email, undefined);
  assert.equal(FakeSdk.authorizeOptions.clientId, fakePublishableKey);
  assert.equal(FakeSdk.authorizeOptions.scope, "generate profile usage");
  assert.ok(FakeSdk.authorizeOptions.signal instanceof AbortSignal);
  assert.equal(await store.load(), fakeUserToken);
  assert.doesNotMatch(JSON.stringify(states), /sk_test_user/);
});

test("falls back to the SDK device client when no publishable app key is configured", async () => {
  const auth = new PollinationsAuth({
    appKey: "pk_REPLACE_WITH_MIDIJOURNEY_APP_KEY",
    credentialStore: new MemoryCredentialStore(),
    sdk: FakeSdk,
    autoOpenBrowser: false,
  });

  assert.equal((await auth.connect()).status, "connected");
  assert.equal(Object.hasOwn(FakeSdk.authorizeOptions, "clientId"), false);
  assert.equal(FakeSdk.authorizeOptions.scope, "generate profile usage");
});

test("rejects a verification URI outside the Pollinations authorization origin", async () => {
  const auth = new PollinationsAuth({
    credentialStore: new MemoryCredentialStore(),
    sdk: FakeSdk,
    deviceAuthorizer: async () => ({
      userCode: "ABCD-1234",
      verificationUri: "https://example.invalid/device",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      poll: async () => fakeUserToken,
    }),
    autoOpenBrowser: false,
  });

  await assert.rejects(() => auth.connect(), {
    code: "CONNECTION_ERROR",
    message: "Could not connect to Pollinations.",
  });
  assert.deepEqual(auth.getState(), {
    status: "error",
    persistent: false,
    user: null,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error: {
      code: "CONNECTION_ERROR",
      message: "Could not connect to Pollinations.",
    },
  });
});

test("bounds the external browser launcher and hides launcher details", async () => {
  let invocation;
  const fakeExecFile = (executable, args, options, callback) => {
    invocation = { executable, args, options };
    callback(Object.assign(new Error("private launcher failure"), { code: "ETIMEDOUT" }));
  };

  await assert.rejects(
    () =>
      openExternalUrl("https://enter.pollinations.ai/device", {
        execFileImpl: fakeExecFile,
        platform: "darwin",
      }),
    {
      message: "MIDIjourney could not open the Pollinations authorization page.",
    },
  );
  assert.equal(invocation.executable, "/usr/bin/open");
  assert.deepEqual(invocation.args, ["https://enter.pollinations.ai/device"]);
  assert.deepEqual(invocation.options, { timeout: 15_000, killSignal: "SIGTERM" });
});

test("an abort releases SDK polling immediately", async () => {
  const polling = deferred();
  const controller = new AbortController();
  const raced = raceWithAbort(polling.promise, controller.signal);
  controller.abort();
  await assert.rejects(raced, { name: "AbortError" });
  polling.resolve(fakeUserToken);
});

test("disconnect releases the auth lifecycle while browser launch is pending", async () => {
  const browserLaunch = deferred();
  const browserLaunchStarted = deferred();
  const store = new MemoryCredentialStore();
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    browserLauncher: () => {
      browserLaunchStarted.resolve();
      return browserLaunch.promise;
    },
  });

  const connection = auth.connect();
  const connectionOutcome = connection.then(
    (state) => ({ state }),
    (error) => ({ error }),
  );
  await browserLaunchStarted.promise;
  assert.equal(auth.getState().status, "awaiting_approval");

  let disconnectSettled = false;
  const disconnection = auth.disconnect().then((state) => {
    disconnectSettled = true;
    return state;
  });
  await new Promise((resolve) => setImmediate(resolve));

  try {
    assert.equal(disconnectSettled, true);
  } finally {
    // Let the abandoned launcher finish so the test leaves no pending work.
    browserLaunch.resolve();
  }

  const [connectionResult, disconnectedState] = await Promise.all([
    connectionOutcome,
    disconnection,
  ]);
  assert.equal(connectionResult.error?.code, "CANCELED");
  assert.equal(disconnectedState.status, "disconnected");
  assert.equal(await store.load(), null);
});

test("coalesces repeated Connect clicks into one authorization flow", async () => {
  let authorizeCalls = 0;
  let releaseAuthorization;
  class SlowSdk extends FakeSdk {
    static async authorizeDevice() {
      authorizeCalls += 1;
      await new Promise((resolve) => {
        releaseAuthorization = resolve;
      });
      return super.authorizeDevice({});
    }
  }
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: new MemoryCredentialStore(),
    sdk: SlowSdk,
    autoOpenBrowser: false,
  });

  const first = auth.connect();
  assert.equal((await auth.connect()).status, "connecting");
  assert.equal(authorizeCalls, 1);
  releaseAuthorization();
  assert.equal((await first).status, "connected");
});

test("waits for initialization before starting a connection", async () => {
  const load = deferred();
  const loadStarted = deferred();
  let authorizeCalls = 0;
  const store = {
    persistent: true,
    async load() {
      loadStarted.resolve();
      return load.promise;
    },
    async save() {},
    async clear() {},
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    deviceAuthorizer: async (options) => {
      authorizeCalls += 1;
      return FakeSdk.authorizeDevice(options);
    },
    autoOpenBrowser: false,
  });

  const initialization = auth.initialize();
  await loadStarted.promise;
  const connection = auth.connect();
  await Promise.resolve();
  assert.equal(authorizeCalls, 0);

  load.resolve(null);
  assert.equal((await initialization).status, "disconnected");
  assert.equal((await connection).status, "connected");
  assert.equal(authorizeCalls, 1);
});

test("reports credential load failures instead of remaining in Checking", async () => {
  const states = [];
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: {
      persistent: true,
      async load() {
        throw new Error("private credential failure");
      },
      async save() {},
      async clear() {},
    },
    sdk: FakeSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  const state = await auth.initialize();
  assert.equal(state.status, "error");
  assert.equal(state.error.code, "CREDENTIAL_STORE_ERROR");
  assert.equal(states.at(-1).status, "error");
  assert.doesNotMatch(JSON.stringify(states), /private credential failure/);
});

test("disconnecting during initialization prevents a stale restored session", async () => {
  const load = deferred();
  const loadStarted = deferred();
  const store = {
    token: fakeUserToken,
    persistent: true,
    async load() {
      loadStarted.resolve();
      return load.promise;
    },
    async save(token) {
      this.token = token;
    },
    async clear() {
      this.token = null;
    },
  };
  const states = [];
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  const initialization = auth.initialize();
  await loadStarted.promise;
  const disconnection = auth.disconnect();
  load.resolve(fakeUserToken);
  await initialization;
  await disconnection;

  assert.equal(auth.getState().status, "disconnected");
  assert.equal(store.token, null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(states.some((state) => state.status === "connected"), false);
});

test("disconnecting during a credential save prevents stale state and storage", async () => {
  const save = deferred();
  const saveStarted = deferred();
  const states = [];
  const store = {
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      saveStarted.resolve();
      await save.promise;
      this.token = token;
    },
    async clear() {
      this.token = null;
    },
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  const connection = auth.connect();
  const connectionFailure = assert.rejects(connection, { code: "CANCELED" });
  await saveStarted.promise;
  const disconnection = auth.disconnect();
  save.resolve();
  await connectionFailure;
  await disconnection;

  assert.equal(auth.getState().status, "disconnected");
  assert.equal(store.token, null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(states.some((state) => state.status === "connected"), false);
});

test("canceling during a credential save rolls storage and state back", async () => {
  const save = deferred();
  const saveStarted = deferred();
  const states = [];
  const store = {
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      saveStarted.resolve();
      await save.promise;
      this.token = token;
    },
    async clear() {
      this.token = null;
    },
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  const connection = auth.connect();
  const connectionFailure = assert.rejects(connection, { code: "CANCELED" });
  await saveStarted.promise;
  assert.equal(auth.cancel().status, "disconnected");
  save.resolve();
  await connectionFailure;

  assert.equal(auth.getState().status, "disconnected");
  assert.equal(store.token, null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(states.some((state) => state.status === "connected"), false);
});

test("reports a credential error when cancel cannot roll storage back", async () => {
  const save = deferred();
  const saveStarted = deferred();
  const store = {
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      saveStarted.resolve();
      await save.promise;
      this.token = token;
    },
    async clear() {
      throw new Error("private rollback failure");
    },
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
  });

  const connection = auth.connect();
  const connectionFailure = assert.rejects(connection, {
    code: "CREDENTIAL_STORE_ERROR",
  });
  await saveStarted.promise;
  assert.equal(auth.cancel().status, "disconnected");
  save.resolve();
  await connectionFailure;

  assert.equal(auth.getState().status, "error");
  assert.equal(auth.getState().error.code, "CREDENTIAL_STORE_ERROR");
  assert.equal(store.token, fakeUserToken);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
  assert.doesNotMatch(JSON.stringify(auth.getState()), /private rollback failure/);
});

test("disconnect supersedes a stale cancel rollback failure", async () => {
  const save = deferred();
  const saveStarted = deferred();
  const firstClear = deferred();
  const firstClearStarted = deferred();
  const store = {
    clearCalls: 0,
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      saveStarted.resolve();
      await save.promise;
      this.token = token;
    },
    async clear() {
      this.clearCalls += 1;
      if (this.clearCalls === 1) {
        firstClearStarted.resolve();
        await firstClear.promise;
        return;
      }
      this.token = null;
    },
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
  });

  const connection = auth.connect();
  const connectionFailure = assert.rejects(connection, { code: "CANCELED" });
  await saveStarted.promise;
  auth.cancel();
  save.resolve();
  await firstClearStarted.promise;
  const disconnection = auth.disconnect();
  firstClear.reject(new Error("private stale rollback failure"));
  await connectionFailure;
  await disconnection;

  assert.equal(store.clearCalls, 2);
  assert.equal(store.token, null);
  assert.equal(auth.getState().status, "disconnected");
  assert.equal(auth.getState().error, null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("restores and disconnects a stored session", async () => {
  const store = new MemoryCredentialStore();
  await store.save(["sk", "stored-authorization-token"].join("_"));
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
  });
  assert.equal((await auth.initialize()).status, "connected");
  assert.equal((await auth.disconnect()).status, "disconnected");
  assert.equal(await store.load(), null);
});

test("invalidates a rejected session and returns the device to Connect", async () => {
  const store = new MemoryCredentialStore();
  await store.save(["sk", "stored-rejected-token"].join("_"));
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: FakeSdk,
    autoOpenBrowser: false,
  });
  await auth.initialize();

  const state = await auth.invalidate();
  assert.equal(state.status, "disconnected");
  assert.equal(state.error.code, "AUTHORIZATION_REQUIRED");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("keeps a stored session during a temporary network outage", async () => {
  class OfflineSdk extends FakeSdk {
    async userInfo() {
      throw new Error("Network unavailable");
    }
  }

  const store = new MemoryCredentialStore();
  const token = ["sk", "stored-offline-token"].join("_");
  await store.save(token);
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: OfflineSdk,
    autoOpenBrowser: false,
  });

  const state = await auth.initialize();
  assert.equal(state.status, "offline");
  assert.equal(await store.load(), token);
  assert.ok(auth.requireClient());
});

test("clears a stored session only when Pollinations rejects it", async () => {
  class UnauthorizedSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Unauthorized", "unauthorized", 401);
    }
  }

  const store = new MemoryCredentialStore();
  await store.save(["sk", "expired-token"].join("_"));
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: UnauthorizedSdk,
    autoOpenBrowser: false,
  });

  const state = await auth.initialize();
  assert.equal(state.status, "disconnected");
  assert.equal(state.error.code, "AUTHORIZATION_REQUIRED");
  assert.equal(await store.load(), null);
});

test("clears a stored session when Pollinations forbids the credential", async () => {
  class ForbiddenSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Forbidden", "forbidden", 403);
    }
  }

  const store = new MemoryCredentialStore();
  await store.save(["sk", "stored-forbidden-token"].join("_"));
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: ForbiddenSdk,
    autoOpenBrowser: false,
  });

  const state = await auth.initialize();
  assert.equal(state.status, "disconnected");
  assert.equal(state.error.code, "AUTHORIZATION_DENIED");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("clears a stored session when Pollinations reports an expired token", async () => {
  class ExpiredSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Expired", "expired_token", 401);
    }
  }

  const store = new MemoryCredentialStore();
  await store.save(["sk", "stored-expired-token"].join("_"));
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: ExpiredSdk,
    autoOpenBrowser: false,
  });

  const state = await auth.initialize();
  assert.equal(state.status, "disconnected");
  assert.equal(state.error.code, "AUTHORIZATION_EXPIRED");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("keeps a newly authorized session if profile lookup is temporarily offline", async () => {
  class OfflineAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new Error("Network unavailable");
    }
  }

  const store = new MemoryCredentialStore();
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: OfflineAfterAuthorizationSdk,
    autoOpenBrowser: false,
  });

  await assert.rejects(() => auth.connect(), { code: "CONNECTION_ERROR" });
  assert.equal(auth.getState().status, "offline");
  assert.equal(await store.load(), fakeUserToken);
  assert.ok(auth.requireClient());
});

test("marks an offline authorized session as nonpersistent when credential save fails", async () => {
  class OfflineAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new Error("private network failure");
    }
  }

  const store = {
    persistent: true,
    async load() {
      return null;
    },
    async save() {
      throw new Error("private credential failure");
    },
    async clear() {},
  };
  const states = [];
  const auth = new PollinationsAuth({
    credentialStore: store,
    sdk: OfflineAfterAuthorizationSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  await assert.rejects(() => auth.connect(), { code: "CONNECTION_ERROR" });
  assert.equal(auth.getState().status, "offline");
  assert.equal(auth.getState().persistent, false);
  assert.ok(auth.requireClient());
  assert.doesNotMatch(JSON.stringify(states), /private (credential|network) failure/);
});

test("removes a newly issued token when profile lookup rejects it", async () => {
  class RejectedAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Unauthorized", "unauthorized", 401);
    }
  }

  const store = new MemoryCredentialStore();
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: RejectedAfterAuthorizationSdk,
    autoOpenBrowser: false,
  });

  await assert.rejects(() => auth.connect(), { code: "AUTHORIZATION_REQUIRED" });
  assert.equal(auth.getState().status, "error");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("disconnect supersedes a stale rejected-token cleanup", async () => {
  class RejectedAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Unauthorized", "unauthorized", 401);
    }
  }

  const firstClear = deferred();
  const firstClearStarted = deferred();
  const store = {
    clearCalls: 0,
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      this.token = token;
    },
    async clear() {
      this.clearCalls += 1;
      if (this.clearCalls === 1) {
        firstClearStarted.resolve();
        await firstClear.promise;
        return;
      }
      this.token = null;
    },
  };
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: RejectedAfterAuthorizationSdk,
    autoOpenBrowser: false,
  });

  const connection = auth.connect();
  const connectionFailure = assert.rejects(connection, { code: "CANCELED" });
  await firstClearStarted.promise;
  const disconnection = auth.disconnect();
  firstClear.reject(new Error("private stale cleanup failure"));
  await connectionFailure;
  await disconnection;

  assert.equal(store.clearCalls, 2);
  assert.equal(store.token, null);
  assert.equal(auth.getState().status, "disconnected");
  assert.equal(auth.getState().error, null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("removes a newly issued token when profile lookup returns forbidden", async () => {
  class ForbiddenAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Forbidden", "forbidden", 403);
    }
  }

  const store = new MemoryCredentialStore();
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: ForbiddenAfterAuthorizationSdk,
    autoOpenBrowser: false,
  });

  await assert.rejects(() => auth.connect(), { code: "AUTHORIZATION_DENIED" });
  assert.equal(auth.getState().status, "error");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("removes a newly issued token when profile lookup reports it expired", async () => {
  class ExpiredAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("Expired", "expired_token", 401);
    }
  }

  const store = new MemoryCredentialStore();
  const auth = new PollinationsAuth({
    appKey: fakePublishableKey,
    credentialStore: store,
    sdk: ExpiredAfterAuthorizationSdk,
    autoOpenBrowser: false,
  });

  await assert.rejects(() => auth.connect(), { code: "AUTHORIZATION_EXPIRED" });
  assert.equal(auth.getState().status, "error");
  assert.equal(await store.load(), null);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
});

test("reports a credential clear failure after a newly issued token is rejected", async () => {
  class RejectedAfterAuthorizationSdk extends FakeSdk {
    async userInfo() {
      throw new PollinationsError("private rejection", "unauthorized", 401);
    }
  }

  const store = {
    token: null,
    persistent: true,
    async load() {
      return this.token;
    },
    async save(token) {
      this.token = token;
    },
    async clear() {
      throw new Error("private credential failure");
    },
  };
  const states = [];
  const auth = new PollinationsAuth({
    credentialStore: store,
    sdk: RejectedAfterAuthorizationSdk,
    autoOpenBrowser: false,
    onState: (state) => states.push(state),
  });

  await assert.rejects(() => auth.connect(), { code: "CREDENTIAL_STORE_ERROR" });
  assert.equal(auth.getState().status, "error");
  assert.equal(auth.getState().error.code, "CREDENTIAL_STORE_ERROR");
  assert.equal(store.token, fakeUserToken);
  assert.throws(() => auth.requireClient(), { code: "AUTHORIZATION_REQUIRED" });
  assert.doesNotMatch(JSON.stringify(states), /private (credential|rejection)/);
});

test("maps authorization failures without exposing provider details", () => {
  assert.deepEqual(classifyAuthError({ name: "AbortError" }), {
    code: "CANCELED",
    message: "Connection canceled.",
  });
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "denied", 403)).code,
    "AUTHORIZATION_DENIED",
  );
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "server", 503)).message,
    "Pollinations is temporarily unavailable.",
  );
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "CANCELLED", 499)).code,
    "CANCELED",
  );
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "access_denied", 400)).code,
    "AUTHORIZATION_DENIED",
  );
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "expired_token", 400)).code,
    "AUTHORIZATION_EXPIRED",
  );
  assert.equal(
    classifyAuthError(new PollinationsError("private detail", "invalid_client", 400)).code,
    "APP_KEY_INVALID",
  );
  assert.deepEqual(
    classifyAuthError(new PollinationsError("private detail", "private_provider_code", 400)),
    {
      code: "POLLINATIONS_ERROR",
      message: "Pollinations could not complete the connection.",
    },
  );
});

test("uses preferred_username as a safe profile fallback", () => {
  assert.deepEqual(
    safeUser({
      sub: "user-1",
      preferred_username: "music-maker",
      email: "private@example.com",
    }),
    {
      id: "user-1",
      name: "music-maker",
      githubUsername: "music-maker",
      tier: null,
    },
  );
});
