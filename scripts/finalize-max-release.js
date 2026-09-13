#!/usr/bin/env node

"use strict";

// Run immediately after Max freezes the release candidate. A frozen AMXD is a
// Max-owned binary container, so finalization validates it and records its
// checksum without rewriting any of Max's dependency metadata or payload bytes.
// Each destination file is replaced atomically. The two-file AMXD/checksum pair
// is restored on caught write errors, but cannot be crash-atomic across both paths.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  MAX_AMXD_BYTES,
  validateFrozenAmxd,
} = require("./max-release-portability");
const { verifyMaxReleaseCandidate } = require("./verify-max-release-candidate");

const root = path.resolve(__dirname, "..");
const releaseDevicePath = path.join(root, "MIDIjourney.amxd");
const releaseDigestPath = path.join(root, "MIDIjourney.amxd.sha256");

function temporarySibling(file, purpose) {
  return path.join(
    path.dirname(file),
    `.${path.basename(file)}.${purpose}-${process.pid}-${Date.now()}`,
  );
}

function syncParentDirectory(file, operations = fs) {
  let descriptor = null;
  try {
    descriptor = operations.openSync(path.dirname(file), fs.constants.O_RDONLY);
    operations.fsyncSync(descriptor);
  } catch (error) {
    if (!["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error?.code)) {
      throw error;
    }
  } finally {
    if (descriptor !== null) operations.closeSync(descriptor);
  }
}

function writeTemporaryFile(destination, contents, operations = fs) {
  const temporary = temporarySibling(destination, "tmp");
  let descriptor = null;
  try {
    descriptor = operations.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o644,
    );
    operations.writeFileSync(descriptor, contents);
    operations.fchmodSync(descriptor, 0o644);
    operations.fsyncSync(descriptor);
    operations.closeSync(descriptor);
    descriptor = null;
    return temporary;
  } catch (error) {
    if (descriptor !== null) {
      try {
        operations.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    try {
      operations.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function restoreFile(destination, previousContents, operations = fs) {
  if (previousContents === null) {
    operations.rmSync(destination, { force: true });
    syncParentDirectory(destination, operations);
    return;
  }
  const rollback = writeTemporaryFile(destination, previousContents, operations);
  operations.renameSync(rollback, destination);
  syncParentDirectory(destination, operations);
}

function canonicalDestination(file, description, operations = fs) {
  const parent = operations.realpathSync(path.dirname(path.resolve(file)));
  const destination = path.join(parent, path.basename(file));
  if (operations.existsSync(destination)) {
    const status = operations.lstatSync(destination);
    if (status.isSymbolicLink()) {
      throw new Error(`${description} path must not be a symbolic link`);
    }
    if (!status.isFile()) throw new Error(`${description} path is not a file`);
  }
  return destination;
}

function sameIdentity(left, right) {
  if (left.ino !== 0n || right.ino !== 0n) {
    return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
  }
  return (
    left.dev === right.dev &&
    left.size === right.size &&
    left.birthtimeNs === right.birthtimeNs
  );
}

function readFileSnapshot(
  file,
  description,
  operations = fs,
  maxBytes = null,
) {
  if (!operations.existsSync(file)) return { contents: null, status: null };
  const before = operations.lstatSync(file, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`${description} must be a regular non-symbolic file`);
  }
  if (maxBytes !== null && before.size > BigInt(maxBytes)) {
    throw new Error(`${description} exceeds its size limit`);
  }
  const descriptor = operations.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = operations.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new Error(`${description} changed while it was opened`);
    }
    const contents = operations.readFileSync(descriptor);
    const after = operations.fstatSync(descriptor, { bigint: true });
    if (
      !sameIdentity(opened, after) ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      BigInt(contents.length) !== after.size
    ) {
      throw new Error(`${description} changed while it was read`);
    }
    return { contents, status: after };
  } finally {
    operations.closeSync(descriptor);
  }
}

function assertSnapshotUnchanged(file, snapshot, description, operations = fs) {
  const current = readFileSnapshot(file, description, operations);
  if (
    Boolean(current.status) !== Boolean(snapshot.status) ||
    (current.status &&
      (!sameIdentity(current.status, snapshot.status) ||
        current.status.size !== snapshot.status.size ||
        current.status.mtimeNs !== snapshot.status.mtimeNs ||
        current.status.ctimeNs !== snapshot.status.ctimeNs ||
        !current.contents.equals(snapshot.contents)))
  ) {
    throw new Error(`${description} changed during release finalization`);
  }
}

function lockPathFor(device) {
  return path.join(path.dirname(device), `.${path.basename(device)}.finalize.lock`);
}

function acquireReleaseLock(device, operations = fs) {
  const lockPath = lockPathFor(device);
  let descriptor = null;
  try {
    descriptor = operations.openSync(
      lockPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    operations.writeFileSync(
      descriptor,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    operations.fsyncSync(descriptor);
    syncParentDirectory(lockPath, operations);
    return { descriptor, lockPath };
  } catch (error) {
    if (descriptor !== null) {
      try {
        operations.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
      try {
        operations.rmSync(lockPath, { force: true });
      } catch {
        // Preserve the original failure.
      }
    }
    if (error?.code === "EEXIST") {
      throw new Error(
        "Another release finalization is active, or a crashed run left its lock file",
      );
    }
    throw error;
  }
}

function releaseLock(lock, operations = fs) {
  operations.closeSync(lock.descriptor);
  operations.rmSync(lock.lockPath, { force: true });
  syncParentDirectory(lock.lockPath, operations);
}

function finalizeMaxRelease({
  devicePath = releaseDevicePath,
  digestPath = releaseDigestPath,
  candidatePath = null,
  projectDirectory,
  bundlePath,
  sourcePath,
  fileSystem = fs,
  quiet = false,
} = {}) {
  devicePath = canonicalDestination(devicePath, "Release device", fileSystem);
  digestPath = canonicalDestination(digestPath, "Release checksum", fileSystem);
  if (devicePath === digestPath) {
    throw new Error("Release device and checksum paths must be different");
  }

  let candidateValidation = null;
  let promoted = false;
  let digestReplaced = false;
  let frozenDevice;
  let validation;
  let digest;
  const lock = acquireReleaseLock(devicePath, fileSystem);
  let previousDevice = null;
  let previousDigest = null;
  let temporaryDevicePath = null;
  let temporaryDigestPath = null;
  let finalizationError = null;

  try {
    previousDevice = readFileSnapshot(
      devicePath,
      "Release device",
      fileSystem,
      MAX_AMXD_BYTES,
    );
    previousDigest = readFileSnapshot(
      digestPath,
      "Release checksum",
      fileSystem,
    );
    if (candidatePath) {
      candidatePath = path.resolve(candidatePath);
      candidateValidation = verifyMaxReleaseCandidate({
        devicePath: candidatePath,
        projectDirectory,
        bundlePath,
        sourcePath,
        quiet: true,
      });
      frozenDevice = candidateValidation.verifiedBuffer;
    } else {
      if (!previousDevice.contents) throw new Error("Release device does not exist");
      frozenDevice = previousDevice.contents;
    }

    validation = validateFrozenAmxd(frozenDevice);
    digest = crypto.createHash("sha256").update(frozenDevice).digest("hex");
    const digestRecord = `${digest}  ${path.basename(devicePath)}\n`;
    if (candidatePath) {
      temporaryDevicePath = writeTemporaryFile(devicePath, frozenDevice, fileSystem);
    }
    temporaryDigestPath = writeTemporaryFile(digestPath, digestRecord, fileSystem);
    assertSnapshotUnchanged(
      devicePath,
      previousDevice,
      "Release device",
      fileSystem,
    );
    assertSnapshotUnchanged(
      digestPath,
      previousDigest,
      "Release checksum",
      fileSystem,
    );
    if (temporaryDevicePath) {
      fileSystem.renameSync(temporaryDevicePath, devicePath);
      promoted = true;
      syncParentDirectory(devicePath, fileSystem);
    }
    assertSnapshotUnchanged(
      digestPath,
      previousDigest,
      "Release checksum",
      fileSystem,
    );
    fileSystem.renameSync(temporaryDigestPath, digestPath);
    digestReplaced = true;
    syncParentDirectory(digestPath, fileSystem);

    const installedDevice = readFileSnapshot(
      devicePath,
      "Installed release device",
      fileSystem,
      MAX_AMXD_BYTES,
    );
    const installedDigest = readFileSnapshot(
      digestPath,
      "Installed release checksum",
      fileSystem,
    );
    if (
      !installedDevice.contents?.equals(frozenDevice) ||
      installedDigest.contents?.toString("utf8") !== digestRecord ||
      crypto.createHash("sha256").update(installedDevice.contents).digest("hex") !== digest
    ) {
      throw new Error("Installed release device and checksum failed their final recheck");
    }
  } catch (error) {
    finalizationError = error;
    const rollbackErrors = [];
    const attempt = (operation) => {
      try {
        operation();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    };
    if (promoted && previousDevice) {
      attempt(() => restoreFile(devicePath, previousDevice.contents, fileSystem));
    } else if (temporaryDevicePath) {
      attempt(() => fileSystem.rmSync(temporaryDevicePath, { force: true }));
    }
    if (digestReplaced && previousDigest) {
      attempt(() => restoreFile(digestPath, previousDigest.contents, fileSystem));
    } else if (temporaryDigestPath) {
      attempt(() => fileSystem.rmSync(temporaryDigestPath, { force: true }));
    }
    if (rollbackErrors.length) {
      error.message = `${error.message}; release rollback also failed: ${rollbackErrors.join("; ")}`;
    }
    throw error;
  } finally {
    try {
      releaseLock(lock, fileSystem);
    } catch (lockError) {
      if (finalizationError) {
        finalizationError.message =
          `${finalizationError.message}; release lock cleanup also failed: ${lockError.message}`;
      } else {
        throw lockError;
      }
    }
  }

  if (!quiet) {
    process.stdout.write(
      candidatePath
        ? `Strictly verified and promoted the external frozen candidate (${candidateValidation.canonicalAssetCount} canonical assets), then recorded the release checksum.\n`
        : `Validated native frozen AMXD structure (${validation.zipEntryCount} embedded assets verified) and recorded its checksum without modifying the device. Checksum-only mode does not verify source or staging freshness.\n`,
    );
  }
  return { candidateValidation, digest, promoted, validation };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 2) {
      throw new Error(
        "Usage: node scripts/finalize-max-release.js [candidate.amxd [staging-project-directory]]",
      );
    }
    finalizeMaxRelease({
      candidatePath: args[0] || null,
      projectDirectory: args[1],
    });
  } catch (error) {
    process.stderr.write(`Release finalization failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { finalizeMaxRelease, lockPathFor };
