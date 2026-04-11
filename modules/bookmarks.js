/**
 * Maps raw bookmark item types to user-facing German labels.
 * @param {unknown} type - Raw bookmark type from `.obsidian/bookmarks.json`.
 * @returns {string} Display label for the bookmark type.
 */
function normalizeItemType(type) {
  const raw = String(type || "").toLowerCase();
  if (raw === "file") return "Datei";
  if (raw === "url") return "Link";
  if (raw === "graph") return "Graph";
  if (raw === "search") return "Search";
  return raw || "Bookmark";
}

/**
 * Recursively flattens nested bookmark groups into leaf entries.
 * @param {Array<object>|undefined|null} items - Bookmark items to traverse.
 * @param {Array<object>} collector - Output list for non-group entries.
 * @returns {void}
 */
function flattenGroupItems(items, collector) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item.type === "group") {
      flattenGroupItems(item.items, collector);
    } else {
      collector.push(item);
    }
  }
}

/**
 * Builds sidebar groups from raw bookmark root items.
 * @param {Array<object>} rawItems - Root bookmark items from the API payload.
 * @returns {Array<{id: string, title: string, entries: Array<object>}>} Grouped bookmark model.
 */
function buildGroups(rawItems) {
  const groups = [];
  for (const rootItem of rawItems) {
    if (rootItem.type === "group") {
      const entries = [];
      flattenGroupItems(rootItem.items, entries);
      groups.push({
        id: rootItem.id,
        title: rootItem.title || "Gruppe",
        entries
      });
    } else {
      groups.push({
        id: "__ungrouped__",
        title: "Ohne Gruppe",
        entries: [rootItem]
      });
    }
  }
  return groups;
}

/**
 * Renders the bookmarks module UI and wires API-backed open actions.
 * @param {{head: HTMLElement, body: HTMLElement}} shell - Module shell DOM nodes.
 * @param {{showPath?: boolean, showType?: boolean, openInNewTab?: boolean, cardMaxWidth?: number|string}} moduleSettings - Bookmarks module settings.
 * @returns {Promise<() => void>} Cleanup callback that clears module DOM.
 */
