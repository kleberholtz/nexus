"""CRUD das configurações S3 (tabela s3_configs) — destinos para upload de logs.

Pode haver **várias** configurações. O segredo (`secret_key`) nunca volta nas
respostas GET (mascarado); num update, secret vazio/None mantém o valor salvo.

Campos da config (JSON):
    endpoint    URL do serviço (ex.: https://s3.amazonaws.com ou MinIO/R2/…);
                vazio = deriva de region para AWS.
    region      região (ex.: us-east-1; para R2 use "auto")
    bucket      nome do bucket (obrigatório)
    access_key  chave de acesso (obrigatório)
    secret_key  chave secreta (obrigatório, mascarado)
    prefix      prefixo/pasta dentro do bucket (opcional)
"""
from __future__ import annotations

import json
import time

from .db import get_session
from .db.models import S3ConfigRow

MASK = "********"
SECRET_KEYS = {"secret_key"}
REQUIRED = ("bucket", "access_key", "secret_key")

# Schema exposto ao frontend (rótulo/segredo por campo).
FIELDS = [
    {"key": "bucket", "label": "Bucket", "secret": False},
    {"key": "region", "label": "Região (ex.: us-east-1 / auto)", "secret": False},
    {"key": "endpoint", "label": "Endpoint (vazio = AWS S3)", "secret": False},
    {"key": "access_key", "label": "Access Key ID", "secret": False},
    {"key": "secret_key", "label": "Secret Access Key", "secret": True},
    {"key": "prefix", "label": "Prefixo/pasta (opcional)", "secret": False},
]


def _config(row: S3ConfigRow) -> dict:
    try:
        return json.loads(row.config)
    except json.JSONDecodeError:
        return {}


def _public(row: S3ConfigRow) -> dict:
    cfg = _config(row)
    masked = {k: (MASK if k in SECRET_KEYS and v else v) for k, v in cfg.items()}
    return {"id": row.id, "label": row.label, "config": masked, "created_ts": row.created_ts}


def list_configs() -> list[dict]:
    with get_session() as s:
        return [_public(r) for r in s.query(S3ConfigRow).order_by(S3ConfigRow.id).all()]


def _validate(config: dict) -> None:
    missing = [k for k in REQUIRED if not str(config.get(k, "")).strip()]
    if missing:
        raise ValueError(f"campos obrigatórios ausentes: {', '.join(missing)}")


def create(label: str, config: dict) -> dict:
    _validate(config)
    with get_session() as s:
        row = S3ConfigRow(label=label or config.get("bucket", "S3"),
                          config=json.dumps(config), created_ts=int(time.time() * 1000))
        s.add(row)
        s.commit()
        s.refresh(row)
        return _public(row)


def update(config_id: int, label: str | None, config: dict | None) -> dict:
    with get_session() as s:
        row = s.get(S3ConfigRow, config_id)
        if not row:
            raise KeyError("configuração S3 não encontrada")
        if label is not None:
            row.label = label
        if config is not None:
            merged = dict(_config(row))
            for k, v in config.items():
                if k in SECRET_KEYS and (v is None or v == "" or v == MASK):
                    continue  # segredo vazio → mantém o atual
                merged[k] = v
            _validate(merged)
            row.config = json.dumps(merged)
        s.commit()
        s.refresh(row)
        return _public(row)


def delete(config_id: int) -> bool:
    with get_session() as s:
        row = s.get(S3ConfigRow, config_id)
        if not row:
            return False
        s.delete(row)
        s.commit()
        return True


def raw_config(config_id: int) -> dict:
    """Config com o segredo real (uso interno: upload)."""
    with get_session() as s:
        row = s.get(S3ConfigRow, config_id)
        if not row:
            raise KeyError("configuração S3 não encontrada")
        return _config(row)
