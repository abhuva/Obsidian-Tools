const ECHARTS_SRC = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
let echartsLoaderPromise = null;

function loadEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsLoaderPromise) return echartsLoaderPromise;

  echartsLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ECHARTS_SRC;
    script.async = true;
    script.onload = () => {
      if (window.echarts) resolve(window.echarts);
      else reject(new Error("ECharts loaded without global object"));
    };
    script.onerror = () => reject(new Error("Could not load ECharts"));
    document.head.appendChild(script);
  });
  return echartsLoaderPromise;
}

function toPercentString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n.toFixed(2)}%`;
}

function toMsString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${Math.round(n)} ms`;
}

function toLocalTime(value) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) return "-";
  return new Date(t).toLocaleTimeString("de-DE", { hour12: false });
}

function severityClass(target) {
  if (!target?.latest) return "unknown";
  return target.latest.success ? "ok" : "down";
}

function statusLabelForLatest(latest) {
  if (latest?.success) return "UP";
  const code = String(latest?.sslIssue?.code || "");
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") return "SSL MISMATCH";
  if (code === "CERT_EXPIRED") return "CERT EXPIRED";
  return "DOWN";
}

function buildLatencySeries(targets) {
  return targets.map((target) => ({
    name: target.name,
    type: "line",
    showSymbol: false,
    smooth: true,
    connectNulls: false,
    data: (target.series || []).map((point) => [
      point.timestamp,
      point.success ? Number(point.responseTimeMs || 0) : null
    ])
  }));
}

function buildAvailabilityScatterData(targets) {
  const points = [];
  targets.forEach((target, idx) => {
    for (const point of target.series || []) {
      points.push({
        value: [point.timestamp, idx, point.success ? 1 : 0],
        statusCode: point.statusCode,
        responseTimeMs: point.responseTimeMs,
        targetName: target.name
      });
    }
  });
  return points;
}

