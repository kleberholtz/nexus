"""Rotas /monitors: monitores (healthcheck) + grupos + status ao vivo (SSE).

O motor de execução (thread que roda os checks) vive em `api/monitorworker.py`;
aqui só expomos CRUD, controle (enable/disable/check) e o stream de status.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import appsettings, monitors, monitorproxies, monitortags, monitorworker, notifications
from ..auth import identity_from_request, require_token
from ..envelope import envelope, message
from ..monitors import MonitorError

router = APIRouter(prefix="/monitors", tags=["monitors"], dependencies=[Depends(require_token)])

# Webhook público dos monitores push (heartbeat) — sem auth (rota pública,
# ver api/authz.py::_PUBLIC_PREFIXES). O beat é autenticado pelo token na URL.
push_router = APIRouter(prefix="/uptime/heartbeats", tags=["monitors"])


@push_router.api_route("/{token}", methods=["GET", "POST"])
def receive_beat(token: str, status: str = Query("up"), msg: str = Query("")):
    if not monitorworker.push_beat(token, status, msg):
        raise HTTPException(status_code=404, detail="heartbeat não encontrado")
    return envelope(data={"ok": True})


def _guard(fn):
    try:
        return fn()
    except MonitorError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


def _tag_guard(fn):
    try:
        return fn()
    except monitortags.MonitorTagError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


# --------------------------------------------------------------------------- #
# Metadados (para o formulário do painel)
# --------------------------------------------------------------------------- #
@router.get("/meta")
def meta():
    return envelope(data={
        "types": monitors.TYPES,
        "implemented_types": monitors.IMPLEMENTED_TYPES,
        "http_methods": monitors.HTTP_METHODS,
        "body_encodings": monitors.BODY_ENCODINGS,
        "auth_types": monitors.AUTH_TYPES,
        "oauth_methods": monitors.OAUTH_METHODS,
        "tcp_tls_alerts": list(monitors.TCP_TLS_ALERTS),
        "dns_record_types": monitors.DNS_RECORD_TYPES,
        "dns_operators": monitors.DNS_OPERATORS,
        "connection_monitor_types": monitors.CONNECTION_MONITOR_TYPES,
        "connection_default_ports": monitors.CONNECTION_DEFAULT_PORTS,
        "connection_uri_schemes": monitors.CONNECTION_URI_SCHEMES,
        "event_catalog": monitors.EVENT_CATALOG,
        "incident_statuses": monitors.INCIDENT_STATUSES,
        "incident_severities": monitors.INCIDENT_SEVERITIES,
        "limits": {
            "interval_min": monitors.INTERVAL_MIN, "interval_max": monitors.INTERVAL_MAX,
            "resend_min": monitors.RESEND_MIN, "resend_max": monitors.RESEND_MAX,
            "push_grace_min": monitors.PUSH_GRACE_MIN,
            "push_grace_max": monitors.PUSH_GRACE_MAX,
        },
    })


# --------------------------------------------------------------------------- #
# Grupos
# --------------------------------------------------------------------------- #
@router.get("/groups")
def list_groups():
    return envelope(data=monitors.list_groups())


@router.post("/groups", status_code=201)
def create_group(payload: dict = Body(...)):
    data = _guard(lambda: monitors.create_group(
        str(payload.get("name", "")), str(payload.get("color", ""))))
    return envelope(data=data, messages=[message("grupo criado", "success")])


@router.put("/groups/{group_id}")
def update_group(group_id: int, payload: dict = Body(...)):
    data = _guard(lambda: monitors.update_group(
        group_id, payload.get("name"), payload.get("color")))
    return envelope(data=data, messages=[message("grupo atualizado", "success")])


@router.delete("/groups/{group_id}")
def delete_group(group_id: int):
    _guard(lambda: monitors.delete_group(group_id))
    return envelope(data={"deleted": group_id}, messages=[message("grupo removido", "success")])


# --------------------------------------------------------------------------- #
# Canais de notificação
# --------------------------------------------------------------------------- #
@router.get("/notifications/types")
def notification_types():
    return envelope(data={"types": notifications.TYPES})


@router.get("/notifications")
def list_notifications(search: str = Query(""), type: str = Query(""),
                       page: int | None = Query(None), limit: int = Query(50)):
    return envelope(data=notifications.list_channels(search=search, type_filter=type, page=page, limit=limit))


@router.post("/notifications", status_code=201)
def create_notification(payload: dict = Body(...)):
    data = notifications.create_channel(payload)
    return envelope(data=data, messages=[message("canal criado", "success")])


@router.post("/notifications/test")
def test_notification_config(payload: dict = Body(...)):
    """Testa uma configuração de canal ainda não salva (ou em edição)."""
    notifications.test_config(payload)
    return envelope(data={"ok": True}, messages=[message("notificação de teste enviada", "success")])


@router.get("/notifications/{channel_id}")
def get_notification(channel_id: int):
    return envelope(data=notifications.get_channel(channel_id))


@router.put("/notifications/{channel_id}")
def update_notification(channel_id: int, payload: dict = Body(...)):
    data = notifications.update_channel(channel_id, payload)
    return envelope(data=data, messages=[message("canal atualizado", "success")])


@router.delete("/notifications/{channel_id}")
def delete_notification(channel_id: int):
    notifications.delete_channel(channel_id)
    return envelope(data={"deleted": channel_id}, messages=[message("canal removido", "success")])


@router.post("/notifications/{channel_id}/test")
def test_notification(channel_id: int):
    notifications.test_channel(channel_id)
    return envelope(data={"ok": True}, messages=[message("notificação de teste enviada", "success")])


# --------------------------------------------------------------------------- #
# Status ao vivo (SSE)
# --------------------------------------------------------------------------- #
@router.get("/stream")
async def stream(request: Request, group_id: int | None = Query(None),
                 push: bool | None = Query(None)):
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")

    async def gen():
        last = -1
        heartbeat = max(1.0, appsettings.get_float("sse_interval_seconds"))
        while True:
            if await request.is_disconnected():
                return
            current = monitorworker.version()
            if current != last:
                # SSE só sinaliza mudança; os dados vêm por GET paginado.
                yield f"event: version\ndata: {json.dumps({'version': current})}\n\n"
                last = current
            else:
                yield ": heartbeat\n\n"
            # Bloqueia até a versão mudar (ou timeout). O retorno é ignorado de
            # propósito: quem detecta a mudança é o `version() != last` no topo do
            # laço — assim nenhuma checagem é "consumida" sem virar snapshot.
            await asyncio.to_thread(monitorworker.wait_for_version, last, heartbeat)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# --------------------------------------------------------------------------- #
# Monitores
# --------------------------------------------------------------------------- #
@router.get("/tags")
def list_tags(search: str = Query(""), page: int | None = Query(None), limit: int = Query(50)):
    return envelope(data=monitortags.list_tags(search=search, page=page, limit=limit))


@router.post("/tags", status_code=201)
def create_tag(payload: dict = Body(...)):
    data = _tag_guard(lambda: monitortags.create_tag(payload))
    return envelope(data=data, messages=[message("tag criada", "success")])


@router.put("/tags/{tag_id}")
def update_tag(tag_id: int, payload: dict = Body(...)):
    data = _tag_guard(lambda: monitortags.update_tag(tag_id, payload))
    return envelope(data=data, messages=[message("tag atualizada", "success")])


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    _tag_guard(lambda: monitortags.delete_tag(tag_id))
    return envelope(data={"deleted": tag_id}, messages=[message("tag removida", "success")])


@router.get("/proxies")
def list_global_proxies(search: str = Query(""), page: int | None = Query(None), limit: int = Query(50)):
    return envelope(data=monitorproxies.list_all(search=search, page=page, limit=limit))

@router.post("/proxies", status_code=201)
def create_global_proxy(payload: dict = Body(...)):
    return envelope(data=_guard(lambda: monitorproxies.create(payload)))

@router.put("/proxies/{proxy_id}")
def update_global_proxy(proxy_id: int, payload: dict = Body(...)):
    return envelope(data=_guard(lambda: monitorproxies.update(proxy_id, payload)))

@router.delete("/proxies/{proxy_id}")
def delete_global_proxy(proxy_id: int):
    _guard(lambda: monitorproxies.delete(proxy_id)); return envelope(data={"deleted": proxy_id})

@router.post("/proxies/test")
def test_unsaved_proxy(payload: dict = Body(...)):
    data = _guard(lambda: monitorproxies.test_config(payload))
    return envelope(data=data, messages=[message("proxy testado com sucesso", "success")])


@router.get("/incidents")
def list_all_incidents(search: str = Query(""), page: int | None = Query(None), limit: int = Query(50)):
    """Todos os incidentes (de todos os monitores)."""
    return envelope(data=monitors.list_all_incidents(search=search, page=page, limit=limit))


@router.get("")
def list_monitors(group_id: int | None = Query(None), push: bool | None = Query(None),
                  no_group: bool = Query(False), search: str = Query(""),
                  page: int | None = Query(None), limit: int = Query(50)):
    return envelope(data=monitors.list_monitors(group_id, push, no_group=no_group,
                                                search=search, page=page, limit=limit))


@router.post("", status_code=201)
def create_monitor(payload: dict = Body(...)):
    data = _guard(lambda: monitors.create_monitor(payload))
    return envelope(data=data, messages=[message("monitor criado", "success")])


@router.get("/{monitor_id}")
def get_monitor(monitor_id: int):
    return _guard(lambda: envelope(data=monitors.get_monitor(monitor_id)))


@router.put("/{monitor_id}")
def update_monitor(monitor_id: int, payload: dict = Body(...)):
    data = _guard(lambda: monitors.update_monitor(monitor_id, payload))
    return envelope(data=data, messages=[message("monitor atualizado", "success")])


@router.put("/{monitor_id}/group")
def move_monitor_to_group(monitor_id: int, payload: dict = Body(...)):
    data = _guard(lambda: monitors.move_monitor_to_group(monitor_id, payload.get("group_id")))
    return envelope(data=data, messages=[message("grupo do monitor atualizado", "success")])


@router.delete("/{monitor_id}")
def delete_monitor(monitor_id: int):
    _guard(lambda: monitors.delete_monitor(monitor_id))
    return envelope(data={"deleted": monitor_id}, messages=[message("monitor removido", "success")])


@router.post("/{monitor_id}/enable")
def enable_monitor(monitor_id: int):
    data = _guard(lambda: monitors.set_active(monitor_id, True))
    return envelope(data=data, messages=[message("monitor ativado", "success")])


@router.post("/{monitor_id}/disable")
def disable_monitor(monitor_id: int):
    data = _guard(lambda: monitors.set_active(monitor_id, False))
    return envelope(data=data, messages=[message("monitor pausado", "success")])


@router.get("/{monitor_id}/heartbeats")
def heartbeats(monitor_id: int, limit: int = Query(100, ge=1, le=1000)):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    return envelope(data=monitors.heartbeats(monitor_id, limit))


@router.get("/{monitor_id}/uptime")
def uptime(monitor_id: int):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    return envelope(data=monitors.uptime(monitor_id))


@router.get("/{monitor_id}/chart")
def chart(monitor_id: int, range: str = Query("24h")):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    return _guard(lambda: envelope(data=monitors.chart(monitor_id, range)))


@router.get("/{monitor_id}/events")
def events(monitor_id: int, limit: int = Query(100, ge=1, le=1000)):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    return envelope(data=monitors.events(monitor_id, limit))


@router.delete("/{monitor_id}/events")
def clear_events(monitor_id: int):
    n = _guard(lambda: monitors.clear_events(monitor_id))
    monitorworker.bump()
    return envelope(data={"deleted": n}, messages=[message(f"{n} evento(s) removido(s)", "success")])


@router.delete("/{monitor_id}/heartbeats")
def clear_heartbeats(monitor_id: int):
    n = _guard(lambda: monitors.clear_heartbeats(monitor_id))
    monitorworker.bump()
    return envelope(data={"deleted": n}, messages=[message("heartbeats removidos", "success")])


# --- Incidentes --------------------------------------------------------------
@router.get("/{monitor_id}/incidents")
def list_incidents(monitor_id: int):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    return envelope(data=monitors.list_incidents(monitor_id))


def _notify_incident(monitor_id: int, data: dict) -> None:
    """Notifica + sinaliza o SSE após criar/atualizar um incidente."""
    event = data.pop("_event", None)
    if event:
        monitorworker.notify_event(monitor_id, event, data.get("title", ""))
    monitorworker.bump()


@router.post("/{monitor_id}/incidents", status_code=201)
def create_incident(monitor_id: int, payload: dict = Body(...)):
    data = _guard(lambda: monitors.create_incident(monitor_id, payload))
    _notify_incident(monitor_id, data)
    return envelope(data=data, messages=[message("incidente criado", "success")])


@router.put("/{monitor_id}/incidents/{incident_id}")
def update_incident(monitor_id: int, incident_id: int, payload: dict = Body(...)):
    data = _guard(lambda: monitors.update_incident(monitor_id, incident_id, payload))
    _notify_incident(monitor_id, data)
    return envelope(data=data, messages=[message("incidente atualizado", "success")])


@router.post("/{monitor_id}/incidents/{incident_id}/updates", status_code=201)
def add_incident_update(monitor_id: int, incident_id: int, payload: dict = Body(...)):
    """Publica uma atualização na linha do tempo do incidente."""
    data = _guard(lambda: monitors.add_incident_update(monitor_id, incident_id, payload))
    _notify_incident(monitor_id, data)
    return envelope(data=data, messages=[message("atualização registrada", "success")])


@router.delete("/{monitor_id}/incidents/{incident_id}")
def delete_incident(monitor_id: int, incident_id: int):
    _guard(lambda: monitors.delete_incident(monitor_id, incident_id))
    monitorworker.bump()
    return envelope(data={"deleted": incident_id}, messages=[message("incidente removido", "success")])


@router.get("/{monitor_id}/stream")
async def monitor_stream(monitor_id: int, request: Request):
    """SSE da tela de detalhes: snapshot (monitor + uptime + eventos + incidentes)."""
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")

    def snapshot():
        return {
            "monitor": monitors.get_monitor(monitor_id),
            "uptime": monitors.uptime(monitor_id),
            "events": monitors.events(monitor_id, 100),
            "incidents": monitors.list_incidents(monitor_id),
        }

    async def gen():
        last = -1
        heartbeat = max(1.0, appsettings.get_float("sse_interval_seconds"))
        while True:
            if await request.is_disconnected():
                return
            current = monitorworker.version()
            if current != last:
                try:
                    payload = snapshot()
                except MonitorError:
                    yield f"event: deleted\ndata: {json.dumps({'id': monitor_id})}\n\n"
                    return
                yield f"event: snapshot\ndata: {json.dumps(payload)}\n\n"
                last = current
            else:
                yield ": heartbeat\n\n"
            # Retorno ignorado de propósito — ver comentário no stream de detalhe.
            await asyncio.to_thread(monitorworker.wait_for_version, last, heartbeat)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/{monitor_id}/check")
def check_now(monitor_id: int):
    _guard(lambda: monitors.get_monitor(monitor_id))  # 404 se não existir
    monitorworker.check_now(monitor_id)
    return _guard(lambda: envelope(data=monitors.get_monitor(monitor_id),
                                   messages=[message("checagem executada", "success")]))
