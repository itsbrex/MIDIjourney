import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { CONFIG } = require("../../js/config.js");
// Whitelist generation settings: never bundle Node auth, the keychain, env
// access or the private release config into the reusable browser MIDI core.
const publicConfig = Object.fromEntries([
  "defaultModel", "defaultTemperature", "maxContextCharacters",
  "maxContextEntryLength", "maxContextMessages", "maxHistoryEntryLength",
  "maxHistoryMessages", "maxClipBeats", "maxInputNotes", "maxOutputNotes",
  "maxPromptLength", "maxTitleLength", "textTimeoutMs", "maxRetries",
].map((key) => [key, CONFIG[key]]));

await build({
  stdin: {
    contents: `
      export { PollinationsMidiClient } from "../../js/pollinationsClient.js";
      export { normalizeHistory, redactSecrets } from "../../js/history.js";
      export { parseMidiClipResponse } from "../../js/encoding/midiClip.js";
      export { CONFIG } from "../../js/config.js";
    `,
    resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
    loader: "js",
  },
  outfile: fileURLToPath(new URL("../.generated/midi-core.mjs", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  plugins: [{
    name: "public-generation-settings",
    setup(builder) {
      builder.onResolve({ filter: /^@pollinations\/sdk$/ }, (args) => args.namespace === "sdk-esm"
        ? { path: args.path, external: true }
        : { path: args.path, namespace: "sdk-esm" });
      builder.onLoad({ filter: /.*/, namespace: "sdk-esm" }, () => ({
        contents: 'export { PollinationsError } from "@pollinations/sdk";',
        loader: "js",
      }));
      builder.onLoad({ filter: /[/\\]js[/\\]config\.js$/ }, () => ({
        contents: `exports.CONFIG = Object.freeze(${JSON.stringify(publicConfig)});`,
        loader: "js",
      }));
    },
  }],
});
