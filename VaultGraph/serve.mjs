import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAndWriteGraph, GENERATED_JSON_FILE } from "./build-graph.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.VAULTGRAPH_HOST || "127.0.0.1";
const PORT = Number(process.env.VAULTGRAPH_PORT || 4175);
const ROOT = __dirname;
const ROOT_REAL = fs.realpathSync(ROOT);
const PID_FILE = path.resolve(ROOT, "vault-graph.preview.pid");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

/**
 * Sends a JSON API response.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {number} statusCode - HTTP status code.
 * @param {unknown} payload - JSON-serializable response body.
 * @returns {void}
 */
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/**
 * Sends a plain text API response.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {number} statusCode - HTTP status code.
 * @param {string} text - Response text.
 * @returns {void}
 */
function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

/**
 * Resolves a static asset request below the tool root.
 * @param {unknown} urlPath - Requested URL path.
 * @returns {string|null} Absolute static file path or `null` when rejected.
 */
function safeResolve(urlPath) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch {
    return null;
  }
  const normalized = decoded === "/" ? "/vault-graph.html" : decoded;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  const relativeToRoot = path.relative(ROOT, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return resolved;
}

/**
 * Reads the generated graph JSON file, building it first if needed.
 * @returns {object} Current generated graph payload.
 */
function readGeneratedGraph() {
  if (!fs.existsSync(GENERATED_JSON_FILE)) {
    return buildAndWriteGraph();
  }
  return JSON.parse(fs.readFileSync(GENERATED_JSON_FILE, "utf8"));
}

/**
 * Writes the current process id to the preview PID file.
 * @returns {void}
 */
function writePidFile() {
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
}

/**
 * Removes the preview PID file.
 * @returns {void}
 */
function clearPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore cleanup failures during shutdown.
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/ping") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/graph") {
    try {
      sendJson(res, 200, { ok: true, graph: readGeneratedGraph() });
    } catch (error) {
      sendText(res, 500, error.message || "Could not read graph data");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/graph/rebuild") {
    try {
      const graph = buildAndWriteGraph();
      sendJson(res, 200, { ok: true, graph });
    } catch (error) {
      sendText(res, 500, error.message || "Could not rebuild graph data");
    }
    return;
  }

  const target = safeResolve(req.url || "/");
  if (!target) {
    sendText(res, 403, "Forbidden");
    return;
  }

  let filePath = target;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "vault-graph.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }
  const realFilePath = fs.realpathSync(filePath);
  const relativeToRealRoot = path.relative(ROOT_REAL, realFilePath);
  if (relativeToRealRoot.startsWith("..") || path.isAbsolute(relativeToRealRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  const stream = fs.createReadStream(realFilePath);
  stream.on("error", (error) => {
    console.error(`VaultGraph static file read failed: ${error?.message || error}`);
    if (!res.headersSent) {
      sendText(res, 500, "Could not read static file");
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`VaultGraph preview failed to start: ${HOST}:${PORT} is already in use.`);
    console.error("Run `npm.cmd --prefix .\\Tools\\VaultGraph run stop:preview` and try again.");
  } else {
    console.error(`VaultGraph preview server error: ${error?.message || error}`);
  }
  clearPidFile();
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log(`VaultGraph preview server: http://${HOST}:${PORT}/vault-graph.html`);
  console.log("VaultGraph API endpoints ready: GET /api/ping, GET /api/graph, POST /api/graph/rebuild");
});

process.on("SIGINT", () => {
  clearPidFile();
  process.exit(0);
});

process.on("SIGTERM", () => {
  clearPidFile();
  process.exit(0);
});

process.on("exit", () => {
  clearPidFile();
});
