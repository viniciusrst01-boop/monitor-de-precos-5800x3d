const app = {
  data: null,
  lastAlertIds: new Set(),
  chartDays: 40,
  pollingHandle: null
};

const currencyFormatterCache = new Map();
const sourceColors = ["#00a8a8", "#2563eb", "#b7791f", "#b42318", "#7c3aed", "#18794e"];

const elements = {
  chipCanvas: document.querySelector("#chipCanvas"),
  statusLine: document.querySelector("#statusLine"),
  scanButton: document.querySelector("#scanButton"),
  refreshButton: document.querySelector("#refreshButton"),
  bestPrice: document.querySelector("#bestPrice"),
  bestPriceMeta: document.querySelector("#bestPriceMeta"),
  activeSources: document.querySelector("#activeSources"),
  sourceHealth: document.querySelector("#sourceHealth"),
  lastScan: document.querySelector("#lastScan"),
  scanCadence: document.querySelector("#scanCadence"),
  openAlerts: document.querySelector("#openAlerts"),
  markAlertsRead: document.querySelector("#markAlertsRead"),
  priceChart: document.querySelector("#priceChart"),
  emptyChart: document.querySelector("#emptyChart"),
  chartReadouts: document.querySelector("#chartReadouts"),
  priceInsightCard: document.querySelector("#priceInsightCard"),
  rangeTabs: document.querySelector("#rangeTabs"),
  sourceForm: document.querySelector("#sourceForm"),
  settingsForm: document.querySelector("#settingsForm"),
  notifyButton: document.querySelector("#notifyButton"),
  sourcesList: document.querySelector("#sourcesList"),
  alertsList: document.querySelector("#alertsList"),
  eventsList: document.querySelector("#eventsList"),
  strictModeBadge: document.querySelector("#strictModeBadge"),
  internationalList: document.querySelector("#internationalList"),
  sourceTemplate: document.querySelector("#sourceTemplate")
};

