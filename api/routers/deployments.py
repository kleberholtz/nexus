"""Rotas de deployment de um serviço (aninhadas sob o serviço CI/CD).

Prefixo `/projects/{project_id}/services/{service_id}/deployments` — os deploys
pertencem sempre a um serviço específico (o disparo mora em
`/projects/.../services/.../{verb}` no router de projetos). Recurso RBAC
`projects` (1º segmento da rota)."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import appsettings
from .. import deployments as D
from ..auth import identity_from_request, require_token
from ..envelope import envelope, message

router = APIRouter(
    prefix="/projects/{project_id}/services/{service_id}/deployments",
    tags=["deployments"], dependencies=[Depends(require_token)],
)


def _req_user(request: Request) -> str:
    return getattr(request.state, "user", None) or request.headers.get("x-user") or ""


@router.get("")
def list_deployments(
    project_id: int,
    service_id: int,
    status: str | None = Query(None),
    limit: int = Query(0, ge=0, le=10000),
    offset: int = Query(0, ge=0),
):
    if status and status not in D.STATUSES:
        raise HTTPException(status_code=422, detail=f"status inválido (use: {', '.join(D.STATUSES)})")
    return envelope(data=D.list_deployments(project_id, service_id, status, limit, offset))


@router.delete("/{deployment_id}")
def delete_deployment(project_id: int, service_id: int, deployment_id: int):
    try:
        D.delete(deployment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="deployment não encontrado")
    return envelope(data={"deleted": deployment_id}, messages=[message("deployment excluído", "success")])


@router.post("/{deployment_id}/rollback")
def rollback_deployment(project_id: int, service_id: int, deployment_id: int,
                        request: Request, _payload: dict = Body(default={})):
    try:
        data = D.rollback(deployment_id, _req_user(request))
    except KeyError:
        raise HTTPException(status_code=404, detail="deployment não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("rollback aplicado", "success")])


@router.get("/{deployment_id}/history")
def deployment_history(project_id: int, service_id: int, deployment_id: int):
    try:
        data = D.history(deployment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="deployment não encontrado")
    return envelope(data=data)


@router.get("/{deployment_id}/history/stream")
async def deployment_history_stream(project_id: int, service_id: int,
                                    deployment_id: int, request: Request):
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")

    async def gen():
        last = -1
        heartbeat = max(1.0, appsettings.get_float("sse_interval_seconds"))
        while True:
            if await request.is_disconnected():
                return
            current = D.version()
            if current != last:
                try:
                    payload = D.history(deployment_id)
                except KeyError:
                    yield f"event: deleted\ndata: {json.dumps({'id': deployment_id})}\n\n"
                    return
                yield f"event: snapshot\ndata: {json.dumps(payload)}\n\n"
                last = current
            else:
                yield ": heartbeat\n\n"
            current = await asyncio.to_thread(D.wait_for_version, last, heartbeat)
            if current != last:
                continue

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/stream")
async def stream_deployments(
    project_id: int,
    service_id: int,
    request: Request,
    status: str | None = Query(None),
    limit: int = Query(0, ge=0, le=10000),
    offset: int = Query(0, ge=0),
):
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")
    if status and status not in D.STATUSES:
        raise HTTPException(status_code=422, detail=f"status inválido (use: {', '.join(D.STATUSES)})")

    async def gen():
        last = -1
        heartbeat = max(1.0, appsettings.get_float("sse_interval_seconds"))
        while True:
            if await request.is_disconnected():
                return
            current = D.version()
            if current != last:
                payload = D.list_deployments(project_id, service_id, status, limit, offset)
                yield f"event: snapshot\ndata: {json.dumps(payload)}\n\n"
                last = current
            else:
                yield ": heartbeat\n\n"
            current = await asyncio.to_thread(D.wait_for_version, last, heartbeat)
            if current != last:
                continue

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
