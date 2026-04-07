import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.CALENDAR_HOST || "127.0.0.1";
const PORT = Number(process.env.CALENDAR_PORT || 4173);
const ROOT = __dirname;
const VAULT_ROOT = path.resolve(__dirname, "..", "..");
const INBOX_PATH = process.env.CALENDAR_INBOX_PATH || "6. Obsidian/Inbox";

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

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = decoded === "/" ? "/cal.html" : decoded;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

function safeResolveVaultPath(relativePath) {
  const raw = String(relativePath || "").trim();
  if (!raw) return null;

  const candidates = new Set();
  const addCandidate = (value) => {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.toLowerCase().endsWith(".md")) {
      candidates.add(normalized);
    }
  };

  addCandidate(raw);

  try {
    addCandidate(decodeURIComponent(raw));
  } catch {
    // ignore invalid URI encoding
  }

  // Recover common mojibake: UTF-8 bytes interpreted as latin1 (e.g. KrÃ¶llwitz -> Kröllwitz)
  addCandidate(Buffer.from(raw, "latin1").toString("utf8"));

  for (const candidate of candidates) {
    const resolved = path.resolve(VAULT_ROOT, candidate);
    if (!resolved.startsWith(VAULT_ROOT)) continue;
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      return resolved;
    }
  }

  return null;
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function addOneDay(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

function yamlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function normalizeTitleToFileBase(title) {
  const normalized = String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/^\.+/g, "")
    .trim();
  return normalized || "Neues Event";
}

function resolveInboxDirectory() {
  const normalized = INBOX_PATH.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(VAULT_ROOT, normalized);
  if (!resolved.startsWith(VAULT_ROOT)) {
    throw new Error(`Inbox path escapes vault: ${INBOX_PATH}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function pickUniqueFilePath(dirPath, fileBaseName) {
  const baseName = normalizeTitleToFileBase(fileBaseName);
  let counter = 1;
  while (true) {
    const suffix = counter === 1 ? "" : ` (${counter})`;
    const candidate = path.join(dirPath, `${baseName}${suffix}.md`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function createEventMarkdownFile({ title, startDate, endDate }) {
  const safeTitle = String(title || "").trim();
  if (!safeTitle) throw new Error("Missing title");
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    throw new Error("startDate/endDate must be YYYY-MM-DD");
  }

  const inboxDir = resolveInboxDirectory();
  const filePath = pickUniqueFilePath(inboxDir, safeTitle);
  const lineBreak = "\n";
  const frontmatter =
    `---${lineBreak}` +
    `title: ${yamlQuote(safeTitle)}${lineBreak}` +
    `startDate: ${startDate}${lineBreak}` +
    `endDate: ${endDate}${lineBreak}` +
    `event_background: false${lineBreak}` +
    `tags:${lineBreak}` +
    `  - event${lineBreak}` +
    `---${lineBreak}${lineBreak}` +
    `# ${safeTitle}${lineBreak}`;

  fs.writeFileSync(filePath, frontmatter, "utf8");

  const sourcePath = path.relative(VAULT_ROOT, filePath).replace(/\\/g, "/");
  const event = {
    id: sourcePath,
    title: safeTitle,
    start: startDate,
    allDay: true,
    extendedProps: {
      sourcePath
    }
  };

  if (startDate !== endDate) {
    event.end = addOneDay(endDate);
  }

  return {
    sourcePath,
    event
  };
}

function updateFrontmatterDates(content, startDate, endDate) {
  const normalizedContent = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const fmMatch = normalizedContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    throw new Error("File has no YAML frontmatter");
  }

  const lineBreak = normalizedContent.includes("\r\n") ? "\r\n" : "\n";
  const frontmatter = fmMatch[1];
  const rest = normalizedContent.slice(fmMatch[0].length);

  const lines = frontmatter.split(/\r?\n/);
  let hasStart = false;
  let hasEnd = false;

  const nextLines = lines.map((line) => {
    if (/^startDate\s*:/i.test(line)) {
      hasStart = true;
      return `startDate: ${startDate}`;
    }
    if (/^endDate\s*:/i.test(line)) {
      hasEnd = true;
      return `endDate: ${endDate}`;
    }
    return line;
  });

  if (!hasStart) nextLines.push(`startDate: ${startDate}`);
  if (!hasEnd) nextLines.push(`endDate: ${endDate}`);

  const newFrontmatter = nextLines.join(lineBreak);
  return `---${lineBreak}${newFrontmatter}${lineBreak}---${rest}`;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function openMarkdownInObsidianNewTab(sourcePath) {
  const markdownPath = safeResolveVaultPath(sourcePath);
  if (!markdownPath) {
    throw new Error(`Source markdown file not found for path: ${sourcePath}`);
  }

  const vaultRelativePath = path.relative(VAULT_ROOT, markdownPath).replace(/\\/g, "/");
  execFileSync("obsidian", ["open", `path=${vaultRelativePath}`, "newtab"], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  return vaultRelativePath;
}

function rebuildEventsFile() {
  execFileSync(process.execPath, [path.join(ROOT, "build-events.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/events/update-dates") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON payload");
          return;
        }

        const sourcePath = String(payload.sourcePath || "").trim();
        const startDate = String(payload.startDate || "").trim();
        const endDate = String(payload.endDate || "").trim();

        if (!sourcePath) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing sourcePath");
          return;
        }
        if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("startDate/endDate must be YYYY-MM-DD");
          return;
        }

        const markdownPath = safeResolveVaultPath(sourcePath);
        if (!markdownPath || !fs.existsSync(markdownPath)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Source markdown file not found for path: ${sourcePath}`);
          return;
        }

        const content = fs.readFileSync(markdownPath, "utf8");
        const updated = updateFrontmatterDates(content, startDate, endDate);
        fs.writeFileSync(markdownPath, updated, "utf8");

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, sourcePath, startDate, endDate }));
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while updating event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/events/open-note") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON payload");
          return;
        }

        const sourcePath = String(payload.sourcePath || "").trim();
        if (!sourcePath) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing sourcePath");
          return;
        }

        try {
          const openedPath = openMarkdownInObsidianNewTab(sourcePath);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, sourcePath: openedPath }));
        } catch (error) {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(error.message || "Could not open note in Obsidian");
        }
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while opening note");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/events/create") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON payload");
          return;
        }

        const title = String(payload.title || "").trim();
        const startDate = String(payload.startDate || "").trim();
        const endDate = String(payload.endDate || "").trim() || startDate;

        if (!title) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing title");
          return;
        }
        if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("startDate/endDate must be YYYY-MM-DD");
          return;
        }

        try {
          const result = createEventMarkdownFile({ title, startDate, endDate });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(error.message || "Could not create event");
        }
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while creating event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/events/rebuild") {
    try {
      rebuildEventsFile();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message || "Could not rebuild events");
    }
    return;
  }

  const target = safeResolve(req.url || "/");
  if (!target) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  let filePath = target;
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "cal.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Calendar preview server: http://${HOST}:${PORT}/cal.html`);
  console.log(
    "Calendar API endpoints ready: POST /api/events/update-dates, POST /api/events/open-note, POST /api/events/create, POST /api/events/rebuild"
  );
});
