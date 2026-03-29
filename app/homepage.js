import { renderBookmarksModule } from "../modules/bookmarks.js";
import { renderClockInElement } from "../modules/clock.js";

const pageTitleEl = document.getElementById("pageTitle");
const pageSubtitleEl = document.getElementById("pageSubtitle");
const moduleGridEl = document.getElementById("moduleGrid");
const headerClockEl = document.getElementById("headerClock");

const activeCleanups = [];
const rootEl = document.documentElement;
const THEME_CACHE_KEY = "homepage-theme-bootstrap-v1";

function addCleanup(fn) {
  if (typeof fn === "function") activeCleanups.push(fn);
}

function cleanupAllModules() {
  while (activeCleanups.length) {
    const fn = activeCleanups.pop();
    try {
      fn();
    } catch {
      // noop
    }
  }
}

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
  }
};

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load settings");
  }
  const payload = await response.json();
  return payload.settings || {};
}

function cleanThemeValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

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

async function fetchObsidianThemeSnapshot() {
  const response = await fetch("/api/obsidian/theme");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load Obsidian theme");
  }
  const payload = await response.json();
  return payload?.theme || null;
}

async function applyUiTheme(themeConfig) {
  const mode = cleanThemeValue(themeConfig?.mode, ["preset", "mirror-obsidian"], "preset");
  const preset = cleanThemeValue(themeConfig?.preset, ["soft", "flat", "high-contrast"], "soft");
  const shape = cleanThemeValue(themeConfig?.shape, ["rounded", "comfortable", "sharp"], "rounded");

  rootEl.dataset.themePreset = preset;
  rootEl.dataset.themeShape = shape;

  clearMirroredThemeVars();
  if (mode === "mirror-obsidian") {
    let mirrored = false;
    try {
      const theme = await fetchObsidianThemeSnapshot();
      mirrored = applyMirroredThemeVars(theme?.vars);
      if (theme?.mode === "dark") rootEl.dataset.obsidianMode = "dark";
      if (theme?.mode === "light") rootEl.dataset.obsidianMode = "light";
    } catch {
      mirrored = false;
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

async function renderPage() {
  cleanupAllModules();
  moduleGridEl.innerHTML = "";

  try {
    const settings = await loadSettings();
    await applyUiTheme(settings?.ui?.theme);
    pageTitleEl.textContent = settings?.ui?.title || "Workspace Homepage";
    pageSubtitleEl.textContent = settings?.ui?.subtitle || "";

    if (settings?.modules?.clock?.enabled) {
      addCleanup(renderClockInElement(headerClockEl, settings.modules.clock));
    } else if (headerClockEl) {
      headerClockEl.textContent = "";
    }

    const moduleEntries = Object.entries(settings?.modules || {});
    const enabledEntries = moduleEntries.filter(
      ([moduleKey, cfg]) => moduleKey !== "clock" && Boolean(cfg?.enabled)
    );

    if (!enabledEntries.length) {
      moduleGridEl.innerHTML =
        '<section class="module"><div class="module-body"><div class="empty">Keine Bereiche aktiv. In den Settings aktivieren.</div></div></section>';
      return;
    }

    for (const [moduleKey, moduleCfg] of enabledEntries) {
      const definition = moduleRegistry[moduleKey];
      if (!definition) continue;

      const title = String(moduleCfg?.title || moduleKey);
      const shell = createModuleShell(title);
      moduleGridEl.appendChild(shell.root);

      try {
        const cleanup = await definition.render(shell, moduleCfg);
        addCleanup(cleanup);
      } catch (error) {
        shell.body.innerHTML = `<div class="empty">Modulfehler: ${error.message || error}</div>`;
      }
    }
  } catch (error) {
    moduleGridEl.innerHTML =
      `<section class="module"><div class="module-body"><div class="empty">Fehler beim Laden der Einstellungen: ${error.message || error}</div></div></section>`;
  }
}

window.addEventListener("beforeunload", cleanupAllModules);
renderPage();
