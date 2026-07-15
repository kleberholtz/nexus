"""Rotas /s3: CRUD das configurações S3 (destinos para upload de logs)."""
from __future__ import annotations

import time

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import s3client, s3configs
from ..auth import require_token
from ..envelope import envelope, message

router = APIRouter(prefix="/s3", tags=["s3"], dependencies=[Depends(require_token)])


@router.get("/fields")
def fields():
    """Schema dos campos de uma configuração S3 (para o formulário)."""
    return envelope(data=s3configs.FIELDS)


@router.get("/configs")
def list_configs():
    return envelope(data=s3configs.list_configs())


@router.post("/configs", status_code=201)
def create_config(payload: dict = Body(...)):
    config = payload.get("config") or {}
    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config deve ser um objeto")
    try:
        data = s3configs.create(str(payload.get("label", "")), config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return envelope(data=data, messages=[message("configuração S3 criada", "success")])


@router.put("/configs/{config_id}")
def update_config(config_id: int, payload: dict = Body(...)):
    config = payload.get("config")
    if config is not None and not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="config deve ser um objeto")
    try:
        data = s3configs.update(config_id, payload.get("label"), config)
    except KeyError:
        raise HTTPException(status_code=404, detail="configuração S3 não encontrada")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return envelope(data=data, messages=[message("configuração S3 atualizada", "success")])


@router.delete("/configs/{config_id}")
def delete_config(config_id: int):
    if not s3configs.delete(config_id):
        raise HTTPException(status_code=404, detail="configuração S3 não encontrada")
    return envelope(data={"deleted": config_id}, messages=[message("configuração removida", "success")])


@router.post("/configs/{config_id}/test")
def test_config(config_id: int):
    """Envia um objeto de teste para validar as credenciais/bucket."""
    try:
        cfg = s3configs.raw_config(config_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="configuração S3 não encontrada")
    key = f"nexus-test/{int(time.time())}.txt"
    try:
        s3client.put_object(cfg, key, b"Holtz Nexus s3 test\n", content_type="text/plain")
    except s3client.S3Error as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return envelope(data={"key": key}, messages=[message("upload de teste OK", "success")])
