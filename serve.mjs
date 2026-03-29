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

function toIntInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function oneOf(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeProjectTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeFundingCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeSociety(value) {
  return oneOf(value, ["nica", "tohu"], "nica").toUpperCase();
}

function normalizeProjectType(value) {
  return oneOf(value, ["funding", "hired", "self financed"], "funding");
}

function sanitizePathSeparators(input) {
  return String(input || "").replace(/\\/g, "/");
}

function hasInvalidWindowsPathChars(value) {
  return /[<>:"/\\|?*\u0000-\u001F]/.test(String(value || ""));
}

function toYamlScalar(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const asString = String(value ?? "");
  const escaped = asString.replace(/'/g, "''");
  return `'${escaped}'`;
}

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

function applyProjectFrontmatter(content, fields) {
  const orderedKeys = ["year", "antragsteller", "förderer", "title", "type", "category"];
  let nextContent = String(content || "");
  for (const key of orderedKeys) {
    if (!(key in fields)) continue;
    nextContent = upsertFrontmatterScalar(nextContent, key, fields[key]);
  }
  return nextContent;
}

function renderTemplateFallback(templateRaw, projectTitle) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return String(templateRaw || "")
    .replace(/<%\s*tp\.date\.now\("YYYY-MM-DD,\s*HH:mm:ss"\)\s*%>/g, timestamp)
    .replace(/<%\s*tp\.file\.title\s*%>/g, String(projectTitle || ""));
}

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

  execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  return {
    ok: true,
    id: String(id),
    openInNewTab: Boolean(openInNewTab),
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

  const raw = execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  const parsed = JSON.parse(clean);
  return {
    ok: Boolean(parsed?.ok),
    provider: String(parsed?.provider || selected),
    commandId: String(parsed?.commandId || commandId)
  };
}

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
  const funding = String(fm["förderer"] || "").trim();
  const year = String(fm.year || "").trim();
  if (society) out.societies[society] = (out.societies[society] || 0) + 1;
  if (type) out.types[type] = (out.types[type] || 0) + 1;
  if (funding) out.fundingCodes[funding] = (out.fundingCodes[funding] || 0) + 1;
  if (year) out.years[year] = (out.years[year] || 0) + 1;
}
JSON.stringify(out);
`.trim();

  const raw = execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  const clean = String(raw || "").replace(/^=>\s*/, "").trim();
  return JSON.parse(clean);
}

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
  execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
}

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

  const raw = execFileSync("obsidian", ["eval", `code=${js}`], {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
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

function openProjectFile(projectFileRel, openInNewTab = false) {
  execFileSync("obsidian", ["open", `path=${projectFileRel}`, openInNewTab ? "newtab" : ""].filter(Boolean), {
    cwd: VAULT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
}

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
    förderer: naming.fundingCode,
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
      förderer: naming.fundingCode,
      title: naming.title,
      type: naming.projectType
    }
  };
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

        const patchSettings = payload?.settings ?? payload;
        const effectiveBefore = getEffectiveSettings();
        const nextRaw = deepMerge(effectiveBefore, patchSettings);
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

  if (req.method === "POST" && req.url === "/api/search/open") {
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

  if (req.method === "GET" && req.url === "/api/projects/meta") {
    try {
      const payload = buildProjectMetaPayload();
      sendJson(res, 200, { ok: true, ...payload });
    } catch (error) {
      sendText(res, 500, error.message || "Could not load project metadata");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/projects/create") {
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
    "Homepage API endpoints ready: GET /api/ping, GET/POST /api/settings, GET /api/bookmarks, GET /api/obsidian/theme, POST /api/bookmarks/open, POST /api/search/open, GET /api/projects/meta, POST /api/projects/create"
  );
});
