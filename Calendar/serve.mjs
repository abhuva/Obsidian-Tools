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
const OBSIDIAN_BIN = resolveObsidianBin();
const GOOGLE_CALENDAR_API_KEY = String(process.env.GOOGLE_CALENDAR_API_KEY || "").trim();
const GOOGLE_CALENDAR_IDS = String(process.env.GOOGLE_CALENDAR_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const GOOGLE_OAUTH_CLIENT_ID = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
const GOOGLE_OAUTH_CLIENT_SECRET = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
const GOOGLE_OAUTH_REDIRECT_URI =
  String(process.env.GOOGLE_OAUTH_REDIRECT_URI || "").trim() || `http://${HOST}:${PORT}/api/google-oauth/callback`;
const GOOGLE_OAUTH_SCOPES = String(
  process.env.GOOGLE_OAUTH_SCOPES ||
    "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events"
)
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);
const GOOGLE_OAUTH_TOKEN_FILE = path.resolve(
  ROOT,
  String(process.env.GOOGLE_OAUTH_TOKEN_FILE || "google-oauth-token.json")
);
const GOOGLE_DEFAULT_CREATE_CALENDAR_ID =
  String(process.env.GOOGLE_CREATE_CALENDAR_ID || "").trim() || GOOGLE_CALENDAR_IDS[0] || "";
const NEXTCLOUD_CALDAV_BASE_URL = String(process.env.NEXTCLOUD_CALDAV_BASE_URL || "").trim();
const NEXTCLOUD_CALDAV_USERNAME = String(process.env.NEXTCLOUD_CALDAV_USERNAME || "").trim();
const NEXTCLOUD_CALDAV_APP_PASSWORD = String(process.env.NEXTCLOUD_CALDAV_APP_PASSWORD || "").trim();
const NEXTCLOUD_CALDAV_CALENDARS = String(process.env.NEXTCLOUD_CALDAV_CALENDARS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const NEXTCLOUD_DEFAULT_CREATE_CALENDAR_ID =
  String(process.env.NEXTCLOUD_CREATE_CALENDAR_ID || "").trim() || NEXTCLOUD_CALDAV_CALENDARS[0] || "";
const BOOKMARKS_FILE = path.resolve(VAULT_ROOT, ".obsidian", "bookmarks.json");
const FILTER_STATE_FILE = path.resolve(ROOT, "calendar.filter-state.json");
const PID_FILE = path.resolve(ROOT, "calendar.preview.pid");
const KALENDAR_BASES_GROUP = "Kalendar Bases";
const API_TOKEN = String(process.env.CALENDAR_API_TOKEN || "").trim() || crypto.randomBytes(24).toString("hex");
const googleOauthStateStore = new Map();

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
 * Builds candidate executable names/paths for the Obsidian CLI.
 * @returns {string[]} Ordered candidate list, de-duplicated.
 */
function getObsidianBinCandidates() {
  const candidates = [];
  const fromEnv = String(process.env.OBSIDIAN_BIN || "").trim();
  if (fromEnv) {
    candidates.push(fromEnv);
  }

  if (process.platform === "win32") {
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    if (localAppData) {
      candidates.push(path.join(localAppData, "Programs", "Obsidian", "Obsidian.com"));
      candidates.push(path.join(localAppData, "Programs", "Obsidian", "Obsidian.exe"));
    }
  }

  candidates.push("obsidian");
  return Array.from(new Set(candidates));
}

/**
 * Resolves the first usable Obsidian CLI binary candidate.
 * @returns {string} Absolute binary path or command name.
 */
function resolveObsidianBin() {
  for (const candidate of getObsidianBinCandidates()) {
    if (!candidate) continue;
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    return candidate;
  }
  return "obsidian";
}

/**
 * Normalizes a vault-relative path to slash-separated form without leading slash.
 * @param {unknown} value - Raw path-like value.
 * @returns {string} Normalized vault-relative path.
 */
function normalizeVaultRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

/**
 * Parses a coordinate value and returns finite numbers only.
 * @param {unknown} value - Raw coordinate value.
 * @returns {number|null} Parsed coordinate or `null`.
 */
function normalizeCoordinateNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses coordinates from array/object/string input variants.
 * @param {unknown} value - Candidate coordinate payload.
 * @returns {{lat: number, lng: number}|null} Normalized coordinates or `null`.
 */
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

/**
 * Sanitizes a Base filter object to valid path/view/title values.
 * @param {unknown} basePath - Base file path.
 * @param {unknown} baseView - Base view name.
 * @param {unknown} [title=""] - Display title.
 * @returns {{path: string, view: string, title: string}} Sanitized filter object.
 */
function sanitizeBaseFilter(basePath, baseView, title = "") {
  const pathValue = normalizeVaultRelativePath(basePath);
  return {
    path: pathValue,
    view: String(baseView || DEFAULT_BASE_VIEW).trim() || DEFAULT_BASE_VIEW,
    title: String(title || "").trim() || path.basename(pathValue, ".base")
  };
}

/**
 * Validates a `.base` file path.
 * @param {unknown} basePath - Candidate base path.
 * @returns {boolean} `true` when path points to a base file.
 */
function isValidBasePath(basePath) {
  const normalized = normalizeVaultRelativePath(basePath).toLowerCase();
  return normalized.endsWith(".base");
}

/**
 * Checks whether a base file exists inside the vault.
 * @param {unknown} basePath - Candidate base path.
 * @returns {boolean} `true` when file exists and is within vault root.
 */
function basePathExists(basePath) {
  const normalized = normalizeVaultRelativePath(basePath);
  if (!normalized || !isValidBasePath(normalized)) return false;
  const resolved = path.resolve(VAULT_ROOT, normalized);
  if (!resolved.startsWith(VAULT_ROOT)) return false;
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

/**
 * Loads persisted base filter state from disk.
 * @returns {{path: string, view: string, title: string}|null} Saved filter or `null`.
 */
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

/**
 * Persists the active base filter state.
 * @param {{path: string, view: string, title: string}} filter - Filter to persist.
 * @returns {void}
 */
function saveFilterState(filter) {
  const safeFilter = sanitizeBaseFilter(filter.path, filter.view, filter.title);
  fs.writeFileSync(FILTER_STATE_FILE, JSON.stringify(safeFilter, null, 2), "utf8");
}

/**
 * Recursively extracts bookmarked base files from the configured bookmark group.
 * @param {Array<object>} items - Bookmark tree nodes.
 * @param {boolean} [inKalendarBasesGroup=false] - Whether traversal is inside target group.
 * @returns {Array<{path: string, view: string, title: string}>} Collected base filters.
 */
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

/**
 * Reads available base filters from defaults and bookmarks.
 * @returns {Array<{path: string, view: string, title: string}>} Available base filters.
 */
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

/**
 * Selects current base filter using saved state, env defaults, and fallbacks.
 * @param {Array<{path: string, view: string, title: string}>} availableFilters - Available filters.
 * @returns {{path: string, view: string, title: string}} Selected base filter.
 */
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

/**
 * Resolves static asset request paths and blocks path traversal.
 * @param {unknown} urlPath - Requested URL path.
 * @returns {string|null} Absolute file path or `null` when invalid.
 */
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

/**
 * Parses and normalizes an Origin/Referer header to origin-only form.
 * @param {unknown} value - Header value.
 * @returns {string} Normalized origin or empty string.
 */
function parseOriginHeader(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Returns host header values accepted for mutating API requests.
 * @returns {Set<string>} Allowed host header values.
 */
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

/**
 * Returns allowed request origins for mutating API requests.
 * @returns {Set<string>} Allowed origins.
 */
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

/**
 * Checks whether request content type is JSON.
 * @param {import("node:http").IncomingMessage} req - Incoming request.
 * @returns {boolean} `true` when content type starts with `application/json`.
 */
function hasJsonContentType(req) {
  const value = String(req.headers["content-type"] || "").toLowerCase();
  return value.startsWith("application/json");
}

/**
 * Verifies API token using timing-safe comparison.
 * @param {unknown} value - Token candidate.
 * @returns {boolean} `true` when token matches configured API token.
 */
function isValidApiToken(value) {
  const provided = String(value || "").trim();
  if (!provided) return false;
  const expectedBuffer = Buffer.from(API_TOKEN, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Validates host/origin/token constraints for state-changing API calls.
 * @param {import("node:http").IncomingMessage} req - Incoming request.
 * @returns {string} Empty string when valid, otherwise rejection reason.
 */
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

/**
 * Resolves a vault-relative markdown path safely and tolerates common encoding issues.
 * @param {unknown} relativePath - User-supplied vault path.
 * @returns {string|null} Absolute markdown path or `null` when unresolved.
 */
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

  // Recover common mojibake: UTF-8 bytes interpreted as latin1 (e.g. KrÃƒÂ¶llwitz -> KrÃ¶llwitz)
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

/**
 * Checks whether a value is an ISO calendar date (`YYYY-MM-DD`).
 * @param {unknown} value - Candidate date value.
 * @returns {boolean} `true` when value matches ISO date format.
 */
function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

/**
 * Checks whether a value is an ISO datetime accepted by calendar APIs.
 * @param {unknown} value - Candidate datetime value.
 * @returns {boolean} `true` when value matches supported ISO datetime format.
 */
function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
    String(value || "").trim()
  );
}

/**
 * Checks whether value is either ISO date or ISO datetime.
 * @param {unknown} value - Candidate date-like value.
 * @returns {boolean} `true` when value is accepted as date/date-time.
 */
function isDateOrDateTime(value) {
  return isIsoDate(value) || isIsoDateTime(value);
}

/**
 * Normalizes date-like input into canonical `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm...`.
 * @param {unknown} value - Raw date-like input.
 * @returns {string} Normalized date/date-time string, or empty string when invalid.
 */
function normalizeCalendarDateLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  if (isIsoDateTime(raw)) return raw.replace(" ", "T");
  return "";
}

/**
 * Extracts the `YYYY-MM-DD` portion from a date/datetime input.
 * @param {unknown} value - Candidate date-like input.
 * @returns {string} ISO date part, or empty string.
 */
function toIsoDatePart(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match && match[1] ? match[1] : "";
}

/**
 * Splits a date/datetime into date and optional time suffix.
 * @param {unknown} value - Candidate date-like input.
 * @returns {{datePart: string, timePart: string}|null} Parsed parts, or `null` for unsupported input.
 */
function extractDateAndTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](.+))?$/);
  if (!match) return null;
  const datePart = match[1] || "";
  const timePart = match[2] ? `T${match[2].trim()}` : "";
  return { datePart, timePart };
}

