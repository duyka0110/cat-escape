#!/usr/bin/env node
/**
 * Serves this folder on 0.0.0.0 so phones/tablets on the same Wi‑Fi can open
 * http://<this-machine's-LAN-IP>:PORT without copying the project.
 *
 * Usage: node play-remotely.mjs
 *        PORT=9000 node play-remotely.mjs
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const PORT = Number(process.env.PORT) || 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".gpl": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function ipv4LanAddresses() {
  const out = [];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) out.push(net.address);
      }
    }
  } catch {
    /* Sandboxed or restricted hosts may block interface enumeration. */
  }
  return out;
}

function resolvePath(urlPath) {
  try {
    const u = new URL(urlPath, "http://127.0.0.1");
    let p = decodeURIComponent(u.pathname);
    if (p.includes("\0")) return null;
    if (p.endsWith("/")) p = path.posix.join(p, "index.html");
    const abs = path.resolve(ROOT, "." + path.sep + path.normalize(p).replace(/^[/\\]+/, ""));
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
    return abs;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const abs = resolvePath(req.url || "/");
  if (!abs) {
    res.writeHead(400);
    res.end();
    return;
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(abs).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const local = `http://127.0.0.1:${PORT}/`;
  const lines = [
    "",
    "Catrow — remote play (same folder, no copy to other devices)",
    "──────────────────────────────────────────────────────────────",
    `  This machine:  ${local}`,
  ];
  const ips = ipv4LanAddresses();
  if (ips.length) {
    lines.push("  Same Wi‑Fi / LAN:");
    for (const ip of ips) lines.push(`                 http://${ip}:${PORT}/`);
  } else {
    lines.push("  (No non-loopback IPv4 found — connect another device to the same network.)");
  }
  lines.push(
    "",
    "  Over the internet (no port forwarding): install cloudflared, then from another folder:",
    `    cloudflared tunnel --url http://127.0.0.1:${PORT}`,
    "  Or one-shot (needs npm/npx):",
    `    npx --yes cloudflared tunnel --url http://127.0.0.1:${PORT}`,
    "",
    "Press Ctrl+C to stop.",
    ""
  );
  console.log(lines.join("\n"));
});
