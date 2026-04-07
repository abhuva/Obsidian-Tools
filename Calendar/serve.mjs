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
const DEFAULT_BASE_PATH = process.env.OBSIDIAN_BASE_PATH || "6. Obsidian/Live/Kalender.base";
const DEFAULT_BASE_VIEW = process.env.OBSIDIAN_BASE_VIEW || "Tabelle";
const BOOKMARKS_FILE = path.resolve(VAULT_ROOT, ".obsidian", "bookmarks.json");
const FILTER_STATE_FILE = path.resolve(ROOT, "calendar.filter-state.json");
const KALENDAR_BASES_GROUP = "Kalendar Bases";

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

function normalizeVaultRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function sanitizeBaseFilter(basePath, baseView, title = "") {
  const pathValue = normalizeVaultRelativePath(basePath);
  return {
    path: pathValue,
    view: String(baseView || DEFAULT_BASE_VIEW).trim() || DEFAULT_BASE_VIEW,
    title: String(title || "").trim() || path.basename(pathValue, ".base")
  };
}

function isValidBasePath(basePath) {
  const normalized = normalizeVaultRelativePath(basePath).toLowerCase();
  return normalized.endsWith(".base");
}

function basePathExists(basePath) {
  const normalized = normalizeVaultRelativePath(basePath);
  if (!normalized || !isValidBasePath(normalized)) return false;
  const resolved = path.resolve(VAULT_ROOT, normalized);
  if (!resolved.startsWith(VAULT_ROOT)) return false;
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function loadSavedFilterState() {
  try {
    if (!fs.existsSync(FILTER_STATE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(FILTER_STATE_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (!isValidBasePath(parsed.path) || !basePathExists(parsed.path)) return null;
    return sanitizeBaseFilter(parsed.path, parsed.view, parsed.title);
  } catch {
    return null;
  }
}

function saveFilterState(filter) {
  const safeFilter = sanitizeBaseFilter(filter.path, filter.view, filter.title);
  fs.writeFileSync(FILTER_STATE_FILE, JSON.stringify(safeFilter, null, 2), "utf8");
}

function collectBaseBookmarks(items, inKalendarBasesGroup = false) {
  const results = [];
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "group") {
      const nextInGroup =
        inKalendarBasesGroup || String(item.title || "").trim() === KALENDAR_BASES_GROUP;
      results.push(...collectBaseBookmarks(item.items || [], nextInGroup));
      continue;
    }
    if (!inKalendarBasesGroup || item.type !== "file") continue;

    const itemPath = normalizeVaultRelativePath(item.path || "");
    if (!isValidBasePath(itemPath) || !basePathExists(itemPath)) continue;
    const itemView = String(item.view || DEFAULT_BASE_VIEW).trim() || DEFAULT_BASE_VIEW;
    const itemTitle = String(item.title || "").trim() || path.basename(itemPath, ".base");
    results.push(sanitizeBaseFilter(itemPath, itemView, itemTitle));
  }
  return results;
}

function readAvailableBaseFilters() {
  const defaultFilter = sanitizeBaseFilter(DEFAULT_BASE_PATH, DEFAULT_BASE_VIEW, "Kalender");
  const byPath = new Map();
  if (basePathExists(defaultFilter.path)) {
    byPath.set(defaultFilter.path, defaultFilter);
  }

  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      const raw = fs.readFileSync(BOOKMARKS_FILE, "utf8");
      const bookmarks = JSON.parse(raw);
      for (const filter of collectBaseBookmarks(bookmarks.items || [])) {
        byPath.set(filter.path, filter);
      }
    }
  } catch {
    // Keep running with default filter only.
  }

  return [...byPath.values()];
}

function selectCurrentBaseFilter(availableFilters) {
  const saved = loadSavedFilterState();
  if (saved) {
    const matched = availableFilters.find((f) => f.path === saved.path) || saved;
    return sanitizeBaseFilter(matched.path, saved.view || matched.view, matched.title || saved.title);
  }

  const envDefault = sanitizeBaseFilter(DEFAULT_BASE_PATH, DEFAULT_BASE_VIEW, "Kalender");
  const envMatch = availableFilters.find((f) => f.path === envDefault.path);
  if (envMatch) return envMatch;
  if (basePathExists(envDefault.path)) return envDefault;
  return availableFilters[0] || envDefault;
}

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