/**
 * Keeps the existing date part and replaces its time part with incoming time part.
 * @param {unknown} existingValue - Existing date/datetime value to preserve date from.
 * @param {unknown} incomingValue - Incoming date/datetime value to read time from.
 * @returns {unknown|string} Merged datetime when both parts are available, otherwise `incomingValue`.
 */
function mergeDateWithIncomingTime(existingValue, incomingValue) {
  const existing = extractDateAndTime(existingValue);
  const incoming = extractDateAndTime(incomingValue);
  if (!existing || !existing.datePart || !incoming || !incoming.timePart) return incomingValue;
  return `${existing.datePart}${incoming.timePart}`;
}

/**
 * Splits markdown into YAML frontmatter lines and body.
 * @param {string} content - Raw markdown file content.
 * @returns {{lineBreak: string, frontmatterLines: string[], rest: string}} Parsed frontmatter/body parts.
 */
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

/**
 * Removes YAML frontmatter block from markdown content when present.
 * @param {string} content - Raw markdown file content.
 * @returns {string} Markdown body without frontmatter.
 */
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

/**
 * Parses one top-level YAML scalar line (`key: value`).
 * @param {unknown} line - Frontmatter line text.
 * @returns {{key: string, rawValue: string}|null} Parsed key/value or `null` when not scalar line.
 */
function topLevelKeyAndValue(line) {
  const match = String(line || "").match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
  if (!match) return null;
  return { key: String(match[1]).toLowerCase(), rawValue: String(match[2] || "").trim() };
}

/**
 * Returns raw scalar value for first matching top-level frontmatter key.
 * @param {string[]} lines - Frontmatter lines.
 * @param {unknown} fieldName - Target field name.
 * @returns {string} Raw scalar field value, or empty string.
 */
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

/**
 * Parses scalar frontmatter text and strips matching wrapping quotes.
 * @param {unknown} rawValue - Raw scalar value text.
 * @returns {string} Parsed scalar value.
 */
