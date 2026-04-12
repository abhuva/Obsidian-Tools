/**
 * Converts entry totals into readable duration labels.
 * @param {number} mins - Duration in minutes.
 * @returns {string} Human-readable duration.
 */
function formatMinutes(mins) {
  const safe = Number.isFinite(mins) ? Math.max(0, Math.floor(mins)) : 0;
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Parses a klog "H:mm" time token.
 * @param {string} value - klog time token.
 * @returns {number|null} Minutes from day start or `null`.
 */
function parseKlogTimeToMins(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const mins = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

/**
 * Computes the live runtime of an open range for the local day.
 * @param {string} recordDate - Date in `YYYY-MM-DD`.
 * @param {string} startTime - Time in `H:mm`.
 * @returns {number} Runtime in minutes.
 */
function openRangeRuntimeMins(recordDate, startTime) {
  const startMins = parseKlogTimeToMins(startTime);
  if (startMins == null) return 0;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (today !== String(recordDate || "").trim()) return 0;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, nowMins - startMins);
}

/**
 * Renders the klog-based time tracking module.
 * @param {{body: HTMLElement}} shell - Module shell DOM nodes.
 * @param {{refreshSec?: number|string}} moduleSettings - Time tracking settings.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderTimetrackingModule(shell, moduleSettings) {
  const refreshSecRaw = Number.parseInt(String(moduleSettings?.refreshSec ?? ""), 10);
  const refreshSec = Number.isFinite(refreshSecRaw) ? Math.max(5, Math.min(300, refreshSecRaw)) : 20;
  let destroyed = false;
  let pollTimer = null;
  let tickTimer = null;
  let snapshot = null;

  const controls = document.createElement("div");
  controls.className = "timetracking-controls";
  controls.innerHTML = `
    <input class="input timetracking-activity-input" type="text" id="timetrackingActivityInput" placeholder="Aktivitaet eingeben..." />
    <div class="timetracking-btn-row">
      <button type="button" class="btn btn-primary" id="timetrackingStartBtn">Start</button>
      <button type="button" class="btn btn-ghost" id="timetrackingPauseBtn">Pause</button>
      <button type="button" class="btn btn-ghost" id="timetrackingStopBtn">Stop</button>
      <button type="button" class="btn btn-ghost" id="timetrackingRefreshBtn">Neu laden</button>
    </div>
  `;

  const status = document.createElement("div");
  status.className = "status";

  const summary = document.createElement("div");
  summary.className = "timetracking-summary";

  const list = document.createElement("div");
  list.className = "timetracking-list";

  shell.body.appendChild(controls);
  shell.body.appendChild(status);
  shell.body.appendChild(summary);
  shell.body.appendChild(list);

  const activityInput = controls.querySelector("#timetrackingActivityInput");
  const startBtn = controls.querySelector("#timetrackingStartBtn");
  const pauseBtn = controls.querySelector("#timetrackingPauseBtn");
  const stopBtn = controls.querySelector("#timetrackingStopBtn");
  const refreshBtn = controls.querySelector("#timetrackingRefreshBtn");

  /**
   * Sets module status text and semantic class.
   * @param {string} text - Status message.
   * @param {"ok"|"err"|""} [state] - Optional status class.
   * @returns {void}
   */
  function setStatus(text, state = "") {
    status.textContent = text || "";
    status.classList.remove("ok", "err");
    if (state === "ok") status.classList.add("ok");
    if (state === "err") status.classList.add("err");
  }

  /**
   * Enables/disables all action buttons while requests are pending.
   * @param {boolean} busy - Busy flag.
   * @returns {void}
   */
  function setBusy(busy) {
    const disabled = Boolean(busy);
    startBtn.disabled = disabled;
    pauseBtn.disabled = disabled;
    stopBtn.disabled = disabled;
    refreshBtn.disabled = disabled;
  }

  /**
   * Updates summary/meta line based on current snapshot.
   * @returns {void}
   */
  function renderSummary() {
    const totalMins = Number(snapshot?.totalMins || 0);
    const active = snapshot?.active || null;
    const activeText = active ? `Aktiv: ${active.summary || "(ohne Titel)"}` : "Keine laufende Aktivitaet";
    const fileText = String(snapshot?.file || "").trim();
    summary.innerHTML = `
      <span><strong>Heute:</strong> ${formatMinutes(totalMins)}</span>
      <span><strong>Status:</strong> ${activeText}</span>
      <span><strong>Datei:</strong> ${fileText || "-"}</span>
    `;
  }

  /**
   * Renders today's tracked entries.
   * @returns {void}
   */
  function renderEntries() {
    const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
    list.innerHTML = "";
    if (!entries.length) {
      list.innerHTML = '<div class="empty">Noch keine Eintraege fuer heute.</div>';
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("article");
      item.className = "timetracking-item";

      const time = document.createElement("div");
      time.className = "timetracking-item-time";
      const type = String(entry?.type || "");
      if (type === "open_range") {
        time.textContent = `${entry.start || "?"} - jetzt`;
      } else if (type === "range") {
        time.textContent = `${entry.start || "?"} - ${entry.end || "?"}`;
      } else {
        time.textContent = String(entry?.total || "0m");
      }

      const text = document.createElement("div");
      text.className = "timetracking-item-text";
      text.textContent = String(entry?.summary || "(ohne Beschreibung)");

      const duration = document.createElement("div");
      duration.className = "timetracking-item-duration";
      if (type === "open_range") {
        const liveMins = openRangeRuntimeMins(snapshot?.date, String(entry?.start || ""));
        duration.textContent = `${formatMinutes(liveMins)} (laufend)`;
      } else {
        const mins = Number(entry?.total_mins || 0);
        duration.textContent = formatMinutes(mins);
      }

      item.appendChild(time);
      item.appendChild(text);
      item.appendChild(duration);
      list.appendChild(item);
    }
  }

  /**
   * Refreshes module data from backend snapshot endpoint.
   * @returns {Promise<void>}
   */
  async function refreshToday() {
    const response = await fetch("/api/timetracking/today");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Konnte Zeiterfassung nicht laden");
    }
    const payload = await response.json();
    snapshot = payload || {};
    renderSummary();
    renderEntries();
  }

  /**
   * Sends a control action to the backend and refreshes the local snapshot.
   * @param {"start"|"pause"|"stop"} action - Action endpoint suffix.
   * @param {object} [payload] - Optional JSON body.
   * @returns {Promise<void>}
   */
  async function runAction(action, payload = undefined) {
    setBusy(true);
    setStatus("Verarbeite Aktion...");
    try {
      const response = await fetch(`/api/timetracking/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {})
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Aktion ${action} fehlgeschlagen`);
      }
      const next = await response.json();
      snapshot = next || {};
      renderSummary();
      renderEntries();
      setStatus("Aktion erfolgreich.", "ok");
    } catch (error) {
      setStatus(error?.message || String(error), "err");
    } finally {
      setBusy(false);
    }
  }

  startBtn.addEventListener("click", () => {
    const summaryText = String(activityInput.value || "").trim();
    if (!summaryText) {
      setStatus("Bitte Aktivitaetsnamen eingeben.", "err");
      return;
    }
    void runAction("start", { summary: summaryText });
  });
  pauseBtn.addEventListener("click", () => void runAction("pause"));
  stopBtn.addEventListener("click", () => void runAction("stop"));
  refreshBtn.addEventListener("click", () => {
    setStatus("Lade Daten...");
    void refreshToday()
      .then(() => setStatus(""))
      .catch((error) => setStatus(error?.message || String(error), "err"));
  });
  activityInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      startBtn.click();
    }
  });

  try {
    await refreshToday();
    setStatus("");
  } catch (error) {
    setStatus(error?.message || String(error), "err");
  }

  pollTimer = setInterval(() => {
    if (destroyed) return;
    void refreshToday().catch(() => {});
  }, refreshSec * 1000);

  tickTimer = setInterval(() => {
    if (destroyed) return;
    if (snapshot?.active) renderEntries();
  }, 60 * 1000);

  return () => {
    destroyed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    shell.body.innerHTML = "";
  };
}
