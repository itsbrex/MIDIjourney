const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const path = require("path");
const os = require("os");
const {
  MacOSKeychainCredentialStore,
  MemoryCredentialStore,
  WindowsDpapiCredentialStore,
  createCredentialStore,
  runProcess,
} = require("../credentialStore.js");

const fakeToken = ["sk", "test-credential-store-token"].join("_");

function createFakeChild({ closeOnKill = true, onEnd = () => {} } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.killSignals = [];
  child.stdin.end = (input) => onEnd(child, input);
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    child.killSignals.push(signal);
    if (closeOnKill) queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  return child;
}

test("credential process is direct, bounded, and preserves successful output", async () => {
  let spawnOptions;
  const child = createFakeChild({
    onEnd(currentChild, input) {
      assert.equal(input, "request-input");
      queueMicrotask(() => {
        currentChild.stdout.emit("data", Buffer.from("credential-result"));
        currentChild.stderr.emit("data", Buffer.from("diagnostic"));
        currentChild.exitCode = 0;
        currentChild.emit("close", 0, null);
      });
    },
  });

  const result = await runProcess("credential-helper", ["read"], "request-input", {
    maxOutputBytes: 32,
    spawnImpl(command, args, options) {
      assert.equal(command, "credential-helper");
      assert.deepEqual(args, ["read"]);
      spawnOptions = options;
      return child;
    },
    timeoutMs: 100,
  });

  assert.equal(result.stdout, "credential-result");
  assert.equal(result.stderr, "diagnostic");
  assert.equal(spawnOptions.shell, false);
  assert.equal(spawnOptions.stdio[0], "pipe");
});

test("credential process timeout terminates only its direct child", async () => {
  const child = createFakeChild({ closeOnKill: false });

  await assert.rejects(
    runProcess("credential-helper", [], "", {
      killGraceMs: 5,
      spawnImpl: () => child,
      timeoutMs: 5,
    }),
    { code: "CREDENTIAL_PROCESS_TIMEOUT", message: "Credential command timed out" },
  );

  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
});

test("credential process rejects oversized output without returning its contents", async () => {
  const privateOutput = "private-credential-output";
  const child = createFakeChild({
    onEnd(currentChild) {
      queueMicrotask(() => currentChild.stdout.emit("data", Buffer.from(privateOutput)));
    },
  });

  await assert.rejects(
    runProcess("credential-helper", [], "", {
      maxOutputBytes: 8,
      spawnImpl: () => child,
      timeoutMs: 100,
    }),
    (error) => {
      assert.equal(error.code, "CREDENTIAL_PROCESS_OUTPUT_LIMIT");
      assert.doesNotMatch(error.message, new RegExp(privateOutput));
      assert.equal(Object.hasOwn(error, "stdout"), false);
      assert.equal(Object.hasOwn(error, "stderr"), false);
      return true;
    },
  );
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("credential process handles stdin failures and terminates its child", async () => {
  const child = createFakeChild({
    onEnd(currentChild) {
      queueMicrotask(() => currentChild.stdin.emit("error", new Error("write failed")));
    },
  });

  await assert.rejects(
    runProcess("credential-helper", [], fakeToken, {
      spawnImpl: () => child,
      timeoutMs: 100,
    }),
    {
      code: "CREDENTIAL_PROCESS_STDIN_ERROR",
      message: "Credential command could not receive its input",
    },
  );
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("credential process preserves exit code 44 without exposing stderr", async () => {
  const privateError = "private credential diagnostic";
  const child = createFakeChild({
    onEnd(currentChild) {
      queueMicrotask(() => {
        currentChild.stderr.emit("data", Buffer.from(privateError));
        currentChild.exitCode = 44;
        currentChild.emit("close", 44, null);
      });
    },
  });

  await assert.rejects(
    runProcess("credential-helper", [], "", {
      spawnImpl: () => child,
      timeoutMs: 100,
    }),
    (error) => {
      assert.equal(error.code, 44);
      assert.doesNotMatch(error.message, new RegExp(privateError));
      assert.equal(Object.hasOwn(error, "stderr"), false);
      return true;
    },
  );
});

test("memory credentials are session-only and clearable", async () => {
  const store = new MemoryCredentialStore();
  assert.equal(store.persistent, false);
  assert.equal(await store.load(), null);
  await store.save(fakeToken);
  assert.equal(await store.load(), fakeToken);
  await store.clear();
  assert.equal(await store.load(), null);
});

test("macOS Keychain adapter uses a fixed service and tolerates missing entries", async () => {
  const calls = [];
  const runner = async (command, args, input) => {
    calls.push({ command, args, input });
    if (args[0] === "find-generic-password") return { stdout: `${fakeToken}\n` };
    return { stdout: "" };
  };
  const store = new MacOSKeychainCredentialStore({ runner });

  assert.equal(await store.load(), fakeToken);
  await store.save(fakeToken);
  await store.clear();

  assert.ok(calls.every((call) => call.command === "/usr/bin/security"));
  assert.ok(calls.every((call) => call.args.includes("ai.pollinations.midijourney")));
  assert.ok(calls.every((call) => call.args.includes("pollinations-user")));
  const saveCall = calls.find((call) => call.args[0] === "add-generic-password");
  assert.equal(saveCall.input, `${fakeToken}\n${fakeToken}\n`);
  assert.equal(saveCall.args.includes(fakeToken), false);
  assert.equal(saveCall.args.at(-1), "-w");

  const callsBeforeInvalidSave = calls.length;
  await assert.rejects(() => store.save(`${fakeToken}\nsecond-line`), {
    code: "CREDENTIAL_VALUE_ERROR",
    message: "Credential value cannot be stored",
  });
  assert.equal(calls.length, callsBeforeInvalidSave);

  const missingStore = new MacOSKeychainCredentialStore({
    runner: async () => {
      const error = new Error("not found");
      error.code = 44;
      throw error;
    },
  });
  assert.equal(await missingStore.load(), null);
  await missingStore.clear();
});

test("Windows adapter passes tokens through stdin and uses user-scoped DPAPI", async () => {
  const calls = [];
  const credentialPath = path.join(os.tmpdir(), "midijourney-test", "token.bin");
  const runner = async (command, args, input, options) => {
    calls.push({ command, args, input, options });
    return { stdout: "" };
  };
  const store = new WindowsDpapiCredentialStore({ runner, credentialPath });

  await store.save(fakeToken);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "powershell.exe");
  assert.equal(calls[0].input, fakeToken);
  assert.equal(calls[0].args.includes(fakeToken), false);
  assert.equal(calls[0].options.env.MIDIJOURNEY_CREDENTIAL_PATH, credentialPath);

  const encodedScript = Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le");
  assert.match(encodedScript, /DataProtectionScope]::CurrentUser/);
  assert.match(encodedScript, /\[Console\]::In\.ReadToEnd\(\)/);
});

test("credential-store factory chooses the platform adapter", () => {
  assert.ok(createCredentialStore({ platform: "darwin" }) instanceof MacOSKeychainCredentialStore);
  assert.ok(createCredentialStore({ platform: "win32" }) instanceof WindowsDpapiCredentialStore);
  assert.ok(createCredentialStore({ platform: "linux" }) instanceof MemoryCredentialStore);
});