function parseFrontmatterScalar(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Returns first non-empty parsed frontmatter value among given candidate keys.
 * @param {string} content - Markdown content with optional YAML frontmatter.
 * @param {...string} keys - Candidate keys in priority order.
 * @returns {string} First matching parsed value, or empty string.
 */
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

/**
 * Extracts first visible content block (paragraph/blockquote block) from markdown body.
 * @param {string} content - Markdown content.
 * @returns {string} First content block as markdown, trimmed.
 */
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

/**
 * Reads preview metadata/content for an event markdown note.
 * @param {unknown} sourcePath - Vault-relative event note path.
 * @returns {{sourcePath: string, title: string, start: string, end: string, previewMarkdown: string}} Event preview payload.
 */
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

/**
 * Rewrites/creates top-level YAML scalar keys while optionally removing others.
 * @param {string[]} lines - Existing frontmatter lines.
 * @param {Record<string,string>} replacements - Key/value pairs to write.
 * @param {string[]} [removeKeys=[]] - Keys to remove.
 * @returns {string[]} Rewritten frontmatter lines.
 */
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

/**
 * Adds one day to an ISO date (`YYYY-MM-DD`) in UTC.
 * @param {unknown} isoDate - ISO date input.
 * @returns {string} Next day as ISO date.
 */
function addOneDay(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

/**
 * Quotes/escapes a scalar value for YAML frontmatter output.
 * @param {unknown} value - Raw value.
 * @returns {string} Double-quoted YAML-safe scalar.
 */
function yamlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Sanitizes an event title into a Windows-safe markdown filename base.
 * @param {unknown} title - Raw event title.
 * @returns {string} Filename-safe base name.
 */
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

/**
 * Resolves and creates the configured inbox directory inside the vault.
 * @returns {string} Absolute inbox directory path.
 */
function resolveInboxDirectory() {
  const normalized = INBOX_PATH.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(VAULT_ROOT, normalized);
  if (!resolved.startsWith(VAULT_ROOT)) {
    throw new Error(`Inbox path escapes vault: ${INBOX_PATH}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

/**
 * Chooses a non-existing markdown file path in a directory using `name (n)` suffixes.
 * @param {string} dirPath - Target directory path.
 * @param {unknown} fileBaseName - Desired file base name.
 * @returns {string} Unique absolute file path.
 */
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

/**
 * Creates a new markdown event note in the inbox and returns its event payload.
 * @param {{title: unknown, start: string, end: string, allDay: boolean}} payload - Event creation data.
 * @returns {{sourcePath: string, event: object}} Created note path and FullCalendar event payload.
 */
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

/**
 * Updates schedule-related frontmatter fields while preserving unrelated metadata.
 * @param {string} content - Existing markdown content.
 * @param {{start: string, end: string, allDay: boolean, recurringSeriesEdit?: boolean}} payload - New schedule values.
 * @returns {string} Updated markdown content.
 */
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

/**
 * Reads request body with a hard 1 MiB limit.
 * @param {import("node:http").IncomingMessage} req - Incoming request.
 * @returns {Promise<string>} Raw body string.
 */
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

/**
 * Injects explicit vault targeting into Obsidian CLI arguments when configured.
 * @param {string[]} args - Obsidian CLI args to augment.
 * @returns {string[]} Argument list with optional `vault=` parameter.
 */
function withVaultArgs(args) {
  if (!OBSIDIAN_VAULT_NAME) return args;
  return [args[0], `vault=${OBSIDIAN_VAULT_NAME}`, ...args.slice(1)];
}

/**
 * Detects CLI errors caused by invalid or missing vault targeting.
 * @param {unknown} error - Error thrown by Obsidian CLI execution.
 * @returns {boolean} `true` when the error indicates vault lookup problems.
 */
function isVaultTargetingError(error) {
  const text = String(error?.stderr || error?.stdout || error?.message || "").toLowerCase();
  return (
    text.includes("vault") ||
    text.includes("unable to find the vault") ||
    text.includes("does not exist")
  );
}

/**
 * Executes Obsidian CLI and retries without vault targeting on vault lookup errors.
 * @param {string[]} args - CLI arguments.
 * @param {object} [options={}] - `execFileSync` options.
 * @returns {string} CLI stdout as UTF-8 text.
 */
function runObsidian(args, options = {}) {
  const execOptions = {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    ...options
  };
  if (!OBSIDIAN_VAULT_NAME) {
    return execFileSync(OBSIDIAN_BIN, args, execOptions);
  }
  try {
    return execFileSync(OBSIDIAN_BIN, withVaultArgs(args), execOptions);
  } catch (error) {
    if (!isVaultTargetingError(error)) {
      throw error;
    }
    return execFileSync(OBSIDIAN_BIN, args, execOptions);
  }
}

/**
 * Opens a markdown file in Obsidian in a new tab.
 * @param {unknown} sourcePath - Vault-relative markdown path.
 * @returns {string} Normalized vault-relative path that was opened.
 */
function openMarkdownInObsidianNewTab(sourcePath) {
  const markdownPath = safeResolveVaultPath(sourcePath);
  if (!markdownPath) {
    throw new Error(`Source markdown file not found for path: ${sourcePath}`);
  }

  const vaultRelativePath = path.relative(VAULT_ROOT, markdownPath).replace(/\\/g, "/");
  runObsidian(["open", `path=${vaultRelativePath}`, "newtab"]);
  return vaultRelativePath;
}

/**
 * Opens the kalender base map view and optionally focuses map coordinates.
 * @param {{lat: number, lng: number}|null} [coordinates=null] - Optional map focus coordinates.
 * @returns {{basePath: string, view: string, centered: boolean}} Obsidian map-open response.
 */
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

  runObsidian(["tab:open", "view=bases", `file=${basePath}`], {
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

  const raw = runObsidian(["eval", `code=${script}`], {
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

/**
 * Rebuilds `events.generated.js` for the selected base filter.
 * @param {{path: unknown, view: unknown, title?: unknown}} baseFilter - Base filter payload.
 * @returns {void}
 */
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

/**
 * Writes current preview server PID to the runtime PID file.
 * @returns {void}
 */
function writePidFile() {
  fs.writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
}

/**
 * Deletes the runtime PID file when it belongs to this process.
 * @returns {void}
 */
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

/**
 * Reads current Obsidian theme tokens for frontend mirror mode.
 * @returns {{mode: string, classes: string, cssTheme: string, baseTheme: string, vars: object}} Theme snapshot.
 */
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

  const raw = runObsidian(["eval", `code=${js}`]);
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  return JSON.parse(clean);
}

/**
 * Checks whether Google OAuth client credentials are configured.
 * @returns {boolean} `true` when OAuth client id/secret/redirect are all present.
 */
function hasGoogleOAuthConfig() {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

/**
 * Loads persisted Google OAuth token data from disk.
 * @returns {object|null} Token payload, or `null` when unavailable/invalid.
 */
function loadGoogleOAuthToken() {
  try {
    if (!fs.existsSync(GOOGLE_OAUTH_TOKEN_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(GOOGLE_OAUTH_TOKEN_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persists Google OAuth token data to the configured token file.
 * @param {object} token - Token payload returned by Google OAuth endpoints.
 * @returns {void}
 */
function saveGoogleOAuthToken(token) {
  fs.writeFileSync(GOOGLE_OAUTH_TOKEN_FILE, JSON.stringify(token, null, 2), "utf8");
}

/**
 * Deletes persisted Google OAuth token data from disk.
 * @returns {void}
 */
function clearGoogleOAuthToken() {
  try {
    if (fs.existsSync(GOOGLE_OAUTH_TOKEN_FILE)) {
      fs.unlinkSync(GOOGLE_OAUTH_TOKEN_FILE);
    }
  } catch {
    // ignore cleanup errors
  }
}

/**
 * Splits a Google OAuth scope string into normalized individual scopes.
 * @param {unknown} scopeValue - Raw space-separated scope string.
 * @returns {string[]} Parsed scope list.
 */
function parseGoogleScopes(scopeValue) {
  return String(scopeValue || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Checks whether a scope set allows Google Calendar write operations.
 * @param {unknown} scopeValue - Raw OAuth scope string.
 * @returns {boolean} `true` when one of the write-capable calendar scopes is present.
 */
function isGoogleScopeWritable(scopeValue) {
  const scopes = new Set(parseGoogleScopes(scopeValue));
  return (
    scopes.has("https://www.googleapis.com/auth/calendar") ||
    scopes.has("https://www.googleapis.com/auth/calendar.events") ||
    scopes.has("https://www.googleapis.com/auth/calendar.events.owned")
  );
}

/**
 * Builds OAuth status flags used by the calendar settings UI and API responses.
 * @returns {{configured: boolean, connected: boolean, writable: boolean, scope: string, hasRefreshToken: boolean}} OAuth status snapshot.
 */
function googleOAuthStatusSnapshot() {
  const token = loadGoogleOAuthToken();
  const connected = Boolean(token && (token.access_token || token.refresh_token));
  const writable = Boolean(token && isGoogleScopeWritable(token.scope || ""));
  return {
    configured: hasGoogleOAuthConfig(),
    connected,
    writable,
    scope: String((token && token.scope) || "").trim(),
    hasRefreshToken: Boolean(token && token.refresh_token)
  };
}

/**
 * Exchanges an OAuth authorization code for tokens and stores merged token data.
 * @param {string} code - Authorization code from Google OAuth callback.
 * @returns {Promise<object>} Persisted merged token payload.
 */
async function exchangeGoogleAuthCode(code) {
  const body = new URLSearchParams();
  body.set("code", code);
  body.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  body.set("client_secret", GOOGLE_OAUTH_CLIENT_SECRET);
  body.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI);
  body.set("grant_type", "authorization_code");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "OAuth code exchange failed");
  }
  const token = await response.json();
  const existing = loadGoogleOAuthToken() || {};
  const merged = {
    ...existing,
    ...token,
    refresh_token: String(token.refresh_token || existing.refresh_token || "").trim()
  };
  if (token.expires_in) {
    merged.expires_at = Date.now() + (Number(token.expires_in) * 1000);
  }
  saveGoogleOAuthToken(merged);
  return merged;
}

/**
 * Refreshes the Google access token using a refresh token and persists the result.
 * @param {object} existingToken - Current persisted token payload.
 * @returns {Promise<object>} Refreshed merged token payload.
 */
async function refreshGoogleAccessToken(existingToken) {
  const refreshToken = String(existingToken && existingToken.refresh_token || "").trim();
  if (!refreshToken) {
    throw new Error("Google OAuth token has no refresh_token. Reconnect OAuth.");
  }
  const body = new URLSearchParams();
  body.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  body.set("client_secret", GOOGLE_OAUTH_CLIENT_SECRET);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "OAuth refresh failed");
  }
  const refreshed = await response.json();
  const merged = {
    ...existingToken,
    ...refreshed,
    refresh_token: refreshToken
  };
  if (refreshed.expires_in) {
    merged.expires_at = Date.now() + (Number(refreshed.expires_in) * 1000);
  }
  saveGoogleOAuthToken(merged);
  return merged;
}

/**
 * Returns a valid Google OAuth access token, refreshing when needed.
 * @returns {Promise<string>} Access token, or empty string when OAuth is not available.
 */
async function getGoogleAccessToken() {
  if (!hasGoogleOAuthConfig()) return "";
  const token = loadGoogleOAuthToken();
  if (!token) return "";
  const accessToken = String(token.access_token || "").trim();
  const expiresAt = Number(token.expires_at || 0);
  if (accessToken && Number.isFinite(expiresAt) && expiresAt - Date.now() > 60 * 1000) {
    return accessToken;
  }
  if (!accessToken && !token.refresh_token) return "";
  const refreshed = await refreshGoogleAccessToken(token);
  return String(refreshed.access_token || "").trim();
}

/**
 * Builds Google calendar source configuration for frontend/API use.
 * @returns {{enabled: boolean, calendars: Array<{id: string}>, oauth: object, defaultCreateCalendarId: string}} Google calendar config.
 */
function getGoogleCalendarConfig() {
  const oauthStatus = googleOAuthStatusSnapshot();
  return {
    enabled: Boolean(GOOGLE_CALENDAR_IDS.length > 0 && (GOOGLE_CALENDAR_API_KEY || oauthStatus.connected)),
    calendars: GOOGLE_CALENDAR_IDS.map((id) => ({ id })),
    oauth: oauthStatus,
    defaultCreateCalendarId: GOOGLE_DEFAULT_CREATE_CALENDAR_ID
  };
}

/**
 * Sends an authenticated Google Calendar API request (OAuth preferred, API key fallback for read).
 * @param {string} url - Absolute Google API endpoint URL.
 * @param {{method?: string, body?: object|null, requireOAuth?: boolean}} [options={}] - Request options.
 * @returns {Promise<object|null>} Parsed JSON response, or `null` for `204 No Content`.
 */
async function googleCalendarApiFetch(url, { method = "GET", body = null, requireOAuth = false } = {}) {
  const accessToken = await getGoogleAccessToken();
  const hasOAuth = Boolean(accessToken);
  if (requireOAuth && !hasOAuth) {
    throw new Error("Google OAuth is required. Connect OAuth in calendar settings first.");
  }
  if (!hasOAuth && !GOOGLE_CALENDAR_API_KEY) {
    throw new Error("Google source not configured: missing API key and OAuth token.");
  }

  const endpoint = new URL(url);
  if (!hasOAuth && GOOGLE_CALENDAR_API_KEY) {
    endpoint.searchParams.set("key", GOOGLE_CALENDAR_API_KEY);
  }

  const headers = {};
  if (body != null) headers["Content-Type"] = "application/json";
  if (hasOAuth) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(endpoint.toString(), {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Google API request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Normalizes an input datetime into UTC ISO string for Google range queries.
 * @param {unknown} value - Candidate datetime value.
 * @returns {string} ISO datetime string, or empty string when invalid.
 */
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

/**
 * Loads Google event/calendar color palette metadata.
 * @returns {Promise<{event: object, calendar: object}>} Palette dictionaries keyed by color id.
 */
async function fetchGoogleCalendarColorPalette() {
  const payload = await googleCalendarApiFetch("https://www.googleapis.com/calendar/v3/colors", { method: "GET" });
  return {
    event: payload?.event && typeof payload.event === "object" ? payload.event : {},
    calendar: payload?.calendar && typeof payload.calendar === "object" ? payload.calendar : {}
  };
}

/**
 * Reads metadata for one Google calendar (title + effective colors).
 * @param {string} calendarId - Google calendar id.
 * @param {{event: object, calendar: object}} colorPalette - Palette maps from Google colors endpoint.
 * @returns {Promise<{id: string, summary: string, colorId: string, backgroundColor: string, foregroundColor: string}>} Calendar metadata.
 */
async function fetchGoogleCalendarMetadata(calendarId, colorPalette) {
  const payload = await googleCalendarApiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    { method: "GET" }
  );
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

/**
 * Resolves final event colors using explicit event colors, calendar colors, and fallback palette.
 * @param {object} item - Raw Google Calendar event payload.
 * @param {object} calendarMeta - Calendar metadata including default colors.
 * @param {{event: object, calendar: object}} colorPalette - Palette dictionaries keyed by color id.
 * @returns {{eventColorId: string, backgroundColor: string, textColor: string}} Effective color metadata.
 */
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

/**
 * Fetches events for one Google calendar and maps them to FullCalendar event objects.
 * @param {string} calendarId - Google calendar id.
 * @param {string} timeMin - ISO range start.
 * @param {string} timeMax - ISO range end.
 * @param {{event: object, calendar: object}} colorPalette - Palette dictionaries keyed by color id.
 * @param {object} calendarMeta - Metadata for the calendar.
 * @returns {Promise<Array<object>>} FullCalendar-compatible event list.
 */
async function fetchGoogleCalendarEventsForCalendar(calendarId, timeMin, timeMax, colorPalette, calendarMeta) {
  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  endpoint.searchParams.set("singleEvents", "true");
  endpoint.searchParams.set("orderBy", "startTime");
  endpoint.searchParams.set("maxResults", "2500");
  endpoint.searchParams.set("timeMin", timeMin);
  endpoint.searchParams.set("timeMax", timeMax);
  const payload = await googleCalendarApiFetch(endpoint.toString(), { method: "GET" });
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const oauthStatus = googleOAuthStatusSnapshot();
  const googleEventsEditable = oauthStatus.connected && oauthStatus.writable;
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
        editable: googleEventsEditable,
        backgroundColor: eventColors.backgroundColor || undefined,
        borderColor: eventColors.backgroundColor || undefined,
        textColor: eventColors.textColor || undefined,
        extendedProps: {
          externalSource: "google",
          googleCalendarId: calendarId,
          googleEventId: String(item?.id || "").trim(),
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

/**
 * Fetches and merges Google events across all configured calendars for a time range.
 * @param {unknown} start - Range start datetime.
 * @param {unknown} end - Range end datetime.
 * @returns {Promise<Array<object>>} Merged and sorted FullCalendar events.
 */
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

/**
 * Builds Google event date payload (`date` or `dateTime`) from normalized inputs.
 * @param {unknown} start - Event start value.
 * @param {unknown} end - Event end value.
 * @param {boolean} allDay - Whether event is all-day.
 * @returns {{start: object, end: object}} Google Calendar API date payload.
 */
function toGoogleEventDatePayload(start, end, allDay) {
  const safeStart = normalizeCalendarDateLike(start);
  const safeEnd = normalizeCalendarDateLike(end) || safeStart;
  if (!isDateOrDateTime(safeStart) || !isDateOrDateTime(safeEnd)) {
    throw new Error("start/end must be YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss][timezone]");
  }

  if (allDay) {
    const startDate = toIsoDatePart(safeStart);
    const endDateInclusive = toIsoDatePart(safeEnd) || startDate;
    if (!startDate || !endDateInclusive) {
      throw new Error("Could not derive all-day start/end dates");
    }
    return {
      start: { date: startDate },
      end: { date: addOneDay(endDateInclusive) }
    };
  }

  return {
    start: { dateTime: safeStart },
    end: { dateTime: safeEnd }
  };
}

/**
 * Creates a Google calendar event in the selected/default target calendar.
 * @param {{calendarId?: string, title: unknown, start: unknown, end: unknown, allDay: boolean, colorId?: unknown}} payload - Create payload.
 * @returns {Promise<object>} Created Google event object.
 */
async function createGoogleCalendarEvent({ calendarId, title, start, end, allDay, colorId }) {
  const targetCalendarId = String(calendarId || GOOGLE_DEFAULT_CREATE_CALENDAR_ID || "").trim();
  if (!targetCalendarId) {
    throw new Error("Missing calendarId for Google event create");
  }
  const payload = {
    summary: String(title || "").trim() || "(No title)",
    ...toGoogleEventDatePayload(start, end, Boolean(allDay))
  };
  const safeColorId = String(colorId || "").trim();
  if (safeColorId) payload.colorId = safeColorId;
  const created = await googleCalendarApiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`,
    { method: "POST", body: payload, requireOAuth: true }
  );
  return created;
}

/**
 * Updates an existing Google calendar event by id.
 * @param {{calendarId: unknown, eventId: unknown, title?: unknown, start: unknown, end: unknown, allDay: boolean}} payload - Update payload.
 * @returns {Promise<object>} Updated Google event object.
 */
async function updateGoogleCalendarEvent({ calendarId, eventId, title, start, end, allDay }) {
  const targetCalendarId = String(calendarId || "").trim();
  const targetEventId = String(eventId || "").trim();
  if (!targetCalendarId || !targetEventId) {
    throw new Error("Missing calendarId/eventId for Google event update");
  }
  const patch = {
    ...toGoogleEventDatePayload(start, end, Boolean(allDay))
  };
  const titleValue = String(title || "").trim();
  if (titleValue) patch.summary = titleValue;
  const updated = await googleCalendarApiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(targetEventId)}`,
    { method: "PATCH", body: patch, requireOAuth: true }
  );
  return updated;
}

/**
 * Deletes a Google calendar event by id.
 * @param {{calendarId: unknown, eventId: unknown}} payload - Delete payload.
 * @returns {Promise<void>}
 */
async function deleteGoogleCalendarEvent({ calendarId, eventId }) {
  const targetCalendarId = String(calendarId || "").trim();
  const targetEventId = String(eventId || "").trim();
  if (!targetCalendarId || !targetEventId) {
    throw new Error("Missing calendarId/eventId for Google event delete");
  }
  await googleCalendarApiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(targetEventId)}`,
    { method: "DELETE", requireOAuth: true }
  );
}

/**
 * Checks whether all required Nextcloud CalDAV configuration values are present.
 * @returns {boolean} `true` when base URL, credentials, and at least one calendar are configured.
 */
function hasNextcloudCalDavConfig() {
  return Boolean(
    NEXTCLOUD_CALDAV_BASE_URL &&
      NEXTCLOUD_CALDAV_USERNAME &&
      NEXTCLOUD_CALDAV_APP_PASSWORD &&
      NEXTCLOUD_CALDAV_CALENDARS.length > 0
  );
}

/**
 * Ensures a URL/path string ends with a trailing slash.
 * @param {unknown} value - Candidate input value.
 * @returns {string} Normalized value with trailing slash (or empty string).
 */
function ensureTrailingSlash(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/**
 * Escapes XML special characters for safe embedding in XML documents.
 * @param {unknown} value - Raw text value.
 * @returns {string} Escaped XML text.
 */
function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Unescapes XML entities into plain text.
 * @param {unknown} value - Escaped XML text.
 * @returns {string} Unescaped text.
 */
function xmlUnescape(value) {
  return String(value || "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * Escapes text for ICS property values.
 * @param {unknown} value - Raw text.
 * @returns {string} ICS-escaped text.
 */
function icsEscapeText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Unescapes ICS text property encoding.
 * @param {unknown} value - ICS-escaped text.
 * @returns {string} Decoded text.
 */
function icsUnescapeText(value) {
  return String(value || "")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";");
}

/**
 * Normalizes a Nextcloud calendar id/slug value.
 * @param {unknown} value - Candidate calendar id.
 * @returns {string} Lowercased normalized calendar id.
 */
function normalizeNextcloudCalendarId(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

/**
 * Parses a Nextcloud calendar reference (slug or URL) into stable calendar metadata.
 * @param {unknown} ref - Configured calendar reference.
 * @returns {{id: string, slug: string, href: string, url: string}|null} Parsed calendar metadata, or `null` when invalid.
 */
function parseNextcloudCalendarRef(ref) {
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const base = ensureTrailingSlash(NEXTCLOUD_CALDAV_BASE_URL);
  if (!base) return null;
  let url;
  try {
    if (/^https?:\/\//i.test(raw)) {
      url = new URL(raw);
    } else if (raw.startsWith("/")) {
      url = new URL(raw, base);
    } else if (raw.includes("/")) {
      url = new URL(raw.replace(/^\/+/, ""), base);
    } else {
      const pathValue = `/remote.php/dav/calendars/${encodeURIComponent(NEXTCLOUD_CALDAV_USERNAME)}/${encodeURIComponent(raw)}/`;
      url = new URL(pathValue, base);
    }
  } catch {
    return null;
  }

  const href = ensureTrailingSlash(url.pathname);
  const parts = href.split("/").filter(Boolean);
  const slug = parts.length ? parts[parts.length - 1] : "";
  const id = normalizeNextcloudCalendarId(raw);
  return {
    id,
    slug: decodeURIComponent(slug || raw),
    url: ensureTrailingSlash(url.toString()),
    href
  };
}

/**
 * Builds normalized calendar metadata for all configured Nextcloud calendars.
 * @returns {Array<{id: string, slug: string, href: string, url: string}>} Parsed calendar list.
 */
function buildNextcloudCalendars() {
  const byId = new Map();
  for (const ref of NEXTCLOUD_CALDAV_CALENDARS) {
    const parsed = parseNextcloudCalendarRef(ref);
    if (!parsed) continue;
    byId.set(normalizeNextcloudCalendarId(parsed.id), parsed);
  }
  return [...byId.values()];
}

/**
 * Resolves one Nextcloud calendar by id/slug.
 * @param {unknown} calendarId - Calendar id/slug candidate.
 * @returns {{id: string, slug: string, href: string, url: string}|null} Matching calendar metadata, or `null`.
 */
function resolveNextcloudCalendar(calendarId) {
  const targetId = normalizeNextcloudCalendarId(calendarId);
  const calendars = buildNextcloudCalendars();
  if (!calendars.length) return null;
  if (!targetId) return calendars[0];
  return (
    calendars.find((item) => normalizeNextcloudCalendarId(item.id) === targetId) ||
    calendars.find((item) => normalizeNextcloudCalendarId(item.slug) === targetId) ||
    null
  );
}

/**
 * Builds Nextcloud source configuration for frontend/API use.
 * @returns {{enabled: boolean, calendars: Array<object>, defaultCreateCalendarId: string}} Nextcloud calendar config.
 */
function getNextcloudCalendarConfig() {
  const calendars = buildNextcloudCalendars();
  const enabled = hasNextcloudCalDavConfig() && calendars.length > 0;
  return {
    enabled,
    writable: enabled,
    calendars: calendars.map((item) => ({ id: item.id, slug: item.slug, href: item.href })),
    defaultCreateCalendarId: normalizeNextcloudCalendarId(NEXTCLOUD_DEFAULT_CREATE_CALENDAR_ID || (calendars[0] && calendars[0].id) || "")
  };
}

/**
 * Sends a CalDAV request with Nextcloud basic auth and validates response status.
 * @param {string} url - Target CalDAV URL.
 * @param {{method?: string, headers?: object, body?: string|null, expectedStatus?: number[]}} [options={}] - Fetch options.
 * @returns {Promise<Response>} Raw fetch response.
 */
async function nextcloudCalDavFetch(url, { method = "GET", headers = {}, body = null, expectedStatus = [] } = {}) {
  if (!hasNextcloudCalDavConfig()) {
    throw new Error("Nextcloud CalDAV not configured. Set NEXTCLOUD_CALDAV_* vars in .env.local.");
  }
  const endpoint = String(url || "").trim();
  if (!endpoint) throw new Error("Missing Nextcloud endpoint URL");

  const authToken = Buffer.from(`${NEXTCLOUD_CALDAV_USERNAME}:${NEXTCLOUD_CALDAV_APP_PASSWORD}`, "utf8").toString("base64");
  const requestHeaders = {
    Authorization: `Basic ${authToken}`,
    ...headers
  };

  const response = await fetch(endpoint, {
    method,
    headers: requestHeaders,
    body: body == null ? undefined : body
  });
  const allowed = Array.isArray(expectedStatus) && expectedStatus.length ? expectedStatus : [200];
  if (!allowed.includes(response.status)) {
    const text = await response.text();
    throw new Error(text || `Nextcloud CalDAV request failed (${response.status})`);
  }
  return response;
}

/**
 * Converts a datetime-like input into basic UTC iCalendar format (`YYYYMMDDTHHmmssZ`).
 * @param {unknown} value - Candidate datetime.
 * @returns {string} Basic UTC datetime, or empty string when invalid.
 */
function toCalDavUtcBasicDateTime(value) {
  const raw = String(value || "").trim();
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

/**
 * Parses one unfolded ICS property line into name/params/value.
 * @param {unknown} line - ICS property line.
 * @returns {{name: string, params: Record<string,string>, value: string}|null} Parsed property, or `null` when invalid.
 */
function parseIcsPropertyLine(line) {
  const raw = String(line || "");
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex < 0) return null;
  const left = raw.slice(0, separatorIndex);
  const value = raw.slice(separatorIndex + 1);
  const parts = left.split(";");
  const name = String(parts[0] || "").trim().toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i += 1) {
    const item = String(parts[i] || "");
    const eqIndex = item.indexOf("=");
    if (eqIndex < 0) {
      params[item.toUpperCase()] = "";
      continue;
    }
    const key = item.slice(0, eqIndex).trim().toUpperCase();
    const paramValue = item.slice(eqIndex + 1).trim();
    params[key] = paramValue;
  }
  return { name, params, value };
}

/**
 * Parses ICS date/datetime values and returns normalized ISO output.
 * @param {unknown} rawValue - ICS date/datetime text.
 * @param {Record<string,string>} [params={}] - ICS parameter map.
 * @returns {{value: string, allDay: boolean}} Normalized value and all-day flag.
 */
function parseIcsDateValue(rawValue, params = {}) {
  const raw = String(rawValue || "").trim();
  if (!raw) return { value: "", allDay: false };

  const valueType = String(params.VALUE || "").toUpperCase();
  if (valueType === "DATE" || /^\d{8}$/.test(raw)) {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return { value: "", allDay: true };
    return { value: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }

  let match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (match) {
    const seconds = match[6] || "00";
    const isoLocal = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${seconds}`;
    if (match[7] === "Z") {
      const utcDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(seconds)));
      return { value: utcDate.toISOString(), allDay: false };
    }
    return { value: isoLocal, allDay: false };
  }

  match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/);
  if (match) {
    const withOffset = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7]}:${match[8]}`;
    return { value: withOffset, allDay: false };
  }

  return { value: raw, allDay: false };
}

/**
 * Returns a de-duplicated list of non-empty strings preserving first occurrence order.
 * @param {unknown} values - Candidate list.
 * @returns {string[]} De-duplicated string array.
 */
function dedupeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

/**
 * Combines an ISO date with the time/timezone portion from a reference datetime.
 * @param {unknown} dateValue - Date input (`YYYY-MM-DD`).
 * @param {unknown} startValue - Reference datetime carrying time/timezone.
 * @returns {string} Combined ISO datetime, or empty string when impossible.
 */
function mergeIsoDateWithStartTimePortion(dateValue, startValue) {
  const day = toIsoDatePart(dateValue);
  if (!day || !isIsoDate(day)) return String(dateValue || "").trim();
  const match = String(startValue || "").trim().match(/^\d{4}-\d{2}-\d{2}(T.+)$/);
  if (!match || !match[1]) return day;
  return `${day}${match[1]}`;
}

/**
 * Parses an ICS RRULE string into FullCalendar-compatible rrule fields.
 * @param {unknown} rawValue - ICS RRULE value.
 * @returns {object|null} Parsed recurrence rule object, or `null`.
 */
function parseIcsRrule(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const segments = raw.split(";").map((item) => String(item || "").trim()).filter(Boolean);
  const kv = {};
  segments.forEach((segment) => {
    const idx = segment.indexOf("=");
    if (idx < 0) return;
    const key = String(segment.slice(0, idx) || "").trim().toUpperCase();
    const value = String(segment.slice(idx + 1) || "").trim();
    if (!key || !value) return;
    kv[key] = value;
  });
  const freqRaw = String(kv.FREQ || "").trim().toUpperCase();
  const freqMap = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };
  const freq = freqMap[freqRaw] || "";
  if (!freq) return null;

  const out = { freq };
  const interval = Number.parseInt(String(kv.INTERVAL || "").trim(), 10);
  if (Number.isFinite(interval) && interval > 0) {
    out.interval = interval;
  }
  const count = Number.parseInt(String(kv.COUNT || "").trim(), 10);
  if (Number.isFinite(count) && count > 0) {
    out.count = count;
  }
  const untilRaw = String(kv.UNTIL || "").trim();
  if (untilRaw) {
    const untilParsed = parseIcsDateValue(untilRaw, {});
    if (untilParsed.value) out.until = untilParsed.value;
  }
  const bydayRaw = String(kv.BYDAY || "").trim();
  if (bydayRaw) {
    const weekdayMap = { MO: "mo", TU: "tu", WE: "we", TH: "th", FR: "fr", SA: "sa", SU: "su" };
    const byweekday = bydayRaw
      .split(",")
      .map((token) => String(token || "").trim().toUpperCase())
      .map((token) => token.replace(/^[+-]?\d+/, ""))
      .map((token) => weekdayMap[token] || "")
      .filter(Boolean);
    if (byweekday.length) out.byweekday = byweekday;
  }
  const bymonthRaw = String(kv.BYMONTH || "").trim();
  if (bymonthRaw) {
    const bymonth = bymonthRaw
      .split(",")
      .map((token) => Number.parseInt(String(token || "").trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);
    if (bymonth.length) out.bymonth = bymonth;
  }
  const bymonthdayRaw = String(kv.BYMONTHDAY || "").trim();
  if (bymonthdayRaw) {
    const bymonthday = bymonthdayRaw
      .split(",")
      .map((token) => Number.parseInt(String(token || "").trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= -31 && n <= 31 && n !== 0);
    if (bymonthday.length) out.bymonthday = bymonthday;
  }
  return out;
}

/**
 * Parses and normalizes EXDATE lines for recurring events.
 * @param {Array<{value: string, params?: Record<string,string>}>} exdateProps - EXDATE properties.
 * @param {string} startValue - Series start value.
 * @param {boolean} allDay - Whether recurrence is all-day.
 * @returns {string[]} Normalized exclusion list.
 */
function parseIcsExdateList(exdateProps, startValue, allDay) {
  const values = [];
  const props = Array.isArray(exdateProps) ? exdateProps : [];
  props.forEach((prop) => {
    const params = prop && typeof prop === "object" ? prop.params || {} : {};
    const raw = String(prop && prop.value || "").trim();
    if (!raw) return;
    raw
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .forEach((entry) => {
        const parsed = parseIcsDateValue(entry, params);
        if (!parsed.value) return;
        values.push(parsed.value);
      });
  });
  const unique = dedupeStringList(values);
  if (allDay) return unique;
  return unique.map((value) => (isIsoDate(value) ? mergeIsoDateWithStartTimePortion(value, startValue) : value));
}

/**
 * Derives an ISO-8601 duration for recurring events from start/end values.
 * @param {string} startValue - Start datetime/date.
 * @param {string} endValue - End datetime/date.
 * @param {boolean} allDay - Whether event is all-day.
 * @returns {string} Duration token suitable for FullCalendar recurrence, or empty string.
 */
function deriveRecurringDuration(startValue, endValue, allDay) {
  if (allDay) {
    const startDate = toIsoDatePart(startValue);
    const endDate = toIsoDatePart(endValue);
    if (!startDate || !endDate) return null;
    const startMs = Date.parse(`${startDate}T00:00:00Z`);
    const endMs = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const days = Math.round((endMs - startMs) / 86400000);
    if (days > 1) return { days };
    return null;
  }
  const startMs = Date.parse(String(startValue || ""));
  const endMs = Date.parse(String(endValue || startValue || ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return { milliseconds: endMs - startMs };
}

/**
 * Parses VEVENT blocks from ICS text into normalized event data objects.
 * @param {unknown} calendarData - Raw ICS file content.
 * @returns {Array<object>} Parsed event list.
 */
function parseIcsEvents(calendarData) {
  const unfolded = String(calendarData || "").replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let active = null;

  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      active = { props: [] };
      continue;
    }
    if (trimmed.toUpperCase() === "END:VEVENT") {
      if (active) events.push(active);
      active = null;
      continue;
    }
    if (!active) continue;
    const parsed = parseIcsPropertyLine(trimmed);
    if (!parsed) continue;
    active.props.push(parsed);
  }

  return events.map((item) => {
    const getValue = (name) => item.props.find((prop) => prop.name === name) || null;
    const getValues = (name) => item.props.filter((prop) => prop.name === name);
    const summary = getValue("SUMMARY");
    const description = getValue("DESCRIPTION");
    const location = getValue("LOCATION");
    const uid = getValue("UID");
    const link = getValue("URL");
    const dtStart = getValue("DTSTART");
    const dtEnd = getValue("DTEND");
    const recurrenceId = getValue("RECURRENCE-ID");
    const rrule = getValue("RRULE");
    const exdates = getValues("EXDATE");

    const parsedStart = parseIcsDateValue(dtStart ? dtStart.value : "", dtStart ? dtStart.params : {});
    const parsedEnd = parseIcsDateValue(dtEnd ? dtEnd.value : "", dtEnd ? dtEnd.params : {});
    const allDay = Boolean(parsedStart.allDay);
    const start = parsedStart.value;
    let end = parsedEnd.value;
    if (!end) {
      end = allDay ? addOneDay(start) : start;
    }

    return {
      uid: String(uid && uid.value || "").trim(),
      summary: icsUnescapeText(summary && summary.value || "").trim(),
      description: icsUnescapeText(description && description.value || "").trim(),
      location: icsUnescapeText(location && location.value || "").trim(),
      url: String(link && link.value || "").trim(),
      start,
      end,
      allDay,
      recurrenceId: parseIcsDateValue(recurrenceId && recurrenceId.value || "", recurrenceId ? recurrenceId.params : {}).value,
      recurrenceRule: parseIcsRrule(rrule && rrule.value || ""),
      exdates: parseIcsExdateList(exdates, start, allDay)
    };
  }).filter((event) => Boolean(event.start));
}

/**
 * Extracts first text content for an XML tag by local name.
 * @param {unknown} xml - XML text.
 * @param {string} localName - Tag local name (namespace ignored).
 * @returns {string} Unescaped tag text, or empty string.
 */
function extractXmlTagText(xml, localName) {
  const pattern = new RegExp(`<(?:[^:>]+:)?${localName}[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${localName}>`, "i");
  const match = String(xml || "").match(pattern);
  if (!match || typeof match[1] !== "string") return "";
  return xmlUnescape(match[1].trim());
}

/**
 * Extracts all XML inner blocks for a tag by local name.
 * @param {unknown} xml - XML text.
 * @param {string} localName - Tag local name (namespace ignored).
 * @returns {string[]} Matched inner XML blocks.
 */
function extractXmlBlocks(xml, localName) {
  const pattern = new RegExp(`<(?:[^:>]+:)?${localName}\\b[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${localName}>`, "gi");
  const blocks = [];
  const raw = String(xml || "");
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    blocks.push(match[1] || "");
  }
  return blocks;
}

/**
 * Maps parsed Nextcloud/ICS event data into FullCalendar event format.
 * @param {object} eventData - Parsed ICS event.
 * @param {{id: string, slug: string}} calendarMeta - Source calendar metadata.
 * @param {string} href - Event object href.
 * @param {string} etag - Current ETag value.
 * @returns {object} FullCalendar-compatible event object.
 */
function mapNextcloudEventToFullCalendar(eventData, calendarMeta, href, etag) {
  const uid = String(eventData.uid || "").trim();
  const eventId = uid || String(href || "").trim();
  const color = "#6f9f61";
  const recurrenceId = String(eventData.recurrenceId || "").trim();
  const hasRecurrenceRule = Boolean(eventData.recurrenceRule && typeof eventData.recurrenceRule === "object");
  const mapped = {
    id: `nccal:${calendarMeta.id}:${eventId}`,
    title: String(eventData.summary || "(No title)").trim(),
    start: eventData.start,
    end: eventData.end || undefined,
    allDay: Boolean(eventData.allDay),
    editable: true,
    backgroundColor: color,
    borderColor: color,
    textColor: "#ffffff",
    extendedProps: {
      externalSource: "nextcloud",
      nextcloudCalendarId: calendarMeta.id,
      nextcloudCalendarLabel: calendarMeta.slug,
      nextcloudHref: String(href || "").trim(),
      nextcloudEtag: String(etag || "").trim(),
      nextcloudUid: uid,
      nextcloudDescription: String(eventData.description || "").trim(),
      nextcloudLocation: String(eventData.location || "").trim(),
      nextcloudUrl: String(eventData.url || "").trim()
    }
  };
  if (hasRecurrenceRule) {
    mapped.rrule = {
      ...eventData.recurrenceRule,
      dtstart: eventData.start
    };
    const duration = deriveRecurringDuration(eventData.start, eventData.end, Boolean(eventData.allDay));
    if (duration) mapped.duration = duration;
    const exdates = dedupeStringList(eventData.exdates || []);
    if (exdates.length) mapped.exdate = exdates;
    mapped.editable = false;
    mapped.extendedProps.isRecurring = true;
    delete mapped.start;
    delete mapped.end;
  }
  if (recurrenceId) {
    mapped.editable = false;
    mapped.extendedProps.isRecurring = true;
    mapped.extendedProps.isRecurringOverride = true;
  }
  return mapped;
}

/**
 * Fetches and parses Nextcloud events for one calendar in a time range.
 * @param {{id: string, slug: string, url: string}} calendarMeta - Calendar metadata.
 * @param {unknown} timeStart - Range start datetime.
 * @param {unknown} timeEnd - Range end datetime.
 * @returns {Promise<Array<object>>} FullCalendar-compatible event list.
 */
async function fetchNextcloudCalendarEventsForCalendar(calendarMeta, timeStart, timeEnd) {
  const rangeStart = toCalDavUtcBasicDateTime(timeStart);
  const rangeEnd = toCalDavUtcBasicDateTime(timeEnd);
  if (!rangeStart || !rangeEnd) {
    throw new Error("Missing or invalid start/end range");
  }

  const reportBody =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">` +
    `<d:prop><d:getetag/><c:calendar-data/></d:prop>` +
    `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">` +
    `<c:time-range start="${xmlEscape(rangeStart)}" end="${xmlEscape(rangeEnd)}"/>` +
    `</c:comp-filter></c:comp-filter></c:filter>` +
    `</c:calendar-query>`;

  const response = await nextcloudCalDavFetch(calendarMeta.url, {
    method: "REPORT",
    headers: {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8"
    },
    body: reportBody,
    expectedStatus: [207]
  });

  const xmlText = await response.text();
  const responseBlocks = extractXmlBlocks(xmlText, "response");
  const events = [];
  for (const block of responseBlocks) {
    const href = extractXmlTagText(block, "href");
    const etag = extractXmlTagText(block, "getetag");
    const calendarData = extractXmlTagText(block, "calendar-data");
    if (!href || !calendarData) continue;
    const parsedEvents = parseIcsEvents(calendarData);
    const overridesByUid = new Map();
    parsedEvents.forEach((item) => {
      const uid = String(item && item.uid || "").trim();
      const recurrenceId = String(item && item.recurrenceId || "").trim();
      if (!uid || !recurrenceId) return;
      const list = overridesByUid.get(uid) || [];
      list.push(recurrenceId);
      overridesByUid.set(uid, list);
    });
    parsedEvents.forEach((item) => {
      const uid = String(item && item.uid || "").trim();
      const mergedExdates = dedupeStringList([
        ...(Array.isArray(item.exdates) ? item.exdates : []),
        ...(uid && overridesByUid.has(uid) ? overridesByUid.get(uid) : [])
      ]);
      const mappedInput = {
        ...item,
        exdates: mergedExdates
      };
      events.push(mapNextcloudEventToFullCalendar(mappedInput, calendarMeta, href, etag));
    });
  }
  return events;
}

/**
 * Fetches and merges Nextcloud events from all configured calendars for a time range.
 * @param {unknown} start - Range start datetime.
 * @param {unknown} end - Range end datetime.
 * @returns {Promise<Array<object>>} Merged/sorted FullCalendar events.
 */
async function fetchNextcloudCalendarEventsInRange(start, end) {
  const config = getNextcloudCalendarConfig();
  if (!config.enabled) return [];
  const calendars = buildNextcloudCalendars();
  const all = await Promise.all(calendars.map((calendar) => fetchNextcloudCalendarEventsForCalendar(calendar, start, end)));
  const merged = all.flat();
  merged.sort(
    (a, b) =>
      String(a.start || "").localeCompare(String(b.start || "")) ||
      String(a.title || "").localeCompare(String(b.title || ""))
  );
  return merged;
}

/**
 * Formats a date-like input into ICS all-day date format (`YYYYMMDD`).
 * @param {unknown} value - Candidate date value.
 * @returns {string} ICS date value, or empty string when invalid.
 */
function formatIcsDateValue(value) {
  const iso = toIsoDatePart(value);
  if (!iso) return "";
  return iso.replace(/-/g, "");
}

/**
 * Formats a datetime-like input into ICS UTC datetime format.
 * @param {unknown} value - Candidate datetime value.
 * @returns {string} ICS UTC datetime, or empty string when invalid.
 */
function formatIcsDateTimeUtc(value) {
  return toCalDavUtcBasicDateTime(value);
}

/**
 * Builds a full ICS payload string for create/update operations in Nextcloud.
 * @param {{uid?: unknown, title?: unknown, start: unknown, end: unknown, allDay: boolean, description?: unknown, location?: unknown, url?: unknown}} payload - Event fields.
 * @returns {string} Serialized ICS content.
 */
function buildIcsEventPayload({ uid, title, start, end, allDay, description = "", location = "", url = "" }) {
  const safeUid = String(uid || "").trim() || crypto.randomUUID();
  const safeTitle = String(title || "").trim() || "(No title)";
  const nowStamp = toCalDavUtcBasicDateTime(new Date().toISOString());
  let dtStartLine = "";
  let dtEndLine = "";
  if (allDay) {
    const startDate = formatIcsDateValue(start);
    const endDateInclusive = formatIcsDateValue(end) || startDate;
    const endDateExclusive = formatIcsDateValue(addOneDay(toIsoDatePart(end) || toIsoDatePart(start) || ""));
    if (!startDate || !endDateInclusive || !endDateExclusive) {
      throw new Error("Could not derive all-day DTSTART/DTEND for Nextcloud event");
    }
    dtStartLine = `DTSTART;VALUE=DATE:${startDate}`;
    dtEndLine = `DTEND;VALUE=DATE:${endDateExclusive}`;
  } else {
    const dtStart = formatIcsDateTimeUtc(start);
    const dtEnd = formatIcsDateTimeUtc(end || start);
    if (!dtStart || !dtEnd) {
      throw new Error("Could not derive DTSTART/DTEND for Nextcloud event");
    }
    dtStartLine = `DTSTART:${dtStart}`;
    dtEndLine = `DTEND:${dtEnd}`;
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NICA Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscapeText(safeUid)}`,
    `DTSTAMP:${nowStamp}`,
    `SUMMARY:${icsEscapeText(safeTitle)}`,
    dtStartLine,
    dtEndLine
  ];
  if (String(description || "").trim()) lines.push(`DESCRIPTION:${icsEscapeText(description)}`);
  if (String(location || "").trim()) lines.push(`LOCATION:${icsEscapeText(location)}`);
  if (String(url || "").trim()) lines.push(`URL:${icsEscapeText(url)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Resolves a Nextcloud object href or URL to an absolute object URL.
 * @param {object} calendarMeta - Calendar metadata (unused fallback context).
 * @param {unknown} hrefOrUrl - Relative href or absolute URL.
 * @returns {string} Absolute object URL, or empty string.
 */
function resolveNextcloudObjectUrl(calendarMeta, hrefOrUrl) {
  const raw = String(hrefOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw, ensureTrailingSlash(NEXTCLOUD_CALDAV_BASE_URL)).toString();
}

/**
 * Fetches one Nextcloud event object by href and maps it to FullCalendar format.
 * @param {{id: string, slug: string, url: string}} calendarMeta - Calendar metadata.
 * @param {unknown} href - Event href or URL.
 * @returns {Promise<object>} FullCalendar-compatible event object.
 */
async function fetchNextcloudEventByHref(calendarMeta, href) {
  const objectUrl = resolveNextcloudObjectUrl(calendarMeta, href);
  if (!objectUrl) throw new Error("Missing Nextcloud event href");
  const response = await nextcloudCalDavFetch(objectUrl, {
    method: "GET",
    expectedStatus: [200]
  });
  const etag = String(response.headers.get("etag") || "").trim();
  const body = await response.text();
  const parsedEvents = parseIcsEvents(body);
  const first = parsedEvents[0];
  if (!first) {
    throw new Error("Nextcloud event body has no VEVENT");
  }
  return mapNextcloudEventToFullCalendar(first, calendarMeta, href, etag);
}

/**
 * Creates a Nextcloud calendar event via CalDAV PUT and returns the mapped created event.
 * @param {{calendarId?: unknown, title?: unknown, start: unknown, end: unknown, allDay: boolean}} payload - Create payload.
 * @returns {Promise<object>} Created event mapped for FullCalendar.
 */
async function createNextcloudCalendarEvent({ calendarId, title, start, end, allDay }) {
  const calendarMeta = resolveNextcloudCalendar(calendarId || NEXTCLOUD_DEFAULT_CREATE_CALENDAR_ID);
  if (!calendarMeta) throw new Error("Missing or invalid Nextcloud target calendar");
  const uid = crypto.randomUUID();
  const ics = buildIcsEventPayload({
    uid,
    title,
    start,
    end,
    allDay: Boolean(allDay)
  });
  const objectHref = `${calendarMeta.href}${encodeURIComponent(uid)}.ics`;
  const objectUrl = resolveNextcloudObjectUrl(calendarMeta, objectHref);
  await nextcloudCalDavFetch(objectUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*"
    },
    body: ics,
    expectedStatus: [201, 204]
  });
  return fetchNextcloudEventByHref(calendarMeta, objectHref);
}

/**
 * Updates an existing Nextcloud event by replacing ICS payload at its href.
 * @param {{calendarId: unknown, href: unknown, etag?: unknown, title?: unknown, start: unknown, end: unknown, allDay: boolean}} payload - Update payload.
 * @returns {Promise<object>} Updated event mapped for FullCalendar.
 */
async function updateNextcloudCalendarEvent({ calendarId, href, etag, title, start, end, allDay }) {
  const calendarMeta = resolveNextcloudCalendar(calendarId);
  if (!calendarMeta) throw new Error("Missing or invalid Nextcloud calendar");
  const current = await fetchNextcloudEventByHref(calendarMeta, href);
  const props = current.extendedProps || {};
  const nextIcs = buildIcsEventPayload({
    uid: props.nextcloudUid || "",
    title: String(title || current.title || "").trim(),
    start,
    end,
    allDay: Boolean(allDay),
    description: props.nextcloudDescription || "",
    location: props.nextcloudLocation || "",
    url: props.nextcloudUrl || ""
  });
  const objectUrl = resolveNextcloudObjectUrl(calendarMeta, href);
  const safeEtag = String(etag || props.nextcloudEtag || "").trim();
  const headers = {
    "Content-Type": "text/calendar; charset=utf-8"
  };
  if (safeEtag) headers["If-Match"] = safeEtag;
  await nextcloudCalDavFetch(objectUrl, {
    method: "PUT",
    headers,
    body: nextIcs,
    expectedStatus: [200, 201, 204]
  });
  return fetchNextcloudEventByHref(calendarMeta, href);
}

/**
 * Deletes an existing Nextcloud event by href.
 * @param {{calendarId: unknown, href: unknown, etag?: unknown}} payload - Delete payload.
 * @returns {Promise<void>}
 */
async function deleteNextcloudCalendarEvent({ calendarId, href, etag }) {
  const calendarMeta = resolveNextcloudCalendar(calendarId);
  if (!calendarMeta) throw new Error("Missing or invalid Nextcloud calendar");
  const objectUrl = resolveNextcloudObjectUrl(calendarMeta, href);
  if (!objectUrl) throw new Error("Missing Nextcloud event href");
  const headers = {};
  const safeEtag = String(etag || "").trim();
  if (safeEtag) headers["If-Match"] = safeEtag;
  await nextcloudCalDavFetch(objectUrl, {
    method: "DELETE",
    headers,
    expectedStatus: [200, 204]
  });
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

  if (req.method === "GET" && req.url === "/api/nextcloud-calendar/config") {
    const config = getNextcloudCalendarConfig();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...config }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/google-oauth/status") {
    const status = googleOAuthStatusSnapshot();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...status }));
    return;
  }

  if (req.method === "GET" && req.url === "/api/google-oauth/start") {
    if (!hasGoogleOAuthConfig()) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI.");
      return;
    }
    const state = crypto.randomBytes(24).toString("hex");
    googleOauthStateStore.set(state, Date.now());
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI);
    authUrl.searchParams.set("scope", GOOGLE_OAUTH_SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("state", state);
    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/google-oauth/callback") {
    const state = String(requestUrl.searchParams.get("state") || "").trim();
    const code = String(requestUrl.searchParams.get("code") || "").trim();
    if (!state || !googleOauthStateStore.has(state)) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid OAuth state");
      return;
    }
    googleOauthStateStore.delete(state);
    if (!code) {
      const errorText = String(requestUrl.searchParams.get("error") || "Missing OAuth code");
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(errorText);
      return;
    }
    exchangeGoogleAuthCode(code)
      .then(() => {
        const html = [
          "<!doctype html><html><head><meta charset='utf-8'><title>Google OAuth connected</title></head>",
          "<body style='font-family:Segoe UI,Arial,sans-serif;padding:24px;'>",
          "<h2>Google OAuth connected</h2>",
          "<p>You can close this tab and return to the calendar.</p>",
          "<script>setTimeout(function(){try{window.close();}catch(e){}},800);</script>",
          "</body></html>"
        ].join("");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      })
      .catch((error) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "OAuth callback failed");
      });
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

  if (req.method === "GET" && requestUrl.pathname === "/api/nextcloud-calendar/events") {
    const start = requestUrl.searchParams.get("start");
    const end = requestUrl.searchParams.get("end");
    fetchNextcloudCalendarEventsInRange(start, end)
      .then((events) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, events }));
      })
      .catch((error) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Could not load Nextcloud Calendar events");
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

  if (req.method === "POST" && req.url === "/api/google-oauth/disconnect") {
    clearGoogleOAuthToken();
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/google-calendar/events/create") {
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
        createGoogleCalendarEvent({
          calendarId: String(payload.calendarId || GOOGLE_DEFAULT_CREATE_CALENDAR_ID || "").trim(),
          title: String(payload.title || "").trim(),
          start: payload.start ?? payload.startDate,
          end: payload.end ?? payload.endDate,
          allDay: payload.allDay === true || payload.allDay === "true",
          colorId: String(payload.colorId || "").trim()
        })
          .then((created) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, event: created }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not create Google event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while creating Google event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/google-calendar/events/update") {
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
        updateGoogleCalendarEvent({
          calendarId: payload.calendarId,
          eventId: payload.eventId,
          title: payload.title,
          start: payload.start ?? payload.startDate,
          end: payload.end ?? payload.endDate,
          allDay: payload.allDay === true || payload.allDay === "true"
        })
          .then((updated) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, event: updated }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not update Google event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while updating Google event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/google-calendar/events/delete") {
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
        deleteGoogleCalendarEvent({
          calendarId: payload.calendarId,
          eventId: payload.eventId
        })
          .then(() => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not delete Google event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while deleting Google event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/nextcloud-calendar/events/create") {
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
        createNextcloudCalendarEvent({
          calendarId: String(payload.calendarId || NEXTCLOUD_DEFAULT_CREATE_CALENDAR_ID || "").trim(),
          title: String(payload.title || "").trim(),
          start: payload.start ?? payload.startDate,
          end: payload.end ?? payload.endDate,
          allDay: payload.allDay === true || payload.allDay === "true"
        })
          .then((created) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, event: created }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not create Nextcloud event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while creating Nextcloud event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/nextcloud-calendar/events/update") {
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
        updateNextcloudCalendarEvent({
          calendarId: payload.calendarId,
          href: payload.href,
          etag: payload.etag,
          title: payload.title,
          start: payload.start ?? payload.startDate,
          end: payload.end ?? payload.endDate,
          allDay: payload.allDay === true || payload.allDay === "true"
        })
          .then((updated) => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, event: updated }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not update Nextcloud event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while updating Nextcloud event");
      });
    return;
  }

  if (req.method === "POST" && req.url === "/api/nextcloud-calendar/events/delete") {
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
        deleteNextcloudCalendarEvent({
          calendarId: payload.calendarId,
          href: payload.href,
          etag: payload.etag
        })
          .then(() => {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((error) => {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(error.message || "Could not delete Nextcloud event");
          });
      })
      .catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Unknown error while deleting Nextcloud event");
      });
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
    "Calendar API endpoints ready: GET /api/ping, GET /api/obsidian/theme, GET /api/calendar/filters, GET /api/google-calendar/config, GET /api/google-calendar/events, GET /api/google-oauth/status, GET /api/google-oauth/start, GET /api/google-oauth/callback, GET /api/nextcloud-calendar/config, GET /api/nextcloud-calendar/events, GET /api/session, GET /api/events/preview, POST /api/google-oauth/disconnect, POST /api/google-calendar/events/create, POST /api/google-calendar/events/update, POST /api/google-calendar/events/delete, POST /api/nextcloud-calendar/events/create, POST /api/nextcloud-calendar/events/update, POST /api/nextcloud-calendar/events/delete, POST /api/events/update-dates, POST /api/events/open-note, POST /api/events/open-map, POST /api/events/create, POST /api/events/rebuild"
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