function formatCurrency(value, currency) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const key = currency || "BRL";
  if (!currencyFormatterCache.has(key)) {
    currencyFormatterCache.set(
      key,
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: key,
        maximumFractionDigits: 2
      })
    );
  }
  return currencyFormatterCache.get(key).format(Number(value));
}

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeDate(value) {
  if (!value) return "nunca";
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  if (diff < minute) return "agora";
  if (diff < hour) return `${Math.floor(diff / minute)} min atrás`;
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} h atrás`;
  return formatDate(value);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Falha na API");
  }
  return payload;
}

async function loadState({ silent = false } = {}) {
  if (!silent) elements.statusLine.textContent = "Atualizando painel...";
  const data = await api("/api/state");
  const previousAlertIds = new Set(app.lastAlertIds);
  app.data = data;
  app.lastAlertIds = new Set(data.alerts.map((alert) => alert.id));
  render();
  maybeNotifyNewAlerts(previousAlertIds, data.alerts);
}

function acceptedHistory() {
  return (app.data?.history || []).filter((entry) => entry.accepted && entry.price);
}

function latestAcceptedBySource() {
  const latest = new Map();
  for (const entry of acceptedHistory()) {
    const current = latest.get(entry.sourceId);
    if (!current || new Date(entry.checkedAt) > new Date(current.checkedAt)) {
      latest.set(entry.sourceId, entry);
    }
  }
  return [...latest.values()];
}

function render() {
  if (!app.data) return;
  renderMetrics();
  renderSettings();
  renderChart();
  renderSources();
  renderAlerts();
  renderEvents();
  renderInternationalTrends();
  drawChip();
}

function renderMetrics() {
  const sources = app.data.sources || [];
  const latest = latestAcceptedBySource();
  const active = sources.filter((source) => source.active !== false);
  const openAlerts = (app.data.alerts || []).filter((alert) => !alert.read);
  const best = latest.reduce((winner, entry) => (!winner || entry.price < winner.price ? entry : winner), null);

  elements.bestPrice.textContent = best ? formatCurrency(best.price, best.currency) : "--";
  elements.bestPriceMeta.textContent = best
    ? `${sourceName(best.sourceId)} · ${relativeDate(best.checkedAt)}`
    : "Sem leituras ainda";

  elements.activeSources.textContent = `${active.length}/${sources.length}`;
  const errors = active.filter((source) => source.lastStatus === "error" && !isLocalCollectorState(source)).length;
  const mismatches = active.filter((source) => {
    const latest = latestForSource(source.id);
    return (
      !isLocalCollectorState(source) &&
      ["wrong_product", "base_model_unconfirmed", "not_matched", "no_price"].includes(source.lastStatus)
    );
  }).length;
  elements.sourceHealth.textContent = errors
    ? `${errors} com erro`
    : mismatches
      ? `${mismatches} exigem revisão`
      : active.length
        ? "Fontes prontas"
        : "Nenhuma fonte ativa";

  elements.lastScan.textContent = formatDate(app.data.settings.lastScanFinishedAt);
  elements.scanCadence.textContent = app.data.settings.autoScan
    ? `A cada ${app.data.settings.intervalMinutes} min`
    : "Varredura manual";
  elements.openAlerts.textContent = String(openAlerts.length);
  elements.statusLine.textContent = app.data.scanInProgress
    ? "Verificação em andamento..."
    : `${acceptedHistory().length} leituras aceitas no histórico`;
  elements.scanButton.disabled = Boolean(app.data.scanInProgress);
  elements.strictModeBadge.textContent = app.data.settings.requireAnniversarySignals
    ? "Modo rígido"
    : "Aceita 5800X3D base";
  elements.strictModeBadge.className = `status-pill ${
    app.data.settings.requireAnniversarySignals ? "success" : "warning"
  }`;
}

function renderSettings() {
  const settings = app.data.settings;
  elements.settingsForm.autoScan.checked = Boolean(settings.autoScan);
  elements.settingsForm.requireAnniversarySignals.checked = Boolean(settings.requireAnniversarySignals);
  elements.settingsForm.intervalMinutes.value = settings.intervalMinutes || 60;
  elements.settingsForm.webhookUrl.value = settings.webhookUrl || "";
}

function renderSources() {
  elements.sourcesList.innerHTML = "";
  const sources = app.data.sources || [];
  if (!sources.length) {
    elements.sourcesList.innerHTML = '<div class="empty-state">Nenhuma loja monitorada.</div>';
    return;
  }

  for (const source of sources) {
    const row = elements.sourceTemplate.content.firstElementChild.cloneNode(true);
    const latest = latestForSource(source.id);
    const title = row.querySelector("h3");
    const badge = row.querySelector(".status-pill");
    const link = row.querySelector("a");
    const subtitle = row.querySelector(".source-subtitle");
    const form = row.querySelector(".source-controls");

    title.textContent = source.store;
    const localCollectorState = isLocalCollectorState(source);
    const waitingForLocalCollector = localCollectorState && !latest;
    badge.textContent = localCollectorState ? (latest ? "via coletor" : "coletor local") : statusLabel(source.lastStatus);
    badge.className = `status-pill ${localCollectorState ? (latest ? "success" : "warning") : statusTone(source.lastStatus)}`;
    link.href = source.url;
    link.textContent = source.url;
    form.targetPrice.value = source.targetPrice || "";
    form.active.checked = source.active !== false;
    form.dataset.sourceId = source.id;

    const currentPrice = waitingForLocalCollector
      ? "aguardando coletor local"
      : latest
      ? `${formatCurrency(latest.price, latest.currency)} · ${stockLabel(latest.stockStatus)}`
      : "sem preço aceito";
    const checked = source.lastCheckedAt ? `verificado ${relativeDate(source.lastCheckedAt)}` : "não verificado";
    const titleText = source.lastTitle ? ` · ${source.lastTitle}` : "";
    subtitle.textContent = `${currentPrice} · ${checked}${titleText}`;

    row.querySelector(".scan-source").addEventListener("click", () => scanSource(source.id));
    row.querySelector(".delete-source").addEventListener("click", () => deleteSource(source.id));
    form.addEventListener("submit", (event) => saveSource(event, source));
    elements.sourcesList.append(row);
  }
}

function isWaitingForLocalCollector(source, latest) {
  return !latest && isLocalCollectorState(source);
}

function isLocalCollectorState(source) {
  return source.localCollector === true && ["error", "no_price"].includes(source.lastStatus);
}

function latestForSource(sourceId) {
  return acceptedHistory()
    .filter((entry) => entry.sourceId === sourceId)
    .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))[0];
}

function sourceName(sourceId) {
  return app.data.sources.find((source) => source.id === sourceId)?.store || "Fonte";
}

function statusLabel(status) {
  return (
    {
      ok: "aceita",
      no_price: "sem preço",
      error: "erro",
      wrong_product: "produto errado",
      base_model_unconfirmed: "sem 10 anos",
      not_matched: "sem match",
      undefined: "pendente",
      null: "pendente"
    }[status] || "pendente"
  );
}

function statusTone(status) {
  if (status === "ok") return "success";
  if (status === "error" || status === "wrong_product") return "danger";
  if (status === "base_model_unconfirmed" || status === "not_matched" || status === "no_price") return "warning";
  return "neutral";
}

function stockLabel(status) {
  return (
    {
      in_stock: "em estoque",
      out_of_stock: "sem estoque",
      preorder: "pré-venda",
      unknown: "estoque incerto"
    }[status] || "estoque incerto"
  );
}

function renderAlerts() {
  elements.alertsList.innerHTML = "";
  const alerts = app.data.alerts || [];
  if (!alerts.length) {
    elements.alertsList.innerHTML = '<div class="empty-state">Nenhum alerta disparado.</div>';
    return;
  }

  for (const alert of alerts.slice(0, 12)) {
    const item = document.createElement("article");
    item.className = `activity-item ${alert.read ? "" : "success"}`;
    item.innerHTML = `
      <strong>${escapeHtml(alert.store)} · ${formatCurrency(alert.price, alert.currency)}</strong>
      <span>${relativeDate(alert.createdAt)} · alvo ${formatCurrency(alert.targetPrice, alert.currency)}</span>
      <p>${escapeHtml(alert.reason || "")}</p>
    `;
    elements.alertsList.append(item);
  }
}

function renderEvents() {
  elements.eventsList.innerHTML = "";
  const events = app.data.events || [];
  if (!events.length) {
    elements.eventsList.innerHTML = '<div class="empty-state">Nenhum evento recente.</div>';
    return;
  }

  for (const event of events.slice(0, 14)) {
    const item = document.createElement("article");
    item.className = `activity-item ${event.tone || ""}`;
    item.innerHTML = `
      <strong>${escapeHtml(event.message)}</strong>
      <span>${relativeDate(event.createdAt)}</span>
    `;
    elements.eventsList.append(item);
  }
}

function renderInternationalTrends() {
  elements.internationalList.innerHTML = "";
  const sources = app.data.internationalSources || [];
  if (!sources.length) {
    elements.internationalList.innerHTML = '<div class="empty-state">Nenhuma fonte internacional configurada.</div>';
    return;
  }

  for (const source of sources) {
    const entries = internationalEntriesForSource(source.id);
    const latest = entries[entries.length - 1];
    const previous = entries[entries.length - 2];
    const trend = calculateTrend(latest, previous);
    const item = document.createElement("article");
    item.className = "international-item";

    item.innerHTML = `
      <div class="source-title-row">
        <h3>${escapeHtml(source.store)}</h3>
        <span class="status-pill ${statusTone(source.lastStatus)}">${statusLabel(source.lastStatus)}</span>
      </div>
      <div class="international-price-row">
        <span class="international-price">${latest ? formatCurrency(latest.price, latest.currency) : "--"}</span>
        <strong class="${trend.className}">${trend.label}</strong>
      </div>
      <span class="international-meta">${latest ? `${relativeDate(latest.checkedAt)} · ${stockLabel(latest.stockStatus)}` : "sem leitura aceita"}</span>
      <a class="international-meta" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a>
    `;
    elements.internationalList.append(item);
  }
}

function internationalEntriesForSource(sourceId) {
  return (app.data.internationalHistory || [])
    .filter((entry) => entry.accepted && entry.price && entry.sourceId === sourceId)
    .sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
}

function calculateTrend(latest, previous) {
  if (!latest || !previous) {
    return { label: "primeira leitura", className: "trend-flat" };
  }
  const delta = Number(latest.price) - Number(previous.price);
  if (Math.abs(delta) < 0.01) {
    return { label: "estável", className: "trend-flat" };
  }
  const percent = Math.abs((delta / Number(previous.price)) * 100);
  return {
    label: `${delta > 0 ? "subiu" : "caiu"} ${percent.toLocaleString("pt-BR", {
      maximumFractionDigits: 1
    })}%`,
    className: delta > 0 ? "trend-up" : "trend-down"
  };
}

function renderChart() {
  const canvas = elements.priceChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(640, Math.floor(rect.width * dpr));
  canvas.height = Math.floor(320 * dpr);
  ctx.scale(dpr, dpr);

  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const padding = { top: 30, right: 38, bottom: 48, left: 82 };
  const entries = priceSeriesForCurrentRange();

  ctx.clearRect(0, 0, width, height);
  drawCleanGrid(ctx, width, height, padding);
  elements.emptyChart.style.display = entries.length ? "none" : "grid";
  if (!entries.length) {
    renderChartDetails([]);
    renderInsightCard(null, []);
    return;
  }

  const minTime = new Date(entries[0].checkedAt).getTime();
  const maxTime = new Date(entries[entries.length - 1].checkedAt).getTime();
  const useSequenceScale = entries.length > 1 && maxTime - minTime < 60 * 60 * 1000;
  const prices = entries.map((entry) => Number(entry.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minEntry = entries.reduce((winner, entry) => (Number(entry.price) < Number(winner.price) ? entry : winner), entries[0]);
  const yMin = Math.max(0, Math.floor((minPrice * 0.84) / 50) * 50);
  const yMax = Math.ceil((maxPrice * 1.16) / 50) * 50;
  renderChartDetails(entries);
  renderInsightCard(entries[entries.length - 1], entries);

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (entry) => {
    if (useSequenceScale) {
      return padding.left + (entry.chartIndex / Math.max(entries.length - 1, 1)) * plotWidth;
    }
    if (maxTime === minTime) return padding.left + plotWidth / 2;
    return padding.left + ((new Date(entry.checkedAt).getTime() - minTime) / (maxTime - minTime)) * plotWidth;
  };
  const yFor = (entry) => padding.top + (1 - (entry.price - yMin) / (yMax - yMin)) * plotHeight;

  drawHistoryArea(ctx, entries, xFor, yFor, height, padding);
  drawHistoryLine(ctx, entries, xFor, yFor);
  drawCleanAxisLabels(ctx, width, height, padding, entries, yMin, yMax);
  drawLowestPriceCallout(ctx, minEntry, xFor, yFor, width, height, padding);
}

function priceSeriesForCurrentRange() {
  const sorted = acceptedHistory().sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
  if (!sorted.length) return [];

  const now = Date.now();
  const cutoff = now - app.chartDays * 24 * 60 * 60 * 1000;
  const filtered = sorted.filter((entry) => new Date(entry.checkedAt).getTime() >= cutoff);
  const rangeEntries = lowestKnownPricePerScan(sorted, filtered.length ? cutoff : Number.NEGATIVE_INFINITY);
  return rangeEntries.map((entry, index) => ({ ...entry, chartIndex: index }));
}

function lowestKnownPricePerScan(entries, cutoff) {
  const scanWindowMs = 5 * 60 * 1000;
  const buckets = new Map();
  const latestBySource = new Map();

  for (const entry of entries) {
    const checkedAt = new Date(entry.checkedAt).getTime();
    if (checkedAt < cutoff) {
      latestBySource.set(entry.sourceId, entry);
      continue;
    }

    const bucket = Math.floor(checkedAt / scanWindowMs);
    const bucketEntries = buckets.get(bucket) || [];
    bucketEntries.push(entry);
    buckets.set(bucket, bucketEntries);
  }

  const timeline = [];
  const orderedBuckets = [...buckets.entries()].sort(([a], [b]) => a - b);

  for (const [, bucketEntries] of orderedBuckets) {
    for (const entry of bucketEntries) {
      latestBySource.set(entry.sourceId, entry);
    }

    const lowest = [...latestBySource.values()].reduce(
      (winner, entry) => (!winner || Number(entry.price) < Number(winner.price) ? entry : winner),
      null
    );
    const bucketTime = bucketEntries.reduce(
      (latest, entry) => Math.max(latest, new Date(entry.checkedAt).getTime()),
      0
    );

    if (lowest) timeline.push({ ...lowest, checkedAt: new Date(bucketTime).toISOString() });
  }

  return timeline;
}

function renderChartDetails(entries) {
  elements.chartReadouts.innerHTML = "";

  if (!entries.length) return;

  const latest = entries[entries.length - 1];
  const first = entries[0];
  const average = entries.reduce((sum, entry) => sum + Number(entry.price), 0) / entries.length;
  const min = entries.reduce((winner, entry) => (Number(entry.price) < Number(winner.price) ? entry : winner), latest);
  const items = [
    ["Agora", latest, sourceName(latest.sourceId)],
    ["Média do período", { ...latest, price: average }, `${entries.length} leitura(s)`],
    ["Menor preço", min, sourceName(min.sourceId)]
  ];

  for (const [label, entry, meta] of items) {
    const item = document.createElement("article");
    item.className = "chart-readout-item";
    item.innerHTML = `
      <div class="readout-topline">
        <span class="readout-store">
          <span class="legend-dot" style="background:#00a8a8"></span>
          <span>${escapeHtml(label)}</span>
        </span>
        <strong>${formatDate(entry.checkedAt || first.checkedAt)}</strong>
      </div>
      <span class="readout-price">${formatCurrency(entry.price, "BRL")}</span>
      <span class="readout-meta">${escapeHtml(meta)}</span>
    `;
    elements.chartReadouts.append(item);
  }
}

function renderInsightCard(latest, entries) {
  if (!latest || !entries.length) {
    elements.priceInsightCard.innerHTML = `
      <div class="insight-title-row">
        <span class="insight-icon blue">i</span>
        <strong>Aguardando histórico</strong>
      </div>
      <p>Assim que houver leituras suficientes, mostramos se o preço está bom.</p>
    `;
    return;
  }

  const average = entries.reduce((sum, entry) => sum + Number(entry.price), 0) / entries.length;
  const delta = Number(latest.price) - average;
  const percent = average ? delta / average : 0;
  const label = percent <= -0.04 ? "ótimo" : percent <= 0.04 ? "bom" : "alto";
  const marker = Math.max(8, Math.min(92, 50 + percent * 240));
  elements.priceInsightCard.innerHTML = `
    <div class="insight-title-row">
      <span class="insight-icon blue">⌁</span>
      <strong>O preço está ${label}</strong>
    </div>
    <p>Com base nos últimos ${app.chartDays} dias, o valor está próximo da média de ${formatCurrency(average, "BRL")}.</p>
    <div class="quality-track" aria-hidden="true">
      <span class="quality-marker" style="left:${marker}%"></span>
      <span class="quality-dot" style="left:${marker}%"></span>
    </div>
  `;
}

function drawCleanGrid(ctx, width, height, padding) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ebeeee";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#d6d9d7";
  ctx.beginPath();
  ctx.moveTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();
}

function drawHistoryArea(ctx, entries, xFor, yFor, height, padding) {
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, "rgba(0, 168, 168, 0.2)");
  gradient.addColorStop(0.65, "rgba(0, 168, 168, 0.08)");
  gradient.addColorStop(1, "rgba(0, 168, 168, 0)");

  ctx.beginPath();
  entries.forEach((entry, index) => {
    const x = xFor(entry);
    const y = yFor(entry);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(entries[entries.length - 1]), height - padding.bottom);
  ctx.lineTo(xFor(entries[0]), height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawHistoryLine(ctx, entries, xFor, yFor) {
  ctx.beginPath();
  entries.forEach((entry, index) => {
    const x = xFor(entry);
    const y = yFor(entry);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#00a8a8";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

function drawCleanAxisLabels(ctx, width, height, padding, entries, yMin, yMax) {
  const currency = "BRL";
  ctx.fillStyle = "#65716f";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = yMax - ((yMax - yMin) / 4) * i;
    const y = padding.top + ((height - padding.top - padding.bottom) / 4) * i;
    ctx.fillText(formatCurrency(value, currency).replace(/\s/g, " "), padding.left - 10, y);
  }

  const first = entries[0];
  const last = entries[entries.length - 1];
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(formatChartDate(first.checkedAt), padding.left, height - padding.bottom + 14);
  ctx.textAlign = "right";
  ctx.fillText("Hoje", width - padding.right, height - padding.bottom + 14);
  if (entries.length > 2) {
    ctx.textAlign = "center";
    const middle = entries[Math.floor(entries.length / 2)];
    ctx.fillText(formatChartDate(middle.checkedAt), width / 2, height - padding.bottom + 14);
  }
}

function drawLowestPriceCallout(ctx, lowest, xFor, yFor, width, height, padding) {
  if (!lowest) return;

  const originalX = xFor(lowest);
  const x = width - padding.right;
  const y = yFor(lowest);
  const label = formatCurrency(lowest.price, lowest.currency).replace("R$", "R$ ");
  const store = sourceName(lowest.sourceId);
  const boxWidth = 132;
  const boxHeight = 58;
  const boxX = x - boxWidth - 14;
  let boxY = y - boxHeight / 2;

  boxY = Math.max(padding.top + 4, Math.min(boxY, height - padding.bottom - boxHeight - 4));

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(0, 128, 128, 0.35)";
  ctx.beginPath();
  ctx.moveTo(originalX, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, height - padding.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#b8e3df";
  ctx.lineWidth = 1;
  roundRect(ctx, boxX, boxY, boxWidth, boxHeight, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#008f8f";
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, boxX + boxWidth / 2, boxY + 20);
  ctx.fillStyle = "#505a57";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("MENOR", boxX + boxWidth / 2, boxY + 37);
  ctx.fillText(store.slice(0, 18), boxX + boxWidth / 2, boxY + 50);

  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#00a8a8";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function formatChartDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short"
  })
    .format(new Date(value))
    .replace(".", "");
}

function drawChip() {
  const canvas = elements.chipCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#34413d");
  gradient.addColorStop(1, "#111816");
  ctx.fillStyle = gradient;
  roundRect(ctx, 8, 8, width - 16, height - 16, 10);
  ctx.fill();

  ctx.strokeStyle = "#d4a949";
  ctx.lineWidth = 3;
  roundRect(ctx, 26, 26, width - 52, height - 52, 8);
  ctx.stroke();

  ctx.fillStyle = "#f7f4ef";
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("5800", width / 2, height / 2 - 8);
  ctx.fillStyle = "#5eead4";
  ctx.fillText("X3D", width / 2, height / 2 + 12);

  ctx.strokeStyle = "#d4a949";
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i += 1) {
    const offset = 18 + i * 12;
    ctx.beginPath();
    ctx.moveTo(offset, 8);
    ctx.lineTo(offset, 0);
    ctx.moveTo(offset, height - 8);
    ctx.lineTo(offset, height);
    ctx.moveTo(8, offset);
    ctx.lineTo(0, offset);
    ctx.moveTo(width - 8, offset);
    ctx.lineTo(width, offset);
    ctx.stroke();
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

async function scanAll() {
  await withBusy(elements.scanButton, "Verificando...", async () => {
    await api("/api/scan", { method: "POST", body: "{}" });
    await loadState({ silent: true });
  });
}

async function scanSource(sourceId) {
  await api(`/api/sources/${sourceId}/scan`, { method: "POST", body: "{}" });
  await loadState({ silent: true });
}

async function deleteSource(sourceId) {
  if (!confirm("Remover esta fonte do monitor?")) return;
  await api(`/api/sources/${sourceId}`, { method: "DELETE" });
  await loadState({ silent: true });
}

async function saveSource(event, source) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    store: source.store,
    url: source.url,
    targetPrice: Number(form.targetPrice.value || 0),
    currency: "BRL",
    active: form.active.checked,
    notes: source.notes || ""
  };
  await api(`/api/sources/${source.id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
  await loadState({ silent: true });
}

