const BINANCE_P2P_URL =
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36";
const REQUEST_TIMEOUT = 8000;

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const text = String(value).trim();
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

function fetchBestAdPrice(payload, tradeType) {
  const items = Array.isArray(payload?.data)
    ? payload.data
    : payload?.data?.items;
  if (!payload?.success || !Array.isArray(items) || !items.length) {
    throw new Error(`Binance P2P rechazó la consulta ${tradeType}.`);
  }

  const prices = items
    .map((item) => parseNumber(item?.adv?.price ?? item?.price))
    .filter((price) => price !== null);
  if (!prices.length) {
    throw new Error(`Binance P2P no devolvió precio para ${tradeType}.`);
  }
  const price = tradeType === "BUY"
    ? Math.min(...prices)
    : Math.max(...prices);

  return price;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": USER_AGENT,
        ...(options.headers || {}),
      },
      body: options.body,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Binance respondió ${response.status}.`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinanceP2P() {
  const fetchSide = async (tradeType) => {
    const body = JSON.stringify({
      asset: "USDT",
      fiat: "VES",
      merchantCheck: true,
      page: 1,
      payTypes: [],
      publisherType: "merchant",
      rows: 20,
      tradeType,
    });

    return fetchBestAdPrice(
      await fetchJson(BINANCE_P2P_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      tradeType,
    );
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

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: true, message: "Método no permitido." });
  }

  try {
    const payload = await fetchBinanceP2P();
    res.setHeader("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
    res.setHeader("CDN-Cache-Control", "no-store");
    res.setHeader("Vercel-CDN-Cache-Control", "no-store");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[binance-p2p]", error);
    return res.status(502).json({
      error: true,
      message: "Binance P2P no está disponible en este momento.",
    });
  }
};

module.exports.parseBinanceQuote = fetchBestAdPrice;
