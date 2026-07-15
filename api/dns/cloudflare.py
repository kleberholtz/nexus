"""Provedor Cloudflare DNS (API v4, token Bearer)."""
from __future__ import annotations

from .base import DnsError, DnsProvider, http_json

API = "https://api.cloudflare.com/client/v4"


class CloudflareProvider(DnsProvider):
    type = "cloudflare"

    def __init__(self, config: dict):
        token = config.get("api_token", "").strip()
        if not token:
            raise DnsError("cloudflare: api_token é obrigatório")
        self._h = {"Authorization": f"Bearer {token}"}

    def _get(self, path: str) -> dict:
        return http_json("GET", f"{API}{path}", self._h)

    def list_zones(self) -> list[dict]:
        data = self._get("/zones?per_page=50")
        return [{"id": z["id"], "name": z["name"]} for z in data.get("result", [])]

    def list_records(self, zone_id: str) -> list[dict]:
        data = self._get(f"/zones/{zone_id}/dns_records?per_page=200")
        return [
            {
                "id": r["id"], "type": r["type"], "name": r["name"],
                "content": r["content"], "ttl": r.get("ttl", 1),
                "proxied": r.get("proxied", False),
                "proxiable": r.get("proxiable", False),
            }
            for r in data.get("result", [])
        ]

    def create_record(self, zone_id, rtype, name, content, ttl=300, proxied: bool = False) -> dict:
        body = {"type": rtype, "name": name, "content": content, "ttl": ttl or 1, "proxied": proxied}
        data = http_json("POST", f"{API}/zones/{zone_id}/dns_records", self._h, body)
        r = data["result"]
        return {
            "id": r["id"], "type": r["type"], "name": r["name"],
            "content": r["content"], "ttl": r.get("ttl"), "proxied": r.get("proxied", False),
            "proxiable": r.get("proxiable", False),
        }

    def update_record(self, zone_id, record_id, rtype, name, content, ttl=300, proxied: bool = False) -> dict:
        body = {"type": rtype, "name": name, "content": content, "ttl": ttl or 1, "proxied": proxied}
        data = http_json("PUT", f"{API}/zones/{zone_id}/dns_records/{record_id}", self._h, body)
        r = data["result"]
        return {
            "id": r["id"], "type": r["type"], "name": r["name"],
            "content": r["content"], "ttl": r.get("ttl"), "proxied": r.get("proxied", False),
            "proxiable": r.get("proxiable", False),
        }

    def delete_record(self, zone_id, record_id) -> None:
        http_json("DELETE", f"{API}/zones/{zone_id}/dns_records/{record_id}", self._h)
