/**
 * Renders a live clock into a target element.
 * @param {HTMLElement|null} targetEl - Element that should display the time.
 * @param {{showSeconds?: boolean, hour12?: boolean}} moduleSettings - Clock rendering options.
 * @returns {() => void} Cleanup callback that clears interval and text content.
 */
export function renderClockInElement(targetEl, moduleSettings) {
  if (!targetEl) return () => {};
  const showSeconds = Boolean(moduleSettings?.showSeconds);
  const hour12 = Boolean(moduleSettings?.hour12);

  /**
   * Updates the clock text with current local time.
   * @returns {void}
   */
  function tick() {
    const now = new Date();
    targetEl.textContent = now.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: showSeconds ? "2-digit" : undefined,
      hour12
    });
  }

  tick();
  const intervalId = setInterval(tick, 1000);
  return () => {
    clearInterval(intervalId);
    targetEl.textContent = "";
  };
}
