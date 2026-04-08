import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadDotEnvFile } from "./lib/env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnvFile(path.resolve(__dirname, ".env"));
loadDotEnvFile(path.resolve(__dirname, ".env.local"));

const HOST = process.env.CALENDAR_HOST || "127.0.0.1";
const PORT = Number(process.env.CALENDAR_PORT || 4173);
const ROOT = __dirname;
const VAULT_ROOT = path.resolve(__dirname, "..", "..");
const INBOX_PATH = process.env.CALENDAR_INBOX_PATH || "6. Obsidian/Inbox";
const DEFAULT_BASE_PATH = process.env.OBSIDIAN_BASE_PATH || "6. Obsidian/Live/Kalender.base";
const DEFAULT_BASE_VIEW = process.env.OBSIDIAN_BASE_VIEW || "Tabelle";
const KALENDER_MAP_BASE_PATH = "6. Obsidian/Live/Kalender.base";
const OBSIDIAN_VAULT_NAME = String(process.env.OBSIDIAN_VAULT_NAME || "").trim();
const GOOGLE_CALENDAR_API_KEY = String(process.env.GOOGLE_CALENDAR_API_KEY || "").trim();
const GOOGLE_CALENDAR_IDS = String(process.env.GOOGLE_CALENDAR_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const BOOKMARKS_FILE = path.resolve(VAULT_ROOT, ".obsidian", "bookmarks.json");
const FILTER_STATE_FILE = path.resolve(ROOT, "calendar.filter-state.json");
const PID_FILE = path.resolve(ROOT, "calendar.preview.pid");
const KALENDAR_BASES_GROUP = "Kalendar Bases";
const API_TOKEN = String(process.env.CALENDAR_API_TOKEN || "").trim() || crypto.randomBytes(24).toString("hex");

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

function normalizeCoordinateNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCoordinatesInput(value) {
  if (value == null) return null;

  if (Array.isArray(value)) {
    if (value.length < 2) return null;
    const lat = normalizeCoordinateNumber(value[0]);
    const lng = normalizeCoordinateNumber(value[1]);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  if (typeof value === "object") {
    const lat = normalizeCoordinateNumber(value.lat ?? value.latitude);
    const lng = normalizeCoordinateNumber(value.lng ?? value.lon ?? value.long ?? value.longitude);
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = normalizeCoordinateNumber(match[1]);
  const lng = normalizeCoordinateNumber(match[2]);
  if (lat == null || lng == null) return null;
  return { lat, lng };
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
  let decoded = "";
  try {
    decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch {
    return null;
  }
  const normalized = decoded === "/" ? "/cal.html" : decoded;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

function parseOriginHeader(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return "";
  }
}

function allowedHostHeaders() {
  return new Set(
    [
      `${HOST}:${PORT}`,
      `localhost:${PORT}`,
      `127.0.0.1:${PORT}`,
      `[::1]:${PORT}`
    ].map((value) => String(value || "").toLowerCase())
  );
}

function allowedOrigins() {
  return new Set(
    [
      `http://${HOST}:${PORT}`,
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      `http://[::1]:${PORT}`
    ].map((value) => String(value || "").toLowerCase())
  );
}

function hasJsonContentType(req) {
  const value = String(req.headers["content-type"] || "").toLowerCase();
  return value.startsWith("application/json");
}

function isValidApiToken(value) {
  const provided = String(value || "").trim();
  if (!provided) return false;
  const expectedBuffer = Buffer.from(API_TOKEN, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function validateMutationRequest(req) {
  const requestHost = String(req.headers.host || "").trim().toLowerCase();
  if (!requestHost || !allowedHostHeaders().has(requestHost)) {
    return "Forbidden host";
  }

  const origin = parseOriginHeader(req.headers.origin || req.headers.referer || "");
  if (origin && !allowedOrigins().has(origin)) {
    return "Forbidden origin";
  }

  const tokenHeader = req.headers["x-calendar-token"];
  const tokenValue = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  if (!isValidApiToken(tokenValue)) {
    return "Invalid or missing API token";
  }

  return "";
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

function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
    String(value || "").trim()
  );
}

function isDateOrDateTime(value) {
  return isIsoDate(value) || isIsoDateTime(value);
}

function normalizeCalendarDateLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  if (isIsoDateTime(raw)) return raw.replace(" ", "T");
  return "";
}

function toIsoDatePart(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match && match[1] ? match[1] : "";
}

function extractDateAndTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](.+))?$/);
  if (!match) return null;
  const datePart = match[1] || "";
  const timePart = match[2] ? `T${match[2].trim()}` : "";
  return { datePart, timePart };
}

