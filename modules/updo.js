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

async function fetchHistory(rangeDays) {
  const safeRange = Number.isFinite(rangeDays) ? rangeDays : 30;
  const response = await fetch(`/api/updo/history?rangeDays=${safeRange}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Could not load monitoring history");
  }
  return response.json();
}

function buildLongtermSeries(summaries, targets) {
  const byTargetId = new Map();
  for (const summary of summaries || []) {
    const targetId = String(summary?.targetId || "");
    if (!targetId) continue;
    if (!byTargetId.has(targetId)) byTargetId.set(targetId, []);
    byTargetId.get(targetId).push(summary);
  }

  const series = [];
  for (const target of targets || []) {
    const targetSummaries = (byTargetId.get(target.id) || [])
      .slice()
      .sort((a, b) => Date.parse(String(a?.windowEnd || "")) - Date.parse(String(b?.windowEnd || "")));
    series.push({
      name: `${target.name} avg`,
      type: "line",
      smooth: true,
      showSymbol: false,
      yAxisIndex: 0,
      data: targetSummaries.map((entry) => {
        const raw = entry?.latencyAvgMs;
        if (raw == null) return [entry.windowEnd, null];
        const value = Number(raw);
        return [entry.windowEnd, Number.isFinite(value) ? value : null];
      })
    });
    series.push({
      name: `${target.name} uptime`,
      type: "line",
      smooth: true,
      showSymbol: false,
      lineStyle: { type: "dashed", width: 1.6 },
      yAxisIndex: 1,
      data: targetSummaries.map((entry) => {
        const raw = entry?.uptimePercent;
        if (raw == null) return [entry.windowEnd, null];
        const value = Number(raw);
        return [entry.windowEnd, Number.isFinite(value) ? value : null];
      })
    });
  }
  return series;
}

function buildIncidentScatter(incidents) {
  return (incidents || [])
    .map((entry) => {
      const ts = String(entry?.start || "");
      if (!ts) return null;
      const type = String(entry?.type || "");
      const y = type === "spike" ? Number(entry?.peakMs ?? entry?.thresholdMs ?? 0) : 0;
      return {
        value: [ts, Number.isFinite(y) ? y : 0],
        incidentType: type,
        durationSec: Number(entry?.durationSec ?? 0)
      };
    })
    .filter(Boolean);
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
  let longtermChart = null;
  let destroyed = false;
  let longtermDays = 30;

  const controls = document.createElement("div");
  controls.className = "updo-toolbar";
  controls.innerHTML = `
    <div class="updo-window-buttons" role="group" aria-label="Zeitfenster">
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="15">15m</button>
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="60">1h</button>
      <button type="button" class="btn btn-ghost updo-window-btn" data-window="360">6h</button>
    </div>
    <div class="updo-window-buttons" role="group" aria-label="Langzeitfenster">
      <button type="button" class="btn btn-ghost updo-history-btn" data-range="7">7d</button>
      <button type="button" class="btn btn-ghost updo-history-btn" data-range="30">30d</button>
      <button type="button" class="btn btn-ghost updo-history-btn" data-range="90">90d</button>
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
  const longtermHost = document.createElement("div");
  longtermHost.className = "updo-chart updo-chart-longterm";
  chartWrap.appendChild(latencyHost);
  chartWrap.appendChild(availabilityHost);
  chartWrap.appendChild(longtermHost);

  shell.body.appendChild(controls);
  shell.body.appendChild(meta);
  shell.body.appendChild(cards);
  shell.body.appendChild(chartWrap);

  const windowButtons = Array.from(controls.querySelectorAll(".updo-window-btn"));
  const historyButtons = Array.from(controls.querySelectorAll(".updo-history-btn"));
  const refreshBtn = controls.querySelector("#updoRefreshBtn");

  function applyWindowButtonState() {
    for (const btn of windowButtons) {
      const isActive = Number.parseInt(String(btn.dataset.window || ""), 10) === windowMinutes;
      btn.classList.toggle("updo-window-btn-active", isActive);
    }
  }

  function applyHistoryButtonState() {
    for (const btn of historyButtons) {
      const isActive = Number.parseInt(String(btn.dataset.range || ""), 10) === longtermDays;
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

      const nameEl = document.createElement("div");
      nameEl.className = "updo-card-name";
      nameEl.textContent = String(target?.name || "-");
      card.appendChild(nameEl);

      const statusEl = document.createElement("div");
      statusEl.className = "updo-card-status";
      statusEl.textContent = statusLabel;
      card.appendChild(statusEl);

      const gridEl = document.createElement("div");
      gridEl.className = "updo-card-grid";
      const metrics = [
        ["Code", String(statusCode)],
        ["Latency", toMsString(latest.responseTimeMs)],
        ["Uptime", toPercentString(target?.stats?.uptimePercent)],
        ["Last", toLocalTime(latest.timestamp)]
      ];
      for (const [label, value] of metrics) {
        const rowEl = document.createElement("div");
        rowEl.append(`${label}: `);
        const strongEl = document.createElement("strong");
        strongEl.textContent = value;
        rowEl.appendChild(strongEl);
        gridEl.appendChild(rowEl);
      }
      card.appendChild(gridEl);

      if (issueText) {
        const issueEl = document.createElement("div");
        issueEl.className = "updo-card-issue";
        issueEl.textContent = issueText;
        card.appendChild(issueEl);
      }
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

  function updateLongtermChart(snapshot, history) {
    if (!longtermChart) return;
    const targets = Array.isArray(snapshot?.targets) ? snapshot.targets : [];
    const summaries = Array.isArray(history?.summaries) ? history.summaries : [];
    const incidents = Array.isArray(history?.incidents) ? history.incidents : [];

    longtermChart.setOption(
      {
        animation: false,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "cross" }
        },
        legend: { top: 2, textStyle: { fontSize: 11 } },
        grid: { left: 46, right: 42, top: 32, bottom: 24 },
        xAxis: { type: "time" },
        yAxis: [
          { type: "value", name: "avg ms", min: 0 },
          { type: "value", name: "uptime %", min: 0, max: 100 }
        ],
        series: [
          ...buildLongtermSeries(summaries, targets),
          {
            name: "Incidents",
            type: "scatter",
            yAxisIndex: 0,
            symbolSize: 9,
            data: buildIncidentScatter(incidents),
            tooltip: {
              trigger: "item",
              formatter: (params) => {
                const data = params?.data || {};
                const tsRaw = Array.isArray(data.value) ? data.value[0] : null;
                const ts = tsRaw ? new Date(tsRaw).toLocaleString("de-DE", { hour12: false }) : "-";
                const incidentType = String(data.incidentType || "incident").toUpperCase();
                return `${incidentType}<br/>${ts}<br/>Dauer: ${Math.round(Number(data.durationSec || 0))}s`;
              }
            },
            itemStyle: {
              color: (params) => {
                const type = String(params?.data?.incidentType || "");
                if (type === "outage") return "#a42130";
                if (type === "spike") return "#d17a00";
                return "#365f9c";
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
      const [snapshot, history] = await Promise.all([
        fetchSnapshot(windowMinutes),
        fetchHistory(longtermDays)
      ]);
      if (destroyed) return;
      const targets = Array.isArray(snapshot?.targets) ? snapshot.targets : [];
      renderCards(targets);
      updateCharts(snapshot);
      updateLongtermChart(snapshot, history);
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
  for (const btn of historyButtons) {
    btn.addEventListener("click", () => {
      longtermDays = Number.parseInt(String(btn.dataset.range || ""), 10) || 30;
      applyHistoryButtonState();
      void refreshOnce();
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => void refreshOnce());
  }

  applyWindowButtonState();
  applyHistoryButtonState();

  try {
    const echarts = await loadEcharts();
    if (destroyed) return () => {};
    latencyChart = echarts.init(latencyHost);
    availabilityChart = echarts.init(availabilityHost);
    longtermChart = echarts.init(longtermHost);
    resizeObserver = new ResizeObserver(() => {
      latencyChart?.resize();
      availabilityChart?.resize();
      longtermChart?.resize();
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
    longtermChart?.dispose();
    latencyChart = null;
    availabilityChart = null;
    longtermChart = null;
  };
}
