"""Rotas /certificates: listar, emitir (self-signed / Let's Encrypt), remover."""
from __future__ import annotations

import re

from fastapi import APIRouter, Body, Depends, HTTPException

import ipaddress

from .. import appsettings, certs, dnsproviders
from ..auth import require_token
from ..config import store as S
from ..dns.base import DnsError
from ..envelope import envelope, message

router = APIRouter(prefix="/certificates", tags=["certificates"],
                   dependencies=[Depends(require_token)])

_DOMAIN = re.compile(r"^(\*\.)?([A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)+[A-Za-z]{2,}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean_domains(raw, required: bool = True) -> list[str]:
    if isinstance(raw, str):
        raw = raw.split()
    if not raw:
        if required:
            raise HTTPException(status_code=400, detail="informe ao menos um domínio")
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="domínios inválidos")
    domains = [str(d).strip().lower() for d in raw if str(d).strip()]
    for d in domains:
        if not _DOMAIN.match(d):
            raise HTTPException(status_code=400, detail=f"domínio inválido: {d}")
    return domains


def _clean_ips(raw) -> list[str]:
    if isinstance(raw, str):
        raw = raw.split()
    if not raw:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="IPs inválidos")
    ips = []
    for ip in raw:
        v = str(ip).strip()
        if not v:
            continue
        try:
            ipaddress.ip_address(v)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"IP inválido: {v}")
        ips.append(v)
    return ips


@router.get("")
def list_certificates():
    store = S.ConfigStore()
    out = certs.list_certs()
    for cert in out:
        users = sorted(set(store.certificate_usage(cert["name"])))
        cert["in_use"] = bool(users)
        cert["used_by"] = users
    return envelope(data=out)


@router.post("/import", status_code=201)
def import_certificate(payload: dict = Body(...)):
    """Importa (upload) um certificado de servidor + chave já existentes."""
    try:
        info = certs.import_cert(
            payload.get("cert", ""), payload.get("key", ""),
            payload.get("chain"), payload.get("name"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    auto_renew = bool(payload.get("auto_renew"))
    certs.save_meta(info["name"], info.get("type", "self-signed"),
                    domains=info.get("domains", []), days=365, auto_renew=auto_renew)
    return envelope(data=info,
                    messages=[message(f"certificado '{info['name']}' importado", "success")])


@router.put("/{name}/auto-renew")
def toggle_auto_renew(name: str, payload: dict = Body(...)):
    """Ativa/desativa a auto-renovação de um certificado existente."""
    enabled = bool(payload.get("auto_renew"))
    if not certs.set_auto_renew(name, enabled):
        raise HTTPException(status_code=404, detail="certificado não encontrado")
    estado = "ativada" if enabled else "desativada"
    return envelope(data={"name": name, "auto_renew": enabled},
                    messages=[message(f"auto-renovação {estado} para '{name}'", "success")])


@router.post("/self-signed", status_code=201)
def create_self_signed(payload: dict = Body(...)):
    domains = _clean_domains(payload.get("domains"), required=False)
    ips = _clean_ips(payload.get("ips"))
    if not domains and not ips:
        raise HTTPException(status_code=400, detail="informe ao menos um domínio ou IP")
    try:
        days = int(payload.get("days", 365))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="dias deve ser inteiro")
    if not (1 <= days <= 3650):
        raise HTTPException(status_code=400, detail="dias deve estar entre 1 e 3650")
    rsa = bool(payload.get("rsa"))
    auto_renew = bool(payload.get("auto_renew"))
    try:
        info = certs.issue_self_signed(domains, ips, days=days, use_rsa=rsa)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    certs.save_meta(info["name"], "self-signed", domains=domains, ips=ips,
                    days=days, rsa=rsa, auto_renew=auto_renew)
    label = domains[0] if domains else ips[0]
    return envelope(data=info, messages=[message(f"certificado self-signed emitido para {label}", "success")])


# --------------------------------------------------------------------------- #
# CA própria: criar CA e assinar certificados com ela
# --------------------------------------------------------------------------- #
@router.get("/ca")
def list_cas():
    metas = certs.list_meta()
    out = certs.list_cas()
    for ca in out:
        users = sorted(m["name"] for m in metas
                       if m.get("kind") == "ca-signed" and m.get("ca_name") == ca["name"])
        ca["in_use"] = bool(users)
        ca["used_by"] = users
    return envelope(data=out)


@router.post("/ca", status_code=201)
def create_ca(payload: dict = Body(...)):
    cn = str(payload.get("cn", "")).strip()
    if not cn:
        raise HTTPException(status_code=400, detail="informe o Common Name (CN) da CA")
    org = str(payload.get("org", "") or "Holtz Nexus")
    try:
        days = int(payload.get("days", 3650))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="dias deve ser inteiro")
    if not (1 <= days <= 7300):
        raise HTTPException(status_code=400, detail="dias deve estar entre 1 e 7300")
    rsa = bool(payload.get("rsa"))
    try:
        info = certs.create_ca(cn, org, days=days, use_rsa=rsa)
    except ValueError as exc:
        # já existe → 409; demais validações → 400
        status = 409 if "já existe" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc))
    return envelope(data=info, messages=[message(f"CA '{info['name']}' criada", "success")])


