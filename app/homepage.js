import { renderBookmarksModule } from "../modules/bookmarks.js";
import { renderClockInElement } from "../modules/clock.js";

const pageTitleEl = document.getElementById("pageTitle");
const moduleGridEl = document.getElementById("moduleGrid");
const headerClockEl = document.getElementById("headerClock");
const openSearchBtnEl = document.getElementById("openSearchBtn");

const activeCleanups = [];
const rootEl = document.documentElement;
const THEME_CACHE_KEY = "homepage-theme-bootstrap-v1";
let searchConfig = {
  provider: "omnisearch",
  openInNewTab: false
};

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

function makeShellCollapsible(shell, startCollapsed = false) {
  if (!shell?.root || !shell?.head || !shell?.body) return () => {};

  shell.root.classList.add("module-collapsible");
  shell.head.setAttribute("role", "button");
  shell.head.tabIndex = 0;

  const applyState = (collapsed) => {
    shell.root.classList.toggle("module-collapsed", collapsed);
    shell.head.setAttribute("aria-expanded", String(!collapsed));
  };

  const toggle = () => {
    const collapsed = !shell.root.classList.contains("module-collapsed");
    applyState(collapsed);
  };

  const onClick = () => toggle();
  const onKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };

  shell.head.addEventListener("click", onClick);
  shell.head.addEventListener("keydown", onKeyDown);
  applyState(Boolean(startCollapsed));

  return () => {
    shell.head.removeEventListener("click", onClick);
    shell.head.removeEventListener("keydown", onKeyDown);
  };
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

function toTitleSize(value, fallback = 38) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(18, Math.min(72, parsed));
}

function cleanSearchProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "omnisearch") return "omnisearch";
  if (raw === "obsidian-search") return "obsidian-search";
  if (raw === "quick-file") return "quick-file";
  return "omnisearch";
}

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
    rootEl.style.setProperty("--hero-title-size", `${toTitleSize(settings?.ui?.titleSize, 38)}px`);
    searchConfig = {
      provider: cleanSearchProvider(settings?.ui?.search?.provider),
      openInNewTab: Boolean(settings?.ui?.search?.openInNewTab)
    };

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
      if (moduleKey === "bookmarks") {
        addCleanup(makeShellCollapsible(shell, false));
      }

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
if (openSearchBtnEl) {
  openSearchBtnEl.addEventListener("click", () => {
    openConfiguredSearch().catch((error) => {
      // Keep UI quiet, but visible in devtools.
      console.error(error);
    });
  });
}
renderPage();
