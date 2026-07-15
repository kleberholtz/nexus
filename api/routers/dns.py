"""Rotas /dns: provedores (config) e registros DNS (via provedor)."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import dns, dnsproviders
from ..auth import require_token
from ..dns.base import DnsError
from ..envelope import envelope, message

router = APIRouter(prefix="/dns", tags=["dns"], dependencies=[Depends(require_token)])

_RTYPES = {"A", "AAAA", "CNAME", "TXT", "MX", "NS", "CAA", "SRV"}


# --------------------------------------------------------------------------- #
# Provedores
# --------------------------------------------------------------------------- #
@router.get("/provider-types")
def provider_types():
    """Tipos suportados e o schema de campos (para o formulário do frontend)."""
    return envelope(data=dns.provider_types())


@router.get("/providers")
def list_providers():
    return envelope(data=dnsproviders.list_providers())


@router.post("/providers", status_code=201)
def create_provider(payload: dict = Body(...)):
    ptype = str(payload.get("type", "")).strip()
    config = payload.get("config") or {}
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config deve ser um objeto")
    try:
        data = dnsproviders.create(ptype, str(payload.get("label", "")), config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return envelope(data=data, messages=[message("provedor DNS criado", "success")])


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, payload: dict = Body(...)):
    config = payload.get("config")
    if config is not None and not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config deve ser um objeto")
    try:
        data = dnsproviders.update(provider_id, payload.get("label"), config)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return envelope(data=data, messages=[message("provedor DNS atualizado", "success")])


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int):
    if not dnsproviders.delete(provider_id):
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    return envelope(data={"deleted": provider_id}, messages=[message("provedor removido", "success")])


# --------------------------------------------------------------------------- #
# Registros (delegado ao provedor real)
# --------------------------------------------------------------------------- #
def _instance(provider_id: int):
    try:
        return dnsproviders.build_instance(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except DnsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _guard(fn):
    try:
        return fn()
    except DnsError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/providers/{provider_id}/zones")
def zones(provider_id: int):
    prov = _instance(provider_id)
    return envelope(data=_guard(prov.list_zones))


@router.get("/providers/{provider_id}/records")
def records(provider_id: int, zone_id: str = Query(..., min_length=1)):
    prov = _instance(provider_id)
    return envelope(data=_guard(lambda: prov.list_records(zone_id)))


def _validate_record(payload: dict) -> tuple[str, str, str, int, bool]:
    rtype = str(payload.get("type", "")).strip().upper()
    name = str(payload.get("name", "")).strip()
    content = str(payload.get("content", "")).strip()
    if rtype not in _RTYPES:
        raise HTTPException(status_code=400, detail=f"tipo inválido (use {', '.join(sorted(_RTYPES))})")
    if not name:
        raise HTTPException(status_code=400, detail="name é obrigatório")
    if not content:
        raise HTTPException(status_code=400, detail="content é obrigatório")
    try:
        ttl = int(payload.get("ttl", 300))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="ttl deve ser inteiro")
    if ttl < 1 or ttl > 604800:
        raise HTTPException(status_code=400, detail="ttl deve estar entre 1 e 604800")
    proxied = bool(payload.get("proxied", False))
    return rtype, name, content, ttl, proxied


@router.post("/providers/{provider_id}/records", status_code=201)
def create_record(provider_id: int, payload: dict = Body(...)):
    zone_id = str(payload.get("zone_id", "")).strip()
    if not zone_id:
        raise HTTPException(status_code=400, detail="zone_id é obrigatório")
    rtype, name, content, ttl, proxied = _validate_record(payload)
    prov = _instance(provider_id)
    if getattr(prov, "type", "") == "cloudflare":
        data = _guard(lambda: prov.create_record(zone_id, rtype, name, content, ttl, proxied=proxied))
    else:
        data = _guard(lambda: prov.create_record(zone_id, rtype, name, content, ttl))
    return envelope(data=data, messages=[message("registro criado", "success")])


@router.put("/providers/{provider_id}/records/{record_id:path}")
def update_record(provider_id: int, record_id: str, payload: dict = Body(...)):
    zone_id = str(payload.get("zone_id", "")).strip()
    if not zone_id:
        raise HTTPException(status_code=400, detail="zone_id é obrigatório")
    rtype, name, content, ttl, proxied = _validate_record(payload)
    prov = _instance(provider_id)
    if getattr(prov, "type", "") == "cloudflare":
        data = _guard(lambda: prov.update_record(zone_id, record_id, rtype, name, content, ttl, proxied=proxied))
    else:
        data = _guard(lambda: prov.update_record(zone_id, record_id, rtype, name, content, ttl))
    return envelope(data=data, messages=[message("registro atualizado", "success")])


@router.delete("/providers/{provider_id}/records/{record_id:path}")
def delete_record(provider_id: int, record_id: str, zone_id: str = Query(..., min_length=1)):
    prov = _instance(provider_id)
    _guard(lambda: prov.delete_record(zone_id, record_id))
    return envelope(data={"deleted": record_id}, messages=[message("registro removido", "success")])
