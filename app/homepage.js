import { renderBookmarksModule } from "../modules/bookmarks.js";
import { renderBeantimeModule } from "../modules/beantime.js";
import { renderClockInElement } from "../modules/clock.js";
import { renderNewProjectModule } from "../modules/new-project.js";
import { renderUpdoModule } from "../modules/updo.js";

let pageTitleEl = null;
let moduleGridEl = null;
let headerClockEl = null;
let headerBeantimeIndicatorEl = null;
let openSearchBtnEl = null;
let moduleTabsEl = null;

const pageCleanups = [];
const activeModuleCleanups = [];
const rootEl = document.documentElement;
const THEME_CACHE_KEY = "homepage-theme-bootstrap-v1";
const MODULE_TAB_CACHE_KEY = "homepage-active-module-v1";
const MODULE_TAB_ID_PREFIX = "module-tab-";
const MODULE_PANEL_ID_PREFIX = "module-panel-";
let searchConfig = {
  provider: "omnisearch",
  openInNewTab: false
};
let activeModuleKey = "";
let enabledModuleEntries = [];
let activeModuleRenderSeq = 0;

/**
 * Builds a compact hh:mm:ss duration string from an ISO start timestamp.
 * @param {string} iso - ISO date-time string.
 * @returns {string} Duration text or "-" for invalid timestamps.
 */
function elapsedFromIso(iso) {
  const raw = String(iso || "").trim();
  if (!raw) return "-";
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return "-";
  const seconds = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Renders the top-bar Beantime running indicator.
 * @param {object|null} running - Running timer payload from /api/beantime/meta.
 * @returns {void}
 */
function renderBeantimeHeaderIndicator(running) {
  if (!headerBeantimeIndicatorEl) return;
  if (!running) {
    headerBeantimeIndicatorEl.hidden = true;
    headerBeantimeIndicatorEl.textContent = "";
    headerBeantimeIndicatorEl.removeAttribute("title");
    return;
  }
  const account = String(running?.account || "-");
  const person = String(running?.personAccount || "-");
  const summary = String(running?.summary || "").trim() || "-";
  const startedAt = String(running?.startedAt || "").trim();
  const startDate = startedAt ? new Date(startedAt) : null;
  const startText =
    startDate && !Number.isNaN(startDate.getTime())
      ? startDate.toLocaleString("de-DE", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        })
      : startedAt || "-";

  headerBeantimeIndicatorEl.hidden = false;
  headerBeantimeIndicatorEl.textContent = `Time run ${elapsedFromIso(startedAt)}`;
  headerBeantimeIndicatorEl.title = `Konto: ${account}\nPerson: ${person}\nSummary: ${summary}\nStart: ${startText}`;
}

/**
 * Loads Beantime meta and refreshes the top-bar running indicator.
 * @returns {Promise<void>}
 */
async function refreshBeantimeHeaderIndicator() {
  if (!headerBeantimeIndicatorEl) return;
  const response = await fetch("/api/beantime/meta");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load Beantime meta");
  }
  const meta = await response.json();
  renderBeantimeHeaderIndicator(meta?.running || null);
}

/**
 * Registers a page-level cleanup callback to run before the next page render.
 * @param {Function} fn - Cleanup function returned by a module renderer.
 * @returns {void}
 */
function addPageCleanup(fn) {
  if (typeof fn === "function") pageCleanups.push(fn);
}

/**
 * Executes and clears all registered page-level cleanup callbacks.
 * @returns {void}
 */
function cleanupPage() {
  while (pageCleanups.length) {
    const fn = pageCleanups.pop();
    try {
      fn();
    } catch {
      // noop
    }
  }
}

/**
 * Registers a cleanup callback for the currently visible module.
 * @param {Function} fn - Cleanup function returned by the active module renderer.
 * @returns {void}
 */
function addActiveModuleCleanup(fn) {
  if (typeof fn === "function") activeModuleCleanups.push(fn);
}

