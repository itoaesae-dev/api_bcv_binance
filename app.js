const API_BASE = "https://ve.dolarapi.com/v1";
const TIME_ZONE = "America/Caracas";
// El BCV suele publicar el valor del lunes el viernes al final de la tarde.
// Si el banco cambia la hora de actualización, basta con cambiar este valor a 17.
const FRIDAY_MONDAY_SWITCH_HOUR = 18;
const CACHE_KEY = "valor-local-cache-v1";
const REFRESH_INTERVAL = 10 * 60 * 1000;
const REQUEST_TIMEOUT = 12000;

const FALLBACK_QUOTES = {
  usd: {
    value: 807.3862,
    source: "oficial",
    label: "Dólar",
    updatedAt: "2026-09-04T00:00:00-04:00",
  },
  eur: {
    value: 938.44920184,
    source: "oficial",
    label: "Euro",
    updatedAt: "2026-09-04T00:00:00-04:00",
  },
  parallel: {
    value: 968.78,
    source: "binance-p2p",
    label: "Dólar Binance",
    buy: 969.46,
    sell: 968.10,
    updatedAt: "2026-09-04T15:41:00Z",
  },
};

const dom = {
  refreshButton: document.querySelector("#refreshButton"),
  headerUpdated: document.querySelector("#headerUpdated"),
  dateBriefTitle: document.querySelector("#dateBriefTitle"),
  effectiveDateLabel: document.querySelector("#effectiveDateLabel"),
  dateRuleNote: document.querySelector("#dateRuleNote"),
  dataState: document.querySelector("#dataState"),
  footerMessage: document.querySelector("#footerMessage"),
  usdCard: document.querySelector("#usdCard"),
  usdValue: document.querySelector("#usdValue"),
  usdUpdated: document.querySelector("#usdUpdated"),
  usdNote: document.querySelector("#usdNote"),
  usdSparkline: document.querySelector("#usdSparkline"),
  eurCard: document.querySelector("#eurCard"),
  eurValue: document.querySelector("#eurValue"),
  eurUpdated: document.querySelector("#eurUpdated"),
  eurNote: document.querySelector("#eurNote"),
  parallelCard: document.querySelector("#parallelCard"),
  parallelSource: document.querySelector("#parallelSource"),
  parallelValue: document.querySelector("#parallelValue"),
  parallelBuy: document.querySelector("#parallelBuy"),
  parallelSell: document.querySelector("#parallelSell"),
  parallelUpdated: document.querySelector("#parallelUpdated"),
  parallelGap: document.querySelector("#parallelGap"),
  trendChart: document.querySelector("#trendChart"),
  trendStart: document.querySelector("#trendStart"),
  trendLatest: document.querySelector("#trendLatest"),
  trendEnd: document.querySelector("#trendEnd"),
  toast: document.querySelector("#toast"),
};

let activeController = null;
let toastTimeout = null;

function getCaracasDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));

  return {
    year,
    month,
    day,
    hour,
    weekday: dateOnly.getUTCDay(),
    dateOnly,
  };
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function getDatePlan(now = new Date()) {
  const today = getCaracasDateParts(now);
  let effectiveDate = today.dateOnly;
  const isWeekend = today.weekday === 0 || today.weekday === 6;
  const isFridayAfterBankUpdate = today.weekday === 5
    && today.hour >= FRIDAY_MONDAY_SWITCH_HOUR;
  const usesMondayDate = isWeekend || isFridayAfterBankUpdate;

  if (today.weekday === 5 && isFridayAfterBankUpdate) {
    effectiveDate = addDays(today.dateOnly, 3);
  }
  if (today.weekday === 6) effectiveDate = addDays(today.dateOnly, 2);
  if (today.weekday === 0) effectiveDate = addDays(today.dateOnly, 1);

  return {
    today,
    effectiveDate,
    isWeekend,
    isFridayAfterBankUpdate,
    usesMondayDate,
  };
}

function toApiDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("es-VE", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("es-VE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatRate(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function formatUpdatedAt(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";

  return new Intl.DateTimeFormat("es-VE", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatTime(value = new Date()) {
  return new Intl.DateTimeFormat("es-VE", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatHourLabel(hour) {
  const suffix = hour >= 12 ? "p. m." : "a. m.";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

function firstFinite(candidates) {
  const value = candidates.find((candidate) => (
    candidate !== null
    && candidate !== undefined
    && candidate !== ""
    && Number.isFinite(Number(candidate))
  ));
  return value === undefined ? null : Number(value);
}

function pickValue(quote) {
  return firstFinite([
    quote?.promedio,
    quote?.rate,
    quote?.value,
    quote?.venta,
    quote?.sell,
    quote?.compra,
    quote?.buy,
  ]);
}

function normalizeQuote(raw, key, plan, mode = "live") {
  const value = pickValue(raw);
  if (!Number.isFinite(value)) throw new Error(`La respuesta de ${key} no tiene un monto válido.`);

  return {
    key,
    value,
    source: raw.fuente || (key === "parallel" ? "paralelo" : "oficial"),
    label: raw.nombre || (key === "parallel" ? "Paralelo" : key === "eur" ? "Euro" : "Dólar"),
    updatedAt: raw.fechaActualizacion || raw.fecha || null,
    buy: firstFinite([raw.compra, raw.buy]),
    sell: firstFinite([raw.venta, raw.sell]),
    change: firstFinite([raw.variacion, raw.change_rate]),
    changePercent: firstFinite([raw.variacionPorcentaje, raw.change_perc]),
    effectiveDate: plan.effectiveDate.toISOString(),
    mode,
  };
}

async function fetchJsonFrom(base, path, signal) {
  const response = await fetch(`${base}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`DolarApi respondió ${response.status}.`);
  }

  return response.json();
}

async function fetchJson(path, signal) {
  return fetchJsonFrom(API_BASE, path, signal);
}

async function fetchLocalJson(path, signal) {
  return fetchJsonFrom("", path, signal);
}

async function fetchOfficial(key, plan, signal) {
  const livePath = key === "eur" ? "/euros/oficial" : "/dolares/oficial";

  if (!plan.usesMondayDate) {
    const raw = await fetchJson(livePath, signal);
    return normalizeQuote(raw, key, plan, "live");
  }

  const historicalPath = key === "eur"
    ? `/historicos/euros/oficial/${toApiDate(plan.effectiveDate)}`
    : `/historicos/dolares/oficial/${toApiDate(plan.effectiveDate)}`;

  try {
    const raw = await fetchJson(historicalPath, signal);
    return normalizeQuote(raw, key, plan, "monday");
  } catch (error) {
    // El lunes futuro aún puede no existir el viernes por la tarde o durante el fin de semana.
    const raw = await fetchJson(livePath, signal);
    return normalizeQuote(raw, key, plan, "monday-fallback");
  }
}

async function fetchBinance(plan, signal) {
  try {
    const raw = await fetchLocalJson(`/api/binance?refresh=${Date.now()}`, signal);
    const mode = raw.fuente === "binance-p2p" ? "binance-p2p" : "binance";
    return normalizeQuote(raw, "parallel", plan, mode);
  } catch (error) {
    // Permite que el dashboard siga funcionando si se sirve como estático.
    const raw = await fetchJson("/dolares/paralelo", signal);
    return normalizeQuote(raw, "parallel", plan, "parallel-fallback");
  }
}

function readCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!saved?.quotes) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeCache(snapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // El panel sigue funcionando aunque el almacenamiento esté bloqueado.
  }
}

function fallbackQuote(key, plan, cached) {
  const cachedQuote = cached?.quotes?.[key];
  const source = Number.isFinite(Number(cachedQuote?.value))
    ? cachedQuote
    : FALLBACK_QUOTES[key];
  return {
    key,
    value: Number(source.value),
    source: source.source,
    label: source.label,
    updatedAt: source.updatedAt,
    buy: firstFinite([source.buy]),
    sell: firstFinite([source.sell]),
    change: firstFinite([source.change]),
    changePercent: firstFinite([source.changePercent]),
    effectiveDate: plan.effectiveDate.toISOString(),
    mode: "local-fallback",
  };
}

async function loadHistory(signal) {
  const raw = await fetchJson("/historicos/dolares/oficial", signal);
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => ({
      value: pickValue(item),
      date: item.fecha || item.fechaActualizacion || null,
    }))
    .filter((item) => Number.isFinite(item.value) && item.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-7);
}

function setLoadingState(isLoading) {
  dom.refreshButton.disabled = isLoading;
  dom.refreshButton.classList.toggle("is-loading", isLoading);
}

function renderDatePlan(plan) {
  const todayLabel = formatLongDate(plan.today.dateOnly);
  const effectiveLabel = formatLongDate(plan.effectiveDate);
  const fridaySwitchLabel = formatHourLabel(FRIDAY_MONDAY_SWITCH_HOUR);

  dom.dateBriefTitle.textContent = capitalize(todayLabel);
  dom.effectiveDateLabel.textContent = plan.usesMondayDate
    ? `Lunes · ${capitalize(effectiveLabel)}`
    : capitalize(effectiveLabel);
  dom.dateRuleNote.textContent = plan.usesMondayDate
    ? "Dólar y euro BCV buscan el monto del lunes siguiente. Si todavía no se publica, se muestra el último dato disponible."
    : `Viernes usa su propio monto hasta las ${fridaySwitchLabel}; después salta al lunes siguiente. Sábado y domingo también toman el lunes.`;
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function renderQuoteCard(card, valueNode, updatedNode, noteNode, quote, plan, baseClass = "") {
  card.classList.toggle("is-stale", quote.mode !== "live" && quote.mode !== "monday");
  valueNode.textContent = formatRate(quote.value);
  updatedNode.textContent = formatUpdatedAt(quote.updatedAt);

  if (quote.mode === "monday") {
    noteNode.textContent = "Monto del lunes";
  } else if (quote.mode === "monday-fallback") {
    noteNode.textContent = "Último BCV disponible";
  } else if (quote.mode === "local-fallback") {
    noteNode.textContent = "Respaldo local";
  } else {
    noteNode.textContent = baseClass || "Promedio BCV";
  }
}

function renderQuotes(quotes, plan) {
  renderQuoteCard(dom.usdCard, dom.usdValue, dom.usdUpdated, dom.usdNote, quotes.usd, plan);
  renderQuoteCard(dom.eurCard, dom.eurValue, dom.eurUpdated, dom.eurNote, quotes.eur, plan);

  const parallelIsLive = quotes.parallel.mode === "binance-p2p";
  dom.parallelCard.classList.toggle("is-stale", !parallelIsLive);
  dom.parallelSource.textContent = quotes.parallel.mode === "binance-p2p"
    ? "Binance P2P"
    : quotes.parallel.mode === "parallel-fallback"
      ? "DolarApi"
      : "Respaldo";
  dom.parallelSource.href = quotes.parallel.mode === "binance-p2p"
    ? "https://p2p.binance.com/"
      : "https://dolarapi.com/docs/venezuela/";
  dom.parallelValue.textContent = formatRate(quotes.parallel.value);
  dom.parallelBuy.textContent = formatRate(quotes.parallel.buy);
  dom.parallelSell.textContent = formatRate(quotes.parallel.sell);
  dom.parallelUpdated.textContent = formatUpdatedAt(quotes.parallel.updatedAt);

  const gap = quotes.usd.value > 0
    ? ((quotes.parallel.value - quotes.usd.value) / quotes.usd.value) * 100
    : null;
  dom.parallelGap.textContent = `${formatPercent(gap)} vs. BCV`;
}

function createChartPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function makeChartData(items, width = 620, height = 170) {
  const values = items.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || Math.max(max * 0.012, 1);
  const left = 8;
  const right = width - 8;
  const top = 16;
  const bottom = height - 23;
  const points = values.map((value, index) => ({
    x: left + (index * (right - left)) / Math.max(values.length - 1, 1),
    y: bottom - ((value - min) / spread) * (bottom - top),
  }));
  return { points, min, max, width, height, bottom };
}

function renderSparkline(container, items) {
  if (!items.length) {
    container.replaceChildren();
    return;
  }

  const { points, width, height, bottom } = makeChartData(items, 620, 48);
  const line = createChartPath(points);
  const area = `${line} L${points.at(-1).x.toFixed(2)},${bottom} L${points[0].x.toFixed(2)},${bottom} Z`;
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" class="spark-area"></path>
      <path d="${line}" class="spark-line"></path>
    </svg>
  `;
}

function renderTrend(items, currentValue) {
  if (!items.length) {
    dom.trendChart.innerHTML = '<div class="chart-empty">La serie histórica no está disponible.</div>';
    dom.trendStart.textContent = "Sin histórico";
    dom.trendLatest.textContent = formatRate(currentValue);
    dom.trendEnd.textContent = "dato actual";
    return;
  }

  const { points, min, max, width, height, bottom } = makeChartData(items);
  const line = createChartPath(points);
  const area = `${line} L${points.at(-1).x.toFixed(2)},${bottom} L${points[0].x.toFixed(2)},${bottom} Z`;
  const gridY = [22, 66, 110, 151];
  const labels = items.map((item, index) => {
    return `<text x="${points[index].x.toFixed(2)}" y="166" text-anchor="${index === 0 ? "start" : index === items.length - 1 ? "end" : "middle"}" class="chart-label">${formatShortDate(new Date(item.date))}</text>`;
  }).join("");
  const circles = points.map((point, index) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${index === points.length - 1 ? 4.5 : 2.5}" class="chart-point"></circle>`).join("");

  dom.trendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución del dólar BCV en los últimos siete días">
      ${gridY.map((y) => `<line x1="8" y1="${y}" x2="612" y2="${y}" class="chart-grid"></line>`).join("")}
      <path d="${area}" class="chart-area"></path>
      <path d="${line}" class="chart-line"></path>
      ${circles}
      ${labels}
      <text x="612" y="13" text-anchor="end" class="chart-scale">máx. ${formatRate(max)}</text>
      <text x="8" y="13" text-anchor="start" class="chart-scale">mín. ${formatRate(min)}</text>
    </svg>
  `;

  dom.trendStart.textContent = formatShortDate(new Date(items[0].date));
  dom.trendLatest.textContent = `Bs. ${formatRate(items.at(-1).value)}`;
  dom.trendEnd.textContent = formatShortDate(new Date(items.at(-1).date));
}

async function loadDashboard() {
  const plan = getDatePlan();
  const cached = readCache();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  activeController?.abort();
  activeController = controller;

  setLoadingState(true);
  renderDatePlan(plan);
  dom.dataState.textContent = "Consultando DolarApi…";
  dom.footerMessage.textContent = "Actualización automática activa";

  const quoteRequests = [
    fetchOfficial("usd", plan, controller.signal),
    fetchOfficial("eur", plan, controller.signal),
    fetchBinance(plan, controller.signal),
  ];

  const [usdResult, eurResult, parallelResult] = await Promise.allSettled(quoteRequests);
  const resultMap = { usd: usdResult, eur: eurResult, parallel: parallelResult };
  const quotes = {};
  const failures = [];

  for (const key of Object.keys(resultMap)) {
    const result = resultMap[key];
    if (result.status === "fulfilled") {
      quotes[key] = result.value;
    } else {
      failures.push(key);
      quotes[key] = fallbackQuote(key, plan, cached);
    }
  }

  renderQuotes(quotes, plan);
  dom.headerUpdated.textContent = `Sincronizado ${formatTime()}`;
  renderSparkline(dom.usdSparkline, []);

  try {
    const history = await loadHistory(controller.signal);
    renderTrend(history, quotes.usd.value);
    renderSparkline(dom.usdSparkline, history.slice(-7));
  } catch {
    renderTrend([], quotes.usd.value);
  }

  const binanceLive = quotes.parallel.mode === "binance-p2p";
  const fallbackLabels = failures.map((key) => key === "parallel" ? "Binance" : key === "eur" ? "euro BCV" : "dólar BCV");
  if (!binanceLive) fallbackLabels.push("Binance");
  const uniqueFallbackLabels = [...new Set(fallbackLabels)];
  const allLive = failures.length === 0 && binanceLive;
  dom.dataState.textContent = allLive
    ? "Datos en vivo · se actualiza cada 10 min"
    : `Sin conexión en ${uniqueFallbackLabels.join(", ")} · mostrando respaldo`;
  dom.footerMessage.textContent = allLive
    ? `Última consulta ${formatTime()}`
    : "Revisa tu conexión y vuelve a actualizar";
  if (!allLive) showToast("Se mantuvo el último dato disponible mientras vuelve la conexión.");

  writeCache({ savedAt: new Date().toISOString(), quotes });
  clearTimeout(timeout);
  setLoadingState(false);
}

dom.refreshButton.addEventListener("click", () => {
  loadDashboard().catch(() => {
    dom.dataState.textContent = "No se pudo actualizar. Intenta de nuevo.";
    setLoadingState(false);
  });
});

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => dom.toast.classList.remove("is-visible"), 5000);
}

loadDashboard().catch(() => {
  dom.dataState.textContent = "No se pudo consultar la API.";
  setLoadingState(false);
});

setInterval(() => loadDashboard().catch(() => {}), REFRESH_INTERVAL);
