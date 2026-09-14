import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const require = createRequire(import.meta.url);
const { CONFIG, hasConfiguredAppKey } = require("../core/config.js");
export default {
  root: dirname(fileURLToPath(import.meta.url)), base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom", "@pollinations/sdk"], alias: [{ find: /^@pollinations\/sdk$/, replacement: resolve(dirname(require.resolve("@pollinations/sdk/package.json")), "dist/index.js") }] },
  define: { __MIDIJOURNEY_APP_KEY__: JSON.stringify(hasConfiguredAppKey() ? CONFIG.appKey : "") },
  server: { host: "localhost", port: 5178, strictPort: true },
};
