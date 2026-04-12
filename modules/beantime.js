/**
 * Renders Beantime timer controls (start/stop with account + person + summary).
 * @param {{body: HTMLElement}} shell - Module shell DOM nodes.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderBeantimeModule(shell) {
  let running = false;
  let isStarting = false;
  let isStopping = false;

  const controls = document.createElement("div");
  controls.className = "beantime-controls";
  controls.innerHTML = `
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
  const personSelect = controls.querySelector("#beantimePerson");
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
   * Updates button disabled states from running snapshot.
   * @returns {void}
   */
  function syncButtons() {
    startBtn.disabled = running || isStarting || isStopping;
    stopBtn.disabled = !running || isStarting || isStopping;
    accountSelect.disabled = running;
    personSelect.disabled = running;
    summaryInput.disabled = running;
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
    const activeText = startIso ? `Aktiv seit ${startIso}` : "Kein laufender Timer";
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

    running = Boolean(meta?.running);
    fillSelect(accountSelect, accounts, "Keine buchbaren Konten gefunden");
    fillSelect(personSelect, people, "Keine Personenkonten gefunden");

    if (meta?.running?.account) {
      setOrAppendSelectValue(accountSelect, String(meta.running.account));
    }
    if (meta?.running?.personAccount) {
      setOrAppendSelectValue(personSelect, String(meta.running.personAccount));
    } else if (meta?.personAccount) {
      setOrAppendSelectValue(personSelect, String(meta.personAccount));
    }
    if (meta?.running) {
      summaryInput.value = String(meta.running.summary ?? "");
    }

    renderInfo(meta);
    syncButtons();
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
    syncButtons();
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
      syncButtons();
    }
  }

  /**
   * Executes stop action and appends finalized entry to Beancount.
   * @returns {Promise<void>}
   */
  async function stopTimer() {
    if (isStarting || isStopping) return;
    isStopping = true;
    syncButtons();
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
      summaryInput.value = "";
      await loadMeta();
      setStatus(response.status === 409 ? "Kein laufender Timer." : "Timer gestoppt und Eintrag gebucht.", "ok");
    } finally {
      isStopping = false;
      syncButtons();
    }
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