/**
 * Executes and clears all cleanup callbacks for the currently visible module.
 * @returns {void}
 */
function cleanupActiveModule() {
  while (activeModuleCleanups.length) {
    const fn = activeModuleCleanups.pop();
    try {
      fn();
    } catch {
      // noop
    }
  }
}

/**
 * Creates the standard homepage module container elements.
 * @param {string} title - Module title shown in the header row.
 * @returns {{root: HTMLElement, head: HTMLElement, body: HTMLElement}} Shell DOM nodes.
 */
function createModuleShell(title) {
  const root = document.createElement("section");
  root.className = "module";

  const head = document.createElement("header");
  head.className = "module-head";
  const h2 = document.createElement("h2");
  h2.className = "module-title";
  h2.textContent = title;
  head.appendChild(h2);

  const body = document.createElement("div");
  body.className = "module-body";

  root.appendChild(head);
  root.appendChild(body);
  return { root, head, body };
}

const moduleRegistry = {
  bookmarks: {
    render: renderBookmarksModule
  },
  beantime: {
    render: renderBeantimeModule
  },
  newProject: {
    render: renderNewProjectModule
  },
  updo: {
    render: renderUpdoModule
  }
};

const moduleUiMeta = {
  bookmarks: {
    icon: "\ud83d\udd16"
  },
  newProject: {
    icon: "\ud83d\uddc2\ufe0f"
  },
  beantime: {
    icon: "\u23f1\ufe0f"
  },
  updo: {
    icon: "\ud83d\udcc8"
  }
};

/**
 * Resolves the icon glyph for a module tab.
 * @param {string} moduleKey - Registry key of the module.
 * @returns {string} Emoji/icon text used by tab button.
 */
function moduleIconForKey(moduleKey) {
  const icon = moduleUiMeta[moduleKey]?.icon;
  if (typeof icon === "string" && icon.trim()) return icon;
  return "\ud83e\udde9";
}

/**
 * Builds stable DOM ids for tab and tabpanel elements.
 * @param {string} moduleKey - Registry key of the module.
 * @returns {{tabId: string, panelId: string}} Linked tab/panel ids.
 */
