"""CRUD das chaves SSH (tabela ssh_keys) — autenticação de clone git via SSH.

A `private_key` nunca volta nas respostas (mascarada); num update, vazia/mascarada
mantém o valor salvo (padrão de `s3configs.py`). Se a chave privada não for
fornecida na criação, um par **ed25519** é gerado (usa `cryptography`).
"""
from __future__ import annotations

import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .db import get_session
from .db.models import SshKey

MASK = "********"


def _public(row: SshKey) -> dict:
    return {
        "id": row.id, "name": row.name,
        "private_key": MASK if row.private_key else "",
        "public_key": row.public_key, "created_ts": row.created_ts,
    }


def _generate_pair(comment: str) -> tuple[str, str]:
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public = key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode()
    if comment:
        public = f"{public} {comment}"
    return private, public


def list_keys() -> list[dict]:
    with get_session() as s:
        return [_public(r) for r in s.query(SshKey).order_by(SshKey.id).all()]


def create(name: str, private_key: str = "", public_key: str = "") -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("nome é obrigatório")
    private_key = (private_key or "").strip()
    public_key = (public_key or "").strip()
    if not private_key:
        private_key, public_key = _generate_pair(name)
    with get_session() as s:
        row = SshKey(name=name, private_key=private_key, public_key=public_key,
                     created_ts=int(time.time() * 1000))
        s.add(row)
        s.commit()
        s.refresh(row)
        return _public(row)


def update(key_id: int, name: str | None, private_key: str | None,
           public_key: str | None) -> dict:
    with get_session() as s:
        row = s.get(SshKey, key_id)
        if not row:
            raise KeyError("chave SSH não encontrada")
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("nome é obrigatório")
            row.name = name
        if private_key is not None and private_key not in ("", MASK):
            row.private_key = private_key.strip()
        if public_key is not None:
            row.public_key = public_key.strip()
        s.commit()
        s.refresh(row)
        return _public(row)


def delete(key_id: int) -> bool:
    with get_session() as s:
        row = s.get(SshKey, key_id)
        if not row:
            return False
        s.delete(row)
        s.commit()
        return True
