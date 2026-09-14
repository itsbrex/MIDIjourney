import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { URL } from "node:url";
import { createBrowserAuth } from "./browser-auth.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };

export async function startUiServer({ directory, assets, getContext, port = 5178, openBrowser = undefined, now = Date.now }) {
  const root = resolve(directory || ".");
  const auth = createBrowserAuth({ openBrowser, now });
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    const address = server.address();
    const expectedHost = `localhost:${typeof address === "object" ? address.port : port}`;
    // Loopback-only; auth handoff additionally requires a per-window capability.
    // No Live mutation endpoint or arbitrary filesystem/SDK operation.
    if (request.headers.host !== expectedHost) {
      response.writeHead(403); response.end("Not allowed"); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, `http://${expectedHost}`).pathname); }
    catch { response.writeHead(400); response.end(); return; }
    if (pathname.startsWith("/api/auth/")) {
      await auth.handle(pathname, request, response, `http://${expectedHost}`); return;
    }
    if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }); response.end(); return; }
    if (pathname === "/api/context") {
      if (request.headers["sec-fetch-site"] === "cross-site") {
        response.writeHead(403); response.end("Not allowed"); return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(getContext())); return;
    }
    const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if ((!assets && !path.startsWith(root.endsWith(sep) ? root : root + sep)) || !MIME[extname(path)]) { response.writeHead(404); response.end(); return; }
    try {
      const name = pathname === "/" ? "index.html" : pathname.slice(1);
      if (assets && !Object.hasOwn(assets, name)) { response.writeHead(404); response.end("Not found"); return; }
      const file = assets ? Buffer.from(assets[name], "base64") : await readFile(path);
      response.setHeader("Content-Type", MIME[extname(path)]);
      response.end(file);
    } catch { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  const address = server.address();
  return {
    url: `http://localhost:${address.port}/`,
    editorUrl: `http://localhost:${address.port}/#live-session=${auth.capability}`,
    close: () => new Promise((done, reject) => {
      auth.clear();
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : done());
    }),
  };
}
