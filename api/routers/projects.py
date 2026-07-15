"""Rotas /projects (grupo CI/CD) + /templates (catálogo).

Projetos agrupam serviços de 4 tipos (application/database/compose/template).
CRUD de projetos e de serviços; a senha de banco é mascarada nas respostas.
O catálogo de templates (`/templates`) busca/paginação no backend — a lista é
grande e não deve ser carregada inteira no front.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import appfiles as AF
from .. import appsettings
from .. import dockerclient
from .. import projects as P
from .. import templates as T
from ..auth import identity_from_request, require_token
from ..envelope import envelope, message

router = APIRouter(tags=["projects"], dependencies=[Depends(require_token)])
webhook_router = APIRouter(tags=["projects"])


_EMBEDDED_LOG_TIMESTAMP = re.compile(
    r"(?P<value>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+UTC)\s*"
)


def _strip_duplicate_log_timestamp(line: str, docker_timestamp_ms: int) -> str:
    def replace(match: re.Match) -> str:
        try:
            value = dt.datetime.fromisoformat(match.group("value").replace(" UTC", "+00:00"))
        except ValueError:
            return match.group(0)
        app_timestamp_ms = int(value.timestamp() * 1000)
        if abs(app_timestamp_ms - docker_timestamp_ms) > 5000:
            return match.group(0)
        return " " if match.start() > 0 and not line[match.start() - 1].isspace() else ""

    return _EMBEDDED_LOG_TIMESTAMP.sub(replace, line).strip()


def _container_log_payload(raw: str) -> dict | None:
    timestamp, separator, line = raw.partition(" ")
    if separator:
        try:
            parsed = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            timestamp_ms = int(parsed.timestamp() * 1000)
            line = _strip_duplicate_log_timestamp(line, timestamp_ms)
            return {"line": line, "timestamp": timestamp_ms} if line else None
        except ValueError:
            pass
    return {"line": raw, "timestamp": None} if raw.strip() else None


@webhook_router.post("/projects/{project_id}/services/{service_id}/webhook")
async def app_service_webhook(project_id: int, service_id: int, request: Request,
                              secret: str = Query("")):
    try:
        body = await request.body()
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}
        data = P.handle_app_webhook(project_id, service_id, secret, dict(request.headers), payload, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data)


# --- Catálogo de templates ---------------------------------------------------

@router.get("/templates")
def list_templates(search: str = Query(""), tags: str = Query(""),
                   limit: int = Query(T.MAX_LIMIT), offset: int = Query(0)):
    tag_list = [t for t in tags.split(",") if t.strip()]
    return envelope(data=T.search(search, tag_list, limit, offset))


@router.get("/templates/tags")
def list_template_tags():
    return envelope(data=T.all_tags())


# --- Projetos ----------------------------------------------------------------

@router.get("/projects")
def list_projects():
    return envelope(data=P.list_projects())


@router.post("/projects", status_code=201)
def create_project(payload: dict = Body(...)):
    try:
        data = P.create_project(payload.get("name", ""), payload.get("description", ""),
                                payload.get("tags") or [])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("projeto criado", "success")])


@router.get("/projects/{project_id}")
def get_project(project_id: int):
    try:
        return envelope(data=P.get_project(project_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="projeto não encontrado")


@router.put("/projects/{project_id}")
def update_project(project_id: int, payload: dict = Body(...)):
    try:
        data = P.update_project(project_id, payload.get("name"),
                                payload.get("description"), payload.get("tags"))
    except KeyError:
        raise HTTPException(status_code=404, detail="projeto não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("projeto atualizado", "success")])


@router.delete("/projects/{project_id}")
def delete_project(project_id: int):
    try:
        name = P.delete_project(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="projeto não encontrado")
    return envelope(data={"deleted": project_id},
                    messages=[message(f"projeto '{name}' removido", "success")])


# --- Serviços ----------------------------------------------------------------

@router.post("/projects/{project_id}/services", status_code=201)
def create_service(project_id: int, payload: dict = Body(...)):
    try:
        data = P.create_service(project_id, payload.get("kind", ""),
                                payload.get("name", ""), payload.get("description", ""),
                                payload.get("config") or {})
    except KeyError:
        raise HTTPException(status_code=404, detail="projeto não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message(f"serviço '{data['name']}' criado", "success")])


@router.get("/projects/{project_id}/services/{service_id}")
def get_service(project_id: int, service_id: int):
    try:
        return envelope(data=P.get_service(project_id, service_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.put("/projects/{project_id}/services/{service_id}")
def update_service(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_service(project_id, service_id, payload.get("name"),
                                payload.get("description"), payload.get("config"))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("serviço atualizado", "success")])


@router.delete("/projects/{project_id}/services/{service_id}")
def delete_service(project_id: int, service_id: int):
    try:
        name = P.delete_service(project_id, service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    return envelope(data={"deleted": service_id},
                    messages=[message(f"serviço '{name}' removido", "success")])


# --- Backups (S3) ------------------------------------------------------------
# Declaradas ANTES da rota genérica /{verb} para não serem capturadas por ela.

@router.get("/projects/{project_id}/services/{service_id}/backups")
def list_backups(project_id: int, service_id: int,
                 page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100)):
    try:
        backups = P.list_backups(project_id, service_id, page, page_size)
        return envelope(data={
            "items": backups["items"],
            "pagination": backups["pagination"],
            "settings": P.backup_settings(project_id, service_id),
        })
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.get("/projects/{project_id}/services/{service_id}/backup-settings")
def get_backup_settings(project_id: int, service_id: int):
    try:
        return envelope(data=P.backup_settings(project_id, service_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.put("/projects/{project_id}/services/{service_id}/backup-settings")
def update_backup_settings(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_backup_settings(project_id, service_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("configurações de backup atualizadas", "success")])


@router.get("/projects/{project_id}/services/{service_id}/snapshots")
def list_snapshots(project_id: int, service_id: int,
                   page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100)):
    try:
        snapshots = P.list_snapshots(project_id, service_id, page, page_size)
        return envelope(data={
            "items": snapshots["items"],
            "pagination": snapshots["pagination"],
            "settings": P.snapshot_settings(project_id, service_id),
        })
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.get("/projects/{project_id}/services/{service_id}/snapshot-settings")
def get_snapshot_settings(project_id: int, service_id: int):
    try:
        return envelope(data=P.snapshot_settings(project_id, service_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.put("/projects/{project_id}/services/{service_id}/snapshot-settings")
def update_snapshot_settings(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_snapshot_settings(project_id, service_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("configurações de snapshot atualizadas", "success")])


@router.get("/projects/{project_id}/services/{service_id}/containers")
def service_containers(project_id: int, service_id: int):
    """Containers do serviço (para o seletor de logs/terminal)."""
    try:
        return envelope(data=P.service_containers(project_id, service_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")


@router.get("/projects/{project_id}/services/{service_id}/domains")
def service_domains(project_id: int, service_id: int):
    try:
        return envelope(data=P.service_domains(project_id, service_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/projects/{project_id}/services/{service_id}/domains", status_code=201)
def add_service_domain(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.add_service_domain(project_id, service_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("domínio vinculado", "success")])


@router.put("/projects/{project_id}/services/{service_id}/domains/{domain_id}")
def update_service_domain(project_id: int, service_id: int, domain_id: str, payload: dict = Body(...)):
    try:
        data = P.add_service_domain(project_id, service_id, payload, domain_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("domínio atualizado", "success")])


@router.delete("/projects/{project_id}/services/{service_id}/domains/{domain_id}")
def delete_service_domain(project_id: int, service_id: int, domain_id: str):
    try:
        data = P.delete_service_domain(project_id, service_id, domain_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("domínio removido", "success")])


@router.post("/projects/{project_id}/services/{service_id}/exec")
def service_exec(project_id: int, service_id: int, payload: dict = Body(...)):
    """Terminal/console: roda um comando no container e devolve a saída."""
    try:
        data = P.exec_command(project_id, service_id, payload.get("command", ""))
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data)


@router.post("/projects/{project_id}/services/{service_id}/backup")
def create_backup(project_id: int, service_id: int):
    try:
        entry = P.start_backup_job(project_id, service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=entry, messages=[message("backup iniciado", "success")])


@router.get("/projects/{project_id}/services/{service_id}/backup/jobs/{job_id}/stream")
async def backup_job_stream(request: Request, project_id: int, service_id: int, job_id: str,
                            from_seq: int = Query(0, alias="from", ge=0)):
    async def gen():
        seq = from_seq
        while True:
            if await request.is_disconnected():
                return
            try:
                events, done = await asyncio.to_thread(P.backup_job_events, job_id, seq)
            except KeyError:
                yield f"event: error\ndata: {json.dumps({'message': 'job não encontrado'})}\n\n"
                return
            for event in events:
                seq = int(event["seq"])
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            if done:
                yield f"event: end\ndata: {json.dumps({'job_id': job_id})}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/projects/{project_id}/services/{service_id}/snapshot")
def create_snapshot(project_id: int, service_id: int):
    try:
        entry = P.start_snapshot_job(project_id, service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=entry, messages=[message("snapshot iniciado", "success")])


@router.get("/projects/{project_id}/services/{service_id}/snapshot/jobs/{job_id}/stream")
async def snapshot_job_stream(request: Request, project_id: int, service_id: int, job_id: str,
                              from_seq: int = Query(0, alias="from", ge=0)):
    async def gen():
        seq = from_seq
        while True:
            if await request.is_disconnected():
                return
            try:
                events, done = await asyncio.to_thread(P.snapshot_job_events, job_id, seq)
            except KeyError:
                yield f"event: error\ndata: {json.dumps({'message': 'job de snapshot não encontrado'})}\n\n"
                return
            for event in events:
                seq = int(event["seq"])
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            if done:
                yield f"event: end\ndata: {json.dumps({'job_id': job_id})}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}/upload")
def upload_snapshot(project_id: int, service_id: int, snapshot_id: str):
    try:
        data = P.upload_snapshot(project_id, service_id, snapshot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="snapshot não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("snapshot enviado ao S3", "success")])


@router.post("/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}/restore")
def restore_snapshot(project_id: int, service_id: int, snapshot_id: str):
    try:
        data = P.start_snapshot_restore_job(project_id, service_id, snapshot_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="snapshot não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("restauração de snapshot iniciada", "success")])


@router.get("/projects/{project_id}/services/{service_id}/snapshot/restore-jobs/{job_id}/stream")
async def snapshot_restore_job_stream(request: Request, project_id: int, service_id: int, job_id: str,
                                      from_seq: int = Query(0, alias="from", ge=0)):
    async def gen():
        seq = from_seq
        while True:
            if await request.is_disconnected():
                return
            try:
                events, done = await asyncio.to_thread(P.snapshot_restore_job_events, job_id, seq)
            except KeyError:
                yield f"event: error\ndata: {json.dumps({'message': 'job de restauração de snapshot não encontrado'})}\n\n"
                return
            for event in events:
                seq = int(event["seq"])
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            if done:
                yield f"event: end\ndata: {json.dumps({'job_id': job_id})}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/projects/{project_id}/services/{service_id}/backups/{backup_id}/upload")
def upload_backup(project_id: int, service_id: int, backup_id: str):
    try:
        data = P.upload_backup(project_id, service_id, backup_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="backup não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("backup enviado ao S3", "success")])


@router.post("/projects/{project_id}/services/{service_id}/backups/{backup_id}/restore")
def restore_backup(project_id: int, service_id: int, backup_id: str):
    try:
        data = P.start_restore_job(project_id, service_id, backup_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="backup não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("restauração iniciada", "success")])


@router.get("/projects/{project_id}/services/{service_id}/backup/restore-jobs/{job_id}/stream")
async def restore_job_stream(request: Request, project_id: int, service_id: int, job_id: str,
                             from_seq: int = Query(0, alias="from", ge=0)):
    async def gen():
        seq = from_seq
        while True:
            if await request.is_disconnected():
                return
            try:
                events, done = await asyncio.to_thread(P.restore_job_events, job_id, seq)
            except KeyError:
                yield f"event: error\ndata: {json.dumps({'message': 'job de restauração não encontrado'})}\n\n"
                return
            for event in events:
                seq = int(event["seq"])
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            if done:
                yield f"event: end\ndata: {json.dumps({'job_id': job_id})}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.delete("/projects/{project_id}/services/{service_id}/backups/{backup_id}")
def delete_backup(project_id: int, service_id: int, backup_id: str,
                  delete_s3: bool = Query(False)):
    try:
        data = P.delete_backup(project_id, service_id, backup_id, delete_s3=delete_s3)
    except KeyError:
        raise HTTPException(status_code=404, detail="backup não encontrado")
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("backup removido", "success")])


@router.delete("/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}")
def delete_snapshot(project_id: int, service_id: int, snapshot_id: str,
                    delete_s3: bool = Query(False)):
    try:
        data = P.delete_snapshot(project_id, service_id, snapshot_id, delete_s3=delete_s3)
    except KeyError:
        raise HTTPException(status_code=404, detail="snapshot não encontrado")
    except Exception as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("snapshot removido", "success")])


# --- Configurações avançadas -------------------------------------------------

@router.put("/projects/{project_id}/services/{service_id}/advanced/command")
def update_advanced_command(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_service_config(project_id, service_id, {
            "command": payload.get("command", ""),
            "command_args": payload.get("command_args") or [],
        })
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("comando atualizado", "success")])


@router.put("/projects/{project_id}/services/{service_id}/advanced/volumes")
def update_advanced_volumes(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_service_config(project_id, service_id, {"volumes": payload.get("volumes") or []})
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("volumes atualizados", "success")])


@router.put("/projects/{project_id}/services/{service_id}/advanced/resources")
def update_advanced_resources(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_service_config(project_id, service_id, {"resources": payload.get("resources") or {}})
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("recursos atualizados", "success")])


@router.put("/projects/{project_id}/services/{service_id}/advanced/ulimits")
def update_advanced_ulimits(project_id: int, service_id: int, payload: dict = Body(...)):
    try:
        data = P.update_service_config(project_id, service_id, {"ulimits": payload.get("ulimits") or []})
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("ulimits atualizados", "success")])


# --- Runtime (Docker) --------------------------------------------------------

_ACTIONS = {"deploy", "start", "stop", "restart", "rebuild"}


@router.post("/projects/{project_id}/services/{service_id}/{verb}")
def service_action(project_id: int, service_id: int, verb: str, request: Request):
    if verb not in _ACTIONS:
        raise HTTPException(status_code=404, detail="ação inválida")
    try:
        user = getattr(request.state, "user", None) or request.headers.get("x-user") or ""
        data = P.start_runtime_action_job(project_id, service_id, verb, user=user)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message(f"'{verb}' iniciado", "success")])


@router.get("/projects/{project_id}/services/{service_id}/runtime/jobs/{job_id}/stream")
async def runtime_job_stream(request: Request, project_id: int, service_id: int, job_id: str,
                             from_seq: int = Query(0, alias="from", ge=0)):
    async def gen():
        seq = from_seq
        while True:
            if await request.is_disconnected():
                return
            try:
                events, done = await asyncio.to_thread(P.runtime_job_events, job_id, seq)
            except KeyError:
                yield f"event: error\ndata: {json.dumps({'message': 'job de runtime não encontrado'})}\n\n"
                return
            for event in events:
                seq = int(event["seq"])
                yield f"event: progress\ndata: {json.dumps(event)}\n\n"
            if done:
                yield f"event: end\ndata: {json.dumps({'job_id': job_id})}\n\n"
                return
            await asyncio.sleep(0.5)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/projects/{project_id}/services/{service_id}/logs/stream")
async def service_logs_stream(project_id: int, service_id: int, request: Request,
                              container: str = Query(""), tail: int = Query(200)):
    # SSE via EventSource não manda header Authorization; aceita ?token=.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")
    try:
        cid = container or P.container_for(project_id, service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")

    async def gen():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_event_loop()
        stop = False

        def pump():
            try:
                for line in dockerclient.stream_logs(cid, tail=tail, follow=True, timestamps=True):
                    if stop:
                        break
                    loop.call_soon_threadsafe(queue.put_nowait, line)
            except dockerclient.DockerError as exc:
                loop.call_soon_threadsafe(queue.put_nowait, f"[erro] {exc}")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        task = asyncio.create_task(asyncio.to_thread(pump))
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if line is None:
                    break
                payload = _container_log_payload(line)
                if payload is not None:
                    yield f"data: {json.dumps(payload)}\n\n"
        finally:
            stop = True
            task.cancel()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# --- Gerenciador de arquivos (aplicações SPA) --------------------------------

_FILES = "/projects/{project_id}/services/{service_id}/files"


def _files_root(project_id: int, service_id: int):
    """Raiz do gerenciador; mapeia erros de domínio p/ HTTPException."""
    try:
        return AF.app_root(project_id, service_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="serviço não encontrado")
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _upload_config() -> dict:
    """Limite/concorrência de upload (configuráveis em CI/CD → Upload)."""
    return {
        "max_mb": appsettings.get_int("upload_max_mb"),
        "concurrency": appsettings.get_int("upload_concurrency"),
    }


@router.get(_FILES)
def files_list(project_id: int, service_id: int, path: str = Query("")):
    root = _files_root(project_id, service_id)
    try:
        data = AF.list_dir(root, path)
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    data["upload"] = _upload_config()
    return envelope(data=data)


@router.post(_FILES + "/folder")
def files_mkdir(project_id: int, service_id: int, payload: dict = Body(...)):
    root = _files_root(project_id, service_id)
    try:
        entry = AF.make_dir(root, str(payload.get("path") or ""), str(payload.get("name") or ""))
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=entry, messages=[message("pasta criada", "success")])


@router.post(_FILES + "/move")
def files_move(project_id: int, service_id: int, payload: dict = Body(...)):
    root = _files_root(project_id, service_id)
    try:
        entry = AF.move(root, str(payload.get("src") or ""), str(payload.get("dst") or ""))
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=entry, messages=[message("item movido", "success")])


@router.post(_FILES + "/copy")
def files_copy(project_id: int, service_id: int, payload: dict = Body(...)):
    root = _files_root(project_id, service_id)
    try:
        entry = AF.copy(root, str(payload.get("src") or ""), str(payload.get("dst") or ""))
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=entry, messages=[message("item copiado", "success")])


@router.delete(_FILES)
def files_delete(project_id: int, service_id: int, path: str = Query(...)):
    root = _files_root(project_id, service_id)
    try:
        AF.delete(root, path)
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data={"path": path}, messages=[message("item removido", "success")])


@router.post(_FILES + "/upload")
async def files_upload(project_id: int, service_id: int, request: Request):
    """Upload multipart: campo `path` (pasta destino) + `files` (um ou vários);
    `paths` opcional carrega o caminho relativo de cada arquivo (upload de pasta)."""
    root = _files_root(project_id, service_id)
    max_bytes = _upload_config()["max_mb"] * 1024 * 1024
    form = await request.form()
    dest = str(form.get("path") or "")
    uploads = form.getlist("files")
    if not uploads:
        raise HTTPException(status_code=422, detail="nenhum arquivo enviado")
    rels = [str(p) for p in form.getlist("paths")]
    saved = []
    try:
        for i, uf in enumerate(uploads):
            name = (rels[i] if i < len(rels) and rels[i] else "") or getattr(uf, "filename", "")
            entry = await asyncio.to_thread(AF.save_upload, root, dest, name, uf.file, max_bytes)
            saved.append(entry)
    except AF.FileError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data={"uploaded": saved},
                    messages=[message(f"{len(saved)} item(ns) enviado(s)", "success")])
