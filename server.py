"""Local server for Valor local.

Serves the static dashboard and exposes a same-origin endpoint that reads the
server-rendered Binance value from ExchangeMonitor. The upstream API requires
credentials, so those credentials are intentionally not needed in the browser.
"""

from __future__ import annotations

import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PORT = 4173
EXCHANGE_URL = "https://exchangemonitor.net/venezuela/dolar-binance"
EXCHANGE_API_URL = "https://exchangemonitor.net/api/v1/data/ve"
READER_URL = "https://r.jina.ai/http://exchangemonitor.net/venezuela/dolar-binance"
BINANCE_P2P_URL = "https://www.binance.com/bapi/c2c/v1/public/c2c/agent/quote-price"
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "Chrome/128.0 Safari/537.36"
)
REQUEST_TIMEOUT = 8
CARACAS_OFFSET = timezone(timedelta(hours=-4))


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


def first_number(values: list[Any]) -> float | None:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, (int, float)):
            number = float(value)
        else:
            number = parse_number(str(value))
        if number is not None:
            return number
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


def normalize_date(value: Any) -> str | None:
    if not value:
        return None

    text = str(value).strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}", text):
            parsed = datetime.fromisoformat(text.replace(" ", "T")).replace(
                tzinfo=CARACAS_OFFSET
            )
        else:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


def parse_api_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not payload.get("success"):
        raise ValueError(payload.get("message") or "ExchangeMonitor rechazó la consulta API.")

    records = payload.get("data") if isinstance(payload.get("data"), list) else []
    record = next((item for item in records if item.get("id") == "ve-binance"), None)
    if record is None:
        record = next(
            (
                item
                for item in records
                if re.search(
                    r"binance",
                    f"{item.get('id', '')} {item.get('name', '')} "
                    f"{item.get('name_large', '')}",
                    flags=re.IGNORECASE,
                )
            ),
            None,
        )
    if record is None:
        raise ValueError("La API no devolvió el registro de Binance.")

    buy = first_number([record.get("buy"), record.get("compra")])
    sell = first_number([record.get("sell"), record.get("venta")])
    average_candidates: list[Any] = [
        record.get("rate"),
        record.get("promedio"),
        record.get("value"),
    ]
    if buy is not None and sell is not None:
        average_candidates.append((buy + sell) / 2)
    average_candidates.extend([sell, buy])
    average = first_number(average_candidates)
    if average is None:
        raise ValueError("El registro de Binance no tiene un monto válido.")

    return {
        "moneda": "USD",
        "fuente": "binance",
        "nombre": "Dólar Binance",
        "promedio": average,
        "compra": buy,
        "venta": sell,
        "variacion": first_number([record.get("change_rate"), record.get("variacion")]),
        "variacionPorcentaje": first_number(
            [record.get("change_perc"), record.get("variacionPorcentaje")]
        ),
        "fechaActualizacion": normalize_date(
            record.get("date")
            or record.get("fecha")
            or (payload.get("settings") or {}).get("date")
        ) or datetime.now(timezone.utc).isoformat(),
        "sourceUrl": EXCHANGE_URL,
    }


def parse_reader_page(page: str) -> dict[str, Any]:
    buy_match = re.search(r"(?:^|\n)\s*Compra\s*(?:\n)+\s*Bs\.\s*([0-9.,]+)", page, re.I)
    sell_match = re.search(r"(?:^|\n)\s*Venta\s*(?:\n)+\s*Bs\.\s*([0-9.,]+)", page, re.I)
    summary_match = re.search(r"Para hoy[\s\S]*?(?=\n\s*##|$)", page, re.I)
    summary = summary_match.group(0) if summary_match else page
    rate_match = re.search(
        r"precio del d[oó]lar Binance[\s\S]*?se cotiza en\s*([0-9.,]+)\s+USD",
        summary,
        re.I,
    )
    average = parse_number(rate_match.group(1)) if rate_match else None
    if average is None:
        raise ValueError("La lectura alternativa no devolvió el precio de Binance.")

    change_match = re.search(
        r"(?:aumento|incremento|disminuci[oó]n|descenso)[\s\S]*?(\d+(?:[.,]\d+)?)%",
        summary,
        re.I,
    )
    negative_change = bool(re.search(r"disminuci[oó]n|descenso|baj[oó]", summary, re.I))
    change = parse_number(change_match.group(1)) if change_match else None
    if change is not None and negative_change:
        change *= -1

    return {
        "moneda": "USD",
        "fuente": "binance",
        "nombre": "Dólar Binance",
        "promedio": average,
        "compra": parse_number(buy_match.group(1)) if buy_match else None,
        "venta": parse_number(sell_match.group(1)) if sell_match else None,
        "variacion": change,
        "variacionPorcentaje": None,
        "fechaActualizacion": parse_page_date(summary) or datetime.now(timezone.utc).isoformat(),
        "sourceUrl": EXCHANGE_URL,
    }


