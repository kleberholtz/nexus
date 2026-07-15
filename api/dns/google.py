"""Provedor Google Cloud DNS (service account → JWT RS256 → REST)."""
from __future__ import annotations

import base64
import json
import time
from urllib.parse import urlencode

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from .base import DnsError, DnsProvider, http, http_json

API = "https://dns.googleapis.com/dns/v1/projects"
SCOPE = "https://www.googleapis.com/auth/ndev.clouddns.readwrite"


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class GoogleProvider(DnsProvider):
    type = "google"

    def __init__(self, config: dict):
        sa = config.get("service_account")
        if isinstance(sa, str):
            sa = json.loads(sa)
        if not sa or "private_key" not in sa:
            raise DnsError("google: service_account (JSON da conta de serviço) é obrigatório")
        self._sa = sa
        self._project = config.get("project_id") or sa.get("project_id")
        if not self._project:
            raise DnsError("google: project_id é obrigatório")
        self._token: str | None = None
        self._token_exp = 0

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        now = int(time.time())
        token_uri = self._sa.get("token_uri", "https://oauth2.googleapis.com/token")
        header = {"alg": "RS256", "typ": "JWT"}
        claim = {"iss": self._sa["client_email"], "scope": SCOPE,
                 "aud": token_uri, "iat": now, "exp": now + 3600}
        signing_input = f"{_b64u(json.dumps(header).encode())}.{_b64u(json.dumps(claim).encode())}"
        key = serialization.load_pem_private_key(self._sa["private_key"].encode(), password=None)
        sig = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
        jwt = f"{signing_input}.{_b64u(sig)}"
        form = urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt})
        status, raw = http("POST", token_uri,
                           {"Content-Type": "application/x-www-form-urlencoded"}, form)
        if status >= 400:
            raise DnsError(f"google token HTTP {status}: {raw.decode('utf-8','replace')[:200]}")
        data = json.loads(raw)
        self._token = data["access_token"]
        self._token_exp = now + int(data.get("expires_in", 3600))
        return self._token

    def _h(self) -> dict:
        return {"Authorization": f"Bearer {self._access_token()}"}

    def list_zones(self) -> list[dict]:
        data = http_json("GET", f"{API}/{self._project}/managedZones", self._h())
        return [{"id": z["name"], "name": z["dnsName"].rstrip(".")} for z in data.get("managedZones", [])]

    def list_records(self, zone_id: str) -> list[dict]:
        data = http_json("GET", f"{API}/{self._project}/managedZones/{zone_id}/rrsets", self._h())
        out = []
        for r in data.get("rrsets", []):
            name = r["name"].rstrip(".")
            for content in r.get("rrdatas", []):
                out.append({
                    "id": f"{name}|{r['type']}", "type": r["type"], "name": name,
                    "content": content.strip('"') if r["type"] == "TXT" else content,
                    "ttl": r.get("ttl", 300),
                })
        return out

    def _rrset(self, rtype, name, content, ttl):
        data = f'"{content}"' if rtype == "TXT" else content
        return {"name": name.rstrip(".") + ".", "type": rtype, "ttl": ttl or 300, "rrdatas": [data]}

    def _change(self, zone_id, additions=None, deletions=None):
        body = {}
        if additions:
            body["additions"] = additions
        if deletions:
            body["deletions"] = deletions
        http_json("POST", f"{API}/{self._project}/managedZones/{zone_id}/changes", self._h(), body)

    def _existing(self, zone_id, record_id):
        for r in self.list_records(zone_id):
            if r["id"] == record_id:
                return r
        return None

    def create_record(self, zone_id, rtype, name, content, ttl=300) -> dict:
        self._change(zone_id, additions=[self._rrset(rtype, name, content, ttl)])
        return {"id": f"{name.rstrip('.')}|{rtype}", "type": rtype, "name": name, "content": content, "ttl": ttl}

    def update_record(self, zone_id, record_id, rtype, name, content, ttl=300) -> dict:
        old = self._existing(zone_id, record_id)
        deletions = [self._rrset(old["type"], old["name"], old["content"], old["ttl"])] if old else None
        self._change(zone_id, additions=[self._rrset(rtype, name, content, ttl)], deletions=deletions)
        return {"id": f"{name.rstrip('.')}|{rtype}", "type": rtype, "name": name, "content": content, "ttl": ttl}

    def delete_record(self, zone_id, record_id) -> None:
        old = self._existing(zone_id, record_id)
        if not old:
            raise DnsError(f"registro não encontrado: {record_id}")
        self._change(zone_id, deletions=[self._rrset(old["type"], old["name"], old["content"], old["ttl"])])
