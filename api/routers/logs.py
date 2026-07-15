"""Rotas /logs: últimas N linhas do access/error.log + stream SSE (live logs)."""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse

from .. import appsettings, logmetrics, logrotate, logs, s3client, s3configs
from ..auth import identity_from_request, require_token
from ..envelope import envelope, message

router = APIRouter(prefix="/logs", tags=["logs"])

_ACCESS_ROTATED_RE = re.compile(r"^access\.log\.(\d{8})-\d{6}(?:\.gz)?$")


@router.get("/access", dependencies=[Depends(require_token)])
def access(lines: int = Query(50, ge=1, le=1000), page: int | None = Query(None, ge=1)):
    if page is not None:
        return envelope(data=logs.entries_page(page, 50))
    return envelope(data=logs.entries(lines))


@router.get("/error", dependencies=[Depends(require_token)])
def error(lines: int = Query(50, ge=1, le=1000), page: int | None = Query(None, ge=1)):
    if page is not None:
        return envelope(data=logs.error_entries_page(page, 50))
    return envelope(data=logs.error_entries(lines))


@router.get("/access/download", dependencies=[Depends(require_token)])
def download_access():
    if not logs.ACCESS_LOG.exists():
        raise HTTPException(status_code=404, detail="access.log não encontrado")
    return FileResponse(logs.ACCESS_LOG, filename="access.log", media_type="text/plain")


@router.get("/error/download", dependencies=[Depends(require_token)])
def download_error():
    if not logs.ERROR_LOG.exists():
        raise HTTPException(status_code=404, detail="error.log não encontrado")
    return FileResponse(logs.ERROR_LOG, filename="error.log", media_type="text/plain")


@router.get("/metrics", dependencies=[Depends(require_token)])
def metrics(lines: int = Query(5000, ge=1, le=50000)):
    """Métricas agregadas a partir das últimas `lines` do access.log (JSON)."""
    return envelope(data=logmetrics.compute(lines))


def _file_info(path: Path, kind: str, current: bool) -> dict | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return {
        "name": path.name,
        "path": str(path),
        "kind": kind,
        "current": current,
        "size": st.st_size,
        "mtime": int(st.st_mtime * 1000),
        "s3": {"status": "not_applicable"},
    }


