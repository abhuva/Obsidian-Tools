/**
 * Renders the settings UI inside the homepage as an embedded panel.
 * @param {{body: HTMLElement}} shell - Module shell DOM nodes.
 * @returns {Promise<() => void>} Cleanup callback.
 */
export async function renderSettingsModule(shell) {
  const frame = document.createElement("iframe");
  frame.className = "settings-embed-frame";
  frame.src = "/settings.html";
  frame.title = "Homepage Settings";
  frame.loading = "lazy";
  frame.setAttribute("aria-label", "Homepage Settings");
  shell.body.appendChild(frame);

  return () => {
    shell.body.innerHTML = "";
  };
}

