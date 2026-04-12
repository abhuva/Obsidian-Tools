import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOMEPAGE_HOST || "127.0.0.1";
const PORT = Number(process.env.HOMEPAGE_PORT || 4174);
const ROOT = __dirname;
const VAULT_ROOT = path.resolve(__dirname, "..");
const OBSIDIAN_VAULT_NAME = String(process.env.OBSIDIAN_VAULT_NAME || "").trim();
const OBSIDIAN_BIN = resolveObsidianBin();

const BOOKMARKS_FILE = path.join(VAULT_ROOT, ".obsidian", "bookmarks.json");
const SETTINGS_DIR = path.join(ROOT, "config");
const DEFAULT_SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.default.json");
const LOCAL_SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.local.json");
const DATA_DIR = path.join(ROOT, "data", "updo");
const UPDO_RAW_FILE = path.join(DATA_DIR, "raw.jsonl");
const UPDO_LONGTERM_FILE = path.join(DATA_DIR, "longterm.jsonl");
const UPDO_INCIDENTS_FILE = path.join(DATA_DIR, "incidents.jsonl");
const UPDO_STATE_FILE = path.join(DATA_DIR, "state.json");
const BEANTIME_STATE_FILE = path.join(ROOT, "data", "beantime", "state.json");
const PROJECTS_ROOT_REL = "2. Projektverwaltung";
const PROJECTS_ROOT = path.join(VAULT_ROOT, PROJECTS_ROOT_REL);
const TEMPLATE_PROJECT_FILE_REL = "6. Obsidian/_template/Projekt.md";
const TEMPLATE_PROJECT_FILE = path.join(VAULT_ROOT, TEMPLATE_PROJECT_FILE_REL);

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

const DEFAULT_SETTINGS_FALLBACK = {
  schemaVersion: 1,
  ui: {
    title: "Workspace Homepage",
    titleSize: 38,
    search: {
      provider: "omnisearch",
      openInNewTab: false
    },
    theme: {
      mode: "preset",
      preset: "soft",
      shape: "rounded"
    }
  },
  modules: {
    bookmarks: {
      enabled: true,
      title: "Bookmarks",
      showPath: false,
      showType: false,
      openInNewTab: false,
      cardMaxWidth: 240
    },
    clock: {
      enabled: true,
      title: "Uhrzeit",
      showSeconds: true,
      hour12: false
    },
    newProject: {
      enabled: true,
      title: "Projektverwaltung",
      openInNewTab: true
    },
    timetracking: {
      enabled: true,
      title: "Zeiterfassung",
      file: "timetracking/timetracking.klg",
      pauseSummary: "Pause #pause",
      refreshSec: 20
    },
    beantime: {
      enabled: true,
      title: "Beantime",
      file: "beantime/zeit.beancount",
      personAccount: "Zeit:Marc",
      stateFile: "data/beantime/state.json",
      bookableAccountPrefix: "Projekte:"
    },
    updo: {
      enabled: true,
      title: "Website Monitoring",
      refreshSec: 5,
      windowMinutes: 60,
      maxPoints: 720,
      persistence: {
        enabled: true,
        rawFile: "data/updo/raw.jsonl",
        longtermFile: "data/updo/longterm.jsonl",
        incidentsFile: "data/updo/incidents.jsonl",
        stateFile: "data/updo/state.json"
      },
      compression: {
        compressCount: 720,
        compressSpanMinutes: 1440,
        keepTailPoints: 120
      },
      spikeDetection: {
        staticThresholdMs: 1200,
        multiplierOverAvg: 2.5,
        minConsecutivePoints: 2
      },
      outageDetection: {
        minConsecutiveFailures: 2
      },
      gapDetection: {
        gapFactor: 3
      },
      targets: [
        { id: "www", name: "www.nica.network", url: "https://www.nica.network" },
        { id: "cloud", name: "cloud.nica.network", url: "https://cloud.nica.network" },
        { id: "campus", name: "campus.nica.network", url: "https://campus.nica.network" }
      ]
    }
  }
};

