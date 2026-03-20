"use strict";

const http = require("node:http");
const path = require("node:path");
const fsp = require("node:fs/promises");
const { URL } = require("node:url");
const core = require("./core");

const PORT = Number(process.env.CODEX_MANAGER_PORT || 4286);
const HOST = process.env.CODEX_MANAGER_HOST || "127.0.0.1";
const publicRoot = path.join(__dirname, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, await core.loadState());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/refresh") {
    sendJson(res, 200, await core.refreshUsage());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/capture-current") {
    sendJson(res, 200, await core.triggerQuickCapture());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/actions/launch-login") {
    sendJson(res, 200, await core.launchLoginTerminal());
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/config/api") {
    const body = await parseBody(req);
    sendJson(res, 200, await core.setApiUsage(Boolean(body.enabled)));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/config/auto") {
    const body = await parseBody(req);
    sendJson(res, 200, await core.setAutoSwitch(Boolean(body.enabled)));
    return true;
  }

  const switchMatch = url.pathname.match(/^\/api\/accounts\/(.+)\/switch$/);
  if (req.method === "POST" && switchMatch) {
    sendJson(res, 200, await core.switchAccount(decodeURIComponent(switchMatch[1])));
    return true;
  }

  return false;
}

async function serveStatic(res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicRoot, pathname));
  if (!filePath.startsWith(publicRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Not found" });
      return;
    }
    await serveStatic(res, url);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
      detail: error.stderr || error.stdout || null,
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Codex Manager running at http://${HOST}:${PORT}\n`);
});
