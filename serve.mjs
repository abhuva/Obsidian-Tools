import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.HOMEPAGE_HOST || "127.0.0.1";
const PORT = Number(process.env.HOMEPAGE_PORT || 4174);
const ROOT = __dirname;
const VAULT_ROOT = path.resolve(__dirname, "..");

const BOOKMARKS_FILE = path.join(VAULT_ROOT, ".obsidian", "bookmarks.json");
const SETTINGS_DIR = path.join(ROOT, "config");
const DEFAULT_SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.default.json");
const LOCAL_SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.local.json");

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
    subtitle: "Visual entry point for the vault",
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
      showType: false
    },
    clock: {
      enabled: true,
      title: "Uhrzeit",
      showSeconds: true,
      hour12: false
    }
  }
};

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = decoded === "/" ? "/home.html" : decoded;
  const resolved = path.resolve(ROOT, `.${normalized}`);
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
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

function ensureSettingsDir() {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function readJsonFileSafe(filePath, fallbackValue) {
  try {
    if (!fs.existsSync(filePath)) return fallbackValue;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

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

function toCleanString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  return cleaned || fallback;
}

function oneOf(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeSettings(input) {
  const merged = deepMerge(DEFAULT_SETTINGS_FALLBACK, input);

  return {
    schemaVersion: 1,
    ui: {
      title: toCleanString(merged?.ui?.title, DEFAULT_SETTINGS_FALLBACK.ui.title),
      subtitle: toCleanString(merged?.ui?.subtitle, DEFAULT_SETTINGS_FALLBACK.ui.subtitle),
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
      }
    }
  };
}

function readDefaultSettings() {
  const raw = readJsonFileSafe(DEFAULT_SETTINGS_FILE, DEFAULT_SETTINGS_FALLBACK);
  return normalizeSettings(raw);
}

function readLocalSettings() {
  return readJsonFileSafe(LOCAL_SETTINGS_FILE, {});
}

function getEffectiveSettings() {
  const defaults = readDefaultSettings();
  const local = readLocalSettings();
  return normalizeSettings(deepMerge(defaults, local));
}

function writeLocalSettings(nextSettings) {
  ensureSettingsDir();
  const normalized = normalizeSettings(nextSettings);
  fs.writeFileSync(LOCAL_SETTINGS_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function readBookmarksRootItems() {
  if (!fs.existsSync(BOOKMARKS_FILE)) {
    throw new Error("Bookmarks file not found");
  }
  const raw = fs.readFileSync(BOOKMARKS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

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

function buildClientBookmarksPayload() {
  const rootItems = readBookmarksRootItems();
  const items = rootItems.map((item, idx) => toClientItem(item, [idx]));
  return { items };
}

function parseBookmarkId(id) {
  const raw = String(id || "").trim();
  if (!/^\d+(?:\.\d+)*$/.test(raw)) return null;
  const segments = raw.split(".").map((n) => Number.parseInt(n, 10));
  if (segments.some((n) => !Number.isInteger(n) || n < 0)) return null;
  return segments;
}

function getItemByIndexPath(rootItems, indexPath) {
  let current = rootItems[indexPath[0]];
  for (let i = 1; i < indexPath.length; i += 1) {
    if (!current || !Array.isArray(current.items)) return null;
    current = current.items[indexPath[i]];
  }
  return current || null;
}

function openBookmarkById(id) {
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
  const js = `
const plugin = app.internalPlugins.plugins.bookmarks?.instance;
if (!plugin) throw new Error("Bookmarks plugin not available");
const idx = ${indexExpr};
let item = plugin.items[idx[0]];
for (let i = 1; i < idx.length; i++) {
  if (!item || !Array.isArray(item.items)) throw new Error("Bookmark not found");
  item = item.items[idx[i]];
}
if (!item) throw new Error("Bookmark not found");
plugin.openBookmark(item);
"ok";
`.trim();

  execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  return {
    ok: true,
    id: String(id),
    type: String(targetItem.type || "unknown"),
    title: defaultTitleForItem(targetItem)
  };
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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/ping") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/api/settings") {
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

  if (req.method === "POST" && req.url === "/api/settings") {
    readRequestBody(req)
      .then((rawBody) => {
        let payload;
        try {
          payload = JSON.parse(rawBody || "{}");
        } catch {
          sendText(res, 400, "Invalid JSON payload");
          return;
        }

        const nextRaw = payload?.settings ?? payload;
        const nextSettings = writeLocalSettings(nextRaw);
        sendJson(res, 200, { ok: true, settings: nextSettings });
      })
      .catch((error) => {
        sendText(res, 500, error.message || "Unknown error while updating settings");
      });
    return;
  }

  if (req.method === "GET" && req.url === "/api/bookmarks") {
    try {
      sendJson(res, 200, buildClientBookmarksPayload());
    } catch (error) {
      sendText(res, 500, error.message || "Could not read bookmarks");
    }
    return;
  }

  if (req.method === "GET" && req.url === "/api/obsidian/theme") {
    try {
      const theme = readObsidianThemeSnapshot();
      sendJson(res, 200, { ok: true, theme });
    } catch (error) {
      sendText(res, 502, error.message || "Could not read Obsidian theme");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/bookmarks/open") {
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

        try {
          const result = openBookmarkById(id);
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
  console.log(`Homepage preview server: http://${HOST}:${PORT}/home.html`);
  console.log(
    "Homepage API endpoints ready: GET /api/ping, GET/POST /api/settings, GET /api/bookmarks, GET /api/obsidian/theme, POST /api/bookmarks/open"
  );
});
