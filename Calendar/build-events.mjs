import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadDotEnvFile } from "./lib/env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnvFile(path.resolve(__dirname, ".env"));
loadDotEnvFile(path.resolve(__dirname, ".env.local"));

const VAULT_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_FILE = path.resolve(__dirname, "events.generated.js");
const BASE_PATH = process.env.OBSIDIAN_BASE_PATH || "6. Obsidian/Live/Kalender.base";
const BASE_VIEW = process.env.OBSIDIAN_BASE_VIEW || "Tabelle";
const OBSIDIAN_VAULT_NAME = String(process.env.OBSIDIAN_VAULT_NAME || "").trim();
const OBSIDIAN_BIN = resolveObsidianBin();
const ALLOW_MARKDOWN_FALLBACK = parseBoolean(process.env.ALLOW_MARKDOWN_FALLBACK || "");
const EXCLUDE_DIRS = new Set([".obsidian", ".trash", "8. Emails", "Attachments", "Excalidraw"]);

/**
 * @typedef {Record<string, string | string[] | undefined>} FrontmatterMap
 */

/**
 * Builds a prioritized list of Obsidian CLI binary candidates.
 * @returns {string[]} Ordered executable candidates without duplicates.
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
 * Resolves the first existing absolute candidate or command name fallback.
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
 * Detects vault-targeting errors returned by Obsidian CLI.
 * @param {unknown} error - Error from `execFileSync`.
 * @returns {boolean} `true` when error indicates invalid/missing vault targeting.
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
 * Checks whether a filename is a markdown file.
 * @param {string} filePath - File path or filename.
 * @returns {boolean} `true` when file ends with `.md`.
 */
function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

/**
 * Checks whether a directory is excluded from markdown fallback scanning.
 * @param {string} dirName - Directory name.
 * @returns {boolean} `true` when directory should be skipped.
 */
function isExcludedDir(dirName) {
  return EXCLUDE_DIRS.has(dirName);
}

/**
 * Recursively collects markdown files under a directory.
 * @param {string} dirPath - Start directory.
 * @param {string[]} [results=[]] - Mutable accumulator.
 * @returns {string[]} Collected absolute markdown file paths.
 */
function listMarkdownFiles(dirPath, results = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!isExcludedDir(entry.name)) {
        listMarkdownFiles(fullPath, results);
      }
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extracts raw YAML frontmatter text from markdown content.
 * @param {string} content - Markdown content.
 * @returns {string} Raw frontmatter body without delimiters, or empty string.
 */
function extractFrontmatter(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return "";
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return "";
  return content.slice(4, end);
}

/**
 * Removes one pair of wrapping single/double quotes and trims value.
 * @param {unknown} value - Raw scalar value.
 * @returns {string} Unquoted scalar text.
 */
