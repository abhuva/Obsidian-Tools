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
 * Get Obsidian Bin Candidates.
 * @returns {*} Returns obsidian bin candidates.
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
 * Resolve Obsidian Bin.
 * @returns {*} Returns obsidian bin.
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
 * Is Vault Targeting Error.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
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
 * Is Markdown File.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

/**
 * Is Excluded Dir.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function isExcludedDir(dirName) {
  return EXCLUDE_DIRS.has(dirName);
}

/**
 * List Markdown Files.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Extract Frontmatter.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Strip Wrapping Quotes.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function stripWrappingQuotes(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Strip Yaml Inline Comment.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Parse Inline Yaml Array.
 * @param {*}
 * @returns {*} Returns inline yaml array.
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
 * Parse Frontmatter Data.
 * @param {*}
 * @returns {*} Returns frontmatter data.
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
 * Frontmatter Lookup.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
 */
function frontmatterLookup(frontmatterData, name) {
  if (!frontmatterData || typeof frontmatterData !== "object") return undefined;
  return frontmatterData[String(name || "").toLowerCase()];
}

/**
 * Extract Field.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Extract List Field.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Parse Boolean.
 * @param {*}
 * @returns {*} Returns boolean.
 */
function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on";
}

/**
 * Parse Integer.
 * @param {*}
 * @param {*}
 * @returns {*} Returns integer.
 */
function parseInteger(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(num) ? num : fallback;
}

/**
 * Normalize Coordinates Value.
 * @param {*}
 * @returns {*} Returns coordinates value.
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
 * Parse Iso Date List.
 * @param {*}
 * @returns {*} Returns iso date list.
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
 * Parse Days Of Week.
 * @param {*}
 * @returns {*} Returns days of week.
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
 * To Rrule By Weekday.
 * @param {*}
 * @returns {*} Returns rrule by weekday.
 */
function toRruleByWeekday(days) {
  const map = ["su", "mo", "tu", "we", "th", "fr", "sa"];
  return days
    .map((d) => map[d])
    .filter(Boolean);
}

/**
 * Parse Json Field.
 * @param {*}
 * @returns {*} Returns json field.
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
 * Extract Tags.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Has Inline Event Tag.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function hasInlineEventTag(content) {
  return /(^|\s)#event(\s|$)/i.test(content);
}

/**
 * Is Iso Date.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Is Iso Date Time.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
    String(value || "").trim()
  );
}

/**
 * Is Date Or Date Time.
 * @param {*}
 * @returns {*} Returns whether the condition is met.
 */
function isDateOrDateTime(value) {
  return isIsoDate(value) || isIsoDateTime(value);
}

/**
 * Date To Local Iso Date.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Parse Date Like To Iso Date.
 * @param {*}
 * @returns {*} Returns date like to iso date.
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
 * Parse Date Like To Calendar Value.
 * @param {*}
 * @returns {*} Returns date like to calendar value.
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
 * Get Start Date From File Meta.
 * @param {*}
 * @returns {*} Returns start date from file meta.
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
 * Add One Day.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function addOneDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

/**
 * Day Of Week From Iso Date.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function dayOfWeekFromIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return utcDate.getUTCDay();
}

/**
 * Inclusive Day Span.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Duration Ms From Date Like.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
 */
function durationMsFromDateLike(startValue, endValue) {
  const startTs = Date.parse(String(startValue || ""));
  const endTs = Date.parse(String(endValue || ""));
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return 0;
  return endTs - startTs;
}

/**
 * Extract Time Portion.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function extractTimePortion(dateTimeValue) {
  const raw = String(dateTimeValue || "").trim();
  const match = raw.match(/^\d{4}-\d{2}-\d{2}T(.+)$/);
  return match && match[1] ? match[1] : "";
}

/**
 * Merge Date With Time Portion.
 * @param {*}
 * @param {*}
 * @returns {*} Returns the function result.
 */
function mergeDateWithTimePortion(isoDate, timePortion) {
  if (!isIsoDate(isoDate) || !timePortion) return isoDate;
  return `${isoDate}T${timePortion}`;
}

/**
 * To Calendar Event.
 * @param {*}
 * @returns {*} Returns calendar event.
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
 * Query Base Rows.
 * @returns {*} Returns the function result.
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
 * Base Row To Calendar Event.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Collect Events From Base.
 * @returns {*} Returns the function result.
 */
function collectEventsFromBase() {
  const rows = queryBaseRows();
  return rows.flatMap(baseRowToCalendarEvent).filter(Boolean);
}

/**
 * Collect Events From Markdown Scan.
 * @returns {*} Returns the function result.
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
 * Event Sort Date.
 * @param {*}
 * @returns {*} Returns the function result.
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


