"""Cliente ACME (RFC 8555) puro, com desafio DNS-01 — sem certbot.

Emite certificados Let's Encrypt usando um provedor DNS (api/dns) para publicar
os registros TXT `_acme-challenge`. Chave de conta ECDSA P-256 (ES256), CSR e
cadeia escritos em /etc/certs. Use `staging=True` para o ambiente de testes do
Let's Encrypt (padrão), evitando os rate limits de produção.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
import urllib.error
import urllib.request

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.x509.oid import NameOID

from . import certs as certmod
from .dns.base import DnsProvider

DIRECTORY = {
    "production": "https://acme-v02.api.letsencrypt.org/directory",
    "staging": "https://acme-staging-v02.api.letsencrypt.org/directory",
}
ACCOUNT_KEY = certmod.CERTS_DIR / "acme" / "account.key"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _load_account_key() -> ec.EllipticCurvePrivateKey:
    ACCOUNT_KEY.parent.mkdir(parents=True, exist_ok=True)
    if ACCOUNT_KEY.exists():
        return serialization.load_pem_private_key(ACCOUNT_KEY.read_bytes(), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    certmod.write_key(ACCOUNT_KEY, key)
    return key


def _jwk(key: ec.EllipticCurvePrivateKey) -> dict:
    nums = key.public_key().public_numbers()
    x = nums.x.to_bytes(32, "big")
    y = nums.y.to_bytes(32, "big")
    return {"crv": "P-256", "kty": "EC", "x": _b64(x), "y": _b64(y)}


def _thumbprint(jwk: dict) -> str:
    canon = json.dumps(jwk, sort_keys=True, separators=(",", ":")).encode()
    return _b64(hashlib.sha256(canon).digest())


class AcmeError(Exception):
    pass


class AcmeClient:
    def __init__(self, email: str, staging: bool = True):
        self.email = email
        self.key = _load_account_key()
        self.jwk = _jwk(self.key)
        self.directory_url = DIRECTORY["staging" if staging else "production"]
        self._nonce: str | None = None
        self._dir: dict = {}
        self.kid: str | None = None

    # -- transporte --------------------------------------------------------- #
    def _raw(self, method: str, url: str, data: bytes | None = None,
             ctype: str = "application/jose+json"):
        headers = {"User-Agent": "holtz-nexus-acme/1.0"}
        if data is not None:
            headers["Content-Type"] = ctype
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            body = resp.read()
            hdrs = resp.headers
            status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read()
            hdrs = e.headers
            status = e.code
        if hdrs.get("Replay-Nonce"):
            self._nonce = hdrs["Replay-Nonce"]
        return status, hdrs, body

    def _directory(self):
        if not self._dir:
            _, _, body = self._raw("GET", self.directory_url)
            self._dir = json.loads(body)
        return self._dir

    def _new_nonce(self):
        if self._nonce is None:
            self._raw("HEAD", self._directory()["newNonce"])
        return self._nonce

    def _sign(self, payload: bytes, url: str) -> bytes:
        der = self.key.sign(payload, ec.ECDSA(hashes.SHA256()))
        r, s = utils.decode_dss_signature(der)
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")

    def _post(self, url: str, payload: dict | None, use_jwk: bool = False):
        protected = {"alg": "ES256", "nonce": self._new_nonce(), "url": url}
        if use_jwk:
            protected["jwk"] = self.jwk
        else:
            protected["kid"] = self.kid
        protected_b64 = _b64(json.dumps(protected).encode())
        payload_b64 = "" if payload is None else _b64(json.dumps(payload).encode())
        signing_input = f"{protected_b64}.{payload_b64}".encode()
        sig = self._sign(signing_input, url)
        body = json.dumps({
            "protected": protected_b64, "payload": payload_b64, "signature": _b64(sig),
        }).encode()
        status, hdrs, resp = self._raw("POST", url, body)
        if status >= 400:
            raise AcmeError(f"ACME {status}: {resp.decode('utf-8', 'replace')[:400]}")
        parsed = json.loads(resp) if resp and resp[:1] in (b"{", b"[") else resp
        return status, hdrs, parsed

    # -- fluxo -------------------------------------------------------------- #
    def register(self):
        d = self._directory()
        _, hdrs, _ = self._post(d["newAccount"],
                                {"termsOfServiceAgreed": True, "contact": [f"mailto:{self.email}"]},
                                use_jwk=True)
        self.kid = hdrs["Location"]

    def issue(self, domains: list[str], provider: DnsProvider,
              propagation_wait: int = 25) -> dict:
        if not domains:
            raise AcmeError("informe ao menos um domínio")
        self.register()
        d = self._directory()

        # 1) new order
        _, hdrs, order = self._post(d["newOrder"],
                                    {"identifiers": [{"type": "dns", "value": dm} for dm in domains]})
        order_url = hdrs["Location"]

        # 2) resolve cada autorização via DNS-01
        published: list[tuple] = []  # (zone_id, record_id)
        try:
            for authz_url in order["authorizations"]:
                _, _, authz = self._post(authz_url, None)  # POST-as-GET
                domain = authz["identifier"]["value"]
                chall = next(c for c in authz["challenges"] if c["type"] == "dns-01")
                key_auth = f"{chall['token']}.{_thumbprint(self.jwk)}"
                txt_value = _b64(hashlib.sha256(key_auth.encode()).digest())
                fqdn = f"_acme-challenge.{domain}"
                published.append(provider.set_txt(fqdn, txt_value))
                # sinaliza que o desafio está pronto
                self._post(chall["url"], {})

            # espera propagação e valida
            time.sleep(propagation_wait)
            for authz_url in order["authorizations"]:
                self._wait_status(authz_url, {"valid"}, {"invalid"}, "autorização")

            # 3) finalize com CSR
            cert_key = ec.generate_private_key(ec.SECP256R1())
            csr = _build_csr(cert_key, domains)
            self._post(order["finalize"], {"csr": _b64(csr)})
            final = self._wait_status(order_url, {"valid"}, {"invalid"}, "ordem")

            # 4) baixa a cadeia (PEM)
            _, _, chain = self._post(final["certificate"], None)
            pem = chain if isinstance(chain, (bytes, bytearray)) else str(chain).encode()

            name = certmod._slug(domains[0])
            crt_path = certmod.CERTS_DIR / f"{name}.crt"
            key_path = certmod.CERTS_DIR / f"{name}.key"
            certmod.write_cert(crt_path, bytes(pem))
            certmod.write_key(key_path, cert_key)
            return {"name": name, "domains": domains,
                    "cert_path": str(crt_path), "key_path": str(key_path)}
        finally:
            for zone_id, record_id in published:
                try:
                    provider.delete_txt(zone_id, record_id)
                except Exception:  # noqa: BLE001 - limpeza best-effort
                    pass

    def _wait_status(self, url: str, ok: set[str], bad: set[str], what: str,
                     tries: int = 30, delay: float = 3.0) -> dict:
        for _ in range(tries):
            _, _, obj = self._post(url, None)
            status = obj.get("status")
            if status in ok:
                return obj
            if status in bad:
                raise AcmeError(f"{what} falhou: {json.dumps(obj)[:400]}")
            time.sleep(delay)
        raise AcmeError(f"timeout aguardando {what} ({url})")


def _build_csr(key, domains: list[str]) -> bytes:
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, domains[0])]))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(d) for d in domains]), critical=False)
        .sign(key, hashes.SHA256())
    )
    return csr.public_bytes(serialization.Encoding.DER)
