const EXCHANGE_URL = "https://exchangemonitor.net/venezuela/dolar-binance";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";

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

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: true, message: "Método no permitido." });
  }

  try {
    const response = await fetch(EXCHANGE_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`ExchangeMonitor respondió ${response.status}.`);

    const payload = parsePage(await response.text());
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