async function fetchSnapshot(windowMinutes) {
  const qs = Number.isFinite(windowMinutes) ? `?windowMinutes=${windowMinutes}` : "";
  const response = await fetch(`/api/updo/snapshot${qs}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load monitoring snapshot");
  }
  return response.json();
}

export async function renderUpdoModule(shell, moduleSettings) {
  const refreshSec = Math.max(3, Number.parseInt(String(moduleSettings?.refreshSec || 5), 10) || 5);
  let windowMinutes = Math.max(
    5,
    Number.parseInt(String(moduleSettings?.windowMinutes || 60), 10) || 60
  );
  const pollMs = refreshSec * 1000;
  let pollTimer = null;
  let resizeObserver = null;
  let latencyChart = null;
  let availabilityChart = null;
  let destroyed = false;

  const controls = document.createElement("div");
  controls.className = "updo-toolbar";
  controls.innerHTML = `
    <div class="updo-window-buttons" role="group" aria-label="Zeitfenster">
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="15">15m</button>
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="60">1h</button>
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="360">6h</button>
    </div>
    <button type="button" class="btn btn-ghost" id="updoRefreshBtn">Neu laden</button>
  `;

  const meta = document.createElement("div");
  meta.className = "status";

  const cards = document.createElement("div");
  cards.className = "updo-cards";

  const chartWrap = document.createElement("div");
  chartWrap.className = "updo-chart-wrap";
  const latencyHost = document.createElement("div");
  latencyHost.className = "updo-chart updo-chart-latency";
  const availabilityHost = document.createElement("div");
  availabilityHost.className = "updo-chart updo-chart-availability";
  chartWrap.appendChild(latencyHost);
  chartWrap.appendChild(availabilityHost);

  shell.body.appendChild(controls);
  shell.body.appendChild(meta);
  shell.body.appendChild(cards);
  shell.body.appendChild(chartWrap);

  const windowButtons = Array.from(controls.querySelectorAll(".updo-window-btn"));
  const refreshBtn = controls.querySelector("#updoRefreshBtn");

  function applyWindowButtonState() {
    for (const btn of windowButtons) {
      const isActive = Number.parseInt(String(btn.dataset.window || ""), 10) === windowMinutes;
      btn.classList.toggle("updo-window-btn-active", isActive);
    }
  }

  function setMeta(text, state = "") {
    meta.textContent = text || "";
    meta.classList.remove("ok", "err");
    if (state === "ok") meta.classList.add("ok");
    if (state === "err") meta.classList.add("err");
  }

  function renderCards(targets) {
    cards.innerHTML = "";
    if (!targets.length) {
      cards.innerHTML = '<div class="empty">Keine Monitoring-Ziele konfiguriert.</div>';
      return;
    }

    for (const target of targets) {
      const card = document.createElement("article");
      card.className = `updo-card updo-card-${severityClass(target)}`;
      const latest = target.latest || {};
      const statusLabel = statusLabelForLatest(latest);
      const statusCode = Number.isInteger(latest.statusCode) ? latest.statusCode : "-";
      const issueText =
        latest?.sslIssue?.code === "ERR_TLS_CERT_ALTNAME_INVALID"
          ? "TLS: Zertifikat passt nicht zum Hostnamen."
          : String(latest?.sslIssue?.message || "").trim();
      card.innerHTML = `
        <div class="updo-card-name">${target.name}</div>
        <div class="updo-card-status">${statusLabel}</div>
        <div class="updo-card-grid">
          <div>Code: <strong>${statusCode}</strong></div>
          <div>Latency: <strong>${toMsString(latest.responseTimeMs)}</strong></div>
          <div>Uptime: <strong>${toPercentString(target?.stats?.uptimePercent)}</strong></div>
          <div>Last: <strong>${toLocalTime(latest.timestamp)}</strong></div>
        </div>
        ${issueText ? `<div class="updo-card-issue">${issueText}</div>` : ""}
      `;
      cards.appendChild(card);
    }
  }

  function updateCharts(snapshot) {
    const targets = Array.isArray(snapshot?.targets) ? snapshot.targets : [];
    if (!latencyChart || !availabilityChart) return;

    latencyChart.setOption(
      {
        animation: false,
        tooltip: {
          trigger: "axis",
          valueFormatter: (value) => (value == null ? "DOWN" : `${Math.round(value)} ms`)
        },
        legend: { top: 2, textStyle: { fontSize: 11 } },
        grid: { left: 46, right: 16, top: 32, bottom: 24 },
        xAxis: { type: "time" },
        yAxis: { type: "value", name: "ms" },
        series: buildLatencySeries(targets)
      },
      { notMerge: true }
    );

    availabilityChart.setOption(
      {
        animation: false,
        tooltip: {
          trigger: "item",
          formatter: (params) => {
            const data = params.data || {};
            const raw = Array.isArray(data.value) ? data.value : [];
            const ok = Number(raw[2]) === 1;
            const ts = raw[0] ? new Date(raw[0]).toLocaleString("de-DE", { hour12: false }) : "-";
            return `${data.targetName || "-"}<br/>${ts}<br/>${ok ? "UP" : "DOWN"}<br/>Code: ${data.statusCode ?? "-"}`;
          }
        },
        grid: { left: 100, right: 16, top: 8, bottom: 26 },
        xAxis: { type: "time" },
        yAxis: {
          type: "category",
          data: targets.map((target) => target.name),
          axisTick: { show: false }
        },
        series: [
          {
            type: "scatter",
            symbolSize: 8,
            data: buildAvailabilityScatterData(targets),
            itemStyle: {
              color: (params) => {
                const raw = Array.isArray(params?.data?.value) ? params.data.value : [];
                return Number(raw[2]) === 1 ? "#1b8e4a" : "#a42130";
              }
            }
          }
        ]
      },
      { notMerge: true }
    );
  }

  async function refreshOnce() {
    try {
      const snapshot = await fetchSnapshot(windowMinutes);
      if (destroyed) return;
      const targets = Array.isArray(snapshot?.targets) ? snapshot.targets : [];
      renderCards(targets);
      updateCharts(snapshot);
      const at = new Date(snapshot.generatedAt || Date.now()).toLocaleTimeString("de-DE", { hour12: false });
      const mismatchHosts = targets
        .filter((target) => target?.latest?.sslIssue?.code === "ERR_TLS_CERT_ALTNAME_INVALID")
        .map((target) => target.name);
      const mismatchText = mismatchHosts.length
        ? ` SSL-Mismatch: ${mismatchHosts.join(", ")}`
        : "";
      const msg = snapshot.error
        ? `Aktualisiert ${at}. Fehler: ${snapshot.error}${mismatchText}`
        : `Aktualisiert ${at}. Refresh: ${snapshot.refreshSec}s.${mismatchText}`;
      setMeta(msg, snapshot.error ? "err" : "ok");
    } catch (error) {
      setMeta(`Monitoring konnte nicht geladen werden: ${error.message || error}`, "err");
    }
  }

  for (const btn of windowButtons) {
    btn.addEventListener("click", () => {
      windowMinutes = Number.parseInt(String(btn.dataset.window || ""), 10) || 60;
      applyWindowButtonState();
      void refreshOnce();
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => void refreshOnce());
  }

  applyWindowButtonState();

  try {
    const echarts = await loadEcharts();
    if (destroyed) return () => {};
    latencyChart = echarts.init(latencyHost);
    availabilityChart = echarts.init(availabilityHost);
    resizeObserver = new ResizeObserver(() => {
      latencyChart?.resize();
      availabilityChart?.resize();
    });
    resizeObserver.observe(shell.root);
    await refreshOnce();
    pollTimer = setInterval(() => void refreshOnce(), pollMs);
  } catch (error) {
    setMeta(`ECharts konnte nicht geladen werden: ${error.message || error}`, "err");
    cards.innerHTML = '<div class="empty">Chart-Rendering ist momentan nicht verfuegbar.</div>';
  }

  return () => {
    destroyed = true;
    if (pollTimer) clearInterval(pollTimer);
    if (resizeObserver) resizeObserver.disconnect();
    latencyChart?.dispose();
    availabilityChart?.dispose();
    latencyChart = null;
    availabilityChart = null;
  };
}
