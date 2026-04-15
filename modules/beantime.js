/**
 * Renders Beantime timer controls (start/stop with account + person + summary).
 * @param {{body: HTMLElement}} shell - Module shell DOM nodes.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderBeantimeModule(shell) {
  let running = false;
  let isStarting = false;
  let isStopping = false;
  let isShowing = false;
  let runningMeta = null;
  let elapsedTickerId = 0;

  const controls = document.createElement("div");
  controls.className = "beantime-controls";
  controls.innerHTML = `
    <div id="beantimeEditorFields">
      <div class="field-row">
        <label for="beantimeAccount">Konto</label>
        <select id="beantimeAccount" class="input"></select>
      </div>
      <div class="field-row">
        <label for="beantimePerson">Person</label>
        <select id="beantimePerson" class="input"></select>
      </div>
      <div class="field-row">
        <label for="beantimeSummary">Summary</label>
        <input id="beantimeSummary" class="input" type="text" placeholder="Kurze Beschreibung..." />
      </div>
    </div>
    <section id="beantimeRunningPanel" class="beantime-running-panel" hidden>
      <div class="beantime-running-title">Timer laeuft</div>
      <div class="beantime-running-grid">
        <div><strong>Konto:</strong> <span id="beantimeRunAccount">-</span></div>
        <div><strong>Person:</strong> <span id="beantimeRunPerson">-</span></div>
        <div><strong>Summary:</strong> <span id="beantimeRunSummary">-</span></div>
        <div><strong>Start:</strong> <span id="beantimeRunStart">-</span></div>
        <div><strong>Laufzeit:</strong> <span id="beantimeRunElapsed">-</span></div>
      </div>
    </section>
    <div class="beantime-btn-row">
      <button type="button" class="btn btn-primary" id="beantimeStartBtn">Start</button>
      <button type="button" class="btn btn-ghost" id="beantimeStopBtn">Stop</button>
      <button type="button" class="btn btn-ghost" id="beantimeShowBtn">Show</button>
      <button type="button" class="btn btn-ghost" id="beantimeReloadBtn">Neu laden</button>
    </div>
  `;

  const status = document.createElement("div");
  status.className = "status";
  const info = document.createElement("div");
  info.className = "beantime-info";
  shell.body.appendChild(controls);
  shell.body.appendChild(status);
  shell.body.appendChild(info);

  const accountSelect = controls.querySelector("#beantimeAccount");
  const personSelect = controls.querySelector("#beantimePerson");
  const summaryInput = controls.querySelector("#beantimeSummary");
  const startBtn = controls.querySelector("#beantimeStartBtn");
  const stopBtn = controls.querySelector("#beantimeStopBtn");
  const showBtn = controls.querySelector("#beantimeShowBtn");
  const reloadBtn = controls.querySelector("#beantimeReloadBtn");
  const editorFields = controls.querySelector("#beantimeEditorFields");
  const runningPanel = controls.querySelector("#beantimeRunningPanel");
  const runAccountEl = controls.querySelector("#beantimeRunAccount");
  const runPersonEl = controls.querySelector("#beantimeRunPerson");
  const runSummaryEl = controls.querySelector("#beantimeRunSummary");
  const runStartEl = controls.querySelector("#beantimeRunStart");
  const runElapsedEl = controls.querySelector("#beantimeRunElapsed");

  /**
   * Sets status message and semantic class.
   * @param {string} text - Status text.
   * @param {"ok"|"err"|""} [state] - Optional status modifier.
   * @returns {void}
   */
  function setStatus(text, state = "") {
    status.textContent = text || "";
    status.classList.remove("ok", "err");
    if (state === "ok") status.classList.add("ok");
    if (state === "err") status.classList.add("err");
  }

  /**
   * Replaces all options on a select element.
   * @param {HTMLSelectElement} selectEl - Target select.
   * @param {string[]} values - Options to render.
   * @param {string} emptyLabel - Label for empty fallback option.
   * @returns {void}
   */
  function fillSelect(selectEl, values, emptyLabel) {
    selectEl.innerHTML = "";
    if (values.length) {
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        selectEl.appendChild(option);
      }
      return;
    }
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    selectEl.appendChild(option);
  }

  /**
   * Forces a select value even if it is not in current options.
   * @param {HTMLSelectElement} selectEl - Target select.
   * @param {string} value - Desired option value.
   * @returns {void}
   */
  function setOrAppendSelectValue(selectEl, value) {
    const clean = String(value || "").trim();
    if (!clean) return;
    const exists = Array.from(selectEl.options).some((option) => option.value === clean);
    if (!exists) {
      const option = document.createElement("option");
      option.value = clean;
      option.textContent = clean;
      selectEl.appendChild(option);
    }
    selectEl.value = clean;
  }

  /**
   * Formats a date-time string for display.
   * @param {string} iso - ISO timestamp.
   * @returns {string} Localized fallback-safe date-time.
   */
  function formatLocalDateTime(iso) {
    const raw = String(iso || "").trim();
    if (!raw) return "-";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  /**
   * Formats elapsed milliseconds as hh:mm:ss.
   * @param {number} ms - Elapsed milliseconds.
   * @returns {string} Human-readable duration.
   */
  function formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  /**
   * Updates running panel values from current running snapshot.
   * @returns {void}
   */
  function syncRunningPanel() {
    const startIso = String(runningMeta?.startedAt || "").trim();
    runAccountEl.textContent = String(runningMeta?.account || "-");
    runPersonEl.textContent = String(runningMeta?.personAccount || "-");
    runSummaryEl.textContent = String(runningMeta?.summary || "-");
    runStartEl.textContent = formatLocalDateTime(startIso);
    if (!startIso) {
      runElapsedEl.textContent = "-";
      return;
    }
    const started = new Date(startIso);
    if (Number.isNaN(started.getTime())) {
      runElapsedEl.textContent = "-";
      return;
    }
    runElapsedEl.textContent = formatElapsed(Date.now() - started.getTime());
  }

  /**
   * Starts/stops live elapsed ticker for running timer panel.
   * @returns {void}
   */
  function syncElapsedTicker() {
    if (elapsedTickerId) {
      clearInterval(elapsedTickerId);
      elapsedTickerId = 0;
    }
    if (!running) return;
    elapsedTickerId = window.setInterval(() => {
      syncRunningPanel();
    }, 1000);
  }

  /**
   * Updates button disabled states and switches form/running view.
   * @returns {void}
   */
  function syncUiState() {
    const busy = isStarting || isStopping || isShowing;
    const showRunningPanel = Boolean(running && String(runningMeta?.startedAt || "").trim());
    startBtn.disabled = running || busy;
    stopBtn.disabled = !running || busy;
    showBtn.disabled = busy;
    accountSelect.disabled = running || isShowing;
    personSelect.disabled = running || isShowing;
    summaryInput.disabled = running || isShowing;
    editorFields.hidden = running;
    runningPanel.hidden = !showRunningPanel;
    runningPanel.style.display = showRunningPanel ? "grid" : "none";
    syncRunningPanel();
    syncElapsedTicker();
  }

  /**
   * Renders static module info text.
   * @param {object} meta - Beantime metadata payload.
   * @returns {void}
   */
  function renderInfo(meta) {
    const file = String(meta?.file || "").trim();
    const person = String(meta?.running?.personAccount || meta?.personAccount || "").trim();
    const startIso = String(meta?.running?.startedAt || "").trim();
    const activeText = startIso ? `Aktiv seit ${formatLocalDateTime(startIso)}` : "Kein laufender Timer";
    info.replaceChildren(
      createInfoItem("Datei", file || "-"),
      createInfoItem("Person", person || "-"),
      createInfoItem("Status", activeText)
    );
  }

  /**
   * Creates one labeled info row item.
   * @param {string} label - Field label.
   * @param {string} value - Display value.
   * @returns {HTMLSpanElement} Rendered info item.
   */
  function createInfoItem(label, value) {
    const item = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    item.appendChild(strong);
    item.append(` ${value}`);
    return item;
  }

  /**
   * Broadcasts current timer snapshot for global header indicator updates.
   * @param {object} meta - Latest Beantime meta payload.
   * @returns {void}
   */
  function publishBeantimeState(meta) {
    window.dispatchEvent(
      new CustomEvent("beantime:state", {
        detail: {
          running: meta?.running || null,
          meta: meta || null
        }
      })
    );
  }

  /**
   * Loads account options and running state from backend.
   * @returns {Promise<void>}
   */
  async function loadMeta() {
    const response = await fetch("/api/beantime/meta");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Konnte Beantime-Meta nicht laden");
    }
    const meta = await response.json();
    const accounts = Array.isArray(meta?.accounts) ? meta.accounts.map((v) => String(v || "").trim()).filter(Boolean) : [];
    const people = Array.isArray(meta?.personAccounts)
      ? meta.personAccounts.map((v) => String(v || "").trim()).filter(Boolean)
      : [];

    const runningCandidate =
      meta?.running && typeof meta.running === "object" ? meta.running : null;
    const hasValidRunningState = Boolean(
      runningCandidate &&
        String(runningCandidate.startedAt || "").trim() &&
        String(runningCandidate.account || "").trim()
    );
    running = hasValidRunningState;
    runningMeta = hasValidRunningState ? runningCandidate : null;
    fillSelect(accountSelect, accounts, "Keine buchbaren Konten gefunden");
    fillSelect(personSelect, people, "Keine Personenkonten gefunden");

    if (runningMeta?.account) {
      setOrAppendSelectValue(accountSelect, String(runningMeta.account));
    }
    if (runningMeta?.personAccount) {
      setOrAppendSelectValue(personSelect, String(runningMeta.personAccount));
    } else if (meta?.personAccount) {
      setOrAppendSelectValue(personSelect, String(meta.personAccount));
    }
    if (runningMeta) {
      summaryInput.value = String(runningMeta.summary ?? "");
    }

    renderInfo(meta);
    syncUiState();
    publishBeantimeState(meta);
  }

  /**
   * Executes start action via backend API.
   * @returns {Promise<void>}
   */
  async function startTimer() {
    if (isStarting || isStopping) return;
    const account = String(accountSelect.value || "").trim();
    const personAccount = String(personSelect.value || "").trim();
    const summary = String(summaryInput.value || "").trim();
    if (!account) {
      setStatus("Bitte ein Konto auswaehlen.", "err");
      return;
    }
    if (!personAccount) {
      setStatus("Bitte eine Person auswaehlen.", "err");
      return;
    }
    isStarting = true;
    syncUiState();
    try {
      setStatus("Starte Timer...");
      const response = await fetch("/api/beantime/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, personAccount, summary })
      });
      if (!response.ok && response.status !== 409) {
        const text = await response.text();
        throw new Error(text || "Start fehlgeschlagen");
      }
      await loadMeta();
      setStatus(response.status === 409 ? "Timer laeuft bereits." : "Timer gestartet.", "ok");
    } finally {
      isStarting = false;
      syncUiState();
    }
  }

  /**
   * Executes stop action and appends finalized entry to Beancount.
   * @returns {Promise<void>}
   */
  async function stopTimer() {
    if (isStarting || isStopping || isShowing) return;
    isStopping = true;
    syncUiState();
    try {
      setStatus("Stoppe Timer...");
      const summary = String(summaryInput.value || "").trim();
      const response = await fetch("/api/beantime/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary })
      });
      if (!response.ok && response.status !== 409) {
        const text = await response.text();
        throw new Error(text || "Stop fehlgeschlagen");
      }
      running = false;
      runningMeta = null;
      syncUiState();
      summaryInput.value = "";
      await loadMeta();
      setStatus(response.status === 409 ? "Kein laufender Timer." : "Timer gestoppt und Eintrag gebucht.", "ok");
    } finally {
      isStopping = false;
      syncUiState();
    }
  }

  /**
   * Starts/opens the local Fava server in Obsidian webviewer.
   * @returns {Promise<void>}
   */
  async function showFava() {
    if (isStarting || isStopping || isShowing) return;
    isShowing = true;
    syncUiState();
    try {
      setStatus("Oeffne Fava...");
      const response = await fetch("/api/beantime/show", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Fava konnte nicht geoeffnet werden");
      }
      const payload = await response.json().catch(() => ({}));
      const file = String(payload?.file || "Tools/data/beantime/zeit.beancount").trim();
      setStatus(`Fava geoeffnet (${file}).`, "ok");
    } finally {
      isShowing = false;
      syncUiState();
    }
  }

  startBtn.addEventListener("click", () => {
    void startTimer().catch((error) => setStatus(error?.message || String(error), "err"));
  });
  stopBtn.addEventListener("click", () => {
    void stopTimer().catch((error) => setStatus(error?.message || String(error), "err"));
  });
  showBtn.addEventListener("click", () => {
    void showFava().catch((error) => setStatus(error?.message || String(error), "err"));
  });
  reloadBtn.addEventListener("click", () => {
    setStatus("Lade Daten...");
    void loadMeta()
      .then(() => setStatus(""))
      .catch((error) => setStatus(error?.message || String(error), "err"));
  });

  try {
    await loadMeta();
  } catch (error) {
    setStatus(error?.message || String(error), "err");
  }

  return () => {
    if (elapsedTickerId) clearInterval(elapsedTickerId);
    shell.body.innerHTML = "";
  };
}
