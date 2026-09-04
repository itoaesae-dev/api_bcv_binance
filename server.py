"""Local server for Valor local with a free Binance P2P proxy."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PORT = 4173
BINANCE_P2P_URL = (
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
)
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "Chrome/128.0 Safari/537.36"
)
REQUEST_TIMEOUT = 8


def parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None

    cleaned = re.sub(r"[^0-9,.-]", "", str(value).strip())
    if not cleaned:
        return None

    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") > 1:
        cleaned = cleaned.replace(".", "")

    try:
        number = float(cleaned)
    except ValueError:
        return None
    return number if number == number else None


def parse_binance_quote(payload: dict[str, Any], trade_type: str) -> float:
    items = payload.get("data")
    if isinstance(items, dict):
        items = items.get("items")
    if not payload.get("success") or not isinstance(items, list) or not items:
        raise ValueError(f"Binance P2P rechazó la consulta {trade_type}.")

    prices = [
        parse_number((item.get("adv") or {}).get("price") or item.get("price"))
        for item in items
    ]
    prices = [price for price in prices if price is not None]
    if not prices:
        raise ValueError(f"Binance P2P no devolvió precio para {trade_type}.")
    return min(prices) if trade_type == "BUY" else max(prices)


def fetch_json(url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    request_body = None
    method = "GET"
    if body is not None:
        request_body = json.dumps(body).encode("utf-8")
        method = "POST"

    headers = {
        "Accept": "application/json",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": USER_AGENT,
    }
    if request_body is not None:
        headers["Content-Type"] = "application/json"

    request = Request(
        url,
        data=request_body,
        headers=headers,
        method=method,
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def fetch_binance_p2p() -> dict[str, Any]:
    def fetch_side(trade_type: str) -> float:
        return parse_binance_quote(
            fetch_json(
                BINANCE_P2P_URL,
                {
                    "asset": "USDT",
                    "fiat": "VES",
                    "merchantCheck": True,
                    "page": 1,
                    "payTypes": [],
                    "publisherType": "merchant",
                    "rows": 20,
                    "tradeType": trade_type,
                },
            ),
            trade_type,
        )

    compra = fetch_side("BUY")
    venta = fetch_side("SELL")
    return {
        "moneda": "USD",
        "fuente": "binance-p2p",
        "nombre": "Dólar Binance",
        "promedio": (compra + venta) / 2,
        "compra": compra,
        "venta": venta,
        "variacion": None,
        "variacionPorcentaje": None,
        "fechaActualizacion": datetime.now(timezone.utc).isoformat(),
        "sourceUrl": "https://p2p.binance.com/",
    }


class DashboardHandler(SimpleHTTPRequestHandler):
    """Serve dashboard files and the same-origin Binance P2P proxy."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - standard library handler API
        if self.path.split("?", 1)[0] == "/api/binance":
            self.handle_binance()
            return
        super().do_GET()

    def handle_binance(self) -> None:
        try:
            self.send_json(200, fetch_binance_p2p())
        except Exception as error:  # pragma: no cover - network-dependent path
            print(f"[binance-p2p] {error}")
            self.send_json(
                502,
                {
                    "error": True,
                    "message": "Binance P2P no está disponible en este momento.",
                },
            )

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DashboardHandler)
    print(f"Valor local disponible en http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
