import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";

// Transport only: PolliProvider still owns OAuth, PKCE, token exchange and
// storage. No credentials go in URLs, command arguments, logs or the Live Set.
export function createBrowserAuth({ openBrowser = openSystemBrowser, now = Date.now } = {}) {
  const capability = randomBytes(32).toString("hex");
  let flow = null;
  function current() {
    if (flow && now() >= flow.expires) flow = null;
    return flow;
  }
  return {
    capability,
    clear() { flow = null; },
    async handle(path, request, response, origin) {
      const json = (status, body) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      const method = path.endsWith("/status") || path.endsWith("/browser-status") ? "GET" : "POST";
      if (request.method !== method) { json(405, { error: "Method not allowed" }); return; }
      if (request.headers["sec-fetch-site"] === "cross-site" ||
          (method === "POST" && (request.headers.origin !== origin ||
          request.headers["content-type"] !== "application/json"))) {
        json(403, { error: "Not allowed" }); return;
      }
      const active = current();
      const fromBrowser = path.endsWith("/complete") || path.endsWith("/browser-status");
      const expected = fromBrowser ? active?.id : capability;
      if (!expected || request.headers.authorization !== `Bearer ${expected}`) {
        json(403, { error: "Connection expired. Click Connect again in Live." }); return;
      }
      if (path === "/api/auth/start") {
        if (active && active.status !== "delivered") { json(409, { error: "A connection is already waiting." }); return; }
        const next = { id: randomBytes(32).toString("hex"), expires: now() + 600_000, status: "pending", apiKey: null };
        flow = next;
        try {
          await openBrowser(`${origin}/#live-connect=${next.id}`);
          json(200, { status: "pending" });
        } catch {
          if (flow === next) flow = null;
          json(502, { error: "Could not open your browser. Please try Connect again." });
        }
      } else if (path === "/api/auth/status") {
        json(200, active ? { status: active.status, apiKey: active.apiKey } : { status: "expired" });
      } else if (path === "/api/auth/browser-status") {
        json(200, { status: active.status });
      } else if (path === "/api/auth/complete") {
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk.toString();
            if (body.length > 8192) { json(413, { error: "Invalid response" }); return; }
          }
          const { apiKey } = JSON.parse(body);
          if (typeof apiKey !== "string" || !apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) {
            json(400, { error: "Invalid response" }); return;
          }
          if (current() !== active) { json(403, { error: "Connection expired" }); return; }
          if (active.status === "delivered" || (active.apiKey && active.apiKey !== apiKey)) {
            json(409, { error: "Connection already completed" }); return;
          }
          active.apiKey = apiKey;
          active.status = "received";
          json(200, { status: "received" });
        } catch { json(400, { error: "Invalid response" }); }
      } else if (path === "/api/auth/finish") {
        if (!active || active.status !== "received") { json(409, { error: "No connection to finish" }); return; }
        active.apiKey = null;
        active.status = "delivered";
        json(200, { status: "delivered" });
      } else if (path === "/api/auth/cancel") {
        flow = null;
        json(200, { status: "canceled" });
      } else { json(404, { error: "Not found" }); }
    },
  };
}

function openSystemBrowser(url) {
  // Only called with a server-created localhost URL, never an arbitrary command
  // or provider callback. Pass an argument array, without a shell.
  const command = process.platform === "darwin" ? "/usr/bin/open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  return new Promise((resolve, reject) => {
    execFile(command, [url], { timeout: 10_000 }, (error) => error ? reject(new Error("Browser launch failed")) : resolve());
  });
}
