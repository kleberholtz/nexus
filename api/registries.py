"""CRUD dos registries Docker (tabela docker_registries) — imagens privadas.

A `password` nunca volta nas respostas (mascarada); num update, vazia/mascarada
mantém o valor salvo (padrão de `s3configs.py`).
"""
from __future__ import annotations

import time

from .db import get_session
from .db.models import DockerRegistry

MASK = "********"


def _public(row: DockerRegistry) -> dict:
    return {
        "id": row.id, "name": row.name, "url": row.url, "username": row.username,
        "password": MASK if row.password else "", "created_ts": row.created_ts,
    }


def list_registries() -> list[dict]:
    with get_session() as s:
        return [_public(r) for r in s.query(DockerRegistry).order_by(DockerRegistry.id).all()]


def create(name: str, url: str, username: str, password: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("nome é obrigatório")
    with get_session() as s:
        row = DockerRegistry(name=name, url=(url or "").strip(),
                             username=(username or "").strip(), password=(password or ""),
                             created_ts=int(time.time() * 1000))
        s.add(row)
        s.commit()
        s.refresh(row)
        return _public(row)


def update(reg_id: int, name: str | None, url: str | None, username: str | None,
           password: str | None) -> dict:
    with get_session() as s:
        row = s.get(DockerRegistry, reg_id)
        if not row:
            raise KeyError("registry não encontrado")
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("nome é obrigatório")
            row.name = name
        if url is not None:
            row.url = url.strip()
        if username is not None:
            row.username = username.strip()
        if password is not None and password not in ("", MASK):
            row.password = password
        s.commit()
        s.refresh(row)
        return _public(row)


def delete(reg_id: int) -> bool:
    with get_session() as s:
        row = s.get(DockerRegistry, reg_id)
        if not row:
            return False
        s.delete(row)
        s.commit()
        return True
