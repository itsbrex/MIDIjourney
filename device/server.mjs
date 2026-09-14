import max from "max-api";
import { execFile } from "node:child_process";
import { startUiServer } from "./ui-server.mjs";
import assets from "#ui-assets";
import { createClipboardHandler } from "./clipboard.mjs";

const clipboard = createClipboardHandler({ reply: (id, value) => max.outlet("clipboard_response", id, JSON.stringify(value)) });
max.addHandler("clipboard_read", id => clipboard("read", id));
max.addHandler("clipboard_write", (id, raw) => clipboard("write", id, raw));
max.addHandler("clipboard_response_write", (id, raw) => clipboard("response", id, raw));

let server;
let starting;
let liveContext = { connected: false };
function start() {
  if (server) { max.outlet("uiurl", server.editorUrl); return; }
  if (starting) return starting;
  starting = (async () => {
    try {
      server = await startUiServer({ assets, getContext: () => liveContext });
      max.outlet("uiurl", server.editorUrl);
      max.outlet("panel", "ready");
    } catch {
      max.outlet("panel", "unavailable");
      max.post("MIDI Journey: close another MIDI Journey device or preview using port 5178, then press Retry.", max.POST_LEVELS.ERROR);
    }
  })().finally(() => { starting = undefined; });
  return starting;
}
max.addHandler("start", start);
// Read-only health/context mirror. Never include credentials or full prompts.
max.addHandler("context", (raw) => {
  try {
    const value = JSON.parse(raw);
    liveContext = { connected: value.connected === true, destination: value.destination, error: value.error };
  } catch { liveContext = { connected: false }; }
});
max.addHandler("dashboard", () => {
  const url = "https://enter.pollinations.ai/pollen";
  const executable = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "/usr/bin/open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  execFile(executable, args, { timeout: 10000 }, (error) => {
    if (error) max.post("Could not open the Pollinations dashboard.", max.POST_LEVELS.ERROR);
  });
});
process.once("SIGTERM", () => {
  void (async () => {
    await starting;
    await server?.close();
  })().finally(() => process.exit(0));
});
void start();
