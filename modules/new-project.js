function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function buildFolderPreview({ year, society, fundingCode, title, projectType }) {
  const cleanYear = String(year || "").trim();
  const cleanSociety = cleanText(society).toUpperCase();
  const cleanTitle = cleanText(title);
  const cleanFunding = cleanText(fundingCode);
  const cleanType = String(projectType || "").trim().toLowerCase();
  if (!cleanYear || !cleanSociety || !cleanTitle) return "";
  if (cleanType === "funding") {
    if (!cleanFunding || cleanFunding === "-") return "";
    return `${cleanYear} ${cleanSociety} ${cleanFunding} - ${cleanTitle}`;
  }
  return `${cleanYear} ${cleanSociety} - ${cleanTitle}`;
}

export async function renderNewProjectModule(shell, moduleSettings) {
  let meta = null;
  const openInNewTab = moduleSettings?.openInNewTab !== false;

  const intro = document.createElement("p");
  intro.className = "module-copy";
  intro.textContent = "Neues Projekt mit Template, Frontmatter und korrektem Ordnernamen anlegen.";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn btn-primary";
  openBtn.textContent = "Neues Projekt anlegen";

  const status = document.createElement("div");
  status.className = "status";

  shell.body.appendChild(intro);
  shell.body.appendChild(openBtn);
  shell.body.appendChild(status);

  function setStatus(text, state) {
    status.textContent = text || "";
    status.classList.remove("ok", "err");
    if (state === "ok") status.classList.add("ok");
    if (state === "err") status.classList.add("err");
  }

  async function fetchMeta() {
    const response = await fetch("/api/projects/meta");
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Projekt-Metadaten konnten nicht geladen werden");
    }
    const payload = await response.json();
    return payload || {};
  }

  async function createProject(payload) {
    const response = await fetch("/api/projects/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Projekt konnte nicht angelegt werden");
    }
    return response.json();
  }

  function createLabeledField(labelText, inputEl) {
    const wrap = document.createElement("label");
    wrap.className = "new-project-field";
    const label = document.createElement("span");
    label.className = "new-project-label";
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "new-project-modal-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("div");
    dialog.className = "new-project-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "new-project-head";
    const title = document.createElement("h3");
    title.textContent = "Neues Projekt erstellen";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "module-head-icon-btn";
    closeBtn.textContent = "x";
    closeBtn.setAttribute("aria-label", "Schliessen");
    head.appendChild(title);
    head.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "new-project-body";
    const formGrid = document.createElement("div");
    formGrid.className = "new-project-grid";

    const yearInput = document.createElement("input");
    yearInput.className = "input";
    yearInput.type = "number";
    yearInput.min = "2000";
    yearInput.max = "2100";
    yearInput.step = "1";

    const societySelect = document.createElement("select");
    societySelect.className = "input";

    const typeSelect = document.createElement("select");
    typeSelect.className = "input";

    const fundingInput = document.createElement("input");
    fundingInput.className = "input";
    fundingInput.type = "text";
    fundingInput.placeholder = "z. B. BKJ";
    fundingInput.setAttribute("list", "projectFundingHints");
    const fundingHints = document.createElement("datalist");
    fundingHints.id = "projectFundingHints";

    const titleInput = document.createElement("input");
    titleInput.className = "input";
    titleInput.type = "text";
    titleInput.placeholder = "Projektname";

    const preview = document.createElement("div");
    preview.className = "new-project-preview";

    const formStatus = document.createElement("div");
    formStatus.className = "status";

    const actions = document.createElement("div");
    actions.className = "new-project-actions";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "btn btn-primary";
    createBtn.textContent = "Erstellen";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-ghost";
    cancelBtn.textContent = "Abbrechen";
    actions.appendChild(createBtn);
    actions.appendChild(cancelBtn);

    formGrid.appendChild(createLabeledField("Jahr", yearInput));
    formGrid.appendChild(createLabeledField("Verein", societySelect));
    formGrid.appendChild(createLabeledField("Projektart", typeSelect));
    formGrid.appendChild(createLabeledField("Foerderkuerzel", fundingInput));
    const titleField = createLabeledField("Projekt-Titel", titleInput);
    titleField.classList.add("new-project-field-full");
    formGrid.appendChild(titleField);
    body.appendChild(formGrid);
    body.appendChild(preview);
    body.appendChild(formStatus);
    body.appendChild(actions);

    dialog.appendChild(head);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    overlay.appendChild(fundingHints);

    document.body.appendChild(overlay);

    function updateFundingState() {
      const funding = String(typeSelect.value || "").toLowerCase() === "funding";
      fundingInput.disabled = !funding;
      if (!funding) fundingInput.value = "-";
      if (funding && fundingInput.value === "-") fundingInput.value = "";
    }

    function updatePreview() {
      const folderName = buildFolderPreview({
        year: yearInput.value,
        society: societySelect.value,
        fundingCode: fundingInput.value,
        title: titleInput.value,
        projectType: typeSelect.value
      });
      preview.textContent = folderName
        ? `Ordner/Datei: ${folderName}`
        : "Ordner/Datei: Bitte Pflichtfelder ausfuellen";
    }

    function setFormStatus(text, state) {
      formStatus.textContent = text || "";
      formStatus.classList.remove("ok", "err");
      if (state === "ok") formStatus.classList.add("ok");
      if (state === "err") formStatus.classList.add("err");
    }

    function show() {
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      setFormStatus("");
      updatePreview();
      titleInput.focus();
    }

    function hide() {
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }

    function hydrateFromMeta(data) {
      const now = new Date();
      const years = Array.isArray(data?.options?.years) ? data.options.years : [];
      const societies = Array.isArray(data?.options?.societies) ? data.options.societies : [];
      const types = Array.isArray(data?.options?.types) ? data.options.types : [];
      const fundingCodes = Array.isArray(data?.options?.fundingCodes) ? data.options.fundingCodes : [];

      yearInput.value = String((years[0] && years[0].value) || now.getFullYear());

      societySelect.innerHTML = "";
      for (const item of societies) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.value;
        societySelect.appendChild(option);
      }
      if (!societySelect.options.length) {
        const option = document.createElement("option");
        option.value = "NICA";
        option.textContent = "NICA";
        societySelect.appendChild(option);
      }

      typeSelect.innerHTML = "";
      for (const item of types) {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.value;
        typeSelect.appendChild(option);
      }
      if (!typeSelect.options.length) {
        const option = document.createElement("option");
        option.value = "funding";
        option.textContent = "funding";
        typeSelect.appendChild(option);
      }

      fundingHints.innerHTML = "";
      for (const item of fundingCodes) {
        const option = document.createElement("option");
        option.value = item.value;
        fundingHints.appendChild(option);
      }

      typeSelect.value = "funding";
      fundingInput.value = "";
      updateFundingState();
      updatePreview();
    }

    closeBtn.addEventListener("click", hide);
    cancelBtn.addEventListener("click", hide);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) hide();
    });
    document.addEventListener("keydown", (event) => {
      if (overlay.hidden) return;
      if (event.key === "Escape") hide();
    });

    yearInput.addEventListener("input", updatePreview);
    societySelect.addEventListener("change", updatePreview);
    typeSelect.addEventListener("change", () => {
      updateFundingState();
      updatePreview();
    });
    fundingInput.addEventListener("input", updatePreview);
    titleInput.addEventListener("input", updatePreview);

    createBtn.addEventListener("click", async () => {
      const payload = {
        year: Number.parseInt(String(yearInput.value || ""), 10),
        society: cleanText(societySelect.value).toUpperCase(),
        fundingCode: cleanText(fundingInput.value),
        title: cleanText(titleInput.value),
        projectType: cleanText(typeSelect.value).toLowerCase(),
        openInNewTab
      };

      if (!payload.title) {
        setFormStatus("Projekt-Titel fehlt.", "err");
        return;
      }
      if (!payload.year || payload.year < 2000 || payload.year > 2100) {
        setFormStatus("Jahr ist ungueltig.", "err");
        return;
      }
      if (payload.projectType === "funding" && (!payload.fundingCode || payload.fundingCode === "-")) {
        setFormStatus("Foerderkuerzel fehlt.", "err");
        return;
      }

      setFormStatus("Projekt wird erstellt...");
      createBtn.disabled = true;
      try {
        const result = await createProject(payload);
        setFormStatus(`Erstellt: ${result.folderName}`, "ok");
        setStatus(`Projekt erstellt: ${result.folderName}`, "ok");
        hide();
      } catch (error) {
        setFormStatus(error.message || String(error), "err");
      } finally {
        createBtn.disabled = false;
      }
    });

    return {
      show,
      hide,
      hydrateFromMeta,
      destroy() {
        overlay.remove();
      }
    };
  }

  const modal = buildModal();

  setStatus("Lade Projekt-Metadaten...");
  try {
    meta = await fetchMeta();
    modal.hydrateFromMeta(meta);
    setStatus("");
  } catch (error) {
    setStatus(`Konnte Metadaten nicht laden: ${error.message || error}`, "err");
  }

  openBtn.addEventListener("click", () => {
    if (!meta) {
      setStatus("Metadaten fehlen. Bitte Modul neu laden.", "err");
      return;
    }
    modal.show();
  });

  return () => {
    modal.destroy();
  };
}
