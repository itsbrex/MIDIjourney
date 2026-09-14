import { build } from "../../web/node_modules/esbuild/lib/main.js";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}/dist`, { recursive: true });
await build({
  entryPoints: [`${root}/src/extension.ts`],
  outfile: `${root}/dist/extension.cjs`,
  platform: "node", target: "node24", format: "cjs", bundle: true,
  sourcemap: false,
});
// This directory is exclusively generated UI output. Do not retain stale
// hashed assets from an earlier build in the local installable prototype.
await rm(`${root}/dist/ui`, { recursive: true, force: true });
await cp(fileURLToPath(new URL("../../web/dist/", import.meta.url)), `${root}/dist/ui`, { recursive: true });
console.log("MIDIjourney Extensions prototype built. No Max device or saved login was changed.");
