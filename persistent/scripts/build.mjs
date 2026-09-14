import { mkdir, symlink, lstat, readFile, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { makeDevice } from "./device.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Separate source/build outputs; reuse the already installed, pinned UI toolchain.
// No package install, source rewrite, key rotation or extension reinstall.
try { await lstat(resolve(root, "node_modules")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  await symlink("../web/node_modules", resolve(root, "node_modules"), "dir");
}
const require = createRequire(resolve(root, "package.json"));
const { build: viteBuild } = await import(pathToFileURL(require.resolve("vite")));
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react")));
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")));
const { build } = await import(pathToFileURL(require.resolve("esbuild")));
const { CONFIG, hasConfiguredAppKey } = require("../js/config.js");
await mkdir(resolve(root, "dist"), { recursive: true });
execFileSync(process.execPath, [resolve(root, "scripts/build-core.mjs")], { stdio: "inherit" });
execFileSync(resolve(root, "node_modules/.bin/tsc"), ["--noEmit", "-p", resolve(root, "tsconfig.json")], { stdio: "inherit" });
await viteBuild({
  root, configFile: false, base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom", "@pollinations/sdk"],
    alias: [{ find: /^@pollinations\/sdk$/, replacement: resolve(dirname(require.resolve("@pollinations/sdk/package.json")), "dist/index.js") }],
  },
  define: { __MIDIJOURNEY_APP_KEY__: JSON.stringify(hasConfiguredAppKey() ? CONFIG.appKey : "") },
  build: { outDir: "dist/ui", emptyOutDir: true, target: "chrome135" },
});
await build({ entryPoints: [resolve(root, "max/server.mjs")], outfile: resolve(root, "dist/server.js"),
  bundle: true, platform: "node", format: "cjs", target: "node20", external: ["max-api"] });
await copyFile(resolve(root, "max/bridge.js"), resolve(root, "dist/bridge.js"));
await copyFile(resolve(root, "max/window.js"), resolve(root, "dist/window.js"));
const patch = makeDevice(resolve(root, "dist"));
await writeFile(resolve(root, "dist/MIDIjourney Persistent.maxpat"), JSON.stringify(patch, null, 2));
// Audio-effect container, matching the existing Main-track device. No old patch
// objects are copied. This local POC uses absolute dependency paths intentionally.
const header = Buffer.from((await readFile(resolve(root, "../MIDIjourney.source.amxd"))).subarray(0, 32));
const body = Buffer.from(JSON.stringify(patch) + "\n\0");
header.writeUInt32LE(body.length, 28);
await writeFile(resolve(root, "MIDIjourney Persistent.amxd"), Buffer.concat([header, body]));
console.log("Built separate MIDIjourney Persistent.amxd. Existing versions were not replaced.");
