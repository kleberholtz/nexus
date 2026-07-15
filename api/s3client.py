"""Cliente S3 mínimo: PutObject via AWS Signature V4 (só stdlib).

Compatível com AWS S3 e serviços S3-compatible (MinIO, Cloudflare R2, Wasabi,
DigitalOcean Spaces, …) via `endpoint` custom. Usa path-style
(`endpoint/bucket/key`) para funcionar com qualquer provedor sem depender de
DNS de virtual-host. Sem SDKs.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import re
import urllib.error
import urllib.request
from urllib.parse import quote


class S3Error(Exception):
    pass


def _xml_tag(body: str, tag: str) -> str:
    """Extrai o texto de <tag>…</tag> de uma resposta de erro S3 (XML)."""
    m = re.search(rf"<{tag}>(.*?)</{tag}>", body, re.DOTALL)
    return m.group(1).strip() if m else ""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _signing_key(secret: str, date: str, region: str, service: str) -> bytes:
    k = _sign(("AWS4" + secret).encode(), date)
    k = _sign(k, region)
    k = _sign(k, service)
    return _sign(k, "aws4_request")


def _endpoint(config: dict) -> str:
    ep = str(config.get("endpoint", "")).strip().rstrip("/")
    if ep:
        # Endpoint sem esquema (ex.: "s3.amazonaws.com", "minio:9000") faria o
        # urllib estourar ValueError("unknown url type") → 500. Assume https.
        if not re.match(r"^https?://", ep, re.IGNORECASE):
            ep = f"https://{ep}"
        return ep
    region = str(config.get("region", "us-east-1")).strip() or "us-east-1"
    # Endpoint regional padrão da AWS.
    if region == "us-east-1":
        return "https://s3.amazonaws.com"
    return f"https://s3.{region}.amazonaws.com"


def _signed_request(config: dict, key: str, method: str, body: bytes = b"",
                    content_type: str | None = None) -> urllib.request.Request:
    bucket = str(config.get("bucket", "")).strip()
    access = str(config.get("access_key", "")).strip()
    secret = str(config.get("secret_key", "")).strip()
    region = str(config.get("region", "us-east-1")).strip() or "us-east-1"
    prefix = str(config.get("prefix", "")).strip().strip("/")
    if not (bucket and access and secret):
        raise S3Error("configuração S3 incompleta (bucket/access_key/secret_key)")

    obj_key = f"{prefix}/{key}" if prefix else key
    endpoint = _endpoint(config)
    host = endpoint.split("://", 1)[-1]
    # Path-style: /bucket/key (cada segmento do key é escapado, mas '/' preservado).
    canonical_uri = "/" + quote(bucket) + "/" + quote(obj_key, safe="/")
    url = f"{endpoint}{canonical_uri}"

    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = _sha256(body)
    service = "s3"

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    signed_headers = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    canonical_request = "\n".join([
        method, canonical_uri, "", canonical_headers, signed_headers, payload_hash,
    ])

    scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, scope, _sha256(canonical_request.encode()),
    ])
    signature = hmac.new(
        _signing_key(secret, date_stamp, region, service), string_to_sign.encode(), hashlib.sha256
    ).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    req_body = body if method in ("PUT", "POST") else None
    req = urllib.request.Request(url, data=req_body, method=method)
    req.add_header("Authorization", authorization)
    req.add_header("x-amz-date", amz_date)
    req.add_header("x-amz-content-sha256", payload_hash)
    if content_type:
        req.add_header("Content-Type", content_type)
    if req_body is not None:
        req.add_header("Content-Length", str(len(body)))
    return req


def put_object(config: dict, key: str, body: bytes,
               content_type: str = "application/octet-stream") -> None:
    """Envia `body` para `bucket/prefix/key` usando as credenciais em `config`."""
    try:
        req = _signed_request(config, key, "PUT", body, content_type)
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status not in (200, 201):
                raise S3Error(f"S3 respondeu {resp.status}")
    except S3Error:
        raise
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", "replace")
        # Respostas de erro do S3 são XML (<Error><Code/><Message/></Error>);
        # extrai Code/Message p/ uma mensagem legível em vez de despejar o XML.
        code = _xml_tag(err, "Code")
        msg = _xml_tag(err, "Message")
        region = _xml_tag(err, "Region")  # PermanentRedirect informa a região certa
        detail = " — ".join(p for p in (code, msg) if p) or err.strip()[:400]
        if region:
            detail += f" (região correta do bucket: {region})"
        raise S3Error(f"S3 HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise S3Error(f"falha de conexão com o S3: {exc.reason}")
    except Exception as exc:  # rede/timeout de leitura/etc. — nunca vazar 500
        raise S3Error(f"falha ao enviar ao S3: {exc}")


def get_object(config: dict, key: str) -> bytes:
    """Baixa `bucket/prefix/key` usando as credenciais em `config`."""
    try:
        req = _signed_request(config, key, "GET")
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status not in (200, 206):
                raise S3Error(f"S3 respondeu {resp.status}")
            return resp.read()
    except S3Error:
        raise
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", "replace")
        code = _xml_tag(err, "Code")
        msg = _xml_tag(err, "Message")
        detail = " — ".join(p for p in (code, msg) if p) or err.strip()[:400]
        raise S3Error(f"S3 HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise S3Error(f"falha de conexão com o S3: {exc.reason}")
    except Exception as exc:
        raise S3Error(f"falha ao baixar do S3: {exc}")


def object_exists(config: dict, key: str) -> bool:
    """Retorna se `bucket/prefix/key` existe, usando HeadObject."""
    try:
        req = _signed_request(config, key, "HEAD")
        with urllib.request.urlopen(req, timeout=15) as resp:
            return 200 <= resp.status < 300
    except S3Error:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return False
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise S3Error(f"S3 HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise S3Error(f"falha de conexão com o S3: {exc.reason}")
    except Exception as exc:  # nunca vazar 500
        raise S3Error(f"falha ao consultar o S3: {exc}")


def delete_object(config: dict, key: str) -> None:
    """Remove `bucket/prefix/key`, tratando 404 como sucesso idempotente."""
    try:
        req = _signed_request(config, key, "DELETE")
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status not in (200, 202, 204):
                raise S3Error(f"S3 respondeu {resp.status}")
    except S3Error:
        raise
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise S3Error(f"S3 HTTP {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        raise S3Error(f"falha de conexão com o S3: {exc.reason}")
    except Exception as exc:
        raise S3Error(f"falha ao remover do S3: {exc}")
