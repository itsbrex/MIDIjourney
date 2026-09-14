import max from "max-api";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { startUiServer } from "../../extension/src/ui-server.mjs";
import { createClipboardHandler } from "./clipboard.mjs";

const clipboard = createClipboardHandler({ reply: (id, value) => max.outlet("clipboard_response", id, JSON.stringify(value)) });
max.addHandler("clipboard_read", id => clipboard("read", id));
max.addHandler("clipboard_write", (id, raw) => clipboard("write", id, raw));

let server;
let starting;
let liveContext = { connected: false };
function start() {
  if (server) { max.outlet("uiurl", server.editorUrl); return; }
  if (starting) return starting;
  starting = (async () => {
    try {
      server = await startUiServer({ directory: resolve(__dirname, "ui"), getContext: () => liveContext });
      max.outlet("uiurl", server.editorUrl);
      max.post("MIDIjourney Persistent: local UI ready.");
    } catch {
      max.post("MIDIjourney Persistent: close the beta extension editor or other preview using port 5178, then press Retry connection on the device.", max.POST_LEVELS.ERROR);
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
