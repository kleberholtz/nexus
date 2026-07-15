"""CRUD dos provedores DNS configurados (tabela dns_providers) + fábrica.

Segredos (campos `secret`) nunca voltam nas respostas GET — são mascarados.
Em updates, um campo secret vazio/None mantém o valor já salvo.
"""
from __future__ import annotations

import json
import time

from . import dns
from .db import get_session
from .db.models import DnsProviderRow

MASK = "********"


def _config(row: DnsProviderRow) -> dict:
    try:
        return json.loads(row.config)
    except json.JSONDecodeError:
        return {}


def _public(row: DnsProviderRow) -> dict:
    cfg = _config(row)
    secrets = set(dns.secret_keys(row.type))
    masked = {k: (MASK if k in secrets and v else v) for k, v in cfg.items()}
    return {"id": row.id, "type": row.type, "label": row.label,
            "config": masked, "created_ts": row.created_ts}


def list_providers() -> list[dict]:
    with get_session() as s:
        return [_public(r) for r in s.query(DnsProviderRow).order_by(DnsProviderRow.id).all()]


def _validate(ptype: str, config: dict) -> None:
    if ptype not in dns.LABELS:
        raise ValueError(f"tipo de provedor inválido: {ptype}")
    missing = [k for k in dns.required_keys(ptype) if not str(config.get(k, "")).strip()]
    if missing:
        raise ValueError(f"campos obrigatórios ausentes: {', '.join(missing)}")


def create(ptype: str, label: str, config: dict) -> dict:
    _validate(ptype, config)
    with get_session() as s:
        row = DnsProviderRow(type=ptype, label=label or dns.LABELS[ptype],
                             config=json.dumps(config), created_ts=int(time.time() * 1000))
        s.add(row)
        s.commit()
        s.refresh(row)
        return _public(row)


def update(provider_id: int, label: str | None, config: dict | None) -> dict:
    with get_session() as s:
        row = s.get(DnsProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        if label is not None:
            row.label = label
        if config is not None:
            current = _config(row)
            secrets = set(dns.secret_keys(row.type))
            merged = dict(current)
            for k, v in config.items():
                # segredo vazio/None → mantém o atual
                if k in secrets and (v is None or v == "" or v == MASK):
                    continue
                merged[k] = v
            _validate(row.type, merged)
            row.config = json.dumps(merged)
        s.commit()
        s.refresh(row)
        return _public(row)


def delete(provider_id: int) -> bool:
    with get_session() as s:
        row = s.get(DnsProviderRow, provider_id)
        if not row:
            return False
        s.delete(row)
        s.commit()
        return True


def build_instance(provider_id: int) -> dns.DnsProvider:
    """Instancia o provedor (com credenciais reais) para operar registros."""
    with get_session() as s:
        row = s.get(DnsProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        return dns.build(row.type, _config(row))
