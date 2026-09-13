const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SERVICE_NAME = "ai.pollinations.midijourney";
const ACCOUNT_NAME = "pollinations-user";
const DEFAULT_PROCESS_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const PROCESS_KILL_GRACE_MS = 250;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function processError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function runProcess(command, args, input = "", options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PROCESS_TIMEOUT_MS);
    const maxOutputBytes = positiveInteger(
      options.maxOutputBytes,
      DEFAULT_MAX_OUTPUT_BYTES,
    );
    const killGraceMs = positiveInteger(options.killGraceMs, PROCESS_KILL_GRACE_MS);
    const spawnImpl = options.spawnImpl || spawn;
    let child;

    try {
      child = spawnImpl(command, args, {
        env: options.env || process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (spawnFailure) {
      reject(
        processError(
          "Credential command could not be started",
          spawnFailure && spawnFailure.code ? spawnFailure.code : "CREDENTIAL_PROCESS_START_ERROR",
        ),
      );
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError = null;
    let timeout = null;
    let killTimeout = null;
    let settled = false;

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
    };

    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (error) reject(error);
      else resolve(result);
    };

    const terminate = (error) => {
      if (terminalError || settled) return;
      terminalError = error;

      // This process is spawned directly (never through a shell or detached
      // process group), so kill() targets only the credential helper child.
      killTimeout = setTimeout(() => {
        if (settled) return;
        if (child.exitCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // The child may already have exited between the state check and kill.
          }
        }
        settle(terminalError);
      }, killGraceMs);

      if (child.exitCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {
          settle(terminalError);
        }
      } else {
        settle(terminalError);
      }
    };

    const collectOutput = (target, streamName) => (chunk) => {
      if (terminalError || settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextSize =
        streamName === "stdout" ? stdoutBytes + buffer.length : stderrBytes + buffer.length;

      if (nextSize > maxOutputBytes) {
        terminate(
          processError(
            "Credential command exceeded its output limit",
            "CREDENTIAL_PROCESS_OUTPUT_LIMIT",
          ),
        );
        return;
      }

      target.push(buffer);
      if (streamName === "stdout") stdoutBytes = nextSize;
      else stderrBytes = nextSize;
    };

    child.stdout.on("data", collectOutput(stdout, "stdout"));
    child.stderr.on("data", collectOutput(stderr, "stderr"));
    child.on("error", (spawnFailure) => {
      settle(
        processError(
          "Credential command could not be started",
          spawnFailure && spawnFailure.code ? spawnFailure.code : "CREDENTIAL_PROCESS_START_ERROR",
        ),
      );
    });
    child.stdin.on("error", () => {
      terminate(
        processError(
          "Credential command could not receive its input",
          "CREDENTIAL_PROCESS_STDIN_ERROR",
        ),
      );
    });
    child.on("close", (code) => {
      if (terminalError) {
        settle(terminalError);
        return;
      }

      const result = {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) {
        settle(null, result);
        return;
      }
      const error = new Error(`Credential command failed with exit code ${code}`);
      error.code = code;
      settle(error);
    });

    timeout = setTimeout(() => {
      terminate(
        processError("Credential command timed out", "CREDENTIAL_PROCESS_TIMEOUT"),
      );
    }, timeoutMs);

    try {
      child.stdin.end(input);
    } catch {
      terminate(
        processError(
          "Credential command could not receive its input",
          "CREDENTIAL_PROCESS_STDIN_ERROR",
        ),
      );
    }
  });
}

class MemoryCredentialStore {
  constructor() {
    this.token = null;
    this.persistent = false;
  }

  async load() {
    return this.token;
  }

  async save(token) {
    this.token = token;
  }

  async clear() {
    this.token = null;
  }
}

class MacOSKeychainCredentialStore {
  constructor({ runner = runProcess } = {}) {
    this.runner = runner;
    this.persistent = true;
  }

  async load() {
    try {
      const result = await this.runner("/usr/bin/security", [
        "find-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
        "-w",
      ]);
      return result.stdout.trim() || null;
    } catch (error) {
      if (error.code === 44) return null;
      throw error;
    }
  }

  async save(token) {
    if (typeof token !== "string" || !token || /[\r\n]/.test(token)) {
      throw processError(
        "Credential value cannot be stored",
        "CREDENTIAL_VALUE_ERROR",
      );
    }
    // With -w as the final option, macOS security reads the password from its
    // two confirmation prompts on stdin. Never place a reusable Pollinations
    // token in argv, where process inspection or telemetry could capture it.
    await this.runner(
      "/usr/bin/security",
      [
        "add-generic-password",
        "-U",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
        "-w",
      ],
      `${token}\n${token}\n`,
    );
  }

  async clear() {
    try {
      await this.runner("/usr/bin/security", [
        "delete-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
      ]);
    } catch (error) {
      if (error.code !== 44) throw error;
    }
  }
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

class WindowsDpapiCredentialStore {
  constructor({ runner = runProcess, credentialPath } = {}) {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    this.credentialPath =
      credentialPath || path.join(appData, "MIDIjourney", "pollinations-token.bin");
    this.runner = runner;
    this.persistent = true;
  }

  async load() {
    try {
      await fs.access(this.credentialPath);
    } catch {
      return null;
    }

    const script = `
$bytes = [IO.File]::ReadAllBytes($env:MIDIJOURNEY_CREDENTIAL_PATH)
$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
`;
    const result = await this.runPowerShell(script);
    return result.stdout || null;
  }

  async save(token) {
    await fs.mkdir(path.dirname(this.credentialPath), { recursive: true });
    const script = `
$token = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($token)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes($env:MIDIJOURNEY_CREDENTIAL_PATH, $protected)
`;
    await this.runPowerShell(script, token);
  }

  async clear() {
    await fs.rm(this.credentialPath, { force: true });
  }

  runPowerShell(script, input = "") {
    return this.runner(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)],
      input,
      {
        env: {
          ...process.env,
          MIDIJOURNEY_CREDENTIAL_PATH: this.credentialPath,
        },
      },
    );
  }
}

function createCredentialStore({ platform = process.platform, runner, credentialPath } = {}) {
  if (process.env.MIDIJOURNEY_DISABLE_CREDENTIAL_PERSISTENCE === "1") {
    return new MemoryCredentialStore();
  }
  if (platform === "darwin") return new MacOSKeychainCredentialStore({ runner });
  if (platform === "win32") {
    return new WindowsDpapiCredentialStore({ runner, credentialPath });
  }
  return new MemoryCredentialStore();
}

exports.MemoryCredentialStore = MemoryCredentialStore;
exports.MacOSKeychainCredentialStore = MacOSKeychainCredentialStore;
exports.WindowsDpapiCredentialStore = WindowsDpapiCredentialStore;
exports.createCredentialStore = createCredentialStore;
exports.runProcess = runProcess;
