#!/usr/bin/env node

// Generates the ignored release-only config immediately before freezing the
// AMXD. Running this script is a credential mutation and requires the explicit
// approval documented in AGENTS.md and the local release plan.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(root, "js", "config.release.js");
const appKey = process.env.MIDIJOURNEY_POLLINATIONS_APP_KEY?.trim();

if (!appKey || !/^pk_[A-Za-z0-9_-]{12,}$/.test(appKey)) {
  throw new Error("MIDIJOURNEY_POLLINATIONS_APP_KEY must contain an approved publishable App Key");
}

const source = `// Generated release input. Never commit this file.\nexports.appKey = ${JSON.stringify(appKey)};\n`;
fs.writeFileSync(outputPath, source, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`Configured ignored release input at ${path.relative(root, outputPath)}\n`);