function moduleTabDomIds(moduleKey) {
  const safeKey = String(moduleKey || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return {
    tabId: `${MODULE_TAB_ID_PREFIX}${safeKey}`,
    panelId: `${MODULE_PANEL_ID_PREFIX}${safeKey}`
  };
}

/**
 * Persists the active module key in localStorage.
 * @param {string} moduleKey - Module key to cache.
 * @returns {void}
 */
function persistActiveModuleKey(moduleKey) {
  try {
    localStorage.setItem(MODULE_TAB_CACHE_KEY, String(moduleKey || ""));
  } catch {
    // noop
  }
}

/**
 * Restores the last active module key from localStorage.
 * @returns {string} Cached module key or an empty string.
 */
function restoreActiveModuleKey() {
  try {
    return String(localStorage.getItem(MODULE_TAB_CACHE_KEY) || "");
  } catch {
    return "";
  }
}

/**
 * Re-renders tab button active states to mirror current selection.
 * @returns {void}
 */
function syncModuleTabSelectionState() {
  if (!moduleTabsEl) return;
  const tabButtons = Array.from(moduleTabsEl.querySelectorAll(".module-tab-btn"));
  for (const button of tabButtons) {
    const moduleKey = String(button.dataset.moduleKey || "");
    const isActive = moduleKey === activeModuleKey;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }
}

/**
 * Activates a module tab and re-renders the active panel.
 * @param {string} moduleKey - Target module key to activate.
 * @param {{focusTab?: boolean}} [opts] - Activation options.
 * @returns {Promise<void>}
 */
async function activateModule(moduleKey, opts = {}) {
  const key = String(moduleKey || "");
  if (!key) return;
  const isEnabled = enabledModuleEntries.some(([enabledKey]) => enabledKey === key);
  if (!isEnabled) return;
  const changed = key !== activeModuleKey;
  activeModuleKey = key;
  persistActiveModuleKey(key);
  syncModuleTabSelectionState();
  if (opts.focusTab && moduleTabsEl) {
    const button = moduleTabsEl.querySelector(`.module-tab-btn[data-module-key="${key}"]`);
    if (button instanceof HTMLElement) button.focus();
  }
  if (changed) {
    await renderActiveModule();
  }
}

/**
 * Computes active tab key from current state, cache, and enabled module list.
 * @returns {string} Valid active module key.
 */
function pickActiveModuleKey() {
  const enabledKeys = enabledModuleEntries.map(([moduleKey]) => moduleKey);
  if (enabledKeys.includes(activeModuleKey)) return activeModuleKey;
  const cached = restoreActiveModuleKey();
  if (enabledKeys.includes(cached)) return cached;
  return enabledKeys[0] || "";
}

/**
 * Renders module icon tabs in the hero header area.
 * @returns {void}
 */
function renderModuleTabs() {
  if (!moduleTabsEl) return;
  moduleTabsEl.innerHTML = "";
  moduleTabsEl.setAttribute("role", "tablist");
  moduleTabsEl.setAttribute("aria-orientation", "horizontal");
  moduleTabsEl.hidden = enabledModuleEntries.length === 0;
  if (!enabledModuleEntries.length) return;

  for (const [moduleKey, moduleCfg] of enabledModuleEntries) {
    const title = String(moduleCfg?.title || moduleKey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-link icon-btn module-tab-btn";
    button.dataset.moduleKey = moduleKey;
    const { tabId, panelId } = moduleTabDomIds(moduleKey);
    button.id = tabId;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-label", title);
    button.title = title;
    button.textContent = moduleIconForKey(moduleKey);
    button.addEventListener("click", () => {
      void activateModule(moduleKey);
    });
    button.addEventListener("keydown", (event) => {
      const keys = enabledModuleEntries.map(([enabledKey]) => enabledKey);
      const currentIndex = keys.indexOf(moduleKey);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % keys.length;
      else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + keys.length) % keys.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = keys.length - 1;
      else return;

      event.preventDefault();
      const nextKey = keys[nextIndex];
      if (!nextKey) return;
      void activateModule(nextKey, { focusTab: true });
    });
    moduleTabsEl.appendChild(button);
  }

  syncModuleTabSelectionState();
}

/**
 * Renders exactly one active module panel below the header.
 * @returns {Promise<void>}
 */
async function renderActiveModule() {
  if (!moduleGridEl) return;
  const renderSeq = ++activeModuleRenderSeq;

  cleanupActiveModule();
  moduleGridEl.innerHTML = "";

  if (!activeModuleKey) {
    moduleGridEl.innerHTML =
      '<section class="module"><div class="module-body"><div class="empty">Keine Bereiche aktiv. In den Settings aktivieren.</div></div></section>';
    return;
  }

  const entry = enabledModuleEntries.find(([moduleKey]) => moduleKey === activeModuleKey);
  if (!entry) {
    moduleGridEl.innerHTML =
      '<section class="module"><div class="module-body"><div class="empty">Modul nicht verfuegbar.</div></div></section>';
    return;
  }

  const [moduleKey, moduleCfg] = entry;
  const definition = moduleRegistry[moduleKey];
  if (!definition) {
    moduleGridEl.innerHTML =
      '<section class="module"><div class="module-body"><div class="empty">Moduldefinition fehlt.</div></div></section>';
    return;
  }

  const shell = createModuleShell(String(moduleCfg?.title || moduleKey));
  const { tabId, panelId } = moduleTabDomIds(moduleKey);
  shell.root.id = panelId;
  shell.root.setAttribute("role", "tabpanel");
  shell.root.setAttribute("aria-labelledby", tabId);
  shell.root.tabIndex = 0;
  moduleGridEl.appendChild(shell.root);

  try {
    const cleanup = await definition.render(shell, moduleCfg);
    if (renderSeq !== activeModuleRenderSeq) {
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {
          // noop
        }
      }
      return;
    }
    addActiveModuleCleanup(cleanup);
  } catch (error) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `Modulfehler: ${error?.message || String(error)}`;
    shell.body.replaceChildren(empty);
  }
}

