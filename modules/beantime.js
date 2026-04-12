/**
 * Renders Beantime timer controls (start/stop with account + summary).
 * @param {{body: HTMLElement}} shell - Module shell DOM nodes.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderBeantimeModule(shell) {
  let running = false;

  const controls = document.createElement("div");
  controls.className = "beantime-controls";
  controls.innerHTML = `
    <div class="field-row">
      <label for="beantimeAccount">Konto</label>
      <select id="beantimeAccount" class="input"></select>
    </div>
    <div class="field-row">
      <label for="beantimeSummary">Summary</label>
      <input id="beantimeSummary" class="input" type="text" placeholder="Kurze Beschreibung..." />
    </div>
    <div class="beantime-btn-row">
      <button type="button" class="btn btn-primary" id="beantimeStartBtn">Start</button>
      <button type="button" class="btn btn-ghost" id="beantimeStopBtn">Stop</button>
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
  const summaryInput = controls.querySelector("#beantimeSummary");
  const startBtn = controls.querySelector("#beantimeStartBtn");
  const stopBtn = controls.querySelector("#beantimeStopBtn");
  const reloadBtn = controls.querySelector("#beantimeReloadBtn");

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
   * Updates button disabled states from running snapshot.
   * @returns {void}
   */
  function syncButtons() {
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    accountSelect.disabled = running;
  }

  /**
   * Renders static module info text.
   * @param {object} meta - Beantime metadata payload.
   * @returns {void}
   */
  function renderInfo(meta) {
    const file = String(meta?.file || "").trim();
    const person = String(meta?.personAccount || "").trim();
    const startIso = String(meta?.running?.startedAt || "").trim();
    const activeText = startIso ? `Aktiv seit ${startIso}` : "Kein laufender Timer";
    info.innerHTML = `
      <span><strong>Datei:</strong> ${file || "-"}</span>
      <span><strong>Person:</strong> ${person || "-"}</span>
      <span><strong>Status:</strong> ${activeText}</span>
    `;
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
    const accounts = Array.isArray(meta?.accounts) ? meta.accounts : [];
    running = Boolean(meta?.running);
    accountSelect.innerHTML = "";
    for (const account of accounts) {
      const option = document.createElement("option");
      option.value = String(account || "");
      option.textContent = String(account || "");
      accountSelect.appendChild(option);
    }
    if (!accounts.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Keine buchbaren Konten gefunden";
      accountSelect.appendChild(option);
    }
    if (meta?.running?.account) {
      accountSelect.value = String(meta.running.account);
    }
    if (meta?.running?.summary) {
      summaryInput.value = String(meta.running.summary);
    }
    renderInfo(meta);
    syncButtons();
  }

  /**
   * Executes start action via backend API.
   * @returns {Promise<void>}
   */
  async function startTimer() {
    const account = String(accountSelect.value || "").trim();
    const summary = String(summaryInput.value || "").trim();
    if (!account) {
      setStatus("Bitte ein Konto auswaehlen.", "err");
      return;
    }
    setStatus("Starte Timer...");
    const response = await fetch("/api/beantime/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, summary })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Start fehlgeschlagen");
    }
    await loadMeta();
    setStatus("Timer gestartet.", "ok");
  }

  /**
   * Executes stop action and appends finalized entry to Beancount.
   * @returns {Promise<void>}
   */
  async function stopTimer() {
    setStatus("Stoppe Timer...");
    const response = await fetch("/api/beantime/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Stop fehlgeschlagen");
    }
    summaryInput.value = "";
    await loadMeta();
    setStatus("Timer gestoppt und Eintrag gebucht.", "ok");
  }

  startBtn.addEventListener("click", () => {
    void startTimer().catch((error) => setStatus(error?.message || String(error), "err"));
  });
  stopBtn.addEventListener("click", () => {
    void stopTimer().catch((error) => setStatus(error?.message || String(error), "err"));
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
    shell.body.innerHTML = "";
  };
}

