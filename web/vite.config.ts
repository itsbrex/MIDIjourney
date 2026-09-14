import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { CONFIG, hasConfiguredAppKey } = require("../js/config.js");

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), {
    name: "standalone-preview-context",
    configureServer(server) {
      server.middlewares.use("/api/context", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ connected: false }));
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/context", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ connected: false }));
      });
    },
  }],
  resolve: {
    dedupe: ["react", "react-dom", "@pollinations/sdk"],
    // The SDK's browser export is a global-script bundle, not an ES module.
    // Select the published ESM entry; keep /react on its normal package export.
    alias: [{ find: /^@pollinations\/sdk$/, replacement: resolve(dirname(require.resolve("@pollinations/sdk/package.json")), "dist/index.js") }],
  },
  define: {
    // Reuse the existing publishable app identity; do not rotate it or import
    // a saved user's Max/OS-keychain session into this browser application.
    __MIDIJOURNEY_APP_KEY__: JSON.stringify(hasConfiguredAppKey() ? CONFIG.appKey : ""),
  },
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  preview: { host: "127.0.0.1", port: 5178, strictPort: true },
});