def parse_binance_quote(payload: dict[str, Any], trade_type: str) -> float:
    if not payload.get("success") or not payload.get("data"):
        raise ValueError(f"Binance P2P rechazó la consulta {trade_type}.")

    price = first_number([payload["data"].get("price")])
    if price is None:
        raise ValueError(f"Binance P2P no devolvió precio para {trade_type}.")
    return price


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


def get_auth_header() -> str | None:
    auth = os.environ.get("EXCHANGE_MONITOR_AUTH", "").strip()
    if auth:
        return auth if auth.lower().startswith("bearer ") else f"Bearer {auth}"

    app_id = os.environ.get("EXCHANGE_MONITOR_APP_ID", "").strip()
    api_key = os.environ.get("EXCHANGE_MONITOR_API_KEY", "").strip()
    return f"Bearer {app_id}:{api_key}" if app_id and api_key else None


def fetch_remote(url: str, headers: dict[str, str] | None = None) -> str:
    request_headers = {
        "Accept": "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": USER_AGENT,
    }
    request_headers.update(headers or {})
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch_official_api(auth_header: str) -> dict[str, Any]:
    url = (
        f"{EXCHANGE_API_URL}?timezone=America%2FCaracas"
        "&filter=binance&limit=10"
    )
    raw = fetch_remote(url, {"Accept": "application/json", "Authorization": auth_header})
    return parse_api_payload(json.loads(raw))


def fetch_binance_p2p() -> dict[str, Any]:
    def fetch_side(trade_type: str) -> float:
        query = urlencode({"fiat": "VES", "asset": "USDT", "tradeType": trade_type})
        payload = json.loads(fetch_remote(f"{BINANCE_P2P_URL}?{query}", {"Accept": "application/json"}))
        return parse_binance_quote(payload, trade_type)

    buy = fetch_side("BUY")
    sell = fetch_side("SELL")
    return {
        "moneda": "USD",
        "fuente": "binance-p2p",
        "nombre": "Dólar Binance",
        "promedio": (buy + sell) / 2,
        "compra": buy,
        "venta": sell,
        "variacion": None,
        "variacionPorcentaje": None,
        "fechaActualizacion": datetime.now(timezone.utc).isoformat(),
        "sourceUrl": "https://p2p.binance.com/",
    }


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
        failures: list[str] = []
        auth_header = get_auth_header()

        try:
            if auth_header:
                try:
                    self.send_json(200, fetch_official_api(auth_header))
                    return
                except Exception as error:
                    failures.append(f"API oficial: {error}")

            try:
                self.send_json(200, parse_page(fetch_remote(EXCHANGE_URL)))
                return
            except Exception as error:
                failures.append(f"página: {error}")

            try:
                self.send_json(
                    200,
                    parse_reader_page(fetch_remote(READER_URL, {"Accept": "text/plain"})),
                )
                return
            except Exception as error:
                failures.append(f"lector: {error}")

            try:
                self.send_json(200, fetch_binance_p2p())
                return
            except Exception as error:
                failures.append(f"Binance P2P: {error}")

            raise RuntimeError(" | ".join(failures))
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
