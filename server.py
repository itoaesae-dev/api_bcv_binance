"""Local server for Valor local.

Serves the static dashboard and exposes a same-origin endpoint that reads the
server-rendered Binance value from ExchangeMonitor. The upstream API requires
credentials, so those credentials are intentionally not needed in the browser.
"""

from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PORT = 4173
EXCHANGE_URL = "https://exchangemonitor.net/venezuela/dolar-binance"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "Chrome/128.0 Safari/537.36"
)


def parse_number(value: str | None) -> float | None:
    """Parse Venezuelan-formatted numbers such as `1.234,56`."""

    if not value:
        return None

    text = re.sub(r"<[^>]+>", " ", html.unescape(value))
    cleaned = re.sub(r"[^0-9,.-]", "", text)
    if not cleaned:
        return None

    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") > 1:
        cleaned = cleaned.replace(".", "")

    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_first(pattern: str, page: str) -> str | None:
    match = re.search(pattern, page, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    return re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()


def parse_page(page: str) -> dict[str, Any]:
    """Extract the public Binance quote from ExchangeMonitor's HTML."""

    main_rate_text = extract_first(
        r"<div[^>]*class=[\"'][^\"']*history-rate[^\"']*[\"'][^>]*>"
        r"(.*?)</div>",
        page,
    )
    buy_text = extract_first(
        r"<small[^>]*>\s*Compra\s*</small>.*?"
        r"<span>\s*([^<]+?)\s*</span>",
        page,
    )
    sell_text = extract_first(
        r"<small[^>]*>\s*Venta\s*</small>.*?"
        r"<span>\s*([^<]+?)\s*</span>",
        page,
    )

    main_rate = parse_number(main_rate_text)
    buy = parse_number(buy_text)
    sell = parse_number(sell_text)
    if main_rate is None:
        raise ValueError("No se encontró el precio principal de Binance.")

    change_text = extract_first(
        r"<div[^>]*class=[\"'][^\"']*history-change[^\"']*[\"'][^>]*>"
        r"(.*?)</div>",
        page,
    )
    visible_change = re.sub(r"<[^>]+>", " ", html.unescape(change_text or ""))
    change_numbers = re.findall(r"\d+(?:[.,]\d+)?", visible_change)
    change_sign = -1 if "-" in visible_change else 1

    description = extract_first(
        r"<meta[^>]*name=[\"']description[\"'][^>]*content=[\"'](.*?)[\"']",
        page,
    )
    updated_at = parse_page_date(description)

    return {
        "moneda": "USD",
        "fuente": "binance",
        "nombre": "Dólar Binance",
        "promedio": main_rate,
        "compra": buy,
        "venta": sell,
        "variacion": (parse_number(change_numbers[0]) * change_sign) if change_numbers else None,
        "variacionPorcentaje": parse_number(change_numbers[1]) if len(change_numbers) > 1 else None,
        "fechaActualizacion": updated_at or datetime.now(timezone.utc).isoformat(),
        "sourceUrl": EXCHANGE_URL,
    }


def parse_page_date(description: str | None) -> str | None:
    """Read the UTC timestamp included in ExchangeMonitor's description."""

    if not description:
        return None

    months = {
        "enero": 1,
        "febrero": 2,
        "marzo": 3,
        "abril": 4,
        "mayo": 5,
        "junio": 6,
        "julio": 7,
        "agosto": 8,
        "septiembre": 9,
        "octubre": 10,
        "noviembre": 11,
        "diciembre": 12,
    }
    match = re.search(
        r"hoy\s+[^,]+,\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})\s+"
        r"a\s+las\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+UTC",
        description,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    day, month_name, year, hour, minute, meridiem = match.groups()
    month = months.get(month_name.lower())
    if month is None:
        return None

    hour_number = int(hour) % 12
    if meridiem.lower() == "pm":
        hour_number += 12

    return datetime(
        int(year), month, int(day), hour_number, int(minute), tzinfo=timezone.utc
    ).isoformat()


class DashboardHandler(SimpleHTTPRequestHandler):
    """Serve dashboard files and the same-origin Binance proxy."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802 - standard library handler API
        if self.path.split("?", 1)[0] == "/api/binance":
            self.handle_binance()
            return
        super().do_GET()

    def handle_binance(self) -> None:
        try:
            request = Request(
                EXCHANGE_URL,
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache",
                    "User-Agent": USER_AGENT,
                },
            )
            with urlopen(request, timeout=15) as response:
                page = response.read().decode("utf-8", errors="replace")
            payload = parse_page(page)
            self.send_json(200, payload)
        except Exception as error:  # pragma: no cover - network-dependent path
            print(f"[binance] {error}")
            self.send_json(
                502,
                {
                    "error": True,
                    "message": "ExchangeMonitor no está disponible en este momento.",
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
