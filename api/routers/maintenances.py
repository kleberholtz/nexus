"""Rotas das Janelas de Manutenção (Uptime).

Montadas em ``/monitors/maintenances`` (RBAC → recurso ``monitors``). Precisa ser
incluído **antes** de ``monitors.router`` no ``main.py`` para as rotas literais
vencerem o genérico ``GET /monitors/{id}`` (mesmo motivo das status pages).
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import maintenances
from ..auth import require_token
from ..envelope import envelope, message
from ..maintenances import MaintenanceError

router = APIRouter(prefix="/monitors/maintenances", tags=["monitors"],
                   dependencies=[Depends(require_token)])


def _guard(fn):
    try:
        return fn()
    except MaintenanceError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("")
def list_maintenances(search: str = Query("")):
    return envelope(data=maintenances.list_maintenances(search=search))


@router.get("/{mid}")
def get_maintenance(mid: int):
    return envelope(data=_guard(lambda: maintenances.get_maintenance(mid)))


@router.post("", status_code=201)
def create_maintenance(payload: dict = Body(...)):
    data = _guard(lambda: maintenances.create_maintenance(payload))
    return envelope(data=data, messages=[message("manutenção criada", "success")])


@router.put("/{mid}")
def update_maintenance(mid: int, payload: dict = Body(...)):
    data = _guard(lambda: maintenances.update_maintenance(mid, payload))
    return envelope(data=data, messages=[message("manutenção atualizada", "success")])


@router.post("/{mid}/enable")
def enable_maintenance(mid: int):
    data = _guard(lambda: maintenances.set_active(mid, True))
    return envelope(data=data, messages=[message("manutenção ativada", "success")])


@router.post("/{mid}/disable")
def disable_maintenance(mid: int):
    data = _guard(lambda: maintenances.set_active(mid, False))
    return envelope(data=data, messages=[message("manutenção desativada", "success")])


@router.delete("/{mid}")
def delete_maintenance(mid: int):
    _guard(lambda: maintenances.delete_maintenance(mid))
    return envelope(data={"deleted": mid}, messages=[message("manutenção removida", "success")])