function stripWrappingQuotes(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Removes unquoted YAML inline comments from a scalar line.
 * @param {unknown} raw - Raw YAML scalar text.
 * @returns {string} Scalar value without trailing inline comment.
 */
function stripYamlInlineComment(raw) {
  const value = String(raw ?? "");
  const singleQuoted = value.startsWith("'") && value.endsWith("'");
  const doubleQuoted = value.startsWith('"') && value.endsWith('"');
  if (singleQuoted || doubleQuoted) return value;
  const hashIndex = value.indexOf("#");
  if (hashIndex < 0) return value;
  return value.slice(0, hashIndex).trimEnd();
}

/**
 * Parses an inline YAML list (for example `[a, "b"]`) into string values.
 * @param {unknown} raw - Raw YAML list text.
 * @returns {string[]} Parsed list entries.
 */
function parseInlineYamlArray(raw) {
  return stripYamlInlineComment(raw)
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((value) => stripWrappingQuotes(value))
    .filter(Boolean);
}

/**
 * Parses selected scalar/list values from YAML frontmatter text.
 * @param {unknown} frontmatter - Raw frontmatter text.
 * @returns {FrontmatterMap} Parsed frontmatter map keyed by lowercase field name.
 */
function parseFrontmatterData(frontmatter) {
  const out = Object.create(null);
  const lines = String(frontmatter || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = String(rawLine || "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;
    const key = String(keyMatch[1] || "").trim().toLowerCase();
    const rawValue = stripYamlInlineComment(keyMatch[2]).trim();

    if (!rawValue) {
      const listValues = [];
      let j = i + 1;
      while (j < lines.length) {
        const listMatch = String(lines[j] || "").match(/^\s*-\s*(.+)\s*$/);
        if (!listMatch) break;
        listValues.push(stripWrappingQuotes(listMatch[1]));
        j += 1;
      }
      out[key] = listValues;
      i = j - 1;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      out[key] = parseInlineYamlArray(rawValue);
      continue;
    }

    out[key] = stripWrappingQuotes(rawValue);
  }
  return out;
}

/**
 * Looks up a frontmatter value by key (case-insensitive).
 * @param {FrontmatterMap | null | undefined} frontmatterData - Parsed frontmatter map.
 * @param {unknown} name - Field name.
 * @returns {string | string[] | undefined} Matching value when present.
 */
function frontmatterLookup(frontmatterData, name) {
  if (!frontmatterData || typeof frontmatterData !== "object") return undefined;
  return frontmatterData[String(name || "").toLowerCase()];
}

/**
 * Extracts the first non-empty scalar value from candidate frontmatter keys.
 * @param {FrontmatterMap | null | undefined} frontmatterData - Parsed frontmatter map.
 * @param {...string} names - Candidate field names in priority order.
 * @returns {string} First non-empty scalar value.
 */
function extractField(frontmatterData, ...names) {
  for (const name of names) {
    const value = frontmatterLookup(frontmatterData, name);
    if (Array.isArray(value)) continue;
    if (value != null && String(value).trim()) {
      return stripWrappingQuotes(value);
    }
  }
  return "";
}

/**
 * Extracts the first list-like field from candidate frontmatter keys.
 * @param {FrontmatterMap | null | undefined} frontmatterData - Parsed frontmatter map.
 * @param {...string} names - Candidate field names in priority order.
 * @returns {string[]} Parsed list values.
 */
function extractListField(frontmatterData, ...names) {
  for (const name of names) {
    const value = frontmatterLookup(frontmatterData, name);
    if (Array.isArray(value)) {
      return value.map((entry) => stripWrappingQuotes(entry)).filter(Boolean);
    }
    if (typeof value === "string" && value.trim().startsWith("[") && value.trim().endsWith("]")) {
      return parseInlineYamlArray(value);
    }
  }
  return [];
}

/**
 * Parses booleans from common YAML/string representations.
 * @param {unknown} value - Raw value.
 * @returns {boolean} Parsed boolean value.
 */
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on";
}

/**
 * Parses an integer with fallback.
 * @param {unknown} value - Raw value.
 * @param {number} [fallback=0] - Fallback when parsing fails.
 * @returns {number} Parsed integer or fallback.
 */
function parseInteger(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(num) ? num : fallback;
}

/**
 * Normalizes coordinates from array/object/string inputs to `lat, lng` format.
 * @param {unknown} value - Raw coordinate payload.
 * @returns {string} Normalized coordinate pair or empty string.
 */
function normalizeCoordinatesValue(value) {
  if (value == null) return "";

  if (Array.isArray(value)) {
    if (value.length < 2) return "";
    const lat = Number(value[0]);
    const lng = Number(value[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `${lat}, ${lng}`;
  }

  if (typeof value === "object") {
    const lat = Number(value.lat ?? value.latitude);
    const lng = Number(value.lng ?? value.lon ?? value.long ?? value.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
    return `${lat}, ${lng}`;
  }

  const raw = String(value).trim();
  if (!raw) return "";
  const match = raw.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return "";
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat}, ${lng}`;
}

/**
 * Parses a list-like value into ISO dates.
 * @param {unknown} value - Raw date list input.
 * @returns {string[]} ISO date list.
 */
function parseIsoDateList(value) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
        .trim()
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

  return values
    .map((v) => String(v).replace(/^["']|["']$/g, "").trim())
    .filter((v) => isIsoDate(v));
}

/**
 * Parses weekday list values into unique sorted numeric weekdays (`0..6`).
 * @param {unknown} value - Raw weekday list input.
 * @returns {number[]} Parsed weekday indices.
 */
function parseDaysOfWeek(value) {
  const weekdayMap = {
    su: 0,
    sun: 0,
    sunday: 0,
    mo: 1,
    mon: 1,
    monday: 1,
    tu: 2,
    tue: 2,
    tues: 2,
    tuesday: 2,
    we: 3,
    wed: 3,
    wednesday: 3,
    th: 4,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fr: 5,
    fri: 5,
    friday: 5,
    sa: 6,
    sat: 6,
    saturday: 6
  };

  const values = Array.isArray(value)
    ? value
    : String(value ?? "")
        .trim()
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

  const days = values
    .map((v) => String(v).trim().toLowerCase())
    .map((v) => {
      const asInt = Number.parseInt(v, 10);
      if (Number.isInteger(asInt)) return asInt;
      if (v in weekdayMap) return weekdayMap[v];
      return NaN;
    })
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * Converts numeric weekdays to rrule weekday tokens.
 * @param {number[]} days - Numeric weekdays (`0..6`).
 * @returns {string[]} RRule weekday tokens (`su..sa`).
 */
function toRruleByWeekday(days) {
  const map = ["su", "mo", "tu", "we", "th", "fr", "sa"];
  return days
    .map((d) => map[d])
    .filter(Boolean);
}

/**
 * Parses a JSON-encoded scalar field.
 * @param {unknown} value - Raw JSON string.
 * @returns {object | null} Parsed object or `null`.
 */
function parseJsonField(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Extracts normalized tag tokens from parsed frontmatter.
 * @param {FrontmatterMap | null | undefined} frontmatterData - Parsed frontmatter map.
 * @returns {string[]} Normalized lowercase tag names without `#`.
 */
function extractTags(frontmatterData) {
  const tags = extractListField(frontmatterData, "tags");
  if (!tags.length) {
    const scalar = extractField(frontmatterData, "tags");
    if (scalar) {
      scalar
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => tags.push(entry));
    }
  }
  return [...new Set(tags.map((tag) => String(tag).replace(/^#/, "").toLowerCase()).filter(Boolean))];
}

/**
 * Checks whether markdown body contains an inline `#event` tag.
 * @param {string} content - Markdown content.
 * @returns {boolean} `true` when inline event tag is present.
 */
function hasInlineEventTag(content) {
  return /(^|\s)#event(\s|$)/i.test(content);
}

/**
 * Checks whether input matches `YYYY-MM-DD`.
 * @param {string} value - Candidate date value.
 * @returns {boolean} `true` when value is ISO date.
 */
function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Checks whether input matches accepted ISO datetime format.
 * @param {unknown} value - Candidate datetime value.
 * @returns {boolean} `true` when value is ISO datetime.
 */
function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
    String(value || "").trim()
  );
}

/**
 * Checks whether value is ISO date or datetime.
 * @param {unknown} value - Candidate date-like value.
 * @returns {boolean} `true` when value is date/date-time.
 */
function isDateOrDateTime(value) {
  return isIsoDate(value) || isIsoDateTime(value);
}

/**
 * Converts a date-like input to local ISO date (`YYYY-MM-DD`).
 * @param {unknown} value - Date-like input.
 * @returns {string} ISO date or empty string when invalid.
 */
function dateToLocalIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a date-like value into ISO date (`YYYY-MM-DD`).
 * @param {unknown} value - Date-like value.
 * @returns {string} ISO date or empty string.
 */
function parseDateLikeToIsoDate(value) {
  if (value == null) return "";
  if (value instanceof Date) return dateToLocalIsoDate(value);
  const raw = String(value).trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
  if (dateOnlyMatch?.[1] && isIsoDate(dateOnlyMatch[1])) return dateOnlyMatch[1];
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return "";
  return dateToLocalIsoDate(new Date(timestamp));
}

/**
 * Parses a date-like value into calendar start/end value (date or datetime).
 * @param {unknown} value - Date-like value.
 * @returns {string} Calendar date/date-time value or empty string.
 */
function parseDateLikeToCalendarValue(value) {
  if (value == null) return "";
  if (value instanceof Date) return dateToLocalIsoDate(value);
  const raw = String(value).trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  if (isIsoDateTime(raw)) return raw.replace(" ", "T");
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
  if (dateOnlyMatch?.[1] && isIsoDate(dateOnlyMatch[1])) return dateOnlyMatch[1];
  return "";
}

/**
 * Derives a fallback start date from file metadata timestamps.
 * @param {string} filePath - Absolute file path.
 * @returns {string} ISO date or empty string.
 */
function getStartDateFromFileMeta(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const birthtimeIso = parseDateLikeToIsoDate(stats.birthtime);
    if (birthtimeIso) return birthtimeIso;
    return parseDateLikeToIsoDate(stats.ctime);
  } catch {
    return "";
  }
}

/**
 * Adds one day to an ISO date (`YYYY-MM-DD`) using UTC arithmetic.
 * @param {string} isoDate - ISO date.
 * @returns {string} Next day as ISO date.
 */
function addOneDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

/**
 * Calculates weekday index (`0..6`) for an ISO date.
 * @param {string} isoDate - ISO date.
 * @returns {number} Weekday index where `0` is Sunday.
 */
function dayOfWeekFromIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return utcDate.getUTCDay();
}

/**
 * Computes inclusive day span between two ISO dates.
 * @param {string} startIso - Start ISO date.
 * @param {string} endIso - End ISO date.
 * @returns {number} Inclusive day count (minimum `1`).
 */
function inclusiveDaySpan(startIso, endIso) {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  const diff = Math.floor((end - start) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}

/**
 * Computes positive millisecond duration between two date-like values.
 * @param {unknown} startValue - Start datetime value.
 * @param {unknown} endValue - End datetime value.
 * @returns {number} Duration in milliseconds, or `0`.
 */
function durationMsFromDateLike(startValue, endValue) {
  const startTs = Date.parse(String(startValue || ""));
  const endTs = Date.parse(String(endValue || ""));
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return 0;
  return endTs - startTs;
}

/**
 * Extracts time/timezone portion from ISO datetime.
 * @param {unknown} dateTimeValue - ISO datetime candidate.
 * @returns {string} Time portion without date, or empty string.
 */
function extractTimePortion(dateTimeValue) {
  const raw = String(dateTimeValue || "").trim();
  const match = raw.match(/^\d{4}-\d{2}-\d{2}T(.+)$/);
  return match && match[1] ? match[1] : "";
}

/**
 * Combines ISO date and time portion into an ISO datetime.
 * @param {string} isoDate - ISO date.
 * @param {string} timePortion - Time suffix.
 * @returns {string} Combined datetime or original `isoDate`.
 */
function mergeDateWithTimePortion(isoDate, timePortion) {
  if (!isIsoDate(isoDate) || !timePortion) return isoDate;
  return `${isoDate}T${timePortion}`;
}

/**
 * Converts one markdown event note into FullCalendar event objects.
 * @param {string} filePath - Absolute markdown file path.
 * @returns {Array<object> | null} Event array (including overrides) or `null` if not an event note.
 */
function toCalendarEvent(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return null;
  const frontmatterData = parseFrontmatterData(frontmatter);

  const tags = extractTags(frontmatterData);
  const taggedAsEvent = tags.includes("event") || hasInlineEventTag(content);
  if (!taggedAsEvent) return null;

  const startDateFromFrontmatter = extractField(
    frontmatterData,
    "event_start",
    "eventStart",
    "startDate",
    "startdate"
  );
  const createdDateFromFrontmatter = extractField(
    frontmatterData,
    "created",
    "creationDate",
    "created_at",
    "date_created",
    "file_created",
    "ctime"
  );
  const startValue =
    parseDateLikeToCalendarValue(startDateFromFrontmatter) ||
    parseDateLikeToIsoDate(createdDateFromFrontmatter) ||
    getStartDateFromFileMeta(filePath);
  const startDate = parseDateLikeToIsoDate(startValue);
  const endValue = parseDateLikeToCalendarValue(
    extractField(frontmatterData, "event_end", "eventEnd", "endDate", "enddate")
  );
  const isTimedEvent = isIsoDateTime(startValue);
  if (!startDate || !isDateOrDateTime(startValue)) return null;

  const titleFromFm = extractField(frontmatterData, "title");
  const eventColor = extractField(frontmatterData, "event_color", "eventColor", "color");
  const eventBackground = parseBoolean(
    extractField(frontmatterData, "event_background", "eventBackground")
  );
  const recurrenceType = extractField(frontmatterData, "event_recurrence", "eventRecurrence").toLowerCase();
  const recurrenceUntil = extractField(frontmatterData, "event_recurrence_until", "eventRecurrenceUntil");
  const recurrenceInterval = parseInteger(
    extractField(frontmatterData, "event_recurrence_interval", "eventRecurrenceInterval"),
    1
  );
  const recurrenceCount = parseInteger(
    extractField(frontmatterData, "event_recurrence_count", "eventRecurrenceCount"),
    0
  );
  const recurrenceDays = parseDaysOfWeek(
    extractListField(frontmatterData, "event_recurrence_days", "eventRecurrenceDays")
  );
  const recurrenceExdates = parseIsoDateList(
    extractListField(frontmatterData, "event_recurrence_exdates", "eventRecurrenceExdates")
  );
  const recurrenceRdates = parseIsoDateList(
    extractListField(frontmatterData, "event_recurrence_rdates", "eventRecurrenceRdates")
  );
  const recurrenceExrule = parseJsonField(
    extractField(frontmatterData, "event_recurrence_exrule", "event_recurrence_exrules")
  );
  const coordinates = normalizeCoordinatesValue(extractField(frontmatterData, "coordinates"));
  const title = titleFromFm || path.basename(filePath, ".md");
  const event = {
    id: path.relative(VAULT_ROOT, filePath).replace(/\\/g, "/"),
    title,
    allDay: !isTimedEvent,
    extendedProps: {
      sourcePath: path.relative(VAULT_ROOT, filePath).replace(/\\/g, "/")
    }
  };

  if (eventColor) {
    event.backgroundColor = eventColor;
    event.borderColor = eventColor;
  }

  if (eventBackground) {
    event.display = "background";
  }
  if (coordinates) {
    event.extendedProps.coordinates = coordinates;
  }

  if (recurrenceType === "weekly") {
    const daysOfWeek = recurrenceDays.length ? recurrenceDays : [dayOfWeekFromIsoDate(startDate)];
    const recurringDurationMs = isTimedEvent ? durationMsFromDateLike(startValue, endValue) : 0;
    const recurringTimePortion = extractTimePortion(startValue);
    event.rrule = {
      freq: "weekly",
      interval: recurrenceInterval > 0 ? recurrenceInterval : 1,
      byweekday: toRruleByWeekday(daysOfWeek),
      dtstart: startValue
    };
    if (isIsoDate(recurrenceUntil)) {
      event.rrule.until = recurrenceUntil;
    }
    if (recurrenceCount > 0) {
      event.rrule.count = recurrenceCount;
    }

    if (isTimedEvent) {
      if (recurringDurationMs > 0) {
        event.duration = { milliseconds: recurringDurationMs };
      }
    } else {
      const lastDate = isIsoDate(endValue) ? endValue : startDate;
      const durationDays = inclusiveDaySpan(startDate, lastDate);
      if (durationDays > 1) {
        event.duration = { days: durationDays };
      }
    }

    if (recurrenceExdates.length) {
      event.exdate = recurrenceExdates;
    }

    if (recurrenceExrule) {
      event.exrule = recurrenceExrule;
    }

    event.editable = isTimedEvent;
    event.extendedProps.isRecurring = true;

    const overrideEvents = recurrenceRdates.map((dateStr) => ({
      id: `${event.id}#rdate-${dateStr}`,
      title: event.title,
      start: isTimedEvent ? mergeDateWithTimePortion(dateStr, recurringTimePortion) : dateStr,
      allDay: !isTimedEvent,
      editable: false,
      backgroundColor: event.backgroundColor,
      borderColor: event.borderColor,
      display: event.display,
      extendedProps: {
        ...event.extendedProps,
        isRecurring: true,
        isRecurringOverride: true
      }
    }));

    if (isTimedEvent && recurringDurationMs > 0) {
      overrideEvents.forEach((overrideEvent) => {
        overrideEvent.duration = { milliseconds: recurringDurationMs };
      });
    }

    return [event, ...overrideEvents];
  } else {
    event.start = startValue;
    if (endValue) {
      if (isTimedEvent && isIsoDateTime(endValue)) {
        event.end = endValue;
      } else if (!isTimedEvent && isIsoDate(endValue)) {
        event.end = addOneDay(endValue);
      }
    }
  }

  return [event];
}

/**
 * Queries Obsidian Base view rows used for event generation.
 * @returns {Array<Record<string, unknown>>} Base query row list.
 */
function queryBaseRows() {
  const run = (useVault) => {
    const args = ["base:query"];
    if (useVault && OBSIDIAN_VAULT_NAME) {
      args.push(`vault=${OBSIDIAN_VAULT_NAME}`);
    }
    args.push(`path=${BASE_PATH}`, `view=${BASE_VIEW}`, "format=json");
    const raw = execFileSync(OBSIDIAN_BIN, args, {
      cwd: VAULT_ROOT,
      encoding: "utf8",
      stdio: "pipe"
    });
    return JSON.parse(raw);
  };

  if (!OBSIDIAN_VAULT_NAME) {
    return run(false);
  }

  try {
    return run(true);
  } catch (error) {
    if (!isVaultTargetingError(error)) {
      throw error;
    }
    return run(false);
  }
}

/**
 * Converts one base row into FullCalendar event objects.
 * @param {Record<string, unknown>} row - Base query row.
 * @returns {Array<object> | null} Event array (including overrides) or `null`.
 */
function baseRowToCalendarEvent(row) {
  const sourcePath = String(row.path ?? "").trim();
  const sourceFilePath = sourcePath ? path.resolve(VAULT_ROOT, sourcePath) : "";
  let titleFromFrontmatter = "";
  let startValue =
    parseDateLikeToCalendarValue(
      row.event_start ??
        row.eventStart ??
        row.startDate ??
        row.startdate
    ) ||
    parseDateLikeToIsoDate(
      row.created ??
        row.creationDate ??
        row.created_at ??
        row.date_created ??
        row.file_created ??
        row.fileCtime ??
        row.file_ctime ??
        row.ctime
    ) ||
    (sourceFilePath ? getStartDateFromFileMeta(sourceFilePath) : "");
  let endValue = parseDateLikeToCalendarValue(row.event_end ?? row.eventEnd ?? row.endDate ?? "");
  let isTimedEvent = isIsoDateTime(startValue);

  // Base views can omit date-time fields. Recover from note frontmatter to avoid
  // downgrading timed events into all-day events after rebuild.
  if (sourceFilePath && fs.existsSync(sourceFilePath)) {
    const content = fs.readFileSync(sourceFilePath, "utf8");
    const frontmatter = extractFrontmatter(content);
    if (frontmatter) {
      const frontmatterData = parseFrontmatterData(frontmatter);
      titleFromFrontmatter = extractField(frontmatterData, "title");
      const fmStartValue = parseDateLikeToCalendarValue(
        extractField(frontmatterData, "event_start", "eventStart", "startDate", "startdate")
      );
      const fmEndValue = parseDateLikeToCalendarValue(
        extractField(frontmatterData, "event_end", "eventEnd", "endDate", "enddate")
      );

      if (!isTimedEvent && fmStartValue && isIsoDateTime(fmStartValue)) {
        startValue = fmStartValue;
      } else if (!startValue && fmStartValue) {
        startValue = fmStartValue;
      }

      if (!endValue && fmEndValue) {
        endValue = fmEndValue;
      }

      isTimedEvent = isIsoDateTime(startValue);
    }
  }

  const startDate = parseDateLikeToIsoDate(startValue);
  if (!startDate || !isDateOrDateTime(startValue)) return null;

  let eventColor =
    String(row.event_color ?? "").trim() ||
    String(row.eventColor ?? "").trim() ||
    String(row.color ?? "").trim();
  let eventBackground =
    row.event_background ?? row.eventBackground ?? row.background ?? row.isBackground ?? "";
  let recurrenceType =
    String(row.event_recurrence ?? row.eventRecurrence ?? "").trim().toLowerCase();
  let recurrenceUntil =
    String(row.event_recurrence_until ?? row.eventRecurrenceUntil ?? "").trim();
  let recurrenceInterval =
    row.event_recurrence_interval ?? row.eventRecurrenceInterval ?? "";
  let recurrenceCount =
    row.event_recurrence_count ?? row.eventRecurrenceCount ?? "";
  let recurrenceDays =
    row.event_recurrence_days ?? row.eventRecurrenceDays ?? row.recurrenceDays ?? [];
  let recurrenceExdates =
    row.event_recurrence_exdates ?? row.eventRecurrenceExdates ?? row.exdates ?? [];
  let recurrenceRdates =
    row.event_recurrence_rdates ?? row.eventRecurrenceRdates ?? row.rdates ?? [];
  let recurrenceExrule =
    row.event_recurrence_exrule ?? row.event_recurrence_exrules ?? row.eventRecurrenceExrule ?? "";
  let coordinates = normalizeCoordinatesValue(row.coordinates);

  // Base views may not expose all fields. Fallback to direct markdown frontmatter.
  if (
    (!eventColor ||
      eventBackground === "" ||
      eventBackground == null ||
      !recurrenceType ||
      !recurrenceUntil ||
      recurrenceInterval === "" ||
      recurrenceCount === "" ||
      recurrenceDays.length === 0 ||
      recurrenceExdates.length === 0 ||
      recurrenceRdates.length === 0 ||
      !recurrenceExrule) &&
    sourcePath
  ) {
    const sourceFile = path.resolve(VAULT_ROOT, sourcePath);
    if (fs.existsSync(sourceFile)) {
      const content = fs.readFileSync(sourceFile, "utf8");
      const frontmatter = extractFrontmatter(content);
      const frontmatterData = parseFrontmatterData(frontmatter);
      if (!titleFromFrontmatter) {
        titleFromFrontmatter = extractField(frontmatterData, "title");
      }
      if (!eventColor) {
        eventColor = extractField(frontmatterData, "event_color", "eventColor", "color");
      }
      if (eventBackground === "" || eventBackground == null) {
        eventBackground = extractField(frontmatterData, "event_background", "eventBackground");
      }
      recurrenceType =
        recurrenceType || extractField(frontmatterData, "event_recurrence", "eventRecurrence").toLowerCase();
      recurrenceUntil =
        recurrenceUntil || extractField(frontmatterData, "event_recurrence_until", "eventRecurrenceUntil");
      if (recurrenceInterval === "") {
        recurrenceInterval = extractField(
          frontmatterData,
          "event_recurrence_interval",
          "eventRecurrenceInterval"
        );
      }
      if (recurrenceCount === "") {
        recurrenceCount = extractField(
          frontmatterData,
          "event_recurrence_count",
          "eventRecurrenceCount"
        );
      }
      if (!recurrenceDays || recurrenceDays.length === 0) {
        recurrenceDays = extractListField(frontmatterData, "event_recurrence_days", "eventRecurrenceDays");
      }
      if (!recurrenceExdates || recurrenceExdates.length === 0) {
        recurrenceExdates = extractListField(
          frontmatterData,
          "event_recurrence_exdates",
          "eventRecurrenceExdates"
        );
      }
      if (!recurrenceRdates || recurrenceRdates.length === 0) {
        recurrenceRdates = extractListField(
          frontmatterData,
          "event_recurrence_rdates",
          "eventRecurrenceRdates"
        );
      }
      if (!recurrenceExrule) {
        recurrenceExrule = extractField(
          frontmatterData,
          "event_recurrence_exrule",
          "event_recurrence_exrules",
          "eventRecurrenceExrule"
        );
      }
      if (!coordinates) {
        coordinates = normalizeCoordinatesValue(extractField(frontmatterData, "coordinates"));
      }
    }
  }

  const titleFromRow = String(row.title ?? row.Title ?? "").trim();
  const title =
    titleFromRow ||
    String(titleFromFrontmatter || "").trim() ||
    String(row.Dateiname ?? "").trim() ||
    (sourcePath ? path.basename(sourcePath, ".md") : "Event");
  const isBackgroundEvent = parseBoolean(eventBackground);

  const event = {
    id: sourcePath,
    title,
    allDay: !isTimedEvent,
    extendedProps: {
      sourcePath
    }
  };

  if (eventColor) {
    event.backgroundColor = eventColor;
    event.borderColor = eventColor;
  }

  if (isBackgroundEvent) {
    event.display = "background";
  }
  if (coordinates) {
    event.extendedProps.coordinates = coordinates;
  }

  if (recurrenceType === "weekly") {
    const parsedDays = parseDaysOfWeek(recurrenceDays);
    const recurringDurationMs = isTimedEvent ? durationMsFromDateLike(startValue, endValue) : 0;
    const recurringTimePortion = extractTimePortion(startValue);
    event.rrule = {
      freq: "weekly",
      interval: Math.max(1, parseInteger(recurrenceInterval, 1)),
      byweekday: toRruleByWeekday(parsedDays.length ? parsedDays : [dayOfWeekFromIsoDate(startDate)]),
      dtstart: startValue
    };
    if (isIsoDate(recurrenceUntil)) {
      event.rrule.until = recurrenceUntil;
    }
    const parsedCount = parseInteger(recurrenceCount, 0);
    if (parsedCount > 0) {
      event.rrule.count = parsedCount;
    }

    if (isTimedEvent) {
      if (recurringDurationMs > 0) {
        event.duration = { milliseconds: recurringDurationMs };
      }
    } else {
      const lastDate = isIsoDate(endValue) ? endValue : startDate;
      const durationDays = inclusiveDaySpan(startDate, lastDate);
      if (durationDays > 1) {
        event.duration = { days: durationDays };
      }
    }

    const parsedExdates = parseIsoDateList(recurrenceExdates);
    if (parsedExdates.length) {
      event.exdate = isTimedEvent
        ? parsedExdates.map((dateStr) => mergeDateWithTimePortion(dateStr, recurringTimePortion))
        : parsedExdates;
    }

    const parsedExrule = parseJsonField(recurrenceExrule);
    if (parsedExrule) {
      event.exrule = parsedExrule;
    }

    event.editable = isTimedEvent;
    event.extendedProps.isRecurring = true;

    const parsedRdates = parseIsoDateList(recurrenceRdates);
    const overrideEvents = parsedRdates.map((dateStr) => ({
      id: `${event.id}#rdate-${dateStr}`,
      title: event.title,
      start: isTimedEvent ? mergeDateWithTimePortion(dateStr, recurringTimePortion) : dateStr,
      allDay: !isTimedEvent,
      editable: false,
      backgroundColor: event.backgroundColor,
      borderColor: event.borderColor,
      display: event.display,
      extendedProps: {
        ...event.extendedProps,
        isRecurring: true,
        isRecurringOverride: true
      }
    }));

    if (isTimedEvent && recurringDurationMs > 0) {
      overrideEvents.forEach((overrideEvent) => {
        overrideEvent.duration = { milliseconds: recurringDurationMs };
      });
    }

    return [event, ...overrideEvents];
  } else {
    event.start = startValue;
    if (endValue) {
      if (isTimedEvent && isIsoDateTime(endValue)) {
        event.end = endValue;
      } else if (!isTimedEvent && isIsoDate(endValue)) {
        event.end = addOneDay(endValue);
      }
    }
  }

  return [event];
}

/**
 * Collects all calendar events from Obsidian Base rows.
 * @returns {object[]} Calendar events.
 */
function collectEventsFromBase() {
  const rows = queryBaseRows();
  return rows.flatMap(baseRowToCalendarEvent).filter(Boolean);
}

/**
 * Collects all calendar events from recursive markdown scan fallback.
 * @returns {object[]} Calendar events.
 */
function collectEventsFromMarkdownScan() {
  const allMarkdown = listMarkdownFiles(VAULT_ROOT);
  return allMarkdown.flatMap((filePath) => toCalendarEvent(filePath)).filter(Boolean);
}

let events;
let sourceLabel = "";

try {
  events = collectEventsFromBase();
  sourceLabel = `Obsidian Base (${BASE_PATH} :: ${BASE_VIEW})`;
} catch (error) {
  if (!ALLOW_MARKDOWN_FALLBACK) {
    const message =
      `Base query failed for ${BASE_PATH} :: ${BASE_VIEW} and markdown fallback is disabled.\n` +
      `Set ALLOW_MARKDOWN_FALLBACK=true to permit full markdown scan fallback.\n` +
      `Original error: ${error.message}`;
    throw new Error(message);
  }
  events = collectEventsFromMarkdownScan();
  sourceLabel = "Markdown fallback scan";
  console.warn(`Base query failed, using fallback scan because ALLOW_MARKDOWN_FALLBACK=true.\n${error.message}`);
}

/**
 * Extracts sortable event date token from event object.
 * @param {object} event - Calendar event.
 * @returns {string} Sort key value.
 */
function eventSortDate(event) {
  return String(event.start || event.startRecur || "");
}

events.sort(
  (a, b) =>
    eventSortDate(a).localeCompare(eventSortDate(b)) ||
    String(a.title || "").localeCompare(String(b.title || ""))
);

const output = `window.CALENDAR_EVENTS = ${JSON.stringify(events, null, 2)};\n`;
fs.writeFileSync(OUTPUT_FILE, output, "utf8");

console.log(
  `Generated ${events.length} events from ${sourceLabel} -> ${path.relative(VAULT_ROOT, OUTPUT_FILE)}`
);