function rebuildEventsFile(baseFilter) {
  const filter = sanitizeBaseFilter(baseFilter.path, baseFilter.view, baseFilter.title);
  if (!isValidBasePath(filter.path) || !basePathExists(filter.path)) {
    throw new Error(`Base file not found: ${filter.path}`);
  }
  execFileSync(process.execPath, [path.join(ROOT, "build-events.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      OBSIDIAN_BASE_PATH: filter.path,
      OBSIDIAN_BASE_VIEW: filter.view
    },
    encoding: "utf8",
    stdio: "pipe"
  });
}

function readObsidianThemeSnapshot() {
  const js = `
const bodyClasses = String(document.body?.className || "");
const styles = getComputedStyle(document.body || document.documentElement);
const isDark = bodyClasses.includes("theme-dark");
const isLight = bodyClasses.includes("theme-light");
JSON.stringify({
  mode: isDark ? "dark" : (isLight ? "light" : "unknown"),
  classes: bodyClasses,
  cssTheme: app.vault.getConfig("cssTheme") || "",
  baseTheme: app.vault.getConfig("theme") || "",
  vars: {
    accent: styles.getPropertyValue("--interactive-accent").trim(),
    accentHover: styles.getPropertyValue("--interactive-accent-hover").trim(),
    bgPrimary: styles.getPropertyValue("--background-primary").trim(),
    bgSecondary: styles.getPropertyValue("--background-secondary").trim(),
    bgMod: styles.getPropertyValue("--background-modifier-form-field").trim(),
    border: styles.getPropertyValue("--background-modifier-border").trim(),
    text: styles.getPropertyValue("--text-normal").trim(),
    textMuted: styles.getPropertyValue("--text-muted").trim(),
    textSuccess: styles.getPropertyValue("--text-success").trim(),
    textError: styles.getPropertyValue("--text-error").trim()
  }
});
`.trim();

  const raw = execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  return JSON.parse(clean);
}

const availableBaseFilters = readAvailableBaseFilters();
let currentBaseFilter = selectCurrentBaseFilter(availableBaseFilters);
if (currentBaseFilter?.path && basePathExists(currentBaseFilter.path)) {
  saveFilterState(currentBaseFilter);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/obsidian/theme") {
    try {
      const theme = readObsidianThemeSnapshot();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, theme }));
    } catch (error) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message || "Could not read Obsidian theme");
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/calendar/filters") {
    const filters = readAvailableBaseFilters();
    const selected =
      filters.find((item) => item.path === currentBaseFilter.path) ||
      selectCurrentBaseFilter(filters);
    currentBaseFilter = selected;
    saveFilterState(selected);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, current: selected, filters }));
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
    readRequestBody(req)
      .then((rawBody) => {
        let payload = {};
        if (rawBody && rawBody.trim()) {
          try {
            payload = JSON.parse(rawBody);
          } catch {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Invalid JSON payload");
            return;
          }
        }

        const filters = readAvailableBaseFilters();
        const requestedBasePath = normalizeVaultRelativePath(payload.basePath || "");
        let nextFilter = currentBaseFilter;

        if (requestedBasePath) {
          const fromBookmarks = filters.find((f) => f.path === requestedBasePath);
          if (fromBookmarks) {
            nextFilter = sanitizeBaseFilter(
              fromBookmarks.path,
              payload.baseView || fromBookmarks.view,
              fromBookmarks.title
            );
          } else if (isValidBasePath(requestedBasePath) && basePathExists(requestedBasePath)) {
            nextFilter = sanitizeBaseFilter(
              requestedBasePath,
              payload.baseView || DEFAULT_BASE_VIEW,
              payload.baseTitle || path.basename(requestedBasePath, ".base")
            );
          } else {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(`Invalid basePath: ${requestedBasePath}`);
            return;
          }
        } else if (payload.baseView) {
          nextFilter = sanitizeBaseFilter(
            currentBaseFilter.path,
            payload.baseView,
            currentBaseFilter.title
          );
        }

        rebuildEventsFile(nextFilter);
        currentBaseFilter = nextFilter;
        saveFilterState(currentBaseFilter);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, current: currentBaseFilter }));
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Could not rebuild events");
      });
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
    "Calendar API endpoints ready: GET /api/ping, GET /api/obsidian/theme, GET /api/calendar/filters, POST /api/events/update-dates, POST /api/events/open-note, POST /api/events/create, POST /api/events/rebuild"
  );
});