function mergeDateWithIncomingTime(existingValue, incomingValue) {
  const existing = extractDateAndTime(existingValue);
  const incoming = extractDateAndTime(incomingValue);
  if (!existing || !existing.datePart || !incoming || !incoming.timePart) return incomingValue;
  return `${existing.datePart}${incoming.timePart}`;
}

function splitFrontmatter(content) {
  const normalizedContent = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lineBreak = normalizedContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = normalizedContent.split(/\r?\n/);
  if (!lines.length || String(lines[0]).trim() !== "---") {
    throw new Error("File has no YAML frontmatter");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (String(lines[i]).trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) {
    throw new Error("File has no YAML frontmatter");
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const rest = lines.slice(endIndex + 1).join(lineBreak);
  return { lineBreak, frontmatterLines, rest };
}

function stripFrontmatter(content) {
  const normalizedContent = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = normalizedContent.split(/\r?\n/);
  if (!lines.length || String(lines[0]).trim() !== "---") {
    return normalizedContent;
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (String(lines[i]).trim() === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }

  return normalizedContent;
}

function topLevelKeyAndValue(line) {
  const match = String(line || "").match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!match) return null;
  return { key: String(match[1]).toLowerCase(), rawValue: String(match[2] || "").trim() };
}

function frontmatterFieldValue(lines, fieldName) {
  const target = String(fieldName || "").toLowerCase();
  for (const line of lines) {
    const parsed = topLevelKeyAndValue(line);
    if (!parsed || parsed.key !== target) continue;
    if (!parsed.rawValue) return "";
    return parsed.rawValue;
  }
  return "";
}

function parseFrontmatterScalar(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function firstFrontmatterValue(content, ...keys) {
  if (!Array.isArray(keys) || keys.length === 0) return "";
  try {
    const { frontmatterLines } = splitFrontmatter(content);
    for (const key of keys) {
      const rawValue = frontmatterFieldValue(frontmatterLines, key);
      const parsedValue = parseFrontmatterScalar(rawValue);
      if (parsedValue) return parsedValue;
    }
  } catch {
    return "";
  }
  return "";
}

function extractFirstMarkdownBlock(content) {
  const body = stripFrontmatter(content);
  const lines = String(body || "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !String(lines[i] || "").trim()) {
    i += 1;
  }
  if (i >= lines.length) return "";

  const firstLine = String(lines[i] || "");
  const isBlockquote = /^\s*>/.test(firstLine);
  const block = [];

  for (; i < lines.length; i += 1) {
    const line = String(lines[i] || "");
    if (!line.trim()) {
      if (block.length > 0) break;
      continue;
    }
    if (isBlockquote && !/^\s*>/.test(line)) break;
    if (!isBlockquote && /^\s*>/.test(line)) break;
    block.push(line);
  }

  return block.join("\n").trim();
}

function readEventPreview(sourcePath) {
  const markdownPath = safeResolveVaultPath(sourcePath);
  if (!markdownPath || !fs.existsSync(markdownPath)) {
    throw new Error(`Source markdown file not found for path: ${sourcePath}`);
  }

  const content = fs.readFileSync(markdownPath, "utf8");
  const title =
    firstFrontmatterValue(content, "title") || path.basename(markdownPath, ".md");
  const start =
    firstFrontmatterValue(content, "event_start", "startDate");
  const end =
    firstFrontmatterValue(content, "event_end", "endDate");

  return {
    sourcePath: path.relative(VAULT_ROOT, markdownPath).replace(/\\/g, "/"),
    title,
    start,
    end,
    previewMarkdown: extractFirstMarkdownBlock(content)
  };
}

function rewriteTopLevelScalarFields(lines, replacements, removeKeys = []) {
  const removeSet = new Set(removeKeys.map((key) => String(key || "").toLowerCase()));
  const replacementEntries = Object.entries(replacements || {}).filter(([key]) => String(key || "").trim());
  const replacementMap = new Map(
    replacementEntries.map(([key, value]) => [String(key).toLowerCase(), { key: String(key), value: String(value) }])
  );
  const written = new Set();
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const parsed = topLevelKeyAndValue(line);
    if (!parsed) {
      out.push(line);
      continue;
    }

    if (removeSet.has(parsed.key)) {
      continue;
    }

    const replacement = replacementMap.get(parsed.key);
    if (!replacement) {
      out.push(line);
      continue;
    }

    if (written.has(parsed.key)) {
      continue;
    }

    out.push(`${replacement.key}: ${replacement.value}`);
    written.add(parsed.key);
  }

  for (const [normalizedKey, replacement] of replacementMap.entries()) {
    if (written.has(normalizedKey)) continue;
    out.push(`${replacement.key}: ${replacement.value}`);
  }

  return out;
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

function createEventMarkdownFile({ title, start, end, allDay }) {
  const safeTitle = String(title || "").trim();
  if (!safeTitle) throw new Error("Missing title");
  if (!isDateOrDateTime(start) || !isDateOrDateTime(end)) {
    throw new Error("start/end must be YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss][timezone]");
  }

  const inboxDir = resolveInboxDirectory();
  const filePath = pickUniqueFilePath(inboxDir, safeTitle);
  const lineBreak = "\n";
  const isTimed = allDay === false;
  const frontmatter =
    `---${lineBreak}` +
    `title: ${yamlQuote(safeTitle)}${lineBreak}` +
    (isTimed
      ? `event_start: ${start}${lineBreak}event_end: ${end}${lineBreak}`
      : `startDate: ${start}${lineBreak}endDate: ${end}${lineBreak}`) +
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
    start,
    allDay: !isTimed,
    extendedProps: {
      sourcePath
    }
  };

  if (isTimed) {
    if (start !== end) event.end = end;
  } else if (start !== end) {
    event.end = addOneDay(end);
  }

  return {
    sourcePath,
    event
  };
}

function updateFrontmatterSchedule(content, { start, end, allDay, recurringSeriesEdit = false }) {
  const { lineBreak, frontmatterLines, rest } = splitFrontmatter(content);
  const isTimed = allDay === false;
  const desiredStartField = isTimed ? "event_start" : "startDate";
  const desiredEndField = isTimed ? "event_end" : "endDate";
  const removeKeys = isTimed ? ["startDate", "endDate"] : ["event_start", "event_end"];
  const persistedStart = recurringSeriesEdit && isTimed ? frontmatterFieldValue(frontmatterLines, "event_start") : "";
  const persistedEnd = recurringSeriesEdit && isTimed ? frontmatterFieldValue(frontmatterLines, "event_end") : "";
  const writeStart =
    recurringSeriesEdit && isTimed ? mergeDateWithIncomingTime(persistedStart, start) : start;
  const writeEnd = recurringSeriesEdit && isTimed ? mergeDateWithIncomingTime(persistedEnd, end) : end;
  const nextLines = rewriteTopLevelScalarFields(
    frontmatterLines,
    {
      [desiredStartField]: writeStart,
      [desiredEndField]: writeEnd
    },
    removeKeys
  );

  const newFrontmatter = nextLines.join(lineBreak);
  return `---${lineBreak}${newFrontmatter}${lineBreak}---${lineBreak}${rest}`;
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

function withVaultArgs(args) {
  if (!OBSIDIAN_VAULT_NAME) return args;
  return [args[0], `vault=${OBSIDIAN_VAULT_NAME}`, ...args.slice(1)];
}

function openMarkdownInObsidianNewTab(sourcePath) {
  const markdownPath = safeResolveVaultPath(sourcePath);
  if (!markdownPath) {
    throw new Error(`Source markdown file not found for path: ${sourcePath}`);
  }

  const vaultRelativePath = path.relative(VAULT_ROOT, markdownPath).replace(/\\/g, "/");
  execFileSync("obsidian", withVaultArgs(["open", `path=${vaultRelativePath}`, "newtab"]), {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  return vaultRelativePath;
}

function openKalenderBaseMapInObsidianNewTab(coordinates = null) {
  const basePath = normalizeVaultRelativePath(KALENDER_MAP_BASE_PATH);
  if (!basePath || !basePathExists(basePath)) {
    throw new Error(`Base file not found: ${basePath || KALENDER_MAP_BASE_PATH}`);
  }

  const safeCoordinates =
    coordinates &&
    Number.isFinite(Number(coordinates.lat)) &&
    Number.isFinite(Number(coordinates.lng))
      ? { lat: Number(coordinates.lat), lng: Number(coordinates.lng) }
      : null;
  const zoom = 14;

  execFileSync("obsidian", withVaultArgs(["tab:open", "view=bases", `file=${basePath}`]), {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 10000
  });

  const script = `
const basePath = ${JSON.stringify(basePath)};
const coords = ${JSON.stringify(safeCoordinates)};
const desiredZoom = ${zoom};
const leaves = app.workspace.getLeavesOfType("bases") || [];
const leaf = leaves.length ? leaves[leaves.length - 1] : null;
if (!leaf) throw new Error("No bases tab found after opening " + basePath);
leaf.setViewState({
  type: "bases",
  state: { file: basePath, viewName: "Map" },
  active: true
});
if (coords) {
  const applyMapFocus = () => {
    const controller = leaf.view?.controller || null;
    const mapView = Array.isArray(controller?._children)
      ? controller._children.find((child) => child && child.type === "map")
      : null;
    if (!mapView) return false;

    const map = mapView.map || null;
    const ephemeral = { center: { lng: coords.lng, lat: coords.lat }, zoom: desiredZoom };
    if (typeof mapView.setEphemeralState === "function") {
      mapView.setEphemeralState(ephemeral);
    }
    if (mapView.mapConfig) {
      mapView.mapConfig.center = [coords.lat, coords.lng];
      mapView.mapConfig.defaultZoom = desiredZoom;
    }

    if (!map) return false;
    if (typeof map.jumpTo === "function") {
      map.jumpTo({ center: [coords.lng, coords.lat], zoom: desiredZoom });
    } else {
      if (typeof map.setCenter === "function") map.setCenter([coords.lng, coords.lat]);
      if (typeof map.setZoom === "function") map.setZoom(desiredZoom);
    }
    return true;
  };

  let attempts = 0;
  const maxAttempts = 20;
  const retryId = window.setInterval(() => {
    attempts += 1;
    const focused = applyMapFocus();
    if (focused || attempts >= maxAttempts) {
      window.clearInterval(retryId);
    }
  }, 250);
  applyMapFocus();
}
JSON.stringify({ basePath, view: "Map", centered: Boolean(coords) });
`.trim();

  const raw = execFileSync("obsidian", withVaultArgs(["eval", `code=${script}`]), {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 10000
  });
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  if (!clean) {
    throw new Error("Obsidian eval returned no output while opening map view");
  }
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Unexpected response while opening map view: ${clean}`);
  }
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

function writePidFile() {
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
}

function clearPidFile() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const current = String(fs.readFileSync(PID_FILE, "utf8") || "").trim();
    if (current && Number(current) !== process.pid) return;
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore cleanup failures on shutdown
  }
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

  const raw = execFileSync("obsidian", withVaultArgs(["eval", `code=${js}`]), {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  return JSON.parse(clean);
}

function getGoogleCalendarConfig() {
  return {
    enabled: Boolean(GOOGLE_CALENDAR_API_KEY && GOOGLE_CALENDAR_IDS.length > 0),
    calendars: GOOGLE_CALENDAR_IDS.map((id) => ({ id }))
  };
}

function normalizeGoogleRangeDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

const GOOGLE_FALLBACK_EVENT_BG = "#a4bdfc";
const GOOGLE_FALLBACK_EVENT_TEXT = "#1d1d1d";
const GOOGLE_FALLBACK_COLOR_ID = "1";

async function fetchGoogleCalendarColorPalette() {
  const endpoint = new URL("https://www.googleapis.com/calendar/v3/colors");
  endpoint.searchParams.set("key", GOOGLE_CALENDAR_API_KEY);
  const response = await fetch(endpoint.toString(), { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google color palette request failed: ${body || response.statusText}`);
  }
  const payload = await response.json();
  return {
    event: payload?.event && typeof payload.event === "object" ? payload.event : {},
    calendar: payload?.calendar && typeof payload.calendar === "object" ? payload.calendar : {}
  };
}

async function fetchGoogleCalendarMetadata(calendarId, colorPalette) {
  const endpoint = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`);
  endpoint.searchParams.set("key", GOOGLE_CALENDAR_API_KEY);
  const response = await fetch(endpoint.toString(), { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google calendar metadata request failed for ${calendarId}: ${body || response.statusText}`);
  }
  const payload = await response.json();
  const colorId = String(payload?.colorId || "").trim();
  const paletteColor = colorId ? colorPalette?.calendar?.[colorId] : null;
  return {
    id: calendarId,
    summary: String(payload?.summary || payload?.id || calendarId).trim(),
    colorId,
    backgroundColor: String(payload?.backgroundColor || paletteColor?.background || "").trim(),
    foregroundColor: String(payload?.foregroundColor || paletteColor?.foreground || "").trim()
  };
}

function resolveGoogleEventColors(item, calendarMeta, colorPalette) {
  const eventColorId = String(item?.colorId || "").trim();
  const calendarColorId = String(calendarMeta?.colorId || "").trim();
  const effectiveColorId = eventColorId || calendarColorId || GOOGLE_FALLBACK_COLOR_ID;
  const eventPaletteColor = effectiveColorId ? colorPalette?.event?.[effectiveColorId] : null;
  const calendarPaletteColor = effectiveColorId ? colorPalette?.calendar?.[effectiveColorId] : null;
  const explicitBackground = String(item?.backgroundColor || "").trim();
  const explicitForeground = String(item?.foregroundColor || "").trim();
  const backgroundColor = String(
    explicitBackground ||
      eventPaletteColor?.background ||
      calendarMeta?.backgroundColor ||
      calendarPaletteColor?.background ||
      GOOGLE_FALLBACK_EVENT_BG
  ).trim();
  const textColor = String(
    explicitForeground ||
      eventPaletteColor?.foreground ||
      calendarMeta?.foregroundColor ||
      calendarPaletteColor?.foreground ||
      GOOGLE_FALLBACK_EVENT_TEXT
  ).trim();
  return { eventColorId: effectiveColorId, backgroundColor, textColor };
}

async function fetchGoogleCalendarEventsForCalendar(calendarId, timeMin, timeMax, colorPalette, calendarMeta) {
  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  endpoint.searchParams.set("singleEvents", "true");
  endpoint.searchParams.set("orderBy", "startTime");
  endpoint.searchParams.set("maxResults", "2500");
  endpoint.searchParams.set("timeMin", timeMin);
  endpoint.searchParams.set("timeMax", timeMax);
  endpoint.searchParams.set("key", GOOGLE_CALENDAR_API_KEY);

  const response = await fetch(endpoint.toString(), { method: "GET" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Calendar request failed for ${calendarId}: ${body || response.statusText}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => {
      const start = String(item?.start?.dateTime || item?.start?.date || "").trim();
      const end = String(item?.end?.dateTime || item?.end?.date || "").trim();
      if (!start) return null;
      const allDay = Boolean(item?.start?.date && !item?.start?.dateTime);
      const eventColors = resolveGoogleEventColors(item, calendarMeta, colorPalette);
      const event = {
        id: `gcal:${calendarId}:${String(item?.id || Math.random()).trim()}`,
        title: String(item?.summary || "(No title)").trim(),
        start,
        allDay,
        editable: false,
        backgroundColor: eventColors.backgroundColor || undefined,
        borderColor: eventColors.backgroundColor || undefined,
        textColor: eventColors.textColor || undefined,
        extendedProps: {
          externalSource: "google",
          googleCalendarId: calendarId,
          googleColorId: eventColors.eventColorId,
          googleBackgroundColor: eventColors.backgroundColor,
          googleTextColor: eventColors.textColor,
          googleHtmlLink: String(item?.htmlLink || "").trim(),
          googleDescription: String(item?.description || "").trim(),
          googleLocation: String(item?.location || "").trim(),
          googleCalendarSummary: String(calendarMeta?.summary || item?.organizer?.displayName || item?.organizer?.email || calendarId).trim()
        }
      };
      if (end) event.end = end;
      return event;
    })
    .filter(Boolean);
}

async function fetchGoogleCalendarEventsInRange(start, end) {
  const config = getGoogleCalendarConfig();
  if (!config.enabled) {
    return [];
  }

  const timeMin = normalizeGoogleRangeDateTime(start);
  const timeMax = normalizeGoogleRangeDateTime(end);
  if (!timeMin || !timeMax) {
    throw new Error("Missing or invalid start/end range");
  }

  let colorPalette = { event: {}, calendar: {} };
  try {
    colorPalette = await fetchGoogleCalendarColorPalette();
  } catch {
    // Continue without palette; calendar/event colors may still come from metadata.
  }

  const all = await Promise.all(
    GOOGLE_CALENDAR_IDS.map(async (calendarId) => {
      let calendarMeta = {
        id: calendarId,
        summary: calendarId,
        colorId: "",
        backgroundColor: "",
        foregroundColor: ""
      };
      try {
        calendarMeta = await fetchGoogleCalendarMetadata(calendarId, colorPalette);
      } catch {
        // Continue with defaults if metadata is unavailable for this calendar.
      }
      return fetchGoogleCalendarEventsForCalendar(calendarId, timeMin, timeMax, colorPalette, calendarMeta);
    })
  );

  const merged = all.flat();
  merged.sort(
    (a, b) =>
      String(a.start || "").localeCompare(String(b.start || "")) ||
      String(a.title || "").localeCompare(String(b.title || ""))
  );
  return merged;
}

const availableBaseFilters = readAvailableBaseFilters();
let currentBaseFilter = selectCurrentBaseFilter(availableBaseFilters);
if (currentBaseFilter?.path && basePathExists(currentBaseFilter.path)) {
  saveFilterState(currentBaseFilter);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

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

  if (req.method === "GET" && req.url === "/api/google-calendar/config") {
    const config = getGoogleCalendarConfig();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...config }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/session") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, token: API_TOKEN }));
    return;
  }

  if (req.method === "POST") {
    if (!hasJsonContentType(req)) {
      res.writeHead(415, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Content-Type must be application/json");
      return;
    }

    const authError = validateMutationRequest(req);
    if (authError) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(authError);
      return;
    }
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/google-calendar/events") {
    const start = requestUrl.searchParams.get("start");
    const end = requestUrl.searchParams.get("end");
    fetchGoogleCalendarEventsInRange(start, end)
      .then((events) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, events }));
      })
      .catch((error) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Could not load Google Calendar events");
      });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/events/preview") {
    const sourcePath = String(requestUrl.searchParams.get("sourcePath") || "").trim();
    if (!sourcePath) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing sourcePath");
      return;
    }

    try {
      const preview = readEventPreview(sourcePath);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...preview }));
    } catch (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message || "Could not read event preview");
    }
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
        const start = normalizeCalendarDateLike(payload.start ?? payload.startDate ?? "");
        const end = normalizeCalendarDateLike(payload.end ?? payload.endDate ?? "");
        const recurringSeriesEdit = payload.recurringSeriesEdit === true || payload.recurringSeriesEdit === "true";
        const allDay =
          payload.allDay === true ||
          payload.allDay === "true" ||
          (payload.allDay == null && isIsoDate(start) && isIsoDate(end));

        if (!sourcePath) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing sourcePath");
          return;
        }
        if (!isDateOrDateTime(start) || !isDateOrDateTime(end)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("start/end must be YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss][timezone]");
          return;
        }

        const markdownPath = safeResolveVaultPath(sourcePath);
        if (!markdownPath || !fs.existsSync(markdownPath)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(`Source markdown file not found for path: ${sourcePath}`);
          return;
        }

        const content = fs.readFileSync(markdownPath, "utf8");
        const schedule = allDay
          ? { start: toIsoDatePart(start), end: toIsoDatePart(end), allDay: true }
          : { start, end, allDay: false };
        if (!schedule.start || !schedule.end) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Could not derive valid start/end values");
          return;
        }
        const updated = updateFrontmatterSchedule(content, { ...schedule, recurringSeriesEdit });
        fs.writeFileSync(markdownPath, updated, "utf8");

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, sourcePath, start: schedule.start, end: schedule.end, allDay: schedule.allDay }));
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

  if (req.method === "POST" && req.url === "/api/events/open-map") {
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

        const coordinates = parseCoordinatesInput(payload.coordinates);
        try {
          const opened = openKalenderBaseMapInObsidianNewTab(coordinates);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, ...opened }));
        } catch (error) {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(error.message || "Could not open map view in Obsidian");
        }
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while opening map view");
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
        const start = normalizeCalendarDateLike(payload.start ?? payload.startDate ?? "");
        const end = normalizeCalendarDateLike(payload.end ?? payload.endDate ?? "") || start;
        const allDay =
          payload.allDay === true ||
          payload.allDay === "true" ||
          (payload.allDay == null && isIsoDate(start) && isIsoDate(end));

        if (!title) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing title");
          return;
        }
        if (!isDateOrDateTime(start) || !isDateOrDateTime(end)) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("start/end must be YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss][timezone]");
          return;
        }

        try {
          const schedule = allDay
            ? { start: toIsoDatePart(start), end: toIsoDatePart(end), allDay: true }
            : { start, end, allDay: false };
          if (!schedule.start || !schedule.end) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Could not derive valid start/end values");
            return;
          }
          const result = createEventMarkdownFile({ title, ...schedule });
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

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`Calendar preview failed to start: ${HOST}:${PORT} is already in use.`);
    console.error("Run `npm.cmd --prefix .\\Tools\\Calendar run stop:preview` and try again.");
  } else {
    console.error(`Calendar preview server error: ${error?.message || error}`);
  }
  clearPidFile();
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  writePidFile();
  console.log(`Calendar preview server: http://${HOST}:${PORT}/cal.html`);
  console.log(
    "Calendar API endpoints ready: GET /api/ping, GET /api/obsidian/theme, GET /api/calendar/filters, GET /api/google-calendar/config, GET /api/google-calendar/events, GET /api/session, GET /api/events/preview, POST /api/events/update-dates, POST /api/events/open-note, POST /api/events/open-map, POST /api/events/create, POST /api/events/rebuild"
  );
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
