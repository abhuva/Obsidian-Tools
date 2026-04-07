import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] || "";
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
    if (!isDoubleQuoted && !isSingleQuoted) {
      const hashIndex = value.indexOf("#");
      if (hashIndex >= 0) value = value.slice(0, hashIndex);
      value = value.trim();
    } else {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile(path.resolve(__dirname, ".env"));
loadDotEnvFile(path.resolve(__dirname, ".env.local"));

const VAULT_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_FILE = path.resolve(__dirname, "events.generated.js");
const BASE_PATH = process.env.OBSIDIAN_BASE_PATH || "6. Obsidian/Live/Kalender.base";
const BASE_VIEW = process.env.OBSIDIAN_BASE_VIEW || "Tabelle";
const OBSIDIAN_VAULT_NAME = String(process.env.OBSIDIAN_VAULT_NAME || "").trim();
const EXCLUDE_DIRS = new Set([".obsidian", ".trash", "8. Emails", "Attachments", "Excalidraw"]);

function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

function isExcludedDir(dirName) {
  return EXCLUDE_DIRS.has(dirName);
}

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

function extractFrontmatter(content) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return "";
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) return "";
  return content.slice(4, end);
}

function extractField(frontmatter, ...names) {
  for (const name of names) {
    const pattern = new RegExp(`^${name}[ \\t]*:[ \\t]*(.*)$`, "mi");
    const match = frontmatter.match(pattern);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

function extractListField(frontmatter, ...names) {
  for (const name of names) {
    const inlinePattern = new RegExp(`^${name}[ \\t]*:[ \\t]*\\[(.*)\\][ \\t]*$`, "mi");
    const inlineMatch = frontmatter.match(inlinePattern);
    if (inlineMatch?.[1] != null) {
      return inlineMatch[1]
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }

    const blockPattern = new RegExp(`^${name}[ \\t]*:[ \\t]*\\n((?:[ \\t]*-[ \\t]*.+\\n?)*)`, "mi");
    const blockMatch = frontmatter.match(blockPattern);
    if (blockMatch?.[1]) {
      return blockMatch[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("-"))
        .map((line) => line.replace(/^-+\s*/, "").trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  return [];
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on";
}

function parseInteger(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(num) ? num : fallback;
}

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

function toRruleByWeekday(days) {
  const map = ["su", "mo", "tu", "we", "th", "fr", "sa"];
  return days
    .map((d) => map[d])
    .filter(Boolean);
}

function parseJsonField(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractTags(frontmatter) {
  const tags = [];

  const inlineMatch = frontmatter.match(/^tags\s*:\s*\[(.+)\]$/mi);
  if (inlineMatch?.[1]) {
    inlineMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/^["'#]|["']$/g, ""))
      .filter(Boolean)
      .forEach((t) => tags.push(t.toLowerCase()));
  }

  const blockMatch = frontmatter.match(/^tags\s*:\s*\n((?:\s*-\s*.+\n?)*)/mi);
  if (blockMatch?.[1]) {
    blockMatch[1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").trim().replace(/^["'#]|["']$/g, ""))
      .filter(Boolean)
      .forEach((t) => tags.push(t.toLowerCase()));
  }

  return [...new Set(tags)];
}

function hasInlineEventTag(content) {
  return /(^|\s)#event(\s|$)/i.test(content);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoDateTime(value) {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
    String(value || "").trim()
  );
}

function isDateOrDateTime(value) {
  return isIsoDate(value) || isIsoDateTime(value);
}

function parseDateLikeToIsoDate(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  const dateOnlyMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s].*$/);
  if (dateOnlyMatch?.[1] && isIsoDate(dateOnlyMatch[1])) return dateOnlyMatch[1];
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseDateLikeToCalendarValue(value) {
  if (value == null) return "";
  const raw = String(value).trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  if (isIsoDate(raw)) return raw;
  if (isIsoDateTime(raw)) return raw.replace(" ", "T");
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return "";
  return new Date(timestamp).toISOString();
}

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

function addOneDay(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  return utcDate.toISOString().slice(0, 10);
}

function dayOfWeekFromIsoDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return utcDate.getUTCDay();
}

function inclusiveDaySpan(startIso, endIso) {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  const diff = Math.floor((end - start) / 86400000) + 1;
  return diff > 0 ? diff : 1;
}

function durationMsFromDateLike(startValue, endValue) {
  const startTs = Date.parse(String(startValue || ""));
  const endTs = Date.parse(String(endValue || ""));
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return 0;
  return endTs - startTs;
}

function extractTimePortion(dateTimeValue) {
  const raw = String(dateTimeValue || "").trim();
  const match = raw.match(/^\d{4}-\d{2}-\d{2}T(.+)$/);
  return match && match[1] ? match[1] : "";
}

function mergeDateWithTimePortion(isoDate, timePortion) {
  if (!isIsoDate(isoDate) || !timePortion) return isoDate;
  return `${isoDate}T${timePortion}`;
}

function toCalendarEvent(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) return null;

  const tags = extractTags(frontmatter);
  const taggedAsEvent = tags.includes("event") || hasInlineEventTag(content);
  if (!taggedAsEvent) return null;

  const startDateFromFrontmatter = extractField(
    frontmatter,
    "event_start",
    "eventStart",
    "startDate",
    "startdate"
  );
  const createdDateFromFrontmatter = extractField(
    frontmatter,
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
    extractField(frontmatter, "event_end", "eventEnd", "endDate", "enddate")
  );
  const isTimedEvent = isIsoDateTime(startValue);
  if (!startDate || !isDateOrDateTime(startValue)) return null;

  const titleFromFm = extractField(frontmatter, "title");
  const eventColor = extractField(frontmatter, "event_color", "eventColor", "color");
  const eventBackground = parseBoolean(
    extractField(frontmatter, "event_background", "eventBackground")
  );
  const recurrenceType = extractField(frontmatter, "event_recurrence", "eventRecurrence").toLowerCase();
  const recurrenceUntil = extractField(frontmatter, "event_recurrence_until", "eventRecurrenceUntil");
  const recurrenceInterval = parseInteger(
    extractField(frontmatter, "event_recurrence_interval", "eventRecurrenceInterval"),
    1
  );
  const recurrenceCount = parseInteger(
    extractField(frontmatter, "event_recurrence_count", "eventRecurrenceCount"),
    0
  );
  const recurrenceDays = parseDaysOfWeek(
    extractListField(frontmatter, "event_recurrence_days", "eventRecurrenceDays")
  );
  const recurrenceExdates = parseIsoDateList(
    extractListField(frontmatter, "event_recurrence_exdates", "eventRecurrenceExdates")
  );
  const recurrenceRdates = parseIsoDateList(
    extractListField(frontmatter, "event_recurrence_rdates", "eventRecurrenceRdates")
  );
  const recurrenceExrule = parseJsonField(
    extractField(frontmatter, "event_recurrence_exrule", "event_recurrence_exrules")
  );
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
        const startTs = Date.parse(String(overrideEvent.start || ""));
        if (Number.isFinite(startTs)) {
          overrideEvent.end = new Date(startTs + recurringDurationMs).toISOString();
        }
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

  if (eventBackground) {
    event.display = "background";
  }

  return [event];
}

function queryBaseRows() {
  const escapedVaultName = OBSIDIAN_VAULT_NAME.replace(/"/g, '\\"');
  const escapedBasePath = BASE_PATH.replace(/"/g, '\\"');
  const escapedView = BASE_VIEW.replace(/"/g, '\\"');
  const vaultArg = escapedVaultName ? ` vault="${escapedVaultName}"` : "";

  const raw = execSync(`obsidian base:query${vaultArg} path="${escapedBasePath}" view="${escapedView}" format=json`, {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  return JSON.parse(raw);
}

function baseRowToCalendarEvent(row) {
  const sourcePath = String(row.path ?? "").trim();
  const sourceFilePath = sourcePath ? path.resolve(VAULT_ROOT, sourcePath) : "";
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
      const fmStartValue = parseDateLikeToCalendarValue(
        extractField(frontmatter, "event_start", "eventStart", "startDate", "startdate")
      );
      const fmEndValue = parseDateLikeToCalendarValue(
        extractField(frontmatter, "event_end", "eventEnd", "endDate", "enddate")
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
      eventColor = extractField(frontmatter, "event_color", "eventColor", "color");
      eventBackground = extractField(frontmatter, "event_background", "eventBackground");
      recurrenceType =
        recurrenceType || extractField(frontmatter, "event_recurrence", "eventRecurrence").toLowerCase();
      recurrenceUntil =
        recurrenceUntil || extractField(frontmatter, "event_recurrence_until", "eventRecurrenceUntil");
      if (recurrenceInterval === "") {
        recurrenceInterval = extractField(
          frontmatter,
          "event_recurrence_interval",
          "eventRecurrenceInterval"
        );
      }
      if (recurrenceCount === "") {
        recurrenceCount = extractField(
          frontmatter,
          "event_recurrence_count",
          "eventRecurrenceCount"
        );
      }
      if (!recurrenceDays || recurrenceDays.length === 0) {
        recurrenceDays = extractListField(frontmatter, "event_recurrence_days", "eventRecurrenceDays");
      }
      if (!recurrenceExdates || recurrenceExdates.length === 0) {
        recurrenceExdates = extractListField(
          frontmatter,
          "event_recurrence_exdates",
          "eventRecurrenceExdates"
        );
      }
      if (!recurrenceRdates || recurrenceRdates.length === 0) {
        recurrenceRdates = extractListField(
          frontmatter,
          "event_recurrence_rdates",
          "eventRecurrenceRdates"
        );
      }
      if (!recurrenceExrule) {
        recurrenceExrule = extractField(
          frontmatter,
          "event_recurrence_exrule",
          "event_recurrence_exrules",
          "eventRecurrenceExrule"
        );
      }
    }
  }

  const title =
    String(row.Dateiname ?? "").trim() ||
    (sourcePath ? path.basename(sourcePath, ".md") : "Event");

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
      event.exdate = parsedExdates;
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
        const startTs = Date.parse(String(overrideEvent.start || ""));
        if (Number.isFinite(startTs)) {
          overrideEvent.end = new Date(startTs + recurringDurationMs).toISOString();
        }
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

  if (parseBoolean(eventBackground)) {
    event.display = "background";
  }

  return [event];
}

function collectEventsFromBase() {
  const rows = queryBaseRows();
  return rows.flatMap(baseRowToCalendarEvent).filter(Boolean);
}

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
  events = collectEventsFromMarkdownScan();
  sourceLabel = "Markdown fallback scan";
  console.warn(`Base query failed, using fallback scan.\n${error.message}`);
}

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
