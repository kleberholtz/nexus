"""Abstração de provedor DNS + helper HTTP (urllib, sem SDKs)."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from abc import ABC, abstractmethod


class DnsError(Exception):
    """Erro de provedor DNS (mapeado para HTTP 400/502 no router)."""


def http(method: str, url: str, headers: dict | None = None,
         body: bytes | str | None = None, timeout: int = 20) -> tuple[int, bytes]:
    data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        raise DnsError(f"falha de rede: {e}")


def http_json(method: str, url: str, headers: dict | None = None,
              body: dict | None = None, timeout: int = 20) -> dict:
    h = {"Accept": "application/json", **(headers or {})}
    payload = None
    if body is not None:
        h["Content-Type"] = "application/json"
        payload = json.dumps(body).encode()
    status, raw = http(method, url, h, payload, timeout)
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {"_raw": raw.decode("utf-8", "replace")}
    if status >= 400:
        raise DnsError(f"HTTP {status}: {str(parsed)[:300]}")
    return parsed


def zone_of(domain: str, zones: list[dict]) -> dict | None:
    """Escolhe a zona cujo `name` é o sufixo mais longo do domínio."""
    d = domain.rstrip(".").lower()
    best = None
    for z in zones:
        zn = z["name"].rstrip(".").lower()
        if d == zn or d.endswith("." + zn):
            if best is None or len(zn) > len(best["name"].rstrip(".")):
                best = z
    return best


class DnsProvider(ABC):
    """Interface comum. `record` = {id, type, name, content, ttl, ...}."""

    type: str = "base"

    @abstractmethod
    def list_zones(self) -> list[dict]:
        """[{id, name}]"""

    @abstractmethod
    def list_records(self, zone_id: str) -> list[dict]:
        """[{id, type, name, content, ttl, ...}]"""

    @abstractmethod
    def create_record(self, zone_id: str, rtype: str, name: str, content: str, ttl: int = 300) -> dict:
        ...

    @abstractmethod
    def update_record(self, zone_id: str, record_id: str, rtype: str, name: str, content: str, ttl: int = 300) -> dict:
        ...

    @abstractmethod
    def delete_record(self, zone_id: str, record_id: str) -> None:
        ...

    # --- helpers p/ ACME DNS-01 (usados pelo cliente ACME) ----------------- #
    def _find_zone(self, fqdn: str) -> dict:
        z = zone_of(fqdn, self.list_zones())
        if not z:
            raise DnsError(f"nenhuma zona encontrada para {fqdn}")
        return z

    def set_txt(self, fqdn: str, value: str, ttl: int = 60) -> tuple[str, str]:
        """Cria um registro TXT. Retorna (zone_id, record_id)."""
        z = self._find_zone(fqdn)
        rec = self.create_record(z["id"], "TXT", fqdn.rstrip("."), value, ttl)
        return z["id"], rec["id"]

    def delete_txt(self, zone_id: str, record_id: str) -> None:
        self.delete_record(zone_id, record_id)
