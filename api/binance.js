const EXCHANGE_URL = "https://exchangemonitor.net/venezuela/dolar-binance";
const EXCHANGE_API_URL = "https://exchangemonitor.net/api/v1/data/ve";
const READER_URL = "https://r.jina.ai/http://exchangemonitor.net/venezuela/dolar-binance";
const BINANCE_P2P_URL = "https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const REQUEST_TIMEOUT = 8000;
const CARACAS_OFFSET = "-04:00";

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function parseNumber(value) {
  if (!value) return null;

  const text = decodeHtml(value).replace(/<[^>]+>/g, " ");
  let cleaned = text.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;

  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    cleaned = cleaned.replace(/\./g, "");
  }

  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = typeof value === "number" ? value : parseNumber(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function extractFirst(pattern, page) {
  const match = page.match(pattern);
  return match?.[1]
    ? decodeHtml(match[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    : null;
}

function parsePageDate(description) {
  if (!description) return null;

  const months = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const match = description.match(
    /hoy\s+[^,]+,\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+UTC/i,
  );
  if (!match) return null;

  const [, day, monthName, year, hour, minute, meridiem] = match;
  const normalizedMonth = monthName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const month = months[normalizedMonth];
  if (!month) return null;

  let hourNumber = Number.parseInt(hour, 10) % 12;
  if (meridiem.toLowerCase() === "pm") hourNumber += 12;

  return new Date(
    Date.UTC(
      Number.parseInt(year, 10),
      month - 1,
      Number.parseInt(day, 10),
      hourNumber,
      Number.parseInt(minute, 10),
    ),
  ).toISOString();
}

function normalizeDate(value) {
  if (!value) return null;

  const text = String(value).trim();
  const localDateMatch = text.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/);
  const date = new Date(
    localDateMatch ? `${text.replace(" ", "T")}${CARACAS_OFFSET}` : text,
  );

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getAuthHeader() {
  const auth = String(process.env.EXCHANGE_MONITOR_AUTH || "").trim();
  if (auth) return /^Bearer\s/i.test(auth) ? auth : `Bearer ${auth}`;

  const appId = String(process.env.EXCHANGE_MONITOR_APP_ID || "").trim();
  const apiKey = String(process.env.EXCHANGE_MONITOR_API_KEY || "").trim();
  return appId && apiKey ? `Bearer ${appId}:${apiKey}` : null;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": USER_AGENT,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${new URL(url).hostname} respondió ${response.status}.`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parsePage(page) {
  const mainRateText = extractFirst(
    /<div[^>]*class=["'][^"']*history-rate[^"']*["'][^>]*>(.*?)<\/div>/is,
    page,
  );
  const buyText = extractFirst(
    /<small[^>]*>\s*Compra\s*<\/small>.*?<span>\s*([^<]+?)\s*<\/span>/is,
    page,
  );
  const sellText = extractFirst(
    /<small[^>]*>\s*Venta\s*<\/small>.*?<span>\s*([^<]+?)\s*<\/span>/is,
    page,
  );

  const promedio = parseNumber(mainRateText);
  if (promedio === null) {
    throw new Error("No se encontró el precio principal de Binance.");
  }

  const visibleChange = extractFirst(
    /<div[^>]*class=["'][^"']*history-change[^"']*["'][^>]*>(.*?)<\/div>/is,
    page,
  ) || "";
  const changeNumbers = visibleChange.match(/\d+(?:[.,]\d+)?/g) || [];
  const changeSign = visibleChange.includes("-") ? -1 : 1;
  const description = extractFirst(
    /<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i,
    page,
  );

  return {
    moneda: "USD",
    fuente: "binance",
    nombre: "Dólar Binance",
    promedio,
    compra: parseNumber(buyText),
    venta: parseNumber(sellText),
    variacion: changeNumbers[0]
      ? parseNumber(changeNumbers[0]) * changeSign
      : null,
    variacionPorcentaje: changeNumbers[1]
      ? parseNumber(changeNumbers[1])
      : null,
    fechaActualizacion: parsePageDate(description) || new Date().toISOString(),
    sourceUrl: EXCHANGE_URL,
  };
}

function parseApiPayload(payload) {
  if (!payload?.success) {
    throw new Error(payload?.message || "ExchangeMonitor rechazó la consulta API.");
  }

  const records = Array.isArray(payload.data) ? payload.data : [];
  const record = records.find((item) => item?.id === "ve-binance")
    || records.find((item) => /binance/i.test(
      `${item?.id || ""} ${item?.name || ""} ${item?.name_large || ""}`,
    ));

  if (!record) throw new Error("La API no devolvió el registro de Binance.");

  const compra = firstNumber([record.buy, record.compra]);
  const venta = firstNumber([record.sell, record.venta]);
  const promedio = firstNumber([
    record.rate,
    record.promedio,
    record.value,
    compra !== null && venta !== null ? (compra + venta) / 2 : null,
    venta,
    compra,
  ]);

  if (promedio === null) {
    throw new Error("El registro de Binance no tiene un monto válido.");
  }

  return {
    moneda: "USD",
    fuente: "binance",
    nombre: "Dólar Binance",
    promedio,
    compra,
    venta,
    variacion: firstNumber([record.change_rate, record.variacion]),
    variacionPorcentaje: firstNumber([record.change_perc, record.variacionPorcentaje]),
    fechaActualizacion: normalizeDate(record.date || record.fecha || payload.settings?.date)
      || new Date().toISOString(),
    sourceUrl: EXCHANGE_URL,
  };
}

function parseReaderPage(page) {
  const buyText = page.match(/(?:^|\n)\s*Compra\s*(?:\n)+\s*Bs\.\s*([0-9.,]+)/i)?.[1];
  const sellText = page.match(/(?:^|\n)\s*Venta\s*(?:\n)+\s*Bs\.\s*([0-9.,]+)/i)?.[1];
  const summary = page.match(
    /Para hoy[\s\S]*?(?=\n\s*##|$)/i,
  )?.[0] || page;
  const rateText = summary.match(
    /precio del d[oó]lar Binance[\s\S]*?se cotiza en\s*([0-9.,]+)\s+USD/i,
  )?.[1];
  const promedio = parseNumber(rateText);

  if (promedio === null) {
    throw new Error("La lectura alternativa no devolvió el precio de Binance.");
  }

  const changeText = summary.match(
    /(?:aumento|incremento|disminuci[oó]n|descenso)[\s\S]*?(\d+(?:[.,]\d+)?)%/i,
  )?.[1];
  const negativeChange = /disminuci[oó]n|descenso|baj[oó]/i.test(summary);

  return {
    moneda: "USD",
    fuente: "binance",
    nombre: "Dólar Binance",
    promedio,
    compra: parseNumber(buyText),
    venta: parseNumber(sellText),
    variacion: changeText
      ? parseNumber(changeText) * (negativeChange ? -1 : 1)
      : null,
    variacionPorcentaje: null,
    fechaActualizacion: parsePageDate(summary) || new Date().toISOString(),
    sourceUrl: EXCHANGE_URL,
  };
}

function parseBinanceQuote(payload, tradeType) {
  if (!payload?.success || !payload.data) {
    throw new Error(`Binance P2P rechazó la consulta ${tradeType}.`);
  }

  const price = firstNumber([payload.data.price]);
  if (price === null) throw new Error(`Binance P2P no devolvió precio para ${tradeType}.`);
  return price;
}

async function fetchOfficialApi(authHeader) {
  const url = new URL(EXCHANGE_API_URL);
  url.searchParams.set("timezone", "America/Caracas");
  url.searchParams.set("filter", "binance");
  url.searchParams.set("limit", "10");

  const raw = await fetchText(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
  });
  return parseApiPayload(JSON.parse(raw));
}

async function fetchHtmlPage() {
  return parsePage(await fetchText(EXCHANGE_URL));
}

async function fetchReaderPage() {
  return parseReaderPage(await fetchText(READER_URL, {
    headers: { Accept: "text/plain" },
  }));
}

async function fetchBinanceP2P() {
  const fetchSide = async (tradeType) => {
    const url = new URL(BINANCE_P2P_URL);
    url.searchParams.set("fiat", "VES");
    url.searchParams.set("asset", "USDT");
    url.searchParams.set("tradeType", tradeType);
    const raw = await fetchText(url.toString(), {
      headers: { Accept: "application/json" },
    });
    return parseBinanceQuote(JSON.parse(raw), tradeType);
  };

  const [compra, venta] = await Promise.all([
    fetchSide("BUY"),
    fetchSide("SELL"),
  ]);

  return {
    moneda: "USD",
    fuente: "binance-p2p",
    nombre: "Dólar Binance",
    promedio: (compra + venta) / 2,
    compra,
    venta,
    variacion: null,
    variacionPorcentaje: null,
    fechaActualizacion: new Date().toISOString(),
    sourceUrl: "https://p2p.binance.com/",
  };
}

async function loadBinanceQuote() {
  const authHeader = getAuthHeader();
  const failures = [];

  if (authHeader) {
    try {
      return await fetchOfficialApi(authHeader);
    } catch (error) {
      failures.push(`API oficial: ${error.message}`);
    }
  }

  const pageAttempts = [
    fetchHtmlPage().catch((error) => {
      throw new Error(`página: ${error.message}`);
    }),
    fetchReaderPage().catch((error) => {
      throw new Error(`lector: ${error.message}`);
    }),
  ];

  try {
    return await Promise.any(pageAttempts);
  } catch (error) {
    const errors = error instanceof AggregateError ? error.errors : [error];
    failures.push(...errors.map((item) => item.message));
  }

  try {
    return await fetchBinanceP2P();
  } catch (error) {
    failures.push(`Binance P2P: ${error.message}`);
  }

  throw new Error(failures.join(" | ") || "No se pudo consultar Binance.");
}

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: true, message: "Método no permitido." });
  }

  try {
    const payload = await loadBinanceQuote();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[binance]", error);
    return res.status(502).json({
      error: true,
      message: "ExchangeMonitor no está disponible en este momento.",
    });
  }
};

module.exports.parsePage = parsePage;
module.exports.parseApiPayload = parseApiPayload;
module.exports.parseReaderPage = parseReaderPage;
module.exports.parseBinanceQuote = parseBinanceQuote;