export async function renderBookmarksModule(shell, moduleSettings) {
  let groupedData = [];
  let selectedGroup = "";
  let query = "";
  const showPath = Boolean(moduleSettings?.showPath);
  const showType = Boolean(moduleSettings?.showType);
  const openInNewTab = Boolean(moduleSettings?.openInNewTab);
  const parsedCardMaxWidth = Number.parseInt(String(moduleSettings?.cardMaxWidth ?? ""), 10);
  const cardMaxWidth = Number.isFinite(parsedCardMaxWidth)
    ? Math.max(205, Math.min(420, parsedCardMaxWidth))
    : 240;

  const toolbar = document.createElement("div");
  toolbar.className = "bookmarks-toolbar";

  const searchInput = document.createElement("input");
  searchInput.className = "input";
  searchInput.type = "search";
  searchInput.placeholder = "Bookmark suchen...";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "module-head-icon-btn";
  refreshBtn.textContent = "\u21bb";
  refreshBtn.title = "Neu laden";
  refreshBtn.setAttribute("aria-label", "Neu laden");
  refreshBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    loadBookmarks();
  });

  toolbar.appendChild(searchInput);
  const headActions = document.createElement("div");
  headActions.className = "module-head-actions";
  headActions.appendChild(refreshBtn);
  shell.head.appendChild(headActions);

  const status = document.createElement("div");
  status.className = "status";

  const layout = document.createElement("div");
  layout.className = "bookmark-layout";

  const groupList = document.createElement("div");
  groupList.className = "group-list";

  const cards = document.createElement("div");
  cards.className = "cards";
  cards.style.setProperty("--bookmark-card-max-width", `${cardMaxWidth}px`);

  layout.appendChild(groupList);
  layout.appendChild(cards);

  shell.body.appendChild(toolbar);
  shell.body.appendChild(status);
  shell.body.appendChild(layout);

  /**
   * Updates the module status message and state class.
   * @param {string} text - Status text.
   * @param {"ok"|"err"|""} [state] - Optional visual state modifier.
   * @returns {void}
   */
  function setStatus(text, state) {
    status.textContent = text || "";
    status.classList.remove("ok", "err");
    if (state === "ok") status.classList.add("ok");
    if (state === "err") status.classList.add("err");
  }

  /**
   * Returns bookmark entries after group and search filtering.
   * @returns {Array<object>} Filtered bookmark entries for card rendering.
   */
  function getActiveEntries() {
    const source =
      selectedGroup === "__all__"
        ? groupedData.flatMap((group) => group.entries)
        : groupedData.find((group) => group.id === selectedGroup)?.entries || [];

    if (!query) return source;
    const needle = query.toLowerCase();
    return source.filter((entry) => {
      const hay = [entry.title || "", entry.path || "", entry.url || "", entry.type || ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  /**
   * Renders group filter buttons and active-state styles.
   * @returns {void}
   */
  function renderGroups() {
    groupList.innerHTML = "";
    for (const group of groupedData) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "group-btn" + (selectedGroup === group.id ? " active" : "");
      btn.textContent = `${group.title} (${group.entries.length})`;
      btn.addEventListener("click", () => {
        selectedGroup = group.id;
        renderGroups();
        renderCards();
      });
      groupList.appendChild(btn);
    }

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "group-btn group-filter-btn" + (selectedGroup === "__all__" ? " active" : "");
    allBtn.textContent = "Alle Gruppen";
    allBtn.addEventListener("click", () => {
      selectedGroup = "__all__";
      renderGroups();
      renderCards();
    });
    groupList.appendChild(allBtn);
  }

  /**
   * Renders bookmark cards for the active group and query.
   * @returns {void}
   */
  function renderCards() {
    const entries = getActiveEntries();
    cards.innerHTML = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Keine passenden Bookmarks gefunden.";
      cards.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";

      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = entry.title || "(ohne Titel)";

      if (showType) {
        const type = document.createElement("div");
        type.className = "card-type";
        type.textContent = normalizeItemType(entry.type);
        card.appendChild(type);
      }
      card.appendChild(title);

      if (showPath) {
        const meta = document.createElement("div");
        meta.className = "card-meta";
        meta.textContent = entry.path || entry.url || "";
        card.appendChild(meta);
      }

      card.addEventListener("click", async () => {
        setStatus(`Oeffne: ${entry.title || entry.path || entry.url || "Bookmark"} ...`);
        try {
          const response = await fetch("/api/bookmarks/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: entry.id, openInNewTab })
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || "Unbekannter Fehler");
          }
          setStatus(`Geoeffnet: ${entry.title || "Bookmark"}`, "ok");
        } catch (error) {
          setStatus(`Konnte nicht oeffnen: ${error.message || error}`, "err");
        }
      });

      cards.appendChild(card);
    }
  }

  /**
   * Loads bookmarks from backend, updates local grouping state, and re-renders UI.
   * @returns {Promise<void>}
   */
  async function loadBookmarks() {
    setStatus("Bookmarks werden geladen...");
    cards.innerHTML = '<div class="empty">Lade Daten...</div>';
    try {
      const response = await fetch("/api/bookmarks");
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Fehler beim Laden");
      }
      const payload = await response.json();
      groupedData = buildGroups(payload.items || []);
      if (!groupedData.find((group) => group.id === selectedGroup)) {
        const mainGroup = groupedData.find((group) => String(group.title || "").trim().toLowerCase() === "main");
        selectedGroup = mainGroup?.id || "__all__";
      }
      renderGroups();
      renderCards();
      setStatus("");
    } catch (error) {
      setStatus(`Fehler: ${error.message || error}`, "err");
      cards.innerHTML = '<div class="empty">Bookmarks konnten nicht geladen werden.</div>';
    }
  }

  searchInput.addEventListener("input", () => {
    query = String(searchInput.value || "").trim();
    renderCards();
  });

  await loadBookmarks();
  return () => {
    groupList.innerHTML = "";
    cards.innerHTML = "";
  };
}
