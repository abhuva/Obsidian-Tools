function normalizeItemType(type) {
  const raw = String(type || "").toLowerCase();
  if (raw === "file") return "Datei";
  if (raw === "url") return "Link";
  if (raw === "graph") return "Graph";
  if (raw === "search") return "Search";
  return raw || "Bookmark";
}

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

export async function renderBookmarksModule(shell, moduleSettings) {
  let groupedData = [];
  let selectedGroup = "__all__";
  let query = "";
  const showPath = Boolean(moduleSettings?.showPath);
  const showType = Boolean(moduleSettings?.showType);

  const toolbar = document.createElement("div");
  toolbar.className = "bookmarks-toolbar";

  const searchInput = document.createElement("input");
  searchInput.className = "input";
  searchInput.type = "search";
  searchInput.placeholder = "Bookmark suchen...";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "btn btn-primary";
  refreshBtn.textContent = "Neu laden";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "btn btn-ghost";
  allBtn.textContent = "Alle Gruppen";

  toolbar.appendChild(searchInput);
  toolbar.appendChild(refreshBtn);
  toolbar.appendChild(allBtn);

  const status = document.createElement("div");
  status.className = "status";

  const layout = document.createElement("div");
  layout.className = "bookmark-layout";

  const groupList = document.createElement("div");
  groupList.className = "group-list";

  const cards = document.createElement("div");
  cards.className = "cards";

  layout.appendChild(groupList);
  layout.appendChild(cards);

  shell.body.appendChild(toolbar);
  shell.body.appendChild(status);
  shell.body.appendChild(layout);

  function setStatus(text, state) {
    status.textContent = text || "";
    status.classList.remove("ok", "err");
    if (state === "ok") status.classList.add("ok");
    if (state === "err") status.classList.add("err");
  }

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
  }

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
            body: JSON.stringify({ id: entry.id })
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
        selectedGroup = "__all__";
      }
      renderGroups();
      renderCards();
      const total = groupedData.reduce((acc, group) => acc + group.entries.length, 0);
      setStatus(`Bereit: ${total} Bookmarks`, "ok");
    } catch (error) {
      setStatus(`Fehler: ${error.message || error}`, "err");
      cards.innerHTML = '<div class="empty">Bookmarks konnten nicht geladen werden.</div>';
    }
  }

  searchInput.addEventListener("input", () => {
    query = String(searchInput.value || "").trim();
    renderCards();
  });
  refreshBtn.addEventListener("click", () => loadBookmarks());
  allBtn.addEventListener("click", () => {
    selectedGroup = "__all__";
    renderGroups();
    renderCards();
  });

  await loadBookmarks();
  return () => {
    groupList.innerHTML = "";
    cards.innerHTML = "";
  };
}