const UPDO_BASE_RESTART_DELAY_MS = 3000;
const UPDO_MAX_RESTART_DELAY_MS = 60000;
const UPDO_MAX_RESTART_ATTEMPTS = 5;
const UPDO_SSL_PROBE_TTL_MS = 5 * 60 * 1000;
const UPDO_COMPRESSION_CHECK_INTERVAL_MS = 60 * 1000;
const updoState = {
  process: null,
  restartTimer: null,
  restartAttempts: 0,
  stdoutBuffer: "",
  stderrBuffer: "",
  configSignature: "",
  stopRequested: false,
  lastError: "",
  startedAt: "",
  latestByUrl: new Map(),
  seriesByUrl: new Map(),
  sslProbeByUrl: new Map(),
  persistedRawByUrl: new Map(),
  lastCompressedTsByUrl: {},
  persistenceLoaded: false,
  persistenceDirty: false,
  lastCompressionCheckMs: 0
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
 * Executes the Obsidian CLI and retries without explicit vault targeting on vault lookup errors.
 * @param {string[]} args - CLI arguments passed to Obsidian.
 * @param {object} options - `execFileSync` options.
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
 * Resolves a URL path to a local file path below `Tools/` and blocks path traversal.
 * @param {string} urlPath - Request pathname from the HTTP request.
 * @returns {string|null} Absolute path for static serving or `null` if rejected.
 */
function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = decoded === "/" ? "/home.html" : decoded;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

/**
 * Reads a request body with a hard size limit of 1 MiB.
 * @param {import("node:http").IncomingMessage} req - Incoming HTTP request.
 * @returns {Promise<string>} Raw request body text.
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
 * Ensures the settings directory exists.
 * @returns {void}
 */
function ensureSettingsDir() {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

/**
 * Reads a JSON file with graceful fallback for missing/invalid files.
 * @template T
 * @param {string} filePath - Absolute file path.
 * @param {T} fallbackValue - Value returned when reading/parsing fails.
 * @returns {T|object} Parsed JSON value or fallback.
 */
function readJsonFileSafe(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

/**
 * Deep-merges plain objects while replacing arrays.
 * @param {object} base - Base object.
 * @param {object} patch - Overlay object.
 * @returns {object} Merged result.
 */
function deepMerge(base, patch) {
  const baseObj = base && typeof base === "object" ? base : {};
  const patchObj = patch && typeof patch === "object" ? patch : {};
  const out = { ...baseObj };

  for (const [key, value] of Object.entries(patchObj)) {
    if (Array.isArray(value)) {
      out[key] = value.slice();
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = deepMerge(baseObj[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Coerces common boolean-like values.
 * @param {unknown} value - Raw value.
 * @param {boolean} fallback - Fallback when conversion is ambiguous.
 * @returns {boolean} Normalized boolean.
 */
function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

/**
 * Returns a trimmed non-empty string or fallback.
 * @param {unknown} value - Candidate string value.
 * @param {string} fallback - Fallback for empty/non-string input.
 * @returns {string} Sanitized text.
 */
function toCleanString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  return cleaned || fallback;
}

/**
 * Parses an integer and clamps it to a configured range.
 * @param {unknown} value - Raw value.
 * @param {number} fallback - Fallback for invalid input.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {number} Clamped integer.
 */
function toIntInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Normalizes string values to one of the allowed lowercase tokens.
 * @param {unknown} value - Raw value.
 * @param {string[]} allowed - Allowed normalized values.
 * @param {string} fallback - Fallback when value is not allowed.
 * @returns {string} Allowed token.
 */
function oneOf(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

/**
 * Coerces a numeric value and falls back for non-finite values.
 * @param {unknown} value - Raw numeric value.
 * @param {number} [fallback=0] - Fallback for invalid input.
 * @returns {number} Finite number.
 */
function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parses a number and clamps it to a configured range.
 * @param {unknown} value - Raw value.
 * @param {number} fallback - Fallback for invalid input.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {number} Clamped number.
 */
function toNumberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Resolves persisted data paths relative to `Tools/`.
 * @param {unknown} relativePath - Configured relative path value.
 * @param {string} fallbackAbsolutePath - Fallback absolute path.
 * @returns {string} Absolute path for the data file.
 */
function resolveDataPath(relativePath, fallbackAbsolutePath) {
  const raw = String(relativePath || "").trim();
  if (!raw) return fallbackAbsolutePath;
  const normalized = raw.replace(/^[/\\]+/, "").replace(/[\\/]+/g, path.sep);
  return path.resolve(ROOT, normalized);
}

/**
 * Resolves the configured klog path to an absolute file path.
 * Relative paths are resolved against `Tools/`.
 * @param {unknown} configuredPath - Configured file path from settings.
 * @returns {string} Absolute file path to the `.klg` file.
 */
function resolveTimetrackingFilePath(configuredPath) {
  const fallback = path.join(ROOT, "timetracking", "timetracking.klg");
  const raw = String(configuredPath || "").trim();
  if (!raw) return fallback;
  if (path.isAbsolute(raw)) return path.resolve(raw);
  const normalized = raw.replace(/^[/\\]+/, "").replace(/[\\/]+/g, path.sep);
  return path.resolve(ROOT, normalized);
}

/**
 * Ensures a klog file exists so klog commands can append/create records.
 * @param {string} filePath - Absolute path to `.klg` file.
 * @returns {void}
 */
function ensureKlogFileExists(filePath) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
  }
}

/**
 * Executes the klog CLI and returns UTF-8 stdout.
 * @param {string[]} args - Argument list passed to `klog`.
 * @returns {string} Command stdout.
 */
function runKlog(args) {
  try {
    return execFileSync("klog", args, {
      cwd: VAULT_ROOT,
      encoding: "utf8",
      stdio: "pipe"
    });
  } catch (error) {
    const details = String(error?.stderr || error?.stdout || error?.message || "").trim();
    throw new Error(details || "klog command failed");
  }
}

/**
 * Parses `H:mm` time values from klog JSON rows.
 * @param {unknown} value - Time token.
 * @returns {number|null} Minutes from day start or `null`.
 */
function parseKlogTimeMins(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number.parseInt(match[1], 10);
  const mm = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Returns current local date as `YYYY-MM-DD`.
 * @returns {string} Date token.
 */
function localTodayToken() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Computes live minutes for an open range on today's record.
 * @param {string} recordDate - Record date token.
 * @param {string} start - Open range start token (`H:mm`).
 * @returns {number} Runtime in minutes.
 */
function openRangeRuntimeMins(recordDate, start) {
  if (String(recordDate || "").trim() !== localTodayToken()) return 0;
  const startMins = parseKlogTimeMins(start);
  if (startMins == null) return 0;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, nowMins - startMins);
}

/**
 * Builds a client payload for today's time tracking state from klog JSON output.
 * @param {string} filePath - Absolute `.klg` file path.
 * @returns {{ok: true, file: string, date: string, totalMins: number, entries: Array<object>, active: object|null}} Snapshot payload.
 */
function getTimetrackingTodaySnapshot(filePath) {
  ensureKlogFileExists(filePath);
  const raw = runKlog(["json", filePath, "--today", "--pretty", "--no-warn"]);
  let payload = null;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Could not parse klog JSON output");
  }

  const record = Array.isArray(payload?.records) && payload.records.length ? payload.records[0] : null;
  const entries = Array.isArray(record?.entries) ? record.entries : [];
  const date = String(record?.date || localTodayToken());

  const shapedEntries = entries.map((entry) => ({
    type: String(entry?.type || ""),
    summary: String(entry?.summary || ""),
    total: String(entry?.total || "0m"),
    total_mins: toFiniteNumber(entry?.total_mins, 0),
    start: String(entry?.start || ""),
    end: String(entry?.end || "")
  }));

  const active = shapedEntries.find((entry) => entry.type === "open_range") || null;
  const closedMins = shapedEntries.reduce((sum, entry) => {
    if (entry.type === "open_range") return sum;
    return sum + toFiniteNumber(entry.total_mins, 0);
  }, 0);
  const activeMins = active ? openRangeRuntimeMins(date, active.start) : 0;
  const totalMins = Math.max(0, Math.floor(closedMins + activeMins));

  return {
    ok: true,
    file: path.relative(VAULT_ROOT, filePath).replace(/\\/g, "/"),
    date,
    totalMins,
    entries: shapedEntries,
    active
  };
}

/**
 * Derives runtime time-tracking config from effective settings.
 * @param {object} settings - Effective settings object.
 * @returns {{enabled: boolean, title: string, filePath: string, pauseSummary: string, refreshSec: number}} Runtime config.
 */
function getTimetrackingConfigFromSettings(settings) {
  const moduleCfg = settings?.modules?.timetracking || {};
  return {
    enabled: toBool(moduleCfg.enabled, DEFAULT_SETTINGS_FALLBACK.modules.timetracking.enabled),
    title: toCleanString(moduleCfg.title, DEFAULT_SETTINGS_FALLBACK.modules.timetracking.title),
    filePath: resolveTimetrackingFilePath(
      toCleanString(moduleCfg.file, DEFAULT_SETTINGS_FALLBACK.modules.timetracking.file)
    ),
    pauseSummary: toCleanString(
      moduleCfg.pauseSummary,
      DEFAULT_SETTINGS_FALLBACK.modules.timetracking.pauseSummary
    ),
    refreshSec: toIntInRange(
      moduleCfg.refreshSec,
      DEFAULT_SETTINGS_FALLBACK.modules.timetracking.refreshSec,
      5,
      300
    )
  };
}

/**
 * Derives runtime Beantime configuration from effective settings.
 * @param {object} settings - Effective settings object.
 * @returns {{enabled: boolean, title: string, filePath: string, personAccount: string, stateFilePath: string, bookableAccountPrefix: string}} Runtime config.
 */
function getBeantimeConfigFromSettings(settings) {
  const moduleCfg = settings?.modules?.beantime || {};
  return {
    enabled: toBool(moduleCfg.enabled, DEFAULT_SETTINGS_FALLBACK.modules.beantime.enabled),
    title: toCleanString(moduleCfg.title, DEFAULT_SETTINGS_FALLBACK.modules.beantime.title),
    filePath: resolveDataPath(
      toCleanString(moduleCfg.file, DEFAULT_SETTINGS_FALLBACK.modules.beantime.file),
      path.join(ROOT, "beantime", "zeit.beancount")
    ),
    personAccount: toCleanString(
      moduleCfg.personAccount,
      DEFAULT_SETTINGS_FALLBACK.modules.beantime.personAccount
    ),
    stateFilePath: resolveDataPath(
      toCleanString(moduleCfg.stateFile, DEFAULT_SETTINGS_FALLBACK.modules.beantime.stateFile),
      BEANTIME_STATE_FILE
    ),
    bookableAccountPrefix: toCleanString(
      moduleCfg.bookableAccountPrefix,
      DEFAULT_SETTINGS_FALLBACK.modules.beantime.bookableAccountPrefix
    )
  };
}

/**
 * Ensures a Beancount file exists for Beantime writes.
 * @param {string} filePath - Absolute path to Beancount ledger.
 * @returns {void}
 */
function ensureBeantimeLedgerExists(filePath) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", "utf8");
  }
}

/**
 * Reads and normalizes the Beantime running timer state.
 * @param {string} stateFilePath - Absolute path to state JSON.
 * @returns {{startedAt: string, startedDate: string, account: string, summary: string}|null} Running timer state.
 */
function readBeantimeState(stateFilePath) {
  const raw = readJsonFileSafe(stateFilePath, null);
  if (!raw || typeof raw !== "object") return null;
  const startedAt = toCleanString(raw.startedAt, "");
  const startedDate = toCleanString(raw.startedDate, "");
  const account = toCleanString(raw.account, "");
  if (!startedAt || !startedDate || !account) return null;
  return {
    startedAt,
    startedDate,
    account,
    summary: toCleanString(raw.summary, "")
  };
}

/**
 * Persists a running timer state for Beantime.
 * @param {string} stateFilePath - Absolute state file path.
 * @param {{startedAt: string, startedDate: string, account: string, summary: string}|null} state - Next state.
 * @returns {void}
 */
function writeBeantimeState(stateFilePath, state) {
  if (!state) {
    if (fs.existsSync(stateFilePath)) fs.unlinkSync(stateFilePath);
    return;
  }
  writeJson(stateFilePath, state);
}

/**
 * Parses open account directives and returns bookable project accounts.
 * @param {string} filePath - Absolute Beancount file path.
 * @param {string} prefix - Account prefix filter.
 * @returns {string[]} Sorted list of account names.
 */
function readBeantimeBookableAccounts(filePath, prefix) {
  ensureBeantimeLedgerExists(filePath);
  const raw = fs.readFileSync(filePath, "utf8");
  const out = new Set();
  const cleanPrefix = String(prefix || "").trim();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\d{4}-\d{2}-\d{2}\s+open\s+([A-Z][A-Za-z0-9:-]*)(?:\s+;.*)?\s*$/);
    if (!match) continue;
    const account = String(match[1] || "").trim();
    if (!account) continue;
    if (cleanPrefix && !account.startsWith(cleanPrefix)) continue;
    out.add(account);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

/**
 * Escapes text for safe use as a Beancount quoted string.
 * @param {unknown} value - Raw text value.
 * @returns {string} Escaped string.
 */
function asBeanString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/**
 * Formats decimal hours from minutes for Beancount HR postings.
 * @param {number} minutes - Duration in minutes.
 * @returns {string} Decimal hours string with two fraction digits.
 */
function minutesToHourAmount(minutes) {
  const safe = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  return (safe / 60).toFixed(2);
}

/**
 * Appends one Beantime transaction to the configured ledger.
 * @param {{filePath: string, personAccount: string}} cfg - Runtime Beantime config.
 * @param {{startedAt: string, startedDate: string, account: string, summary: string}} state - Running state to finalize.
 * @returns {{date: string, durationMinutes: number, amountHours: string}} Append summary.
 */
function appendBeantimeTransaction(cfg, state) {
  ensureBeantimeLedgerExists(cfg.filePath);
  const startMs = Date.parse(state.startedAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Invalid start timestamp in state");
  }
  const end = new Date();
  const endIso = end.toISOString();
  const diffMs = Math.max(0, end.getTime() - startMs);
  const durationMinutes = Math.max(0, Math.round(diffMs / 60000));
  const amountHours = minutesToHourAmount(durationMinutes);
  const txDate = toCleanString(state.startedDate, localTodayToken());
  const payee = cfg.personAccount.includes(":") ? cfg.personAccount.split(":").pop() : cfg.personAccount;
  const narration = state.summary || "Zeiterfassung";

  const tx = [
    `${txDate} * "${asBeanString(payee)}" "${asBeanString(narration)}"`,
    `  start: "${asBeanString(state.startedAt)}"`,
    `  end: "${asBeanString(endIso)}"`,
    `  duration_minutes: ${durationMinutes}`,
    `  timer_module: "beantime"`,
    `  ${state.account}  ${amountHours} HR`,
    `  ${cfg.personAccount}`,
    ""
  ].join("\n");

  const current = fs.existsSync(cfg.filePath) ? fs.readFileSync(cfg.filePath, "utf8") : "";
  const spacer = current.length && !current.endsWith("\n") ? "\n\n" : current.length ? "\n" : "";
  fs.appendFileSync(cfg.filePath, `${spacer}${tx}`, "utf8");

  return {
    date: txDate,
    durationMinutes,
    amountHours
  };
}

/**
 * Ensures the parent directory of a file path exists.
 * @param {string} filePath - Target file path.
 * @returns {void}
 */
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Appends one JSONL row to a file.
 * @param {string} filePath - JSONL file path.
 * @param {object} payload - JSON-serializable row payload.
 * @returns {void}
 */
function appendJsonLine(filePath, payload) {
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

/**
 * Reads a JSONL file and skips malformed rows.
 * @param {string} filePath - JSONL file path.
 * @returns {Array<object>} Parsed JSON rows.
 */
function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Ignore malformed lines and keep processing.
    }
  }
  return out;
}

/**
 * Writes a formatted JSON file with trailing newline.
 * @param {string} filePath - Target file path.
 * @param {object} payload - JSON-serializable payload.
 * @returns {void}
 */
function writeJson(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Validates and normalizes HTTP(S) URLs.
 * @param {unknown} value - Raw URL string.
 * @returns {string} Normalized URL or empty string when invalid.
 */
function toCleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * Builds a safe identifier for monitoring targets.
 * @param {unknown} value - Raw identifier seed.
 * @returns {string} Slug-like target id.
 */
function toUpdoId(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "";
}

/**
 * Normalizes and de-duplicates configured monitoring targets.
 * @param {unknown} input - Raw targets array from settings.
 * @returns {Array<{id: string, name: string, url: string}>} Sanitized target list.
 */
function normalizeUpdoTargets(input) {
  const source = Array.isArray(input) ? input : [];
  const out = [];
  const usedIds = new Set();
  const usedUrls = new Set();

  for (const entry of source) {
    const url = toCleanUrl(entry?.url);
    if (!url || usedUrls.has(url)) continue;
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    let id = toUpdoId(entry?.id || host);
    if (!id) id = `target-${out.length + 1}`;
    while (usedIds.has(id)) {
      id = `${id}-${out.length + 1}`;
    }
    usedIds.add(id);
    usedUrls.add(url);
    out.push({
      id,
      name: toCleanString(entry?.name, host),
      url
    });
  }

  return out;
}

/**
 * Normalizes project title input for naming.
 * @param {unknown} value - Raw title value.
 * @returns {string} Trimmed title with collapsed whitespace.
 */
function normalizeProjectTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * Normalizes funding code input for naming.
 * @param {unknown} value - Raw funding code.
 * @returns {string} Trimmed code with collapsed whitespace.
 */
function normalizeFundingCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * Normalizes the selected society token.
 * @param {unknown} value - Raw society value.
 * @returns {"NICA"|"TOHU"} Uppercase society key.
 */
function normalizeSociety(value) {
  return oneOf(value, ["nica", "tohu"], "nica").toUpperCase();
}

/**
 * Normalizes project type selection.
 * @param {unknown} value - Raw project type value.
 * @returns {"funding"|"hired"|"self financed"} Normalized project type.
 */
function normalizeProjectType(value) {
  return oneOf(value, ["funding", "hired", "self financed"], "funding");
}

/**
 * Converts Windows separators to POSIX separators.
 * @param {unknown} input - Path-like input.
 * @returns {string} Normalized path string.
 */
function sanitizePathSeparators(input) {
  return String(input || "").replace(/\\/g, "/");
}

/**
 * Checks whether a name contains Windows-invalid path characters.
 * @param {unknown} value - Candidate file/folder name.
 * @returns {boolean} `true` when disallowed characters are present.
 */
function hasInvalidWindowsPathChars(value) {
  return /[<>:"/\\|?*\u0000-\u001F]/.test(String(value || ""));
}

/**
 * Escapes and formats a scalar for YAML frontmatter.
 * @param {unknown} value - Scalar value.
 * @returns {string} YAML-safe scalar representation.
 */
function toYamlScalar(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const asString = String(value ?? "");
  const escaped = asString.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Inserts or updates a scalar key inside frontmatter.
 * @param {unknown} content - Markdown content.
 * @param {string} key - Frontmatter key.
 * @param {unknown} value - Scalar value.
 * @returns {string} Updated markdown content.
 */
function upsertFrontmatterScalar(content, key, value) {
  const normalizedContent = String(content || "");
  const yamlValue = toYamlScalar(value);
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*.*$`, "m");

  if (!normalizedContent.startsWith("---\n")) {
    return `---\n${key}: ${yamlValue}\n---\n${normalizedContent}`;
  }

  const endMarkerIndex = normalizedContent.indexOf("\n---\n", 4);
  if (endMarkerIndex < 0) {
    return `---\n${key}: ${yamlValue}\n---\n${normalizedContent.slice(4)}`;
  }

  const frontmatterBlock = normalizedContent.slice(4, endMarkerIndex);
  const body = normalizedContent.slice(endMarkerIndex + 5);
  let nextFrontmatter = frontmatterBlock;

  if (keyPattern.test(frontmatterBlock)) {
    nextFrontmatter = frontmatterBlock.replace(keyPattern, `${key}: ${yamlValue}`);
  } else {
    const needsBreak = nextFrontmatter.length > 0 && !nextFrontmatter.endsWith("\n");
    nextFrontmatter = `${nextFrontmatter}${needsBreak ? "\n" : ""}${key}: ${yamlValue}`;
  }

  return `---\n${nextFrontmatter}\n---\n${body}`;
}

/**
 * Applies known project fields to markdown frontmatter in stable key order.
 * @param {unknown} content - Markdown content.
 * @param {Record<string, unknown>} fields - Frontmatter values to upsert.
 * @returns {string} Updated markdown content.
 */
function applyProjectFrontmatter(content, fields) {
  const orderedKeys = ["year", "antragsteller", "f\u00F6rderer", "title", "type", "category"];
  let nextContent = String(content || "");
  for (const key of orderedKeys) {
    if (!(key in fields)) continue;
    nextContent = upsertFrontmatterScalar(nextContent, key, fields[key]);
  }
  return nextContent;
}

/**
 * Applies a minimal fallback replacement for template placeholders.
 * @param {unknown} templateRaw - Raw template markdown.
 * @param {string} projectTitle - Final project title.
 * @returns {string} Rendered markdown content.
 */
function renderTemplateFallback(templateRaw, projectTitle) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return String(templateRaw || "")
    .replace(/<%\s*tp\.date\.now\("YYYY-MM-DD,\s*HH:mm:ss"\)\s*%>/g, timestamp)
    .replace(/<%\s*tp\.file\.title\s*%>/g, String(projectTitle || ""));
}

/**
 * Validates inputs and builds canonical project folder naming.
 * @param {{year: unknown, society: unknown, fundingCode: unknown, projectTitle: unknown, projectType: unknown}} input - Raw naming inputs.
 * @returns {{year: number, society: "NICA"|"TOHU", projectType: "funding"|"hired"|"self financed", fundingCode: string, title: string, folderName: string}} Naming payload.
 */
function buildProjectNaming({ year, society, fundingCode, projectTitle, projectType }) {
  const cleanTitle = normalizeProjectTitle(projectTitle);
  if (!cleanTitle) throw new Error("Projekt-Titel darf nicht leer sein");
  if (hasInvalidWindowsPathChars(cleanTitle)) {
    throw new Error("Projekt-Titel enthaelt unzulaessige Zeichen");
  }
  if (cleanTitle.endsWith(".") || cleanTitle.endsWith(" ")) {
    throw new Error("Projekt-Titel darf nicht mit Punkt oder Leerzeichen enden");
  }

  const parsedYear = toIntInRange(year, new Date().getFullYear(), 2000, 2100);
  const cleanSociety = normalizeSociety(society);
  const cleanType = normalizeProjectType(projectType);
  const cleanFundingCode = normalizeFundingCode(fundingCode);

  if (cleanType === "funding") {
    if (!cleanFundingCode || cleanFundingCode === "-") {
      throw new Error("Foerderkuerzel ist fuer gefoerderte Projekte erforderlich");
    }
    if (hasInvalidWindowsPathChars(cleanFundingCode)) {
      throw new Error("Foerderkuerzel enthaelt unzulaessige Zeichen");
    }
    const folderName = `${parsedYear} ${cleanSociety} ${cleanFundingCode} - ${cleanTitle}`;
    return {
      year: parsedYear,
      society: cleanSociety,
      projectType: cleanType,
      fundingCode: cleanFundingCode,
      title: cleanTitle,
      folderName
    };
  }

  const folderName = `${parsedYear} ${cleanSociety} - ${cleanTitle}`;
  return {
    year: parsedYear,
    society: cleanSociety,
    projectType: cleanType,
    fundingCode: "-",
    title: cleanTitle,
    folderName
  };
}

/**
 * Normalizes and clamps all settings to schema-safe values.
 * @param {unknown} input - Raw settings payload.
 * @returns {object} Normalized settings object.
 */
function normalizeSettings(input) {
  const merged = deepMerge(DEFAULT_SETTINGS_FALLBACK, input);

  return {
    schemaVersion: 1,
    ui: {
      title: toCleanString(merged?.ui?.title, DEFAULT_SETTINGS_FALLBACK.ui.title),
      titleSize: toIntInRange(merged?.ui?.titleSize, DEFAULT_SETTINGS_FALLBACK.ui.titleSize, 18, 72),
      search: {
        provider: oneOf(
          merged?.ui?.search?.provider,
          ["omnisearch", "obsidian-search", "quick-file"],
          DEFAULT_SETTINGS_FALLBACK.ui.search.provider
        ),
        openInNewTab: toBool(
          merged?.ui?.search?.openInNewTab,
          DEFAULT_SETTINGS_FALLBACK.ui.search.openInNewTab
        )
      },
      theme: {
        mode: oneOf(merged?.ui?.theme?.mode, ["preset", "mirror-obsidian"], DEFAULT_SETTINGS_FALLBACK.ui.theme.mode),
        preset: oneOf(
          merged?.ui?.theme?.preset,
          ["soft", "flat", "high-contrast"],
          DEFAULT_SETTINGS_FALLBACK.ui.theme.preset
        ),
        shape: oneOf(
          merged?.ui?.theme?.shape,
          ["rounded", "comfortable", "sharp"],
          DEFAULT_SETTINGS_FALLBACK.ui.theme.shape
        )
      }
    },
    modules: {
      bookmarks: {
        enabled: toBool(
          merged?.modules?.bookmarks?.enabled,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.enabled
        ),
        title: toCleanString(
          merged?.modules?.bookmarks?.title,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.title
        ),
        showPath: toBool(
          merged?.modules?.bookmarks?.showPath,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.showPath
        ),
        showType: toBool(
          merged?.modules?.bookmarks?.showType,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.showType
        ),
        openInNewTab: toBool(
          merged?.modules?.bookmarks?.openInNewTab,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.openInNewTab
        ),
        cardMaxWidth: toIntInRange(
          merged?.modules?.bookmarks?.cardMaxWidth,
          DEFAULT_SETTINGS_FALLBACK.modules.bookmarks.cardMaxWidth,
          205,
          420
        )
      },
      clock: {
        enabled: toBool(merged?.modules?.clock?.enabled, DEFAULT_SETTINGS_FALLBACK.modules.clock.enabled),
        title: toCleanString(merged?.modules?.clock?.title, DEFAULT_SETTINGS_FALLBACK.modules.clock.title),
        showSeconds: toBool(
          merged?.modules?.clock?.showSeconds,
          DEFAULT_SETTINGS_FALLBACK.modules.clock.showSeconds
        ),
        hour12: toBool(merged?.modules?.clock?.hour12, DEFAULT_SETTINGS_FALLBACK.modules.clock.hour12)
      },
      newProject: {
        enabled: toBool(
          merged?.modules?.newProject?.enabled,
          DEFAULT_SETTINGS_FALLBACK.modules.newProject.enabled
        ),
        title: toCleanString(
          merged?.modules?.newProject?.title,
          DEFAULT_SETTINGS_FALLBACK.modules.newProject.title
        ),
        openInNewTab: toBool(
          merged?.modules?.newProject?.openInNewTab,
          DEFAULT_SETTINGS_FALLBACK.modules.newProject.openInNewTab
        )
      },
      timetracking: {
        enabled: toBool(
          merged?.modules?.timetracking?.enabled,
          DEFAULT_SETTINGS_FALLBACK.modules.timetracking.enabled
        ),
        title: toCleanString(
          merged?.modules?.timetracking?.title,
          DEFAULT_SETTINGS_FALLBACK.modules.timetracking.title
        ),
        file: toCleanString(
          merged?.modules?.timetracking?.file,
          DEFAULT_SETTINGS_FALLBACK.modules.timetracking.file
        ),
        pauseSummary: toCleanString(
          merged?.modules?.timetracking?.pauseSummary,
          DEFAULT_SETTINGS_FALLBACK.modules.timetracking.pauseSummary
        ),
        refreshSec: toIntInRange(
          merged?.modules?.timetracking?.refreshSec,
          DEFAULT_SETTINGS_FALLBACK.modules.timetracking.refreshSec,
          5,
          300
        )
      },
      beantime: {
        enabled: toBool(
          merged?.modules?.beantime?.enabled,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.enabled
        ),
        title: toCleanString(
          merged?.modules?.beantime?.title,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.title
        ),
        file: toCleanString(
          merged?.modules?.beantime?.file,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.file
        ),
        personAccount: toCleanString(
          merged?.modules?.beantime?.personAccount,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.personAccount
        ),
        stateFile: toCleanString(
          merged?.modules?.beantime?.stateFile,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.stateFile
        ),
        bookableAccountPrefix: toCleanString(
          merged?.modules?.beantime?.bookableAccountPrefix,
          DEFAULT_SETTINGS_FALLBACK.modules.beantime.bookableAccountPrefix
        )
      },
      updo: {
        enabled: toBool(merged?.modules?.updo?.enabled, DEFAULT_SETTINGS_FALLBACK.modules.updo.enabled),
        title: toCleanString(merged?.modules?.updo?.title, DEFAULT_SETTINGS_FALLBACK.modules.updo.title),
        refreshSec: toIntInRange(
          merged?.modules?.updo?.refreshSec,
          DEFAULT_SETTINGS_FALLBACK.modules.updo.refreshSec,
          3,
          300
        ),
        windowMinutes: toIntInRange(
          merged?.modules?.updo?.windowMinutes,
          DEFAULT_SETTINGS_FALLBACK.modules.updo.windowMinutes,
          5,
          1440
        ),
        maxPoints: toIntInRange(
          merged?.modules?.updo?.maxPoints,
          DEFAULT_SETTINGS_FALLBACK.modules.updo.maxPoints,
          60,
          5000
        ),
        persistence: {
          enabled: toBool(
            merged?.modules?.updo?.persistence?.enabled,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.enabled
          ),
          rawFile: toCleanString(
            merged?.modules?.updo?.persistence?.rawFile,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.rawFile
          ),
          longtermFile: toCleanString(
            merged?.modules?.updo?.persistence?.longtermFile,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.longtermFile
          ),
          incidentsFile: toCleanString(
            merged?.modules?.updo?.persistence?.incidentsFile,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.incidentsFile
          ),
          stateFile: toCleanString(
            merged?.modules?.updo?.persistence?.stateFile,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.stateFile
          )
        },
        compression: {
          compressCount: toIntInRange(
            merged?.modules?.updo?.compression?.compressCount,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.compressCount,
            120,
            20000
          ),
          compressSpanMinutes: toIntInRange(
            merged?.modules?.updo?.compression?.compressSpanMinutes,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.compressSpanMinutes,
            30,
            60 * 24 * 14
          ),
          keepTailPoints: toIntInRange(
            merged?.modules?.updo?.compression?.keepTailPoints,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.keepTailPoints,
            10,
            5000
          )
        },
        spikeDetection: {
          staticThresholdMs: toIntInRange(
            merged?.modules?.updo?.spikeDetection?.staticThresholdMs,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.staticThresholdMs,
            100,
            120000
          ),
          multiplierOverAvg: toNumberInRange(
            merged?.modules?.updo?.spikeDetection?.multiplierOverAvg,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.multiplierOverAvg,
            1.1,
            20
          ),
          minConsecutivePoints: toIntInRange(
            merged?.modules?.updo?.spikeDetection?.minConsecutivePoints,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.minConsecutivePoints,
            1,
            100
          )
        },
        outageDetection: {
          minConsecutiveFailures: toIntInRange(
            merged?.modules?.updo?.outageDetection?.minConsecutiveFailures,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.outageDetection.minConsecutiveFailures,
            1,
            100
          )
        },
        gapDetection: {
          gapFactor: toNumberInRange(
            merged?.modules?.updo?.gapDetection?.gapFactor,
            DEFAULT_SETTINGS_FALLBACK.modules.updo.gapDetection.gapFactor,
            1.1,
            100
          )
        },
        targets: (() => {
          const normalized = normalizeUpdoTargets(merged?.modules?.updo?.targets);
          return normalized.length
            ? normalized
            : normalizeUpdoTargets(DEFAULT_SETTINGS_FALLBACK.modules.updo.targets);
        })()
      }
    }
  };
}

/**
 * Reads and normalizes default settings.
 * @returns {object} Normalized defaults.
 */
function readDefaultSettings() {
  const raw = readJsonFileSafe(DEFAULT_SETTINGS_FILE, DEFAULT_SETTINGS_FALLBACK);
  return normalizeSettings(raw);
}

/**
 * Reads local settings override file.
 * @returns {object} Local settings object (possibly empty).
 */
function readLocalSettings() {
  return readJsonFileSafe(LOCAL_SETTINGS_FILE, {});
}

/**
 * Builds effective settings by merging defaults and local overrides.
 * @returns {object} Normalized settings object used by frontend and APIs.
 */
function getEffectiveSettings() {
  const defaults = readDefaultSettings();
  const local = readLocalSettings();
  return normalizeSettings(deepMerge(defaults, local));
}

/**
 * Persists local settings after schema normalization.
 * @param {object} nextSettings - Candidate settings payload from the settings API.
 * @returns {object} Persisted normalized settings.
 */
function writeLocalSettings(nextSettings) {
  ensureSettingsDir();
  const normalized = normalizeSettings(nextSettings);
  fs.writeFileSync(LOCAL_SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

/**
 * Derives runtime monitor configuration from effective settings.
 * @param {object} settings - Effective settings object.
 * @returns {object} Normalized updo runtime configuration.
 */
function getUpdoConfigFromSettings(settings) {
  const moduleCfg = settings?.modules?.updo || {};
  const targets = normalizeUpdoTargets(moduleCfg.targets);
  const persistenceCfg = moduleCfg.persistence || {};
  const compressionCfg = moduleCfg.compression || {};
  const spikeCfg = moduleCfg.spikeDetection || {};
  const outageCfg = moduleCfg.outageDetection || {};
  const gapCfg = moduleCfg.gapDetection || {};
  return {
    enabled: Boolean(moduleCfg.enabled),
    refreshSec: toIntInRange(moduleCfg.refreshSec, DEFAULT_SETTINGS_FALLBACK.modules.updo.refreshSec, 3, 300),
    windowMinutes: toIntInRange(
      moduleCfg.windowMinutes,
      DEFAULT_SETTINGS_FALLBACK.modules.updo.windowMinutes,
      5,
      1440
    ),
    maxPoints: toIntInRange(moduleCfg.maxPoints, DEFAULT_SETTINGS_FALLBACK.modules.updo.maxPoints, 60, 5000),
    persistence: {
      enabled: toBool(persistenceCfg.enabled, DEFAULT_SETTINGS_FALLBACK.modules.updo.persistence.enabled),
      rawFile: resolveDataPath(persistenceCfg.rawFile, UPDO_RAW_FILE),
      longtermFile: resolveDataPath(persistenceCfg.longtermFile, UPDO_LONGTERM_FILE),
      incidentsFile: resolveDataPath(persistenceCfg.incidentsFile, UPDO_INCIDENTS_FILE),
      stateFile: resolveDataPath(persistenceCfg.stateFile, UPDO_STATE_FILE)
    },
    compression: {
      compressCount: toIntInRange(
        compressionCfg.compressCount,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.compressCount,
        120,
        20000
      ),
      compressSpanMinutes: toIntInRange(
        compressionCfg.compressSpanMinutes,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.compressSpanMinutes,
        30,
        60 * 24 * 14
      ),
      keepTailPoints: toIntInRange(
        compressionCfg.keepTailPoints,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.compression.keepTailPoints,
        10,
        5000
      )
    },
    spikeDetection: {
      staticThresholdMs: toIntInRange(
        spikeCfg.staticThresholdMs,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.staticThresholdMs,
        100,
        120000
      ),
      multiplierOverAvg: toNumberInRange(
        spikeCfg.multiplierOverAvg,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.multiplierOverAvg,
        1.1,
        20
      ),
      minConsecutivePoints: toIntInRange(
        spikeCfg.minConsecutivePoints,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.spikeDetection.minConsecutivePoints,
        1,
        100
      )
    },
    outageDetection: {
      minConsecutiveFailures: toIntInRange(
        outageCfg.minConsecutiveFailures,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.outageDetection.minConsecutiveFailures,
        1,
        100
      )
    },
    gapDetection: {
      gapFactor: toNumberInRange(
        gapCfg.gapFactor,
        DEFAULT_SETTINGS_FALLBACK.modules.updo.gapDetection.gapFactor,
        1.1,
        100
      )
    },
    targets
  };
}

/**
 * Stops the running monitor process and cancels pending restarts.
 * @returns {void}
 */
function stopUpdoMonitor() {
  updoState.stopRequested = true;
  if (updoState.restartTimer) {
    clearTimeout(updoState.restartTimer);
    updoState.restartTimer = null;
  }
  if (updoState.process && !updoState.process.killed) {
    updoState.process.kill();
  }
  updoState.process = null;
}

/**
 * Returns (and lazily creates) the in-memory series list for a target URL.
 * @param {string} url - Target URL.
 * @returns {Array<object>} Mutable series array for the URL.
 */
function ensureUpdoSeriesForUrl(url) {
  if (!updoState.seriesByUrl.has(url)) {
    updoState.seriesByUrl.set(url, []);
  }
  return updoState.seriesByUrl.get(url);
}

/**
 * Trims in-memory series data to the configured maximum point count.
 * @param {number} maxPoints - Max retained points per target.
 * @returns {void}
 */
function trimUpdoSeries(maxPoints) {
  for (const [url, series] of updoState.seriesByUrl.entries()) {
    if (!Array.isArray(series)) continue;
    if (series.length > maxPoints) {
      updoState.seriesByUrl.set(url, series.slice(-maxPoints));
    }
  }
}

/**
 * Removes stale monitor state entries for targets no longer configured.
 * @param {Array<{url: string}>} targets - Current target configuration.
 * @returns {void}
 */
function pruneUpdoStateForTargets(targets) {
  const keepUrls = new Set((Array.isArray(targets) ? targets : []).map((target) => target.url));
  const maps = [updoState.latestByUrl, updoState.seriesByUrl, updoState.sslProbeByUrl, updoState.persistedRawByUrl];
  for (const map of maps) {
    for (const url of map.keys()) {
      if (!keepUrls.has(url)) {
        map.delete(url);
      }
    }
  }
}

/**
 * Extracts a point timestamp as epoch milliseconds.
 * @param {object} point - Time-series point.
 * @returns {number} Epoch milliseconds or `NaN`.
 */
function pointTimestampMs(point) {
  const t = Date.parse(String(point?.timestamp || point?.ts || ""));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Returns (and lazily creates) persisted raw point storage for a URL.
 * @param {string} url - Target URL.
 * @returns {Array<object>} Mutable raw point array for URL.
 */
function ensurePersistedRawForUrl(url) {
  if (!updoState.persistedRawByUrl.has(url)) {
    updoState.persistedRawByUrl.set(url, []);
  }
  return updoState.persistedRawByUrl.get(url);
}

/**
 * Returns points sorted by valid timestamp ascending.
 * @param {Array<object>} points - Point list.
 * @returns {Array<object>} Sorted points.
 */
function sortPointsByTs(points) {
  return points
    .filter((point) => Number.isFinite(pointTimestampMs(point)))
    .sort((a, b) => pointTimestampMs(a) - pointTimestampMs(b));
}

/**
 * Loads persisted monitoring raw/state data into in-memory state caches.
 * @param {object} config - Updo runtime config with persistence paths.
 * @returns {void}
 */
function loadUpdoPersistence(config) {
  if (!config.persistence.enabled) {
    updoState.persistedRawByUrl.clear();
    updoState.lastCompressedTsByUrl = {};
    updoState.persistenceLoaded = true;
    return;
  }
  if (updoState.persistenceLoaded) return;

  const state = readJsonFileSafe(config.persistence.stateFile, { version: 1, lastCompressedTsByUrl: {} });
  updoState.lastCompressedTsByUrl =
    state && typeof state === "object" && state.lastCompressedTsByUrl && typeof state.lastCompressedTsByUrl === "object"
      ? { ...state.lastCompressedTsByUrl }
      : {};

  const rawRows = readJsonLines(config.persistence.rawFile);
  updoState.persistedRawByUrl.clear();
  for (const row of rawRows) {
    const url = toCleanUrl(row?.targetUrl);
    if (!url) continue;
    const ts = String(row?.ts || row?.timestamp || "").trim();
    if (!ts || !Number.isFinite(Date.parse(ts))) continue;
    const points = ensurePersistedRawForUrl(url);
    points.push({
      timestamp: ts,
      success: toBool(row?.success, false),
      statusCode: Number.isInteger(row?.statusCode) ? row.statusCode : 0,
      responseTimeMs: Math.max(0, Math.round(toFiniteNumber(row?.responseTimeMs, 0))),
      sslIssue: row?.sslIssueCode
        ? {
            code: String(row.sslIssueCode),
            message: String(row?.sslIssueMessage || "")
          }
        : null
    });
  }
  for (const [url, points] of updoState.persistedRawByUrl.entries()) {
    updoState.persistedRawByUrl.set(url, sortPointsByTs(points));
  }
  updoState.persistenceLoaded = true;
}

/**
 * Persists monitor compression cursor state to disk.
 * @param {object} config - Updo runtime config.
 * @returns {void}
 */
function writeUpdoStateFile(config) {
  if (!config.persistence.enabled) return;
  writeJson(config.persistence.stateFile, {
    version: 1,
    lastCompressedTsByUrl: updoState.lastCompressedTsByUrl
  });
}

/**
 * Rewrites the persisted raw JSONL file from in-memory per-target caches.
 * @param {object} config - Updo runtime config.
 * @returns {void}
 */
function rewriteUpdoRawFile(config) {
  if (!config.persistence.enabled) return;
  const allRows = [];
  for (const target of config.targets) {
    const rows = updoState.persistedRawByUrl.get(target.url) || [];
    for (const point of rows) {
      allRows.push({
        ts: String(point.timestamp || ""),
        targetId: target.id,
        targetUrl: target.url,
        success: Boolean(point.success),
        statusCode: Number.isInteger(point.statusCode) ? point.statusCode : 0,
        responseTimeMs: Math.max(0, Math.round(toFiniteNumber(point.responseTimeMs, 0))),
        sslIssueCode: point?.sslIssue?.code ? String(point.sslIssue.code) : null,
        sslIssueMessage: point?.sslIssue?.message ? String(point.sslIssue.message) : null
      });
    }
  }
  allRows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  ensureParentDir(config.persistence.rawFile);
  const content = allRows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(config.persistence.rawFile, content ? `${content}\n` : "", "utf8");
}

/**
 * Appends one probe point to persistence and in-memory raw cache.
 * @param {object} config - Updo runtime config.
 * @param {{id: string, url: string}} target - Target metadata.
 * @param {object} point - Probe point payload.
 * @returns {void}
 */
function appendRawPoint(config, target, point) {
  if (!config.persistence.enabled) return;
  const rawRecord = {
    ts: String(point.timestamp || ""),
    targetId: target.id,
    targetUrl: target.url,
    success: Boolean(point.success),
    statusCode: Number.isInteger(point.statusCode) ? point.statusCode : 0,
    responseTimeMs: Math.max(0, Math.round(toFiniteNumber(point.responseTimeMs, 0))),
    sslIssueCode: point?.sslIssue?.code ? String(point.sslIssue.code) : null,
    sslIssueMessage: point?.sslIssue?.message ? String(point.sslIssue.message) : null
  };
  appendJsonLine(config.persistence.rawFile, rawRecord);
  const rows = ensurePersistedRawForUrl(target.url);
  rows.push({
    timestamp: rawRecord.ts,
    success: rawRecord.success,
    statusCode: rawRecord.statusCode,
    responseTimeMs: rawRecord.responseTimeMs,
    sslIssue:
      rawRecord.sslIssueCode || rawRecord.sslIssueMessage
        ? {
            code: rawRecord.sslIssueCode || "",
            message: rawRecord.sslIssueMessage || ""
          }
        : null
  });
  updoState.persistenceDirty = true;
}

/**
 * Collects contiguous index ranges where predicate stays true.
 * @param {Array<object>} points - Ordered points.
 * @param {(point: object, index: number, points: Array<object>) => boolean} isInRun - Run predicate.
 * @returns {Array<[number, number]>} Inclusive `[start,end]` ranges.
 */
function collectRuns(points, isInRun) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < points.length; i += 1) {
    if (isInRun(points[i], i, points)) {
      if (start === -1) start = i;
      continue;
    }
    if (start !== -1) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, points.length - 1]);
  return runs;
}

/**
 * Persists generated incident rows to JSONL.
 * @param {object} config - Updo runtime config.
 * @param {Array<object>} incidents - Incident rows.
 * @returns {void}
 */
function appendUpdoIncidents(config, incidents) {
  if (!config.persistence.enabled || !incidents.length) return;
  for (const incident of incidents) {
    appendJsonLine(config.persistence.incidentsFile, incident);
  }
}

/**
 * Persists a long-term summary row to JSONL.
 * @param {object} config - Updo runtime config.
 * @param {object} summary - Summary row payload.
 * @returns {void}
 */
function appendUpdoLongtermSummary(config, summary) {
  if (!config.persistence.enabled) return;
  appendJsonLine(config.persistence.longtermFile, summary);
}

/**
 * Compresses eligible raw history into summary + incident records for one target.
 * @param {object} config - Updo runtime config.
 * @param {{id: string, url: string}} target - Target metadata.
 * @returns {{summary: object, incidents: Array<object>, keepTail: Array<object>}|null} Compression result or `null`.
 */
function compressTargetHistory(config, target) {
  if (!config.persistence.enabled) return null;

  const allRaw = sortPointsByTs(updoState.persistedRawByUrl.get(target.url) || []);
  const lastCompressedTs = String(updoState.lastCompressedTsByUrl[target.id] || "").trim();
  const lastCompressedMs = Number.isFinite(Date.parse(lastCompressedTs)) ? Date.parse(lastCompressedTs) : -Infinity;
  const eligible = allRaw.filter((point) => pointTimestampMs(point) > lastCompressedMs);
  if (!eligible.length) return null;

  const firstMs = pointTimestampMs(eligible[0]);
  const lastMs = pointTimestampMs(eligible[eligible.length - 1]);
  const spanMinutes = Math.max(0, Math.round((lastMs - firstMs) / 60000));
  const shouldCompress =
    eligible.length >= config.compression.compressCount || spanMinutes >= config.compression.compressSpanMinutes;
  if (!shouldCompress) return null;

  const successes = eligible.filter((point) => point.success);
  const failures = eligible.filter((point) => !point.success);
  const latencyValues = successes
    .map((point) => Math.max(0, Math.round(toFiniteNumber(point.responseTimeMs, NaN))))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const avgLatencyMs = latencyValues.length
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : null;
  const p95LatencyMs = latencyValues.length ? Math.round(computePercentile(latencyValues, 0.95)) : null;
  const maxLatencyMs = latencyValues.length ? latencyValues[latencyValues.length - 1] : null;
  const uptimePercent = eligible.length ? (successes.length / eligible.length) * 100 : 0;
  const spikeThresholdMs = Math.max(
    config.spikeDetection.staticThresholdMs,
    Number.isFinite(avgLatencyMs) ? avgLatencyMs * config.spikeDetection.multiplierOverAvg : 0
  );

  const outageRuns = collectRuns(eligible, (point) => !point.success).filter(
    ([start, end]) => end - start + 1 >= config.outageDetection.minConsecutiveFailures
  );
  const spikeRuns = collectRuns(
    eligible,
    (point) => point.success && toFiniteNumber(point.responseTimeMs, 0) >= spikeThresholdMs
  ).filter(([start, end]) => end - start + 1 >= config.spikeDetection.minConsecutivePoints);
  const gapRuns = [];
  const maxExpectedGapMs = config.refreshSec * 1000 * config.gapDetection.gapFactor;
  for (let i = 1; i < eligible.length; i += 1) {
    const prevMs = pointTimestampMs(eligible[i - 1]);
    const currMs = pointTimestampMs(eligible[i]);
    if (currMs - prevMs > maxExpectedGapMs) {
      gapRuns.push([i - 1, i]);
    }
  }

  const incidents = [];
  let outageSeconds = 0;
  for (const [startIdx, endIdx] of outageRuns) {
    const startPoint = eligible[startIdx];
    const endPoint = eligible[endIdx];
    const startMs = pointTimestampMs(startPoint);
    const endMs = pointTimestampMs(endPoint);
    const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
    outageSeconds += durationSec;
    incidents.push({
      type: "outage",
      targetId: target.id,
      targetUrl: target.url,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationSec,
      points: endIdx - startIdx + 1,
      statusCodes: Array.from(new Set(eligible.slice(startIdx, endIdx + 1).map((point) => point.statusCode))),
      sslIssueCode: eligible
        .slice(startIdx, endIdx + 1)
        .map((point) => point?.sslIssue?.code)
        .find((value) => value) || null
    });
  }

  for (const [startIdx, endIdx] of spikeRuns) {
    const runPoints = eligible.slice(startIdx, endIdx + 1);
    const startMs = pointTimestampMs(runPoints[0]);
    const endMs = pointTimestampMs(runPoints[runPoints.length - 1]);
    incidents.push({
      type: "spike",
      targetId: target.id,
      targetUrl: target.url,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationSec: Math.max(0, Math.round((endMs - startMs) / 1000)),
      points: runPoints.length,
      peakMs: Math.max(...runPoints.map((point) => Math.max(0, toFiniteNumber(point.responseTimeMs, 0)))),
      thresholdMs: Math.round(spikeThresholdMs)
    });
  }

  for (const [prevIdx, nextIdx] of gapRuns) {
    const startMs = pointTimestampMs(eligible[prevIdx]);
    const endMs = pointTimestampMs(eligible[nextIdx]);
    incidents.push({
      type: "gap",
      targetId: target.id,
      targetUrl: target.url,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      durationSec: Math.max(0, Math.round((endMs - startMs) / 1000)),
      reason: "monitor_inactive_or_no_events"
    });
  }

  const summary = {
    windowStart: new Date(firstMs).toISOString(),
    windowEnd: new Date(lastMs).toISOString(),
    targetId: target.id,
    targetUrl: target.url,
    points: eligible.length,
    successes: successes.length,
    failures: failures.length,
    uptimePercent: Math.round(uptimePercent * 100) / 100,
    latencyAvgMs: avgLatencyMs,
    latencyP95Ms: p95LatencyMs,
    latencyMaxMs: maxLatencyMs,
    spikeCount: spikeRuns.length,
    outageCount: outageRuns.length,
    outageSeconds,
    gapCount: gapRuns.length
  };

  appendUpdoLongtermSummary(config, summary);
  appendUpdoIncidents(config, incidents);
  updoState.lastCompressedTsByUrl[target.id] = summary.windowEnd;

  const keepTail = Math.max(0, config.compression.keepTailPoints);
  const tail = keepTail ? allRaw.slice(-keepTail) : [];
  const uncompressed = allRaw.filter((point) => pointTimestampMs(point) > lastMs);
  const merged = sortPointsByTs([...tail, ...uncompressed]);
  updoState.persistedRawByUrl.set(target.url, merged);
  updoState.persistenceDirty = true;

  return { summary, incidentsCount: incidents.length };
}

/**
 * Runs compression for all configured monitoring targets and persists updated state.
 * @param {object} config - Normalized updo runtime configuration.
 * @returns {Array<{targetId: string, summary: object, incidentsCount: number}>} Compression results by target.
 */
function maybeCompressUpdoHistory(config) {
  if (!config.persistence.enabled) return [];
  loadUpdoPersistence(config);
  const compressed = [];
  for (const target of config.targets) {
    const result = compressTargetHistory(config, target);
    if (result) compressed.push({ targetId: target.id, ...result });
  }
  if (compressed.length) {
    rewriteUpdoRawFile(config);
    writeUpdoStateFile(config);
  }
  return compressed;
}

/**
 * Reads persisted monitoring summaries/incidents for the requested history window.
 * @param {object} config - Normalized updo runtime configuration.
 * @param {number} [rangeDays=30] - History range in days (clamped to `1..365`).
 * @returns {{summaries: Array<object>, incidents: Array<object>}} Filtered history payload.
 */
function buildUpdoHistory(config, rangeDays = 30) {
  if (!config.persistence.enabled) {
    return { summaries: [], incidents: [] };
  }
  const safeRangeDays = toIntInRange(rangeDays, 30, 1, 365);
  const thresholdMs = Date.now() - safeRangeDays * 24 * 60 * 60 * 1000;
  const allowedTargetIds = new Set(config.targets.map((target) => target.id));

  const summaries = readJsonLines(config.persistence.longtermFile).filter((entry) => {
    if (!allowedTargetIds.has(String(entry?.targetId || ""))) return false;
    const endMs = Date.parse(String(entry?.windowEnd || ""));
    return Number.isFinite(endMs) && endMs >= thresholdMs;
  });

  const incidents = readJsonLines(config.persistence.incidentsFile).filter((entry) => {
    if (!allowedTargetIds.has(String(entry?.targetId || ""))) return false;
    const endMs = Date.parse(String(entry?.end || entry?.windowEnd || ""));
    return Number.isFinite(endMs) && endMs >= thresholdMs;
  });

  summaries.sort((a, b) => Date.parse(String(a.windowStart || "")) - Date.parse(String(b.windowStart || "")));
  incidents.sort((a, b) => Date.parse(String(a.start || "")) - Date.parse(String(b.start || "")));
  return { summaries, incidents };
}

/**
 * Seeds in-memory live series from persisted raw points for each configured target.
 * @param {object} config - Normalized updo runtime configuration.
 * @returns {void}
 */
function syncLiveStateFromPersisted(config) {
  for (const target of config.targets) {
    const persisted = sortPointsByTs(updoState.persistedRawByUrl.get(target.url) || []);
    if (!persisted.length) continue;
    const tail = persisted.slice(-config.maxPoints);
    updoState.seriesByUrl.set(target.url, tail.map((point) => ({ ...point })));
    const latest = tail[tail.length - 1];
    if (latest) {
      const currentLatest = updoState.latestByUrl.get(target.url);
      if (!currentLatest || !currentLatest.timestamp) {
        updoState.latestByUrl.set(target.url, { ...latest });
      }
    }
  }
}

/**
 * Performs a direct TLS handshake and reports certificate/identity issues for an HTTPS URL.
 * @param {string} url - Target URL.
 * @returns {Promise<{type: string, code: string, message: string}|null>} TLS issue details, or `null` when healthy/not applicable.
 */
function probeSslIssue(url) {
  return new Promise((resolve) => {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    if (parsed.protocol !== "https:") {
      resolve(null);
      return;
    }

    const host = parsed.hostname;
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 443;
    const socket = tls.connect(
      {
        host,
        port: Number.isFinite(port) ? port : 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 10000
      },
      () => {
        let issue = null;
        try {
          const cert = socket.getPeerCertificate(true);
          if (!cert || !Object.keys(cert).length) {
            issue = {
              type: "tls",
              code: "NO_CERT",
              message: "No TLS certificate presented"
            };
          } else {
            const identityError = tls.checkServerIdentity(host, cert);
            if (identityError) {
              issue = {
                type: "tls",
                code: String(identityError.code || "TLS_IDENTITY_ERROR"),
                message: String(identityError.message || "TLS certificate identity check failed")
              };
            } else if (cert.valid_to) {
              const expiresAt = Date.parse(String(cert.valid_to));
              if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
                issue = {
                  type: "tls",
                  code: "CERT_EXPIRED",
                  message: "TLS certificate expired"
                };
              }
            }
          }
        } catch (error) {
          issue = {
            type: "tls",
            code: String(error?.code || "TLS_PROBE_ERROR"),
            message: String(error?.message || "TLS probe failed")
          };
        }
        socket.end();
        resolve(issue);
      }
    );

    socket.on("error", (error) => {
      resolve({
        type: "tls",
        code: String(error?.code || "TLS_PROBE_ERROR"),
        message: String(error?.message || "TLS probe failed")
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        type: "tls",
        code: "TLS_TIMEOUT",
        message: "TLS probe timed out"
      });
    });
  });
}

/**
 * Schedules/caches an SSL probe for failed HTTPS checks and updates latest state when finished.
 * @param {string} url - Target URL.
 * @returns {void}
 */
function maybeProbeSslIssue(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== "https:") return;

  const now = Date.now();
  const cached = updoState.sslProbeByUrl.get(url);
  if (cached?.pending) return;
  if (cached && now - toFiniteNumber(cached.checkedAt, 0) < UPDO_SSL_PROBE_TTL_MS) return;

  updoState.sslProbeByUrl.set(url, {
    checkedAt: now,
    pending: true,
    issue: cached?.issue || null
  });

  probeSslIssue(url)
    .then((issue) => {
      updoState.sslProbeByUrl.set(url, {
        checkedAt: Date.now(),
        pending: false,
        issue: issue || null
      });
      const current = updoState.latestByUrl.get(url);
      if (current && !current.success) {
        updoState.latestByUrl.set(url, {
          ...current,
          sslIssue: issue || null
        });
      }
    })
    .catch((error) => {
      updoState.sslProbeByUrl.set(url, {
        checkedAt: Date.now(),
        pending: false,
        issue: {
          type: "tls",
          code: String(error?.code || "TLS_PROBE_ERROR"),
          message: String(error?.message || "TLS probe failed")
        }
      });
    });
}

/**
 * Applies one parsed `updo` JSON event to in-memory and persisted monitoring state.
 * @param {object} event - Parsed line event emitted by `updo`.
 * @param {object} config - Normalized updo runtime configuration.
 * @returns {void}
 */
function handleUpdoJsonEvent(event, config) {
  if (!event || typeof event !== "object") return;
  const url = toCleanUrl(event.url);
  if (!url) return;
  const target = config.targets.find((entry) => entry.url === url);
  if (!target) return;

  if (event.type === "check") {
    const sslIssue = updoState.sslProbeByUrl.get(url)?.issue || null;
    const point = {
      timestamp: String(event.timestamp || new Date().toISOString()),
      success: Boolean(event.success),
      statusCode: Number.isInteger(event.status_code) ? event.status_code : 0,
      responseTimeMs: Math.max(0, Math.round(toFiniteNumber(event.response_time_ms, 0))),
      sslIssue: event.success ? null : sslIssue
    };
    updoState.latestByUrl.set(url, point);
    if (!point.success) maybeProbeSslIssue(url);
    const series = ensureUpdoSeriesForUrl(url);
    series.push(point);
    if (series.length > config.maxPoints) {
      series.splice(0, series.length - config.maxPoints);
    }
    appendRawPoint(config, target, point);
    const nowMs = Date.now();
    if (nowMs - updoState.lastCompressionCheckMs >= UPDO_COMPRESSION_CHECK_INTERVAL_MS) {
      updoState.lastCompressionCheckMs = nowMs;
      maybeCompressUpdoHistory(config);
    }
    return;
  }

  if (event.type === "warning") {
    const current = updoState.latestByUrl.get(url) || {};
    const sslIssue = updoState.sslProbeByUrl.get(url)?.issue || current.sslIssue || null;
    updoState.latestByUrl.set(url, {
      ...current,
      warning: toCleanString(event.message, "Request failed"),
      timestamp: String(event.timestamp || current.timestamp || new Date().toISOString()),
      sslIssue
    });
    maybeProbeSslIssue(url);
  }
}

/**
 * Parses and handles one output line from the `updo` process.
 * @param {unknown} line - Raw line text.
 * @param {object} config - Normalized updo runtime configuration.
 * @returns {void}
 */
function processUpdoLine(line, config) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    handleUpdoJsonEvent(parsed, config);
  } catch {
    // Ignore non-JSON lines from updo.
  }
}

/**
 * Buffers streamed stdout/stderr chunks and dispatches complete lines for parsing.
 * @param {"stdout"|"stderr"} kind - Source stream.
 * @param {unknown} chunk - Raw stream chunk.
 * @param {object} config - Normalized updo runtime configuration.
 * @returns {void}
 */
function processUpdoChunk(kind, chunk, config) {
  if (!chunk) return;
  const key = kind === "stderr" ? "stderrBuffer" : "stdoutBuffer";
  updoState[key] += String(chunk);
  const lines = updoState[key].split(/\r?\n/);
  updoState[key] = lines.pop() || "";
  for (const line of lines) {
    processUpdoLine(line, config);
  }
}

/**
 * Normalizes spawn/startup errors into user-facing monitor messages.
 * @param {unknown} error - Spawn error.
 * @returns {string} Human-readable error message.
 */
function formatUpdoStartError(error) {
  if (error?.code === "ENOENT") {
    return "updo not found in PATH (ENOENT)";
  }
  return error?.message || "Could not start updo";
}

/**
 * Starts the `updo` monitor process for current targets and wires restart handling.
 * @param {object} config - Normalized monitoring configuration.
 * @returns {void}
 */
function startUpdoMonitor(config) {
  if (!config.enabled || !config.targets.length) {
    stopUpdoMonitor();
    return;
  }

  const args = [
    "monitor",
    "--log",
    "--simple",
    "--request",
    "HEAD",
    "--refresh",
    String(config.refreshSec),
    ...config.targets.map((target) => target.url)
  ];

  updoState.stopRequested = false;
  updoState.stdoutBuffer = "";
  updoState.stderrBuffer = "";
  updoState.lastError = "";

  try {
    const child = spawn("updo", args, {
      cwd: VAULT_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });
    updoState.process = child;
    updoState.startedAt = new Date().toISOString();
    let restartHandled = false;
    const scheduleRestart = () => {
      if (restartHandled) return;
      restartHandled = true;
      if (updoState.stopRequested) return;
      const settings = getEffectiveSettings();
      const nextConfig = getUpdoConfigFromSettings(settings);
      if (!nextConfig.enabled || !nextConfig.targets.length) return;
      updoState.restartAttempts += 1;
      if (updoState.restartAttempts > UPDO_MAX_RESTART_ATTEMPTS) {
        updoState.lastError = "Too many updo restart attempts, monitor stopped";
        return;
      }
      const restartDelayMs = Math.min(
        UPDO_BASE_RESTART_DELAY_MS * Math.pow(2, updoState.restartAttempts - 1),
        UPDO_MAX_RESTART_DELAY_MS
      );
      if (updoState.restartTimer) clearTimeout(updoState.restartTimer);
      updoState.restartTimer = setTimeout(() => {
        updoState.restartTimer = null;
        ensureUpdoMonitor();
      }, restartDelayMs);
    };

    child.stdout.on("data", (chunk) => processUpdoChunk("stdout", chunk, config));
    child.stderr.on("data", (chunk) => processUpdoChunk("stderr", chunk, config));
    child.on("error", (error) => {
      updoState.lastError = formatUpdoStartError(error);
      updoState.process = null;
      updoState.startedAt = "";
      scheduleRestart();
    });
    child.on("exit", () => {
      updoState.process = null;
      scheduleRestart();
    });
  } catch (error) {
    updoState.lastError = formatUpdoStartError(error);
    updoState.process = null;
    updoState.startedAt = "";
  }
}

/**
 * Reconciles monitor process state with current settings and returns active runtime config.
 * @returns {object} Normalized updo runtime configuration.
 */
function ensureUpdoMonitor() {
  const settings = getEffectiveSettings();
  const config = getUpdoConfigFromSettings(settings);
  const signature = JSON.stringify(config);
  const signatureChanged = updoState.configSignature !== signature;
  if (signatureChanged) {
    updoState.persistenceLoaded = false;
  }
  loadUpdoPersistence(config);
  pruneUpdoStateForTargets(config.targets);
  syncLiveStateFromPersisted(config);
  trimUpdoSeries(config.maxPoints);

  if (!config.enabled || !config.targets.length) {
    updoState.restartAttempts = 0;
    updoState.configSignature = signature;
    stopUpdoMonitor();
    return config;
  }

  const running = updoState.process && !updoState.process.killed;
  if (running && updoState.configSignature === signature) {
    return config;
  }

  stopUpdoMonitor();
  if (signatureChanged) {
    updoState.restartAttempts = 0;
  }
  updoState.configSignature = signature;
  startUpdoMonitor(config);
  return config;
}

/**
 * Computes a percentile from a sorted numeric list.
 * @param {number[]} sortedValues - Ascending sorted values.
 * @param {number} ratio - Percentile ratio in `[0,1]` (for example `0.95`).
 * @returns {number|null} Percentile value, or `null` when input is empty.
 */
function computePercentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  const idx = Math.ceil(sortedValues.length * ratio) - 1;
  const safeIdx = Math.max(0, Math.min(sortedValues.length - 1, idx));
  return sortedValues[safeIdx];
}

/**
 * Builds the current monitoring snapshot for dashboard rendering.
 * @param {number|null} requestedWindowMinutes - Optional override for the sliding time window.
 * @returns {object} Snapshot payload with target stats and chart series.
 */
function buildUpdoSnapshot(requestedWindowMinutes = null) {
  const config = ensureUpdoMonitor();
  const nowMs = Date.now();
  const windowMinutes = toIntInRange(
    requestedWindowMinutes,
    config.windowMinutes || DEFAULT_SETTINGS_FALLBACK.modules.updo.windowMinutes,
    5,
    1440
  );
  const windowStart = nowMs - windowMinutes * 60 * 1000;

  const targets = config.targets.map((target) => {
    const fullSeries = updoState.seriesByUrl.get(target.url) || [];
    const series = fullSeries.filter((point) => {
      const t = Date.parse(point.timestamp);
      return Number.isFinite(t) && t >= windowStart;
    });
    const checks = series.length;
    const successes = series.filter((point) => point.success).length;
    const uptimePercent = checks ? (successes / checks) * 100 : 0;
    const latencies = series
      .map((point) => toFiniteNumber(point.responseTimeMs, NaN))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const avgMs = latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null;
    const p95Ms = latencies.length ? Math.round(computePercentile(latencies, 0.95)) : null;

    return {
      id: target.id,
      name: target.name,
      url: target.url,
      latest: updoState.latestByUrl.get(target.url) || null,
      stats: {
        checks,
        successes,
        uptimePercent: Math.round(uptimePercent * 100) / 100,
        avgMs,
        p95Ms
      },
      series
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    running: Boolean(updoState.process && !updoState.process.killed),
    startedAt: updoState.startedAt || null,
    error: updoState.lastError || null,
    method: "HEAD",
    refreshSec: config.refreshSec,
    windowMinutes,
    targets
  };
}

/**
 * Reads the root bookmark item array from `.obsidian/bookmarks.json`.
 * @returns {Array<object>} Bookmark root items.
 */
function readBookmarksRootItems() {
  if (!fs.existsSync(BOOKMARKS_FILE)) {
    throw new Error("Bookmarks file not found");
  }
  const raw = fs.readFileSync(BOOKMARKS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * Derives a readable fallback title for one bookmark item.
 * @param {object} item - Raw bookmark item.
 * @returns {string} Display title.
 */
function defaultTitleForItem(item) {
  if (!item || typeof item !== "object") return "Untitled";
  if (item.type === "group") return String(item.title || "Group");
  if (item.title && String(item.title).trim()) return String(item.title).trim();

  if (item.type === "file") {
    const rawPath = String(item.path || "");
    if (!rawPath) return "Datei";
    const base = path.basename(rawPath);
    return base.replace(/\.[^/.]+$/, "") || base;
  }

  if (item.type === "url") return String(item.url || "URL");
  if (item.type === "search") return "Search";
  if (item.type === "graph") return "Graph";
  return String(item.type || "Bookmark");
}

/**
 * Maps a raw bookmark tree node into the API payload shape used by the homepage.
 * @param {object} item - Raw bookmark node.
 * @param {number[]} idPath - Numeric index path of the node.
 * @returns {object} Client-facing bookmark node.
 */
function toClientItem(item, idPath) {
  const node = {
    id: idPath.join("."),
    type: String(item?.type || "unknown"),
    title: defaultTitleForItem(item)
  };

  if (item?.type === "file") node.path = String(item.path || "");
  if (item?.type === "url") node.url = String(item.url || "");
  if (item?.type === "search") node.query = String(item.query || "");

  if (Array.isArray(item?.items)) {
    node.items = item.items.map((child, idx) => toClientItem(child, [...idPath, idx]));
  }

  return node;
}

/**
 * Builds a client-safe bookmark tree payload from local bookmark data.
 * @returns {{items: Array<object>}} Bookmark payload.
 */
function buildClientBookmarksPayload() {
  const rootItems = readBookmarksRootItems();
  const items = rootItems.map((item, idx) => toClientItem(item, [idx]));
  return { items };
}

/**
 * Parses a serialized bookmark id path (`"0.2.1"`) into numeric segments.
 * @param {unknown} id - Incoming bookmark id.
 * @returns {number[]|null} Parsed index path, or `null` when invalid.
 */
function parseBookmarkId(id) {
  const raw = String(id || "").trim();
  if (!/^\d+(?:\.\d+)*$/.test(raw)) return null;
  const segments = raw.split(".").map((n) => Number.parseInt(n, 10));
  if (segments.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return segments;
}

/**
 * Resolves a bookmark node by walking an index path through nested `items` arrays.
 * @param {Array<object>} rootItems - Root bookmark array.
 * @param {number[]} indexPath - Numeric path from root to target node.
 * @returns {object|null} Resolved bookmark node or `null`.
 */
function getItemByIndexPath(rootItems, indexPath) {
  let current = rootItems[indexPath[0]];
  for (let i = 1; i < indexPath.length; i += 1) {
    if (!current || !Array.isArray(current.items)) return null;
    current = current.items[indexPath[i]];
  }
  return current || null;
}

/**
 * Opens a bookmark from `.obsidian/bookmarks.json` via Obsidian's bookmark plugin API.
 * @param {string} id - Serialized bookmark id path (`idx-...`).
 * @param {boolean} openInNewTab - Whether to open the bookmark in a new tab.
 * @returns {{ok: boolean, id: string, openInNewTab: boolean, type: string, title: string}} Open result metadata.
 */
function openBookmarkById(id, openInNewTab = false) {
  const indexPath = parseBookmarkId(id);
  if (!indexPath) {
    throw new Error("Invalid bookmark id");
  }

  const rootItems = readBookmarksRootItems();
  const targetItem = getItemByIndexPath(rootItems, indexPath);
  if (!targetItem || targetItem.type === "group") {
    throw new Error("Bookmark not found or not openable");
  }

  const indexExpr = JSON.stringify(indexPath);
  const openTarget = openInNewTab ? "tab" : false;
  const js = `
const plugin = app.internalPlugins.plugins.bookmarks?.instance;
if (!plugin) throw new Error("Bookmarks plugin not available");
const idx = ${indexExpr};
const openTarget = ${JSON.stringify(openTarget)};
let item = plugin.items[idx[0]];
for (let i = 1; i < idx.length; i++) {
  if (!item || !Array.isArray(item.items)) throw new Error("Bookmark not found");
  item = item.items[idx[i]];
}
if (!item) throw new Error("Bookmark not found");
plugin.openBookmark(item, openTarget);
"ok";
`.trim();

  runObsidian(["eval", `code=${js}`]);

  return {
    ok: true,
    id: String(id),
    openInNewTab: Boolean(openInNewTab),
    type: String(targetItem.type || "unknown"),
    title: defaultTitleForItem(targetItem)
  };
}

/**
 * Reads current Obsidian theme variables for mirror-theming in the homepage/settings UI.
 * @returns {{mode: string, classes: string, cssTheme: string, baseTheme: string, vars: object}} Theme snapshot payload.
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
 * Opens the configured search provider in Obsidian.
 * @param {"omnisearch"|"obsidian-search"|"quick-file"} provider - Search provider id.
 * @param {boolean} openInNewTab - Whether the action should target a new tab.
 * @returns {{ok: boolean, provider: string, commandId: string}} Execution result.
 */
function openConfiguredSearch(provider = "omnisearch", openInNewTab = false) {
  const selected = oneOf(provider, ["omnisearch", "obsidian-search", "quick-file"], "omnisearch");
  const commandMap = {
    omnisearch: "omnisearch:show-modal",
    "obsidian-search": "global-search:open",
    "quick-file": "switcher:open"
  };
  const commandId = commandMap[selected];
  const js = `
const provider = ${JSON.stringify(selected)};
const openInNewTab = ${JSON.stringify(Boolean(openInNewTab))};
const commandId = ${JSON.stringify(commandId)};

/**
 * Safe Set Active Leaf.
 * @param {any} leaf - Leaf candidate created by workspace.getLeaf(...).
 * @returns {void}
 */
function safeSetActiveLeaf(leaf) {
  if (!leaf) return;
  try {
    app.workspace.setActiveLeaf(leaf, true, true);
    return;
  } catch {}
  try {
    app.workspace.setActiveLeaf(leaf, true);
    return;
  } catch {}
  try {
    app.workspace.setActiveLeaf(leaf);
  } catch {}
}

if (provider === "obsidian-search" && openInNewTab) {
  const leaf = app.workspace.getLeaf("tab");
  if (!leaf) throw new Error("Could not create tab leaf");
  leaf.setViewState({ type: "search", active: true });
  safeSetActiveLeaf(leaf);
  JSON.stringify({ ok: true, provider, commandId, mode: "view-state" });
} else {
  if (openInNewTab) {
    const tabLeaf = app.workspace.getLeaf("tab");
    safeSetActiveLeaf(tabLeaf);
  }
  if (!app?.commands?.commands?.[commandId]) throw new Error("Search command not found: " + commandId);
  app.commands.executeCommandById(commandId);
  JSON.stringify({ ok: true, provider, commandId, mode: "command" });
}
`.trim();

  const raw = runObsidian(["eval", `code=${js}`]);
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  const parsed = JSON.parse(clean);
  return {
    ok: Boolean(parsed?.ok),
    provider: String(parsed?.provider || selected),
    commandId: String(parsed?.commandId || commandId)
  };
}

/**
 * Aggregates historical project metadata to drive form suggestions.
 * @returns {{societies: object, types: object, fundingCodes: object, years: object}} Counter maps by metadata field.
 */
function getProjectSuggestionData() {
  const js = `
const out = {
  societies: {},
  types: {},
  fundingCodes: {},
  years: {}
};
for (const file of app.vault.getMarkdownFiles()) {
  if (!String(file.path || "").startsWith("2. Projektverwaltung/")) continue;
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm) continue;
  if (String(fm.category || "") !== "project-moc") continue;
  const society = String(fm.antragsteller || "").trim();
  const type = String(fm.type || "").trim();
  const funding = String(fm["f\u00F6rderer"] || "").trim();
  const year = String(fm.year || "").trim();
  if (society) out.societies[society] = (out.societies[society] || 0) + 1;
  if (type) out.types[type] = (out.types[type] || 0) + 1;
  if (funding) out.fundingCodes[funding] = (out.fundingCodes[funding] || 0) + 1;
  if (year) out.years[year] = (out.years[year] || 0) + 1;
}
JSON.stringify(out);
`.trim();

  const raw = runObsidian(["eval", `code=${js}`]);
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  return JSON.parse(clean);
}

/**
 * Converts a `{value: count}` map into a sorted `{value,count}` list for UI dropdowns.
 * @param {object} counterObject - Map of option values to occurrence counts.
 * @param {{filter?: (value: string) => boolean}} [options={}] - Optional filter predicate.
 * @returns {Array<{value: string, count: number}>} Sorted option list.
 */
function toSortedOptionList(counterObject, options = {}) {
  const entries = Object.entries(counterObject && typeof counterObject === "object" ? counterObject : {});
  if (options.filter) {
    return entries
      .filter(([value]) => options.filter(value))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
      .map(([value, count]) => ({ value, count }));
  }
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de"))
    .map(([value, count]) => ({ value, count }));
}

/**
 * Builds dropdown options and defaults for the "new project" modal.
 * @returns {object} Frontend-ready metadata payload for project creation.
 */
function buildProjectMetaPayload() {
  const currentYear = new Date().getFullYear();
  let rawSuggestions = null;
  try {
    rawSuggestions = getProjectSuggestionData();
  } catch {
    rawSuggestions = null;
  }

  const societyOptions = toSortedOptionList(rawSuggestions?.societies, {
    filter: (value) => value === "NICA" || value === "TOHU"
  });
  const typeOptions = toSortedOptionList(rawSuggestions?.types, {
    filter: (value) => ["funding", "hired", "self financed"].includes(value)
  });
  const fundingOptions = toSortedOptionList(rawSuggestions?.fundingCodes, {
    filter: (value) => value && value !== "-"
  });
  const yearOptions = toSortedOptionList(rawSuggestions?.years)
    .map((entry) => Number.parseInt(String(entry.value), 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);

  const distinctYears = Array.from(new Set([currentYear + 1, currentYear, ...yearOptions]));

  return {
    projectRoot: PROJECTS_ROOT_REL.replace(/\\/g, "/"),
    templateFile: TEMPLATE_PROJECT_FILE_REL.replace(/\\/g, "/"),
    options: {
      societies: societyOptions.length ? societyOptions : [{ value: "NICA", count: 0 }, { value: "TOHU", count: 0 }],
      types: typeOptions.length
        ? typeOptions
        : [
            { value: "funding", count: 0 },
            { value: "hired", count: 0 },
            { value: "self financed", count: 0 }
          ],
      fundingCodes: fundingOptions,
      years: distinctYears.map((value) => ({ value, count: 0 }))
    }
  };
}

/**
 * Ensures a vault-relative folder path exists by creating missing path segments in Obsidian.
 * @param {string} relativeFolderPath - Vault-relative folder path.
 * @returns {void}
 */
function ensureVaultFolderExists(relativeFolderPath) {
  const js = `
(async () => {
const folderPath = ${JSON.stringify(relativeFolderPath)};
const parts = folderPath.split("/").filter(Boolean);
let current = "";
for (const part of parts) {
  current = current ? current + "/" + part : part;
  if (!app.vault.getAbstractFileByPath(current)) {
    await app.vault.createFolder(current);
  }
}
})();
"ok";
`.trim();
  runObsidian(["eval", `code=${js}`]);
}

/**
 * Creates a project note from the configured template via Templater (or plain fallback).
 * @param {{projectFolderRel: string, projectFileRel: string, projectName: string}} payload - Target folder/file/title.
 * @returns {{createdPath: string}} Created note path relative to vault root.
 */
function createProjectNoteFromTemplate({ projectFolderRel, projectFileRel, projectName }) {
  const js = `
(async () => {
const folderPath = ${JSON.stringify(projectFolderRel)};
const filePath = ${JSON.stringify(projectFileRel)};
const fileTitle = ${JSON.stringify(projectName)};
const templatePath = "6. Obsidian/_template/Projekt.md";
const templateBasename = "Projekt";

const folder = app.vault.getAbstractFileByPath(folderPath);
if (!folder) throw new Error("Projektordner nicht gefunden");
if (app.vault.getAbstractFileByPath(filePath)) throw new Error("Projektdatei existiert bereits");

const templater = app.plugins.plugins["templater-obsidian"]?.templater;
let templateFile = app.vault.getAbstractFileByPath(templatePath);
if (!templateFile) {
  templateFile = app.vault.getMarkdownFiles().find((file) => file.basename === templateBasename) || null;
}
if (!templateFile) throw new Error("Projekt-Template nicht gefunden");

let createdFile = null;
if (templater?.create_new_note_from_template) {
  createdFile = await templater.create_new_note_from_template(templateFile, folder, fileTitle, false);
} else {
  const raw = await app.vault.cachedRead(templateFile);
  createdFile = await app.vault.create(filePath, raw);
}
const createdPath = createdFile?.path || filePath;
JSON.stringify({ ok: true, createdPath });
})();
`.trim();

  const raw = runObsidian(["eval", `code=${js}`]);
  const normalized = String(raw || "").trim();
  if (/^Error:/i.test(normalized)) {
    throw new Error(normalized);
  }
  const clean = normalized.replace(/^=>\s*/, "").trim();
  if (!clean) {
    return { createdPath: projectFileRel };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(clean || "{}");
  } catch {
    return { createdPath: projectFileRel };
  }
  return {
    createdPath: sanitizePathSeparators(parsed?.createdPath || projectFileRel)
  };
}

/**
 * Opens the given project note in Obsidian.
 * @param {string} projectFileRel - Vault-relative markdown file path.
 * @param {boolean} [openInNewTab=false] - Whether to open in a new tab.
 * @returns {void}
 */
function openProjectFile(projectFileRel, openInNewTab = false) {
  runObsidian(["open", `path=${projectFileRel}`, openInNewTab ? "newtab" : ""].filter(Boolean));
}

/**
 * Creates a new project folder and MOC note from template, then opens it in Obsidian.
 * @param {object} payload - API payload from the "new project" UI.
 * @returns {object} Creation result with paths and applied frontmatter fields.
 */
function createProject(payload) {
  if (!fs.existsSync(PROJECTS_ROOT) || !fs.statSync(PROJECTS_ROOT).isDirectory()) {
    throw new Error("Projektverwaltung-Ordner wurde nicht gefunden");
  }
  if (!fs.existsSync(TEMPLATE_PROJECT_FILE) || !fs.statSync(TEMPLATE_PROJECT_FILE).isFile()) {
    throw new Error("Projekt-Template fehlt unter 6. Obsidian/_template/Projekt.md");
  }

  const naming = buildProjectNaming({
    year: payload?.year,
    society: payload?.society,
    fundingCode: payload?.fundingCode,
    projectTitle: payload?.title,
    projectType: payload?.projectType
  });

  const projectFolderAbs = path.join(PROJECTS_ROOT, naming.folderName);
  const projectFolderRel = sanitizePathSeparators(path.relative(VAULT_ROOT, projectFolderAbs));
  const projectFileName = `${naming.folderName}.md`;
  const projectFileAbs = path.join(projectFolderAbs, projectFileName);
  const projectFileRel = sanitizePathSeparators(path.relative(VAULT_ROOT, projectFileAbs));

  if (fs.existsSync(projectFolderAbs)) throw new Error("Projektordner existiert bereits");
  if (fs.existsSync(projectFileAbs)) throw new Error("Projektdatei existiert bereits");

  fs.mkdirSync(projectFolderAbs, { recursive: false });
  ensureVaultFolderExists(projectFolderRel);
  const created = createProjectNoteFromTemplate({
    projectFolderRel,
    projectFileRel,
    projectName: naming.folderName
  });

  let targetFileAbs = projectFileAbs;
  let targetFileRel = projectFileRel;
  const createdRel = sanitizePathSeparators(created?.createdPath || "");
  if (createdRel) {
    const createdAbs = path.resolve(VAULT_ROOT, createdRel);
    if (fs.existsSync(createdAbs) && createdAbs !== projectFileAbs) {
      if (!fs.existsSync(projectFileAbs)) {
        fs.renameSync(createdAbs, projectFileAbs);
      }
      targetFileAbs = projectFileAbs;
      targetFileRel = projectFileRel;
    }
  }

  if (!fs.existsSync(targetFileAbs)) {
    const templateRaw = fs.readFileSync(TEMPLATE_PROJECT_FILE, "utf8");
    const rendered = renderTemplateFallback(templateRaw, naming.folderName);
    fs.writeFileSync(targetFileAbs, rendered, "utf8");
  }

  const raw = fs.readFileSync(targetFileAbs, "utf8");
  const next = applyProjectFrontmatter(raw, {
    year: naming.year,
    antragsteller: naming.society,
    "f\u00F6rderer": naming.fundingCode,
    title: naming.title,
    type: naming.projectType,
    category: "project-moc"
  });
  fs.writeFileSync(targetFileAbs, next, "utf8");

  openProjectFile(targetFileRel, toBool(payload?.openInNewTab, true));
  return {
    ok: true,
    folderName: naming.folderName,
    fileName: projectFileName,
    paths: {
      folder: projectFolderRel,
      file: targetFileRel
    },
    frontmatter: {
      year: naming.year,
      antragsteller: naming.society,
      "f\u00F6rderer": naming.fundingCode,
      title: naming.title,
      type: naming.projectType
    }
  };
}

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
 * Sends a plain-text HTTP response.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {number} statusCode - HTTP status code.
 * @param {string} text - Response body text.
 * @returns {void}
 */
function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/ping") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    const settings = getEffectiveSettings();
    sendJson(res, 200, {
      ok: true,
      settings,
      files: {
        defaults: path.relative(VAULT_ROOT, DEFAULT_SETTINGS_FILE).replace(/\\/g, "/"),
        local: path.relative(VAULT_ROOT, LOCAL_SETTINGS_FILE).replace(/\\/g, "/")
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        const patchSettings = payload?.settings ?? payload;
        const effectiveBefore = getEffectiveSettings();
        const nextRaw = deepMerge(effectiveBefore, patchSettings);
        const nextSettings = writeLocalSettings(nextRaw);
        ensureUpdoMonitor();
        sendJson(res, 200, { ok: true, settings: nextSettings });
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while updating settings");
      });
    return;
  }

  if (req.method === "GET" && pathname === "/api/bookmarks") {
    try {
      sendJson(res, 200, buildClientBookmarksPayload());
    } catch (error) {
      sendText(res, 500, error.message || "Could not read bookmarks");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/obsidian/theme") {
    try {
      const theme = readObsidianThemeSnapshot();
      sendJson(res, 200, { ok: true, theme });
    } catch (error) {
      sendText(res, 502, error.message || "Could not read Obsidian theme");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/bookmarks/open") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        const id = String(payload.id || "").trim();
        if (!id) {
          sendText(res, 400, "Missing bookmark id");
          return;
        }
        const openInNewTab = toBool(payload.openInNewTab, false);

        try {
          const result = openBookmarkById(id, openInNewTab);
          sendJson(res, 200, result);
        } catch (error) {
          sendText(res, 502, error.message || "Could not open bookmark");
        }
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while opening bookmark");
      });
    return;
  }

  if (req.method === "POST" && pathname === "/api/search/open") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        const provider = String(payload.provider || "omnisearch");
        const openInNewTab = toBool(payload.openInNewTab, false);
        try {
          const result = openConfiguredSearch(provider, openInNewTab);
          sendJson(res, 200, result);
        } catch (error) {
          sendText(res, 502, error.message || "Could not open configured search");
        }
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while opening configured search");
      });
    return;
  }

  if (req.method === "GET" && pathname === "/api/timetracking/today") {
    try {
      const settings = getEffectiveSettings();
      const config = getTimetrackingConfigFromSettings(settings);
      const snapshot = getTimetrackingTodaySnapshot(config.filePath);
      sendJson(res, 200, snapshot);
    } catch (error) {
      sendText(res, 500, error.message || "Could not load time tracking data");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/timetracking/start") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        const summary = toCleanString(payload?.summary, "");
        if (!summary) {
          sendText(res, 400, "Missing activity summary");
          return;
        }

        try {
          const settings = getEffectiveSettings();
          const config = getTimetrackingConfigFromSettings(settings);
          const before = getTimetrackingTodaySnapshot(config.filePath);
          if (before.active) {
            runKlog(["switch", config.filePath, "--summary", summary, "--no-style", "--no-warn"]);
          } else {
            runKlog(["start", config.filePath, "--summary", summary, "--no-style", "--no-warn"]);
          }
          const after = getTimetrackingTodaySnapshot(config.filePath);
          sendJson(res, 200, after);
        } catch (error) {
          sendText(res, 422, error.message || "Could not start tracking");
        }
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while starting tracking");
      });
    return;
  }

  if (req.method === "POST" && pathname === "/api/timetracking/pause") {
    try {
      const settings = getEffectiveSettings();
      const config = getTimetrackingConfigFromSettings(settings);
      const before = getTimetrackingTodaySnapshot(config.filePath);
      if (!before.active) {
        sendText(res, 409, "No active activity to pause");
        return;
      }
      runKlog(["switch", config.filePath, "--summary", config.pauseSummary, "--no-style", "--no-warn"]);
      const after = getTimetrackingTodaySnapshot(config.filePath);
      sendJson(res, 200, after);
    } catch (error) {
      sendText(res, 422, error.message || "Could not pause tracking");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/timetracking/stop") {
    try {
      const settings = getEffectiveSettings();
      const config = getTimetrackingConfigFromSettings(settings);
      runKlog(["stop", config.filePath, "--no-style", "--no-warn"]);
      const after = getTimetrackingTodaySnapshot(config.filePath);
      sendJson(res, 200, after);
    } catch (error) {
      sendText(res, 422, error.message || "Could not stop tracking");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/beantime/meta") {
    try {
      const settings = getEffectiveSettings();
      const config = getBeantimeConfigFromSettings(settings);
      const accounts = readBeantimeBookableAccounts(config.filePath, config.bookableAccountPrefix);
      const running = readBeantimeState(config.stateFilePath);
      sendJson(res, 200, {
        ok: true,
        file: path.relative(VAULT_ROOT, config.filePath).replace(/\\/g, "/"),
        personAccount: config.personAccount,
        accountPrefix: config.bookableAccountPrefix,
        accounts,
        running
      });
    } catch (error) {
      sendText(res, 500, error.message || "Could not load Beantime meta");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/beantime/start") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        try {
          const settings = getEffectiveSettings();
          const config = getBeantimeConfigFromSettings(settings);
          const running = readBeantimeState(config.stateFilePath);
          if (running) {
            sendText(res, 409, "A timer is already running");
            return;
          }

          const account = toCleanString(payload?.account, "");
          if (!account) {
            sendText(res, 400, "Missing account");
            return;
          }
          const accounts = readBeantimeBookableAccounts(config.filePath, config.bookableAccountPrefix);
          if (!accounts.includes(account)) {
            sendText(res, 422, "Selected account is not open/bookable");
            return;
          }

          const startedAt = new Date().toISOString();
          const state = {
            startedAt,
            startedDate: localTodayToken(),
            account,
            summary: toCleanString(payload?.summary, "")
          };
          writeBeantimeState(config.stateFilePath, state);
          sendJson(res, 200, { ok: true, running: state });
        } catch (error) {
          sendText(res, 422, error.message || "Could not start Beantime");
        }
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while starting Beantime");
      });
    return;
  }

  if (req.method === "POST" && pathname === "/api/beantime/stop") {
    try {
      const settings = getEffectiveSettings();
      const config = getBeantimeConfigFromSettings(settings);
      const running = readBeantimeState(config.stateFilePath);
      if (!running) {
        sendText(res, 409, "No running Beantime timer");
        return;
      }
      const appendResult = appendBeantimeTransaction(config, running);
      writeBeantimeState(config.stateFilePath, null);
      sendJson(res, 200, {
        ok: true,
        appended: appendResult,
        file: path.relative(VAULT_ROOT, config.filePath).replace(/\\/g, "/")
      });
    } catch (error) {
      sendText(res, 422, error.message || "Could not stop Beantime");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/projects/meta") {
    try {
      const payload = buildProjectMetaPayload();
      sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      sendText(res, 500, error.message || "Could not load project metadata");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/projects/create") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        try {
          const result = createProject(payload);
          sendJson(res, 200, result);
        } catch (error) {
          sendText(res, 422, error.message || "Could not create project");
        }
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while creating project");
      });
    return;
  }

  if (req.method === "GET" && pathname === "/api/updo/snapshot") {
    try {
      const windowMinutesRaw = Number.parseInt(String(url.searchParams.get("windowMinutes") || ""), 10);
      const payload = buildUpdoSnapshot(Number.isFinite(windowMinutesRaw) ? windowMinutesRaw : null);
      sendJson(res, 200, payload);
    } catch (error) {
      sendText(res, 500, error.message || "Could not build updo snapshot");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/updo/history") {
    try {
      const config = ensureUpdoMonitor();
      maybeCompressUpdoHistory(config);
      const rangeDaysRaw = Number.parseInt(String(url.searchParams.get("rangeDays") || ""), 10);
      const targetId = String(url.searchParams.get("targetId") || "").trim();
      const history = buildUpdoHistory(config, Number.isFinite(rangeDaysRaw) ? rangeDaysRaw : 30);
      const filteredSummaries = targetId
        ? history.summaries.filter((entry) => String(entry?.targetId || "") === targetId)
        : history.summaries;
      const filteredIncidents = targetId
        ? history.incidents.filter((entry) => String(entry?.targetId || "") === targetId)
        : history.incidents;
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        rangeDays: Number.isFinite(rangeDaysRaw) ? rangeDaysRaw : 30,
        summaries: filteredSummaries,
        incidents: filteredIncidents
      });
    } catch (error) {
      sendText(res, 500, error.message || "Could not build updo history");
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/updo/restart") {
    try {
      stopUpdoMonitor();
      updoState.restartAttempts = 0;
      const config = ensureUpdoMonitor();
      sendJson(res, 200, {
        ok: true,
        enabled: config.enabled,
        targets: config.targets.length
      });
    } catch (error) {
      sendText(res, 500, error.message || "Could not restart updo monitor");
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
    filePath = path.join(filePath, "home.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  ensureUpdoMonitor();
  console.log(`Homepage preview server: http://${HOST}:${PORT}/home.html`);
  console.log(
    "Homepage API endpoints ready: GET /api/ping, GET/POST /api/settings, GET /api/bookmarks, GET /api/obsidian/theme, POST /api/bookmarks/open, POST /api/search/open, GET /api/timetracking/today, POST /api/timetracking/start, POST /api/timetracking/pause, POST /api/timetracking/stop, GET /api/beantime/meta, POST /api/beantime/start, POST /api/beantime/stop, GET /api/projects/meta, POST /api/projects/create, GET /api/updo/snapshot, GET /api/updo/history, POST /api/updo/restart"
  );
});

process.on("SIGINT", () => {
  stopUpdoMonitor();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopUpdoMonitor();
  process.exit(0);
});