async function withBusy(button, label, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function maybeNotifyNewAlerts(previousAlertIds, alerts) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const fresh = alerts.filter((alert) => !previousAlertIds.has(alert.id));
  for (const alert of fresh.slice(0, 3)) {
    new Notification("Preço no alvo", {
      body: `${alert.store}: ${formatCurrency(alert.price, alert.currency)}`,
      tag: alert.id
    });
  }
}

elements.scanButton.addEventListener("click", scanAll);
elements.refreshButton.addEventListener("click", () => loadState());
elements.rangeTabs.addEventListener("click", (event) => {
  const button = event.target.closest(".range-tab");
  if (!button) return;
  app.chartDays = Number(button.dataset.days || 40);
  elements.rangeTabs.querySelectorAll(".range-tab").forEach((tab) => {
    tab.classList.toggle("active", tab === button);
  });
  renderChart();
});
elements.markAlertsRead.addEventListener("click", async () => {
  await api("/api/alerts/read", { method: "POST", body: "{}" });
  await loadState({ silent: true });
});

elements.sourceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const body = {
    store: data.get("store"),
    url: data.get("url"),
    targetPrice: Number(data.get("targetPrice") || 0),
    currency: "BRL",
    active: true
  };
  try {
    await api("/api/sources", {
      method: "POST",
      body: JSON.stringify(body)
    });
    form.reset();
    await loadState({ silent: true });
  } catch (error) {
    alert(error.message);
  }
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    autoScan: form.autoScan.checked,
    requireAnniversarySignals: form.requireAnniversarySignals.checked,
    intervalMinutes: Number(form.intervalMinutes.value || 60),
    webhookUrl: form.webhookUrl.value
  };
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(body)
    });
    await loadState({ silent: true });
  } catch (error) {
    alert(error.message);
  }
});

elements.notifyButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("Este navegador não suporta notificações.");
    return;
  }
  const permission = await Notification.requestPermission();
  elements.notifyButton.textContent = permission === "granted" ? "Notificações ativas" : "Ativar notificações";
});

window.addEventListener("resize", () => renderChart());

loadState().catch((error) => {
  elements.statusLine.textContent = error.message;
});
app.pollingHandle = setInterval(() => loadState({ silent: true }).catch(() => {}), 15000);