/**
 * Loads effective settings from the backend API.
 * @returns {Promise<object>} Effective settings payload.
 */
async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load settings");
  }
  const payload = await response.json();
  return payload.settings || {};
}

/**
 * Parses and clamps the homepage title size token.
 * @param {unknown} value - Raw numeric input from settings.
 * @param {number} fallback - Fallback value used for invalid input.
 * @returns {number} Clamped title size in pixels.
 */
function toTitleSize(value, fallback = 38) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(18, Math.min(72, parsed));
}

/**
 * Normalizes the configured search provider to supported backend values.
 * @param {unknown} value - Raw provider value from settings.
 * @returns {"omnisearch"|"obsidian-search"|"quick-file"} Supported provider key.
 */
function cleanSearchProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "omnisearch") return "omnisearch";
  if (raw === "obsidian-search") return "obsidian-search";
  if (raw === "quick-file") return "quick-file";
  return "omnisearch";
}

/**
 * Triggers the configured search provider via backend endpoint.
 * @returns {Promise<void>}
 */
async function openConfiguredSearch() {
  const response = await fetch("/api/search/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: cleanSearchProvider(searchConfig?.provider),
      openInNewTab: Boolean(searchConfig?.openInNewTab)
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not open configured search");
  }
}

/**
 * Normalizes a theme option against an allow-list.
 * @param {unknown} value - Raw setting value.
 * @param {string[]} allowed - Allowed normalized values.
 * @param {string} fallback - Value used when `value` is not allowed.
 * @returns {string} Sanitized theme token.
 */
function cleanThemeValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

/**
 * Removes inline CSS variables that were previously mirrored from Obsidian.
 * @returns {void}
 */
function clearMirroredThemeVars() {
  const vars = [
    "--bg-a",
    "--bg-b",
    "--surface",
    "--surface-strong",
    "--module-head-bg",
    "--button-ghost-bg",
    "--group-btn-bg",
    "--card-bg",
    "--empty-bg",
    "--border",
    "--text",
    "--text-soft",
    "--accent",
    "--accent-soft",
    "--ok",
    "--danger",
    "--shadow"
  ];
  for (const varName of vars) {
    rootEl.style.removeProperty(varName);
  }
}

/**
 * Maps Obsidian theme values to homepage CSS custom properties.
 * @param {object|null|undefined} themeVars - Theme variable payload from `/api/obsidian/theme`.
 * @returns {boolean} `true` when required values were present and applied.
 */
function applyMirroredThemeVars(themeVars) {
  const accent = String(themeVars?.accent || "").trim();
  const bgPrimary = String(themeVars?.bgPrimary || "").trim();
  const bgSecondary = String(themeVars?.bgSecondary || "").trim();
  const bgMod = String(themeVars?.bgMod || "").trim();
  const border = String(themeVars?.border || "").trim();
  const text = String(themeVars?.text || "").trim();
  const textSoft = String(themeVars?.textMuted || "").trim();
  const ok = String(themeVars?.textSuccess || "").trim();
  const danger = String(themeVars?.textError || "").trim();
  const accentHover = String(themeVars?.accentHover || "").trim();

  if (!bgPrimary || !text || !accent) {
    return false;
  }

  rootEl.style.setProperty("--bg-a", bgSecondary || bgPrimary);
  rootEl.style.setProperty("--bg-b", bgPrimary);
  rootEl.style.setProperty("--surface", bgSecondary || bgPrimary);
  rootEl.style.setProperty("--surface-strong", bgPrimary);
  rootEl.style.setProperty("--module-head-bg", bgMod || bgSecondary || bgPrimary);
  rootEl.style.setProperty("--button-ghost-bg", bgPrimary);
  rootEl.style.setProperty("--group-btn-bg", bgMod || bgSecondary || bgPrimary);
  rootEl.style.setProperty("--card-bg", bgPrimary);
  rootEl.style.setProperty("--empty-bg", bgMod || bgSecondary || bgPrimary);
  rootEl.style.setProperty("--border", border || "rgba(128, 128, 128, 0.3)");
  rootEl.style.setProperty("--text", text);
  rootEl.style.setProperty("--text-soft", textSoft || text);
  rootEl.style.setProperty("--accent", accent);
  rootEl.style.setProperty("--accent-soft", accentHover || accent);
  rootEl.style.setProperty("--ok", ok || "#1b8e4a");
  rootEl.style.setProperty("--danger", danger || "#a42130");
  rootEl.style.setProperty("--shadow", "0 10px 30px rgba(0, 0, 0, 0.18)");
  return true;
}

