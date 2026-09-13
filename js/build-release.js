#!/usr/bin/env node

// Builds the self-contained Node for Max entry used by the frozen AMXD.
// The generated JavaScript contains the approved publishable App Key and is
// intentionally ignored. Never print or commit its contents.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ncc = require("@vercel/ncc");

const sourceDirectory = __dirname;
const root = path.resolve(sourceDirectory, "..");
const entryPath = path.join(sourceDirectory, "midiJourney.js");
const configPath = path.join(sourceDirectory, "config.release.js");
const outputPath = path.join(sourceDirectory, "midiJourney.release.js");
const digestPath = path.join(sourceDirectory, "release-app-key.sha256");
const systemPromptPath = path.join(sourceDirectory, "system-prompt.md");
const placeholder = "pk_REPLACE_WITH_MIDIJOURNEY_APP_KEY";
const reviewedSdkFixtureDigest =
  "58a37f5dd729b3d50bddc997e67e9eb72248d94d9feb14fc5fda969287dffc31";

function readReleaseAppKey() {
  if (!fs.existsSync(configPath)) {
    throw new Error("Run the approved release configuration step before building");
  }

  const content = fs.readFileSync(configPath, "utf8");
  const assignment = content.match(/exports\.appKey\s*=\s*("(?:[^"\\]|\\.)*")\s*;/);
  if (!assignment) throw new Error("config.release.js has an unsupported format");

  const appKey = JSON.parse(assignment[1]);
  if (!/^pk_[A-Za-z0-9_-]{12,}$/.test(appKey) || appKey === placeholder) {
    throw new Error("config.release.js does not contain an approved publishable App Key");
  }
  return appKey;
}

async function main() {
  const appKey = readReleaseAppKey();
  const result = await ncc(entryPath, {
    cache: false,
    externals: ["max-api"],
    minify: true,
    quiet: true,
  });

  const assetNames = Object.keys(result.assets).sort();
  if (assetNames.length !== 0) {
    throw new Error("The release bundle contains an unexpected runtime asset");
  }
  const reviewedSystemPrompt = fs.readFileSync(systemPromptPath, "utf8").trim();
  if (require("./systemPrompt") !== reviewedSystemPrompt) {
    throw new Error("systemPrompt.js does not match the reviewed Markdown prompt");
  }
  if (!result.code.includes(appKey)) {
    throw new Error("The approved App Key was not embedded in the release bundle");
  }
  if (!/require\(["']max-api["']\)/.test(result.code)) {
    throw new Error("The release bundle must leave Live's max-api module external");
  }
  if (result.code.includes(`${root}${path.sep}`)) {
    throw new Error("The release bundle contains a machine-specific repository path");
  }
  const credentialLikeValues =
    result.code.match(/\b(?:sk|pk)_[A-Za-z0-9_-]{12,}\b/g) || [];
  const unexpectedCredential = credentialLikeValues.find(
    (value) =>
      value !== appKey &&
      value !== placeholder &&
      crypto.createHash("sha256").update(value).digest("hex") !==
        reviewedSdkFixtureDigest,
  );
  if (unexpectedCredential) {
    throw new Error("The release bundle contains an unreviewed credential-like value");
  }

  fs.writeFileSync(outputPath, result.code, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(outputPath, 0o600);
  const digest = crypto.createHash("sha256").update(appKey).digest("hex");
  fs.writeFileSync(digestPath, `${digest}\n`, { encoding: "utf8", mode: 0o644 });

  process.stdout.write(
    `Built ignored release entry ${path.relative(root, outputPath)} (${Buffer.byteLength(result.code)} bytes)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Release build failed: ${error.message}\n`);
  process.exitCode = 1;
});
