"""Gerência de certificados em /etc/certs: listar, emitir self-signed, remover.

Emissão via Let's Encrypt fica em api/acme.py (ACME DNS-01). Aqui ficam as
operações locais e a leitura dos metadados dos certificados existentes.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import os
import re
import time
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .db import get_session
from .db.models import CertMeta

CERTS_DIR = Path(os.environ.get("CERTS_DIR", "/etc/certs"))
# CAs próprias ficam num subdiretório (não colidem com os certs de servidor;
# `list_certs` faz glob não-recursivo em CERTS_DIR/*.crt).
CA_DIR = CERTS_DIR / "ca"

# Renova quando faltar menos que isto (dias), por tipo.
RENEW_THRESHOLD = {"letsencrypt": 30, "self-signed": 15, "ca-signed": 15}

# Nomes reservados (infra) que não devem aparecer como certificados de domínio.
_RESERVED = {"ca", "api"}


def _new_key(use_rsa: bool):
    if use_rsa:
        return rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return ec.generate_private_key(ec.SECP256R1())


def _san(names: list[str]) -> list[x509.GeneralName]:
    out: list[x509.GeneralName] = []
    for n in names:
        try:
            out.append(x509.IPAddress(ipaddress.ip_address(n)))
        except ValueError:
            out.append(x509.DNSName(n))
    return out


def _pubkey_bytes(pub) -> bytes:
    """DER da chave pública (para comparar cert × chave privada)."""
    return pub.public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )


# --------------------------------------------------------------------------- #
# Leitura / listagem
# --------------------------------------------------------------------------- #
def _classify(cert: x509.Certificate) -> str:
    issuer = cert.issuer.rfc4514_string().lower()
    if cert.issuer == cert.subject:
        return "self-signed"
    if "let's encrypt" in issuer or "letsencrypt" in issuer or "r3" in issuer or "e1" in issuer:
        return "letsencrypt"
    return "ca-signed"


def _domains(cert: x509.Certificate) -> list[str]:
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        return [str(v) for v in ext.value.get_values_for_type(x509.DNSName)]
    except x509.ExtensionNotFound:
        try:
            return [cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value]
        except (IndexError, ValueError):
            return []


def list_certs() -> list[dict]:
    out: list[dict] = []
    if not CERTS_DIR.exists():
        return out
    metas = {m["name"]: m for m in list_meta()}
    for crt in sorted(CERTS_DIR.glob("*.crt")):
        name = crt.stem
        if name in _RESERVED:
            continue
        try:
            cert = x509.load_pem_x509_certificate(crt.read_bytes())
        except Exception:
            continue
        not_after = cert.not_valid_after_utc
        days = (not_after - dt.datetime.now(dt.timezone.utc)).days
        cn = ""
        try:
            cn = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME)[0].value
        except (IndexError, ValueError):
            pass
        meta = metas.get(name, {})
        out.append({
            "name": name,
            "common_name": cn,
            "domains": _domains(cert),
            "type": _classify(cert),
            "issuer": cert.issuer.rfc4514_string(),
            "not_before": cert.not_valid_before_utc.isoformat(),
            "not_after": not_after.isoformat(),
            "days_left": days,
            "expired": days < 0,
            "has_key": crt.with_suffix(".key").exists(),
            "cert_path": str(crt),
            "key_path": str(crt.with_suffix(".key")),
            "auto_renew": bool(meta.get("auto_renew", False)),
        })
    return out


# --------------------------------------------------------------------------- #
# Metadados (auto-renovação)
# --------------------------------------------------------------------------- #
def save_meta(name: str, kind: str, *, domains=None, ips=None, days=825, rsa=False,
              provider_id=None, staging=True, auto_renew=False, ca_name=None) -> None:
    with get_session() as s:
        row = s.get(CertMeta, name) or CertMeta(name=name)
        row.kind = kind
        row.domains = json.dumps(domains or [])
        row.ips = json.dumps(ips or [])
        row.days = int(days)
        row.rsa = bool(rsa)
        row.provider_id = provider_id
        row.staging = bool(staging)
        row.auto_renew = bool(auto_renew)
        row.ca_name = ca_name
        row.updated_ts = int(time.time() * 1000)
        s.merge(row)
        s.commit()


def _meta_dict(m: CertMeta) -> dict:
    return {
        "name": m.name, "kind": m.kind,
        "domains": json.loads(m.domains or "[]"), "ips": json.loads(m.ips or "[]"),
        "days": m.days, "rsa": m.rsa, "provider_id": m.provider_id,
        "staging": m.staging, "auto_renew": m.auto_renew, "ca_name": m.ca_name,
    }


def list_meta() -> list[dict]:
    with get_session() as s:
        return [_meta_dict(m) for m in s.query(CertMeta).all()]


def delete_meta(name: str) -> None:
    with get_session() as s:
        row = s.get(CertMeta, name)
        if row:
            s.delete(row)
            s.commit()


def set_auto_renew(name: str, auto_renew: bool) -> bool:
    """Liga/desliga a auto-renovação de um certificado existente. Se não houver
    metadados ainda (ex.: cert importado/externo), cria um registro mínimo
    classificando o próprio certificado."""
    slug = _slug(name)
    crt = CERTS_DIR / f"{slug}.crt"
    if not crt.exists():
        return False
    with get_session() as s:
        row = s.get(CertMeta, slug)
        if row is None:
            try:
                cert = x509.load_pem_x509_certificate(crt.read_bytes())
                kind, domains = _classify(cert), _domains(cert)
            except Exception:  # noqa: BLE001
                kind, domains = "self-signed", []
            row = CertMeta(name=slug, kind=kind, domains=json.dumps(domains),
                           ips=json.dumps([]), days=365)
        row.auto_renew = bool(auto_renew)
        row.updated_ts = int(time.time() * 1000)
        s.merge(row)
        s.commit()
    return True


# --------------------------------------------------------------------------- #
# Emissão self-signed
# --------------------------------------------------------------------------- #
def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-.")
    return s or "cert"


def _build_self_signed(names: list[str], days: int, use_rsa: bool):
    """Monta (key, cert) self-signed com SAN=`names` (1º nome vira CN)."""
    cn = names[0]
    key = _new_key(use_rsa)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=days))
        .add_extension(x509.SubjectAlternativeName(_san(names)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    return key, cert


def issue_self_signed_at(cert_path, key_path, names: list[str],
                         days: int = 825, use_rsa: bool = False) -> None:
    """Emite um self-signed gravando nos caminhos exatos informados (usado no
    boot para satisfazer `ssl_certificate` de confs que apontam para arquivos
    ainda inexistentes — ver `api/certboot.py`)."""
    if not names:
        raise ValueError("informe ao menos um nome")
    key, cert = _build_self_signed(list(names), days, use_rsa)
    write_cert(Path(cert_path), cert.public_bytes(serialization.Encoding.PEM))
    write_key(Path(key_path), key)


def issue_self_signed(domains: list[str], ips: list[str] | None = None,
                      days: int = 825, use_rsa: bool = False) -> dict:
    ips = ips or []
    names = list(domains) + list(ips)
    if not names:
        raise ValueError("informe ao menos um domínio ou IP")
    cn = domains[0] if domains else ips[0]
    name = _slug(cn)
    crt_path = CERTS_DIR / f"{name}.crt"
    key_path = CERTS_DIR / f"{name}.key"
    issue_self_signed_at(crt_path, key_path, names, days=days, use_rsa=use_rsa)
    return {"name": name, "cert_path": str(crt_path), "key_path": str(key_path)}


def write_key(path: Path, key) -> None:
    path.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    path.chmod(0o600)


def write_cert(path: Path, pem: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pem)


# --------------------------------------------------------------------------- #
# CAs (autoridade certificadora local) — criar CA e assinar certificados
# --------------------------------------------------------------------------- #
def _ca_paths(name: str) -> tuple[Path, Path, str]:
    slug = _slug(name)
    return CA_DIR / f"{slug}.crt", CA_DIR / f"{slug}.key", slug


def _subject_attr(cert: x509.Certificate, oid) -> str:
    try:
        return cert.subject.get_attributes_for_oid(oid)[0].value
    except (IndexError, ValueError):
        return ""


def _ca_dict(name: str, cert: x509.Certificate, *, has_key: bool, pem: str | None = None) -> dict:
    not_after = cert.not_valid_after_utc
    days = (not_after - dt.datetime.now(dt.timezone.utc)).days
    return {
        "name": name,
        "common_name": _subject_attr(cert, NameOID.COMMON_NAME),
        "org": _subject_attr(cert, NameOID.ORGANIZATION_NAME),
        "not_before": cert.not_valid_before_utc.isoformat(),
        "not_after": not_after.isoformat(),
        "days_left": days,
        "expired": days < 0,
        "has_key": has_key,
        "cert_pem": pem,
    }


def list_cas() -> list[dict]:
    out: list[dict] = []
    if not CA_DIR.exists():
        return out
    for crt in sorted(CA_DIR.glob("*.crt")):
        try:
            cert = x509.load_pem_x509_certificate(crt.read_bytes())
        except Exception:  # noqa: BLE001
            continue
        out.append(_ca_dict(crt.stem, cert, has_key=crt.with_suffix(".key").exists(),
                            pem=crt.read_text(errors="replace")))
    return out


def create_ca(cn: str, org: str = "Holtz Nexus", days: int = 3650, use_rsa: bool = False) -> dict:
    cn = (cn or "").strip()
    if not cn:
        raise ValueError("informe o Common Name (CN) da CA")
    CA_DIR.mkdir(parents=True, exist_ok=True)
    crt_path, key_path, slug = _ca_paths(cn)
    if crt_path.exists():
        raise ValueError(f"CA '{slug}' já existe")
    key = _new_key(use_rsa)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, (org or "Holtz Nexus").strip() or "Holtz Nexus"),
    ])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, key_cert_sign=True, crl_sign=True,
            key_encipherment=False, content_commitment=False, data_encipherment=False,
            key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    write_cert(crt_path, cert.public_bytes(serialization.Encoding.PEM))
    write_key(key_path, key)
    return _ca_dict(slug, cert, has_key=True,
                    pem=cert.public_bytes(serialization.Encoding.PEM).decode())


def _load_ca(name: str):
    crt_path, key_path, _ = _ca_paths(name)
    if not crt_path.exists() or not key_path.exists():
        raise ValueError(f"CA '{name}' não encontrada")
    cert = x509.load_pem_x509_certificate(crt_path.read_bytes())
    key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    return key, cert


def delete_ca(name: str) -> bool:
    crt_path, key_path, _ = _ca_paths(name)
    existed = crt_path.exists()
    crt_path.unlink(missing_ok=True)
    key_path.unlink(missing_ok=True)
    return existed


def issue_ca_signed(ca_name: str, domains: list[str], ips: list[str] | None = None,
                    days: int = 825, use_rsa: bool = False) -> dict:
    """Emite um certificado de servidor assinado pela CA `ca_name` (fullchain)."""
    ips = ips or []
    names = list(domains) + list(ips)
    if not names:
        raise ValueError("informe ao menos um domínio ou IP")
    ca_key, ca_cert = _load_ca(ca_name)
    cn = domains[0] if domains else ips[0]
    leaf_key = _new_key(use_rsa)
    key_usage = x509.KeyUsage(
        digital_signature=True, key_encipherment=use_rsa, key_agreement=not use_rsa,
        content_commitment=False, data_encipherment=False, key_cert_sign=False,
        crl_sign=False, encipher_only=False, decipher_only=False)
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)]))
        .issuer_name(ca_cert.subject)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=days))
        .add_extension(x509.SubjectAlternativeName(_san(names)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(key_usage, critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_cert.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    name = _slug(cn)
    crt_path = CERTS_DIR / f"{name}.crt"
    key_path = CERTS_DIR / f"{name}.key"
    # fullchain = folha + CA (cadeia para o nginx).
    fullchain = cert.public_bytes(serialization.Encoding.PEM) + \
        ca_cert.public_bytes(serialization.Encoding.PEM)
    write_cert(crt_path, fullchain)
    write_key(key_path, leaf_key)
    return {"name": name, "cert_path": str(crt_path), "key_path": str(key_path)}


def delete_cert(name: str) -> bool:
    name = _slug(name)
    if name in _RESERVED:
        raise ValueError("certificado reservado não pode ser removido")
    crt = CERTS_DIR / f"{name}.crt"
    key = CERTS_DIR / f"{name}.key"
    existed = crt.exists()
    crt.unlink(missing_ok=True)
    key.unlink(missing_ok=True)
    delete_meta(name)
    return existed


# --------------------------------------------------------------------------- #
# Importação (upload) de certificados/CA existentes
# --------------------------------------------------------------------------- #
def _load_pem_pair(cert_pem: str, key_pem: str):
    """Carrega e valida um par (certificado, chave privada) em PEM."""
    cert_pem = (cert_pem or "").strip()
    key_pem = (key_pem or "").strip()
    if not cert_pem or not key_pem:
        raise ValueError("informe o certificado e a chave privada (PEM)")
    try:
        cert = x509.load_pem_x509_certificate(cert_pem.encode())
    except Exception:  # noqa: BLE001
        raise ValueError("certificado PEM inválido")
    try:
        key = serialization.load_pem_private_key(key_pem.encode(), password=None)
    except Exception:  # noqa: BLE001
        raise ValueError("chave privada PEM inválida (ou protegida por senha)")
    if _pubkey_bytes(key.public_key()) != _pubkey_bytes(cert.public_key()):
        raise ValueError("a chave privada não corresponde ao certificado")
    return cert, key


def _pem_bytes(text: str) -> bytes:
    b = text.strip().encode()
    return b + b"\n" if not b.endswith(b"\n") else b


def import_cert(cert_pem: str, key_pem: str, chain_pem: str | None = None,
                name: str | None = None) -> dict:
    """Importa um certificado de servidor + chave (opcionalmente cadeia). Grava
    como fullchain (folha + cadeia) em CERTS_DIR."""
    cert, key = _load_pem_pair(cert_pem, key_pem)
    base = (name or "").strip() or _subject_attr(cert, NameOID.COMMON_NAME) \
        or (_domains(cert)[0] if _domains(cert) else "cert")
    slug = _slug(base)
    if slug in _RESERVED:
        raise ValueError("nome reservado")
    crt_path = CERTS_DIR / f"{slug}.crt"
    key_path = CERTS_DIR / f"{slug}.key"
    pem = _pem_bytes(cert_pem)
    if chain_pem and chain_pem.strip():
        pem += _pem_bytes(chain_pem)
    write_cert(crt_path, pem)
    write_key(key_path, key)
    return {"name": slug, "cert_path": str(crt_path), "key_path": str(key_path),
            "type": _classify(cert), "domains": _domains(cert)}


def import_ca(cert_pem: str, key_pem: str, name: str | None = None) -> dict:
    """Importa uma CA (certificado + chave) para CA_DIR."""
    cert, key = _load_pem_pair(cert_pem, key_pem)
    try:
        is_ca = cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    except x509.ExtensionNotFound:
        is_ca = cert.issuer == cert.subject
    if not is_ca:
        raise ValueError("o certificado não é uma CA (BasicConstraints ca=false)")
    base = (name or "").strip() or _subject_attr(cert, NameOID.COMMON_NAME) or "ca"
    CA_DIR.mkdir(parents=True, exist_ok=True)
    crt_path, key_path, slug = _ca_paths(base)
    if crt_path.exists():
        raise ValueError(f"CA '{slug}' já existe")
    write_cert(crt_path, cert.public_bytes(serialization.Encoding.PEM))
    write_key(key_path, key)
    return _ca_dict(slug, cert, has_key=True,
                    pem=cert.public_bytes(serialization.Encoding.PEM).decode())