/**
 * Captures currently applied inline theme CSS variables for first-paint caching.
 * @returns {Record<string, string>} CSS variable/value map.
 */
function currentThemeCssVarSnapshot() {
  const names = [
    "--bg-a",
    "--bg-b",
    "--surface",
    "--surface-strong",
    "--module-head-bg",
    "--button-ghost-bg",
    "--group-btn-bg",
    "--card-bg",
    "--empty-bg",
    "--border",
    "--text",
    "--text-soft",
    "--accent",
    "--accent-soft",
    "--ok",
    "--danger",
    "--shadow"
  ];
  const out = {};
  for (const name of names) {
    const value = rootEl.style.getPropertyValue(name);
    if (value && String(value).trim()) out[name] = String(value).trim();
  }
  return out;
}

/**
 * Stores a minimal theme snapshot in localStorage for flash-free first paint.
 * @param {{mode: string, preset: string, shape: string, vars?: Record<string, string>|null}} cachePayload - Cache payload.
 * @returns {void}
 */
function persistThemeBootstrapCache({ mode, preset, shape, vars }) {
  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        mode,
        preset,
        shape,
        vars: vars && typeof vars === "object" ? vars : null
      })
    );
  } catch {
    // noop
  }
}

/**
 * Fetches theme variables mirrored from Obsidian.
 * @returns {Promise<object|null>} Theme payload or `null` if fetch fails.
 */
async function fetchObsidianThemeSnapshot() {
  const response = await fetch("/api/obsidian/theme");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load Obsidian theme");
  }
  const payload = await response.json();
  return payload?.theme || null;
}

/**
 * Applies either preset theming or mirrored Obsidian theme values to the page.
 * @param {object} themeConfig - Theme config from effective settings.
 * @returns {Promise<void>}
 */
async function applyUiTheme(themeConfig) {
  const mode = cleanThemeValue(themeConfig?.mode, ["preset", "mirror-obsidian"], "preset");
  const preset = cleanThemeValue(themeConfig?.preset, ["soft", "flat", "high-contrast"], "soft");
  const shape = cleanThemeValue(themeConfig?.shape, ["rounded", "comfortable", "sharp"], "rounded");

  rootEl.dataset.themePreset = preset;
  rootEl.dataset.themeShape = shape;

  clearMirroredThemeVars();
  if (mode === "mirror-obsidian") {
    delete rootEl.dataset.obsidianMode;
    let mirrored = false;
    try {
      const theme = await fetchObsidianThemeSnapshot();
      mirrored = applyMirroredThemeVars(theme?.vars);
      if (theme?.mode === "dark") {
        rootEl.dataset.obsidianMode = "dark";
      } else if (theme?.mode === "light") {
        rootEl.dataset.obsidianMode = "light";
      } else {
        delete rootEl.dataset.obsidianMode;
      }
    } catch {
      mirrored = false;
      delete rootEl.dataset.obsidianMode;
    }
    rootEl.dataset.themeMode = mirrored ? "mirror-obsidian" : "preset";
    persistThemeBootstrapCache({
      mode: mirrored ? "mirror-obsidian" : "preset",
      preset,
      shape,
      vars: mirrored ? currentThemeCssVarSnapshot() : null
    });
  } else {
    rootEl.dataset.themeMode = "preset";
    delete rootEl.dataset.obsidianMode;
    persistThemeBootstrapCache({ mode: "preset", preset, shape, vars: null });
  }
}