def _rotated_files(base: Path) -> list[Path]:
    try:
        return sorted(
            base.parent.glob(base.name + ".*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return []


def _s3_key_for_access_rotation(name: str) -> str | None:
    match = _ACCESS_ROTATED_RE.match(name)
    if not match:
        return None
    stamp = match.group(1)
    return f"{stamp[:4]}/{stamp[4:6]}/{stamp[6:8]}/{name}"


def _rotated_access_by_name(name: str) -> Path | None:
    for path in _rotated_files(logs.ACCESS_LOG):
        if path.name == name:
            return path
    return None


@router.get("/files", dependencies=[Depends(require_token)])
def files():
    """Lista arquivos locais de log e indica se rotacionados estão no S3 configurado."""
    items: list[dict] = []
    for path, kind, current in [
        (logs.ACCESS_LOG, "access", True),
        (logs.ERROR_LOG, "error", True),
    ]:
        info = _file_info(path, kind, current)
        if info:
            items.append(info)
    for path in _rotated_files(logs.ACCESS_LOG):
        info = _file_info(path, "access", False)
        if info:
            items.append(info)
    for path in _rotated_files(logs.ERROR_LOG):
        info = _file_info(path, "error", False)
        if info:
            items.append(info)

    s3_enabled = appsettings.get_bool("log_s3_enabled")
    s3_config_id = appsettings.get_int("log_s3_config_id")
    s3_label = ""
    cfg: dict | None = None
    if s3_config_id:
        s3_label = next(
            (c["label"] for c in s3configs.list_configs() if c["id"] == s3_config_id),
            "",
        )
    if s3_enabled and s3_config_id:
        try:
            cfg = s3configs.raw_config(s3_config_id)
        except KeyError:
            cfg = None

    s3_error: str | None = None
    for item in items:
        key = _s3_key_for_access_rotation(item["name"]) if item["kind"] == "access" and not item["current"] else None
        if not key:
            item["s3"] = {"status": "not_applicable"}
        elif not s3_enabled:
            item["s3"] = {"status": "disabled", "key": key}
        elif not cfg:
            item["s3"] = {"status": "error", "key": key, "error": "configuração S3 ausente"}
        elif s3_error:
            item["s3"] = {"status": "error", "key": key, "error": s3_error}
        else:
            try:
                item["s3"] = {
                    "status": "available" if s3client.object_exists(cfg, key) else "missing",
                    "key": key,
                }
            except Exception as exc:  # noqa: BLE001
                s3_error = str(exc)
                item["s3"] = {"status": "error", "key": key, "error": s3_error}

    items.sort(key=lambda x: (not x["current"], -x["mtime"]))
    return envelope(data={
        "s3_enabled": s3_enabled,
        "s3_config_id": s3_config_id,
        "s3_label": s3_label,
        "files": items,
    })


@router.post("/rotate", dependencies=[Depends(require_token)])
def rotate():
    """Rotaciona o access.log agora (comprime/envia ao S3 conforme settings)."""
    result = logrotate.rotate_now()
    kind = "success" if result.get("rotated") else "warn"
    return envelope(data=result, messages=[message(
        "log rotacionado" if result.get("rotated") else result.get("reason", "nada a rotacionar"), kind)])


@router.post("/files/retry", dependencies=[Depends(require_token)])
def retry_file(payload: dict = Body(...)):
    """Reenvia manualmente um access.log rotacionado para o S3 configurado."""
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="nome do arquivo é obrigatório")
    key = _s3_key_for_access_rotation(name)
    if not key:
        raise HTTPException(status_code=400, detail="arquivo não é um access.log rotacionado")
    path = _rotated_access_by_name(name)
    if not path:
        raise HTTPException(status_code=404, detail="arquivo local não encontrado")
    s3_config_id = appsettings.get_int("log_s3_config_id")
    if not s3_config_id:
        raise HTTPException(status_code=409, detail="nenhum destino S3 configurado")
    try:
        cfg = s3configs.raw_config(s3_config_id)
        s3client.put_object(
            cfg,
            key,
            path.read_bytes(),
            content_type="application/gzip" if path.suffix == ".gz" else "text/plain",
        )
    except KeyError as exc:
        raise HTTPException(status_code=409, detail="configuração S3 ausente") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return envelope(
        data={"uploaded": True, "file": name, "key": key},
        messages=[message("arquivo reenviado ao S3", "success")],
    )


@router.delete("/files/local", dependencies=[Depends(require_token)])
def delete_local_file(payload: dict = Body(...)):
    """Remove um access.log rotacionado local depois de confirmado no S3."""
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="nome do arquivo é obrigatório")
    key = _s3_key_for_access_rotation(name)
    if not key:
        raise HTTPException(status_code=400, detail="arquivo não é um access.log rotacionado")
    path = _rotated_access_by_name(name)
    if not path:
        raise HTTPException(status_code=404, detail="arquivo local não encontrado")
    s3_config_id = appsettings.get_int("log_s3_config_id")
    if not s3_config_id:
        raise HTTPException(status_code=409, detail="nenhum destino S3 configurado")
    try:
        cfg = s3configs.raw_config(s3_config_id)
        if not s3client.object_exists(cfg, key):
            raise HTTPException(status_code=409, detail="arquivo ainda não está disponível no S3")
        path.unlink()
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=409, detail="configuração S3 ausente") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return envelope(
        data={"deleted": True, "file": name, "key": key},
        messages=[message("arquivo local removido", "success")],
    )


def _check_token(request: Request) -> None:
    # SSE via EventSource não manda header Authorization; aceitamos ?token=.
    # Aceita tanto o API_TOKEN (master) quanto tokens de sessão de usuários.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")


def _tail_stream(request: Request, path: Path, parser: Callable[[str], dict | None]) -> StreamingResponse:
    """SSE genérico: envia as linhas novas de `path` conforme são gravadas."""

    async def gen():
        f = None
        try:
            if path.exists():
                f = open(path, "r", errors="replace")
                f.seek(0, os.SEEK_END)
            while True:
                if await request.is_disconnected():
                    break
                if f is None:
                    if path.exists():
                        f = open(path, "r", errors="replace")
                        f.seek(0, os.SEEK_END)
                    else:
                        await asyncio.sleep(1.0)
                        continue
                # rotação/truncamento: volta ao início se o arquivo encolheu
                try:
                    if path.stat().st_size < f.tell():
                        f.seek(0)
                except OSError:
                    pass
                new_lines = await asyncio.to_thread(f.readlines)
                for ln in new_lines:
                    ln = ln.rstrip("\n")
                    if ln:
                        payload = {"raw": ln, "parsed": parser(ln)}
                        yield f"data: {json.dumps(payload)}\n\n"
                await asyncio.sleep(0.8)
        finally:
            if f:
                f.close()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/access/stream")
async def access_stream(request: Request):
    """SSE: envia as linhas novas do access.log conforme são gravadas."""
    _check_token(request)
    return _tail_stream(request, logs.ACCESS_LOG, logs.parse_line)


@router.get("/error/stream")
async def error_stream(request: Request):
    """SSE: envia as linhas novas do error.log conforme são gravadas."""
    _check_token(request)
    return _tail_stream(request, logs.ERROR_LOG, logs.parse_error_line)
