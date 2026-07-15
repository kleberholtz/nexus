"""Inspeção de validade de domínios via RDAP.

O servidor autoritativo é descoberto pelo bootstrap DNS da IANA (RFC 9224), e
as datas vêm dos eventos `registration`/`expiration` da resposta RDAP (RFC 9083).
Só usa stdlib; o bootstrap fica em cache por 24h no processo.
"""
from __future__ import annotations

import datetime as dt
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json"
_CACHE_SECONDS = 24 * 60 * 60
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_EXPIRY_WARN_DAYS = 30

_cache_lock = threading.Lock()
_bootstrap_cache: tuple[float, dict[str, list[str]]] = (0.0, {})
_bootstrap_error: tuple[float, str] = (0.0, "")


class DomainCheckError(Exception):
    pass


def normalize_domain(raw: str) -> str:
    """Normaliza um domínio registrável para A-label (IDNA) e valida o formato."""
    value = (raw or "").strip().rstrip(".").lower()
    if not value or "://" in value or any(ch in value for ch in "/?#@"):
        raise DomainCheckError("informe apenas o domínio, sem protocolo ou caminho")
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise DomainCheckError("domínio inválido") from exc
    if len(value) > 253 or "." not in value:
        raise DomainCheckError("informe um domínio registrável, como exemplo.com")
    labels = value.split(".")
    if any(not label or len(label) > 63 or label.startswith("-") or label.endswith("-")
           or not all(ch.isalnum() or ch == "-" for ch in label) for label in labels):
        raise DomainCheckError("domínio inválido")
    return value


def _fetch_json(url: str, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/rdap+json, application/json", "User-Agent": "holtz-nexus-monitor/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(raw) > _MAX_RESPONSE_BYTES:
        raise DomainCheckError("resposta RDAP excedeu o limite permitido")
    payload = json.loads(raw.decode("utf-8", "replace"))
    if not isinstance(payload, dict):
        raise DomainCheckError("resposta RDAP inválida")
    return payload


def _bootstrap(timeout: float) -> dict[str, list[str]]:
    global _bootstrap_cache, _bootstrap_error
    now = time.monotonic()
    with _cache_lock:
        cached_at, cached = _bootstrap_cache
        if cached and now - cached_at < _CACHE_SECONDS:
            return cached
        error_at, error = _bootstrap_error
        if not cached and error and now - error_at < 300:
            raise DomainCheckError(error)
        try:
            payload = _fetch_json(BOOTSTRAP_URL, timeout)
        except Exception as exc:
            if cached:
                return cached  # bootstrap vencido ainda é melhor que indisponibilidade total
            error = str(exc) or type(exc).__name__
            _bootstrap_error = (now, error)
            raise DomainCheckError(error) from exc
        services: dict[str, list[str]] = {}
        for entry in payload.get("services") or []:
            if not isinstance(entry, list) or len(entry) != 2:
                continue
            suffixes, urls = entry
            clean_urls = [str(url) for url in (urls or []) if str(url).startswith(("https://", "http://"))]
            for suffix in suffixes or []:
                if clean_urls:
                    services[str(suffix).lower().lstrip(".")] = clean_urls
        if not services:
            raise DomainCheckError("bootstrap RDAP da IANA não retornou serviços")
        _bootstrap_cache = (now, services)
        _bootstrap_error = (0.0, "")
        return services


def _event_ts(payload: dict, *actions: str) -> int:
    wanted = {action.lower() for action in actions}
    for event in payload.get("events") or []:
        if not isinstance(event, dict) or str(event.get("eventAction", "")).lower() not in wanted:
            continue
        value = str(event.get("eventDate", "")).strip()
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return int(parsed.timestamp() * 1000)
        except (ValueError, OverflowError):
            continue
    return 0


def _result(payload: dict, now_ms: int | None = None) -> dict:
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    registered = _event_ts(payload, "registration", "reregistration")
    expires = _event_ts(payload, "expiration", "registrar expiration")
    if not expires:
        return {
            "status": "unknown", "registered_ts": registered, "expires_ts": 0,
            "message": "o servidor RDAP não informou a expiração do domínio",
        }
    remaining = expires - now
    if remaining <= 0:
        days = max(1, (abs(remaining) + 86_399_999) // 86_400_000)
        status, message = "expired", f"domínio expirado há {days} dia(s)"
    else:
        days = (remaining + 86_399_999) // 86_400_000
        if remaining <= _EXPIRY_WARN_DAYS * 86_400_000:
            status, message = "expiring", f"domínio expira em {days} dia(s)"
        else:
            status, message = "valid", f"domínio válido por mais {days} dia(s)"
    return {
        "status": status, "registered_ts": registered, "expires_ts": expires,
        "message": message,
    }


def check(raw_domain: str, timeout: float = 10.0) -> dict:
    """Consulta o RDAP autoritativo e devolve status/datas de validade."""
    try:
        domain = normalize_domain(raw_domain)
        timeout = max(5.0, min(float(timeout), 30.0))
        services = _bootstrap(timeout)
        tld = domain.rsplit(".", 1)[-1]
        urls = services.get(tld) or []
        if not urls:
            return {"status": "unavailable", "registered_ts": 0, "expires_ts": 0,
                    "message": f"TLD .{tld} sem servidor RDAP no bootstrap da IANA"}
        base = next((url for url in urls if url.startswith("https://")), urls[0])
        url = f"{base.rstrip('/')}/domain/{urllib.parse.quote(domain, safe='')}"
        payload = _fetch_json(url, timeout)
        if payload.get("objectClassName") != "domain":
            return {"status": "unknown", "registered_ts": 0, "expires_ts": 0,
                    "message": "resposta RDAP não representa um domínio"}
        return _result(payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {"status": "not_found", "registered_ts": 0, "expires_ts": 0,
                    "message": "domínio não encontrado no RDAP"}
        if exc.code == 429:
            message = "servidor RDAP limitou temporariamente as consultas"
        else:
            message = f"servidor RDAP respondeu HTTP {exc.code}"
        return {"status": "unavailable", "registered_ts": 0, "expires_ts": 0,
                "message": message}
    except (DomainCheckError, urllib.error.URLError, TimeoutError, OSError, ValueError,
            json.JSONDecodeError) as exc:
        return {"status": "unavailable", "registered_ts": 0, "expires_ts": 0,
                "message": str(exc) or type(exc).__name__}