/**
 * Renders homepage modules from effective settings and wires module cleanup lifecycle.
 * @returns {Promise<void>}
 */
async function renderPage() {
  if (!moduleGridEl) {
    console.error("Missing required #moduleGrid mount node.");
    return;
  }
  cleanupActiveModule();
  cleanupPage();
  moduleGridEl.innerHTML = "";

  try {
    const settings = await loadSettings();
    await applyUiTheme(settings?.ui?.theme);
    if (pageTitleEl) {
      pageTitleEl.textContent = settings?.ui?.title || "Workspace Homepage";
    }
    rootEl.style.setProperty("--hero-title-size", `${toTitleSize(settings?.ui?.titleSize, 38)}px`);
    searchConfig = {
      provider: cleanSearchProvider(settings?.ui?.search?.provider),
      openInNewTab: Boolean(settings?.ui?.search?.openInNewTab)
    };

    if (settings?.modules?.clock?.enabled && headerClockEl) {
      addPageCleanup(renderClockInElement(headerClockEl, settings.modules.clock));
    } else if (headerClockEl) {
      headerClockEl.textContent = "";
    }

    if (settings?.modules?.beantime?.enabled && headerBeantimeIndicatorEl) {
      const syncFromApi = async () => {
        try {
          await refreshBeantimeHeaderIndicator();
        } catch {
          renderBeantimeHeaderIndicator(null);
        }
      };
      const onBeantimeState = (event) => {
        renderBeantimeHeaderIndicator(event?.detail?.running || null);
      };
      const pollId = window.setInterval(() => {
        void syncFromApi();
      }, 15000);
      window.addEventListener("beantime:state", onBeantimeState);
      addPageCleanup(() => {
        clearInterval(pollId);
        window.removeEventListener("beantime:state", onBeantimeState);
      });
      await syncFromApi();
    } else {
      renderBeantimeHeaderIndicator(null);
    }

    const moduleEntries = Object.entries(settings?.modules || {});
    enabledModuleEntries = moduleEntries.filter(
      ([moduleKey, cfg]) => moduleKey !== "clock" && Boolean(cfg?.enabled)
    );

    activeModuleKey = pickActiveModuleKey();
    persistActiveModuleKey(activeModuleKey);
    renderModuleTabs();
    await renderActiveModule();
  } catch (error) {
    enabledModuleEntries = [];
    activeModuleKey = "";
    renderModuleTabs();
    const section = document.createElement("section");
    section.className = "module";
    const body = document.createElement("div");
    body.className = "module-body";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = `Fehler beim Laden der Einstellungen: ${error?.message || String(error)}`;
    body.appendChild(empty);
    section.appendChild(body);
    moduleGridEl.replaceChildren(section);
  }
}

/**
 * Resolves required/optional DOM anchors and wires module bootstrap handlers.
 * @returns {void}
 */
function initHomepage() {
  pageTitleEl = document.getElementById("pageTitle");
  moduleGridEl = document.getElementById("moduleGrid");
  headerClockEl = document.getElementById("headerClock");
  headerBeantimeIndicatorEl = document.getElementById("headerBeantimeIndicator");
  openSearchBtnEl = document.getElementById("openSearchBtn");
  moduleTabsEl = document.getElementById("moduleTabs");

  if (openSearchBtnEl) {
    openSearchBtnEl.addEventListener("click", () => {
      openConfiguredSearch().catch((error) => {
        // Keep UI quiet, but visible in devtools.
        console.error(error);
      });
    });
  }

  void renderPage();
}

window.addEventListener("beforeunload", () => {
  cleanupActiveModule();
  cleanupPage();
});
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHomepage, { once: true });
} else {
  initHomepage();
}





