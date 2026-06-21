/**
 * Renders the VaultGraph tool as an embedded local-server page.
 * @param {{head: HTMLElement, body: HTMLElement}} shell - Module shell returned by homepage renderer.
 * @param {{url?: string}} moduleSettings - Module settings from effective config.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderVaultGraphModule(shell, moduleSettings) {
  const url = String(moduleSettings?.url || "http://127.0.0.1:4175/vault-graph.html").trim();

  const actions = document.createElement("div");
  actions.className = "module-head-actions";

  const openLink = document.createElement("a");
  openLink.className = "module-head-icon-btn";
  openLink.href = url;
  openLink.target = "_blank";
  openLink.rel = "noreferrer";
  openLink.title = "VaultGraph in neuem Tab oeffnen";
  openLink.setAttribute("aria-label", "VaultGraph in neuem Tab oeffnen");
  openLink.textContent = "↗";
  actions.appendChild(openLink);
  shell.head.appendChild(actions);

  const hint = document.createElement("p");
  hint.className = "module-copy vaultgraph-hint";
  hint.textContent = "Laedt VaultGraph vom lokalen Preview-Server. Falls nichts erscheint: VaultGraph preview starten.";

  const frame = document.createElement("iframe");
  frame.className = "vaultgraph-embed-frame";
  frame.src = url;
  frame.title = "VaultGraph";
  frame.loading = "lazy";
  frame.setAttribute("aria-label", "VaultGraph");

  shell.body.classList.add("vaultgraph-module-body");
  shell.body.appendChild(hint);
  shell.body.appendChild(frame);

  return () => {
    shell.body.classList.remove("vaultgraph-module-body");
    shell.body.innerHTML = "";
    actions.remove();
  };
}
