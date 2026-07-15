"""Provedor Amazon Route 53 (REST/XML, assinatura SigV4 em stdlib).

Route 53 não tem "id" de registro; usamos `name|TYPE` como identificador e
operamos via ChangeResourceRecordSets (UPSERT/DELETE).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import xml.etree.ElementTree as ET
from urllib.parse import quote

from .base import DnsError, DnsProvider, http

HOST = "route53.amazonaws.com"
REGION = "us-east-1"
SERVICE = "route53"
NS = "https://route53.amazonaws.com/doc/2013-04-01/"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class Route53Provider(DnsProvider):
    type = "route53"

    def __init__(self, config: dict):
        self._ak = config.get("access_key", "").strip()
        self._sk = config.get("secret_key", "").strip()
        if not (self._ak and self._sk):
            raise DnsError("route53: access_key e secret_key são obrigatórios")

    # -- SigV4 -------------------------------------------------------------- #
    def _request(self, method: str, path: str, query: str = "", body: str = "") -> bytes:
        now = dt.datetime.now(dt.timezone.utc)
        amzdate = now.strftime("%Y%m%dT%H%M%SZ")
        datestamp = now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(body.encode()).hexdigest()

        canonical_headers = f"host:{HOST}\nx-amz-date:{amzdate}\n"
        signed_headers = "host;x-amz-date"
        canonical_request = "\n".join([
            method, path, query, canonical_headers, signed_headers, payload_hash,
        ])
        scope = f"{datestamp}/{REGION}/{SERVICE}/aws4_request"
        to_sign = "\n".join([
            "AWS4-HMAC-SHA256", amzdate, scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ])
        k_date = _sign(("AWS4" + self._sk).encode(), datestamp)
        k_region = _sign(k_date, REGION)
        k_service = _sign(k_region, SERVICE)
        k_signing = _sign(k_service, "aws4_request")
        signature = hmac.new(k_signing, to_sign.encode(), hashlib.sha256).hexdigest()
        auth = (
            f"AWS4-HMAC-SHA256 Credential={self._ak}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        headers = {"x-amz-date": amzdate, "Authorization": auth, "Content-Type": "text/xml"}
        url = f"https://{HOST}{path}" + (f"?{query}" if query else "")
        status, raw = http(method, url, headers, body or None)
        if status >= 400:
            raise DnsError(f"route53 HTTP {status}: {raw.decode('utf-8', 'replace')[:300]}")
        return raw

    @staticmethod
    def _tag(el, name):
        return el.find(f"{{{NS}}}{name}")

    def list_zones(self) -> list[dict]:
        raw = self._request("GET", "/2013-04-01/hostedzone")
        root = ET.fromstring(raw)
        zones = []
        for hz in root.iter(f"{{{NS}}}HostedZone"):
            zid = self._tag(hz, "Id").text.split("/")[-1]
            name = self._tag(hz, "Name").text
            zones.append({"id": zid, "name": name.rstrip(".")})
        return zones

    def list_records(self, zone_id: str) -> list[dict]:
        raw = self._request("GET", f"/2013-04-01/hostedzone/{zone_id}/rrset")
        root = ET.fromstring(raw)
        out = []
        for rr in root.iter(f"{{{NS}}}ResourceRecordSet"):
            name = self._tag(rr, "Name").text.rstrip(".")
            rtype = self._tag(rr, "Type").text
            ttl_el = self._tag(rr, "TTL")
            ttl = int(ttl_el.text) if ttl_el is not None else 300
            for val in rr.iter(f"{{{NS}}}ResourceRecord"):
                content = self._tag(val, "Value").text
                out.append({
                    "id": f"{name}|{rtype}", "type": rtype, "name": name,
                    "content": content.strip('"') if rtype == "TXT" else content, "ttl": ttl,
                })
        return out

    def _change(self, zone_id: str, action: str, rtype: str, name: str, content: str, ttl: int) -> None:
        value = f'"{content}"' if rtype == "TXT" else content
        body = (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<ChangeResourceRecordSetsRequest xmlns="{NS}"><ChangeBatch><Changes>'
            f'<Change><Action>{action}</Action><ResourceRecordSet>'
            f'<Name>{name}</Name><Type>{rtype}</Type><TTL>{ttl}</TTL>'
            f'<ResourceRecords><ResourceRecord><Value>{value}</Value></ResourceRecord></ResourceRecords>'
            f'</ResourceRecordSet></Change></Changes></ChangeBatch></ChangeResourceRecordSetsRequest>'
        )
        self._request("POST", f"/2013-04-01/hostedzone/{zone_id}/rrset/", body=body)

    def create_record(self, zone_id, rtype, name, content, ttl=300) -> dict:
        self._change(zone_id, "UPSERT", rtype, name, content, ttl or 300)
        return {"id": f"{name.rstrip('.')}|{rtype}", "type": rtype, "name": name, "content": content, "ttl": ttl}

    def update_record(self, zone_id, record_id, rtype, name, content, ttl=300) -> dict:
        self._change(zone_id, "UPSERT", rtype, name, content, ttl or 300)
        return {"id": f"{name.rstrip('.')}|{rtype}", "type": rtype, "name": name, "content": content, "ttl": ttl}

    def delete_record(self, zone_id, record_id) -> None:
        # record_id = "name|TYPE"; precisa do valor atual p/ montar o DELETE.
        name, _, rtype = record_id.rpartition("|")
        for r in self.list_records(zone_id):
            if r["id"] == record_id:
                self._change(zone_id, "DELETE", rtype, name, r["content"], r["ttl"])
                return
        raise DnsError(f"registro não encontrado: {record_id}")

    def set_txt(self, fqdn: str, value: str, ttl: int = 60):
        z = self._find_zone(fqdn)
        self._change(z["id"], "UPSERT", "TXT", fqdn.rstrip(".") + ".", value, ttl)
        return z["id"], f"{fqdn.rstrip('.')}|TXT"