@router.post("/ca/import", status_code=201)
def import_ca_route(payload: dict = Body(...)):
    """Importa (upload) uma CA existente (certificado + chave)."""
    try:
        info = certs.import_ca(payload.get("cert", ""), payload.get("key", ""),
                               payload.get("name"))
    except ValueError as exc:
        status = 409 if "já existe" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc))
    return envelope(data=info, messages=[message(f"CA '{info['name']}' importada", "success")])


@router.delete("/ca/{name}")
def delete_ca(name: str):
    # Não permite remover CA que assinou certificados ainda presentes.
    users = sorted(m["name"] for m in certs.list_meta()
                   if m.get("kind") == "ca-signed" and m.get("ca_name") == name)
    if users:
        raise HTTPException(status_code=409, detail=f"CA em uso por: {', '.join(users)}")
    if not certs.delete_ca(name):
        raise HTTPException(status_code=404, detail="CA não encontrada")
    return envelope(data={"deleted": name}, messages=[message(f"CA '{name}' removida", "success")])


@router.post("/ca-signed", status_code=201)
def create_ca_signed(payload: dict = Body(...)):
    ca_name = str(payload.get("ca_name", "")).strip()
    if not ca_name:
        raise HTTPException(status_code=400, detail="ca_name é obrigatório")
    domains = _clean_domains(payload.get("domains"), required=False)
    ips = _clean_ips(payload.get("ips"))
    if not domains and not ips:
        raise HTTPException(status_code=400, detail="informe ao menos um domínio ou IP")
    try:
        days = int(payload.get("days", 365))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="dias deve ser inteiro")
    if not (1 <= days <= 3650):
        raise HTTPException(status_code=400, detail="dias deve estar entre 1 e 3650")
    rsa = bool(payload.get("rsa"))
    auto_renew = bool(payload.get("auto_renew"))
    try:
        info = certs.issue_ca_signed(ca_name, domains, ips, days=days, use_rsa=rsa)
    except ValueError as exc:
        status = 404 if "não encontrada" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc))
    certs.save_meta(info["name"], "ca-signed", domains=domains, ips=ips, days=days,
                    rsa=rsa, ca_name=ca_name, auto_renew=auto_renew)
    label = domains[0] if domains else ips[0]
    return envelope(data=info, messages=[message(f"certificado assinado pela CA emitido para {label}", "success")])


@router.post("/letsencrypt", status_code=201)
def create_letsencrypt(payload: dict = Body(...)):
    domains = _clean_domains(payload.get("domains"))
    email = appsettings.get_str("acme_email")  # e-mail vem das Configurações
    if not _EMAIL.match(email):
        raise HTTPException(status_code=400,
                            detail="configure o e-mail da conta ACME em Configurações")
    provider_id = payload.get("provider_id")
    if not isinstance(provider_id, int):
        raise HTTPException(status_code=400, detail="provider_id (DNS) é obrigatório")
    staging = bool(payload.get("staging", True))
    auto_renew = bool(payload.get("auto_renew"))

    # import tardio: só carrega o cliente ACME quando for realmente emitir.
    from ..acme import AcmeClient, AcmeError

    try:
        provider = dnsproviders.build_instance(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor DNS não encontrado")
    except DnsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        client = AcmeClient(email=email, staging=staging)
        info = client.issue(domains, provider)
    except (AcmeError, DnsError) as exc:
        raise HTTPException(status_code=502, detail=f"falha na emissão: {exc}")
    certs.save_meta(info["name"], "letsencrypt", domains=domains,
                    provider_id=provider_id, staging=staging, auto_renew=auto_renew)
    info["staging"] = staging
    return envelope(data=info, messages=[message(f"certificado Let's Encrypt emitido para {domains[0]}", "success")])


@router.delete("/{name}")
def delete_certificate(name: str):
    # Não permite remover certificado referenciado por algum server/stream.
    users = sorted(set(S.ConfigStore().certificate_usage(name)))
    if users:
        raise HTTPException(status_code=409,
                            detail=f"certificado em uso por: {', '.join(users)}")
    try:
        removed = certs.delete_cert(name)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    if not removed:
        raise HTTPException(status_code=404, detail="certificado não encontrado")
    return envelope(data={"deleted": name}, messages=[message(f"certificado '{name}' removido", "success")])
