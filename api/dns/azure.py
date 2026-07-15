"""Provedor Azure DNS (client credentials → token → Resource Manager REST)."""
from __future__ import annotations

import json
import time
from urllib.parse import urlencode

from .base import DnsError, DnsProvider, http, http_json

MGMT = "https://management.azure.com"
API_VERSION = "2018-05-01"


class AzureProvider(DnsProvider):
    type = "azure"

    def __init__(self, config: dict):
        self._tenant = config.get("tenant_id", "").strip()
        self._client = config.get("client_id", "").strip()
        self._secret = config.get("client_secret", "").strip()
        self._sub = config.get("subscription_id", "").strip()
        self._rg = config.get("resource_group", "").strip()
        if not all([self._tenant, self._client, self._secret, self._sub, self._rg]):
            raise DnsError("azure: tenant_id, client_id, client_secret, subscription_id e resource_group são obrigatórios")
        self._token: str | None = None
        self._token_exp = 0

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        url = f"https://login.microsoftonline.com/{self._tenant}/oauth2/v2.0/token"
        form = urlencode({
            "grant_type": "client_credentials", "client_id": self._client,
            "client_secret": self._secret, "scope": f"{MGMT}/.default",
        })
        status, raw = http("POST", url, {"Content-Type": "application/x-www-form-urlencoded"}, form)
        if status >= 400:
            raise DnsError(f"azure token HTTP {status}: {raw.decode('utf-8','replace')[:200]}")
        data = json.loads(raw)
        self._token = data["access_token"]
        self._token_exp = int(time.time()) + int(data.get("expires_in", 3600))
        return self._token

    def _h(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token()}"}

    def _base(self) -> str:
        return (f"{MGMT}/subscriptions/{self._sub}/resourceGroups/{self._rg}"
                f"/providers/Microsoft.Network/dnsZones")

    def list_zones(self) -> list[dict]:
        data = http_json("GET", f"{self._base()}?api-version={API_VERSION}", self._h())
        return [{"id": z["name"], "name": z["name"]} for z in data.get("value", [])]

    def list_records(self, zone_id: str) -> list[dict]:
        data = http_json("GET", f"{self._base()}/{zone_id}/recordsets?api-version={API_VERSION}", self._h())
        out = []
        for rs in data.get("value", []):
            rtype = rs["type"].split("/")[-1]  # Microsoft.Network/dnsZones/A -> A
            name = rs["name"]
            props = rs.get("properties", {})
            ttl = props.get("TTL", 300)
            for content in _contents(rtype, props):
                out.append({"id": f"{name}|{rtype}", "type": rtype, "name": name, "content": content, "ttl": ttl})
        return out

    def _put(self, zone_id, rtype, rel_name, content, ttl):
        url = f"{self._base()}/{zone_id}/{rtype}/{rel_name}?api-version={API_VERSION}"
        body = {"properties": {"TTL": ttl or 300, **_record_body(rtype, content)}}
        return http_json("PUT", url, self._h(), body)

    def create_record(self, zone_id, rtype, name, content, ttl=300) -> dict:
        rel = _relative(name, zone_id)
        self._put(zone_id, rtype, rel, content, ttl)
        return {"id": f"{rel}|{rtype}", "type": rtype, "name": rel, "content": content, "ttl": ttl}

    def update_record(self, zone_id, record_id, rtype, name, content, ttl=300) -> dict:
        rel = _relative(name, zone_id)
        self._put(zone_id, rtype, rel, content, ttl)
        return {"id": f"{rel}|{rtype}", "type": rtype, "name": rel, "content": content, "ttl": ttl}

    def delete_record(self, zone_id, record_id) -> None:
        rel, _, rtype = record_id.rpartition("|")
        url = f"{self._base()}/{zone_id}/{rtype}/{rel}?api-version={API_VERSION}"
        http_json("DELETE", url, self._h())

    def set_txt(self, fqdn: str, value: str, ttl: int = 60):
        z = self._find_zone(fqdn)
        rel = _relative(fqdn.rstrip("."), z["id"])
        self._put(z["id"], "TXT", rel, value, ttl)
        return z["id"], f"{rel}|TXT"


def _relative(name: str, zone: str) -> str:
    n = name.rstrip(".")
    z = zone.rstrip(".")
    if n == z:
        return "@"
    return n[: -(len(z) + 1)] if n.endswith("." + z) else n


def _record_body(rtype: str, content: str) -> dict:
    if rtype == "TXT":
        return {"TXTRecords": [{"value": [content]}]}
    if rtype == "A":
        return {"ARecords": [{"ipv4Address": content}]}
    if rtype == "AAAA":
        return {"AAAARecords": [{"ipv6Address": content}]}
    if rtype == "CNAME":
        return {"CNAMERecord": {"cname": content}}
    if rtype == "MX":
        pref, _, ex = content.partition(" ")
        return {"MXRecords": [{"preference": int(pref or 10), "exchange": ex or content}]}
    if rtype == "NS":
        return {"NSRecords": [{"nsdname": content}]}
    return {"TXTRecords": [{"value": [content]}]}


def _contents(rtype: str, props: dict) -> list[str]:
    if rtype == "TXT":
        return [" ".join(r.get("value", [])) for r in props.get("TXTRecords", [])]
    if rtype == "A":
        return [r["ipv4Address"] for r in props.get("ARecords", [])]
    if rtype == "AAAA":
        return [r["ipv6Address"] for r in props.get("AAAARecords", [])]
    if rtype == "CNAME":
        c = props.get("CNAMERecord", {})
        return [c["cname"]] if c else []
    if rtype == "MX":
        return [f"{r['preference']} {r['exchange']}" for r in props.get("MXRecords", [])]
    if rtype == "NS":
        return [r["nsdname"] for r in props.get("NSRecords", [])]
    return []
