"""Store de papéis (roles) persistidos — permissões editáveis pelo painel.

Fonte da verdade das permissões de cada papel atribuível. O `master` é implícito
(todas as permissões, `{"*"}`) e não vive no banco. Os papéis-semente
(`rbac.DEFAULT_ROLES`) são criados na 1ª utilização e marcados `builtin` (não
deletáveis, mas editáveis).

`permissions_for` é chamado a cada request (no authz) — por isso mantemos um
cache em memória invalidado a cada escrita.
"""
from __future__ import annotations

import json
import re
import threading
import time

from sqlalchemy import delete, func, select

from . import rbac
from .db import get_session
from .db.models import Role, User

MASTER_ROLE = rbac.MASTER_ROLE

_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")

_cache: dict[str, set[str]] | None = None
_lock = threading.Lock()
_seeded = False


class RoleError(Exception):
    """Erro de validação/regra de negócio na gestão de papéis."""
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


def invalidate() -> None:
    global _cache
    _cache = None


def ensure_defaults() -> None:
    """Cria os papéis-semente ausentes (idempotente). Não sobrescreve edições."""
    global _seeded
    if _seeded:
        return
    now = _now_ms()
    with get_session() as s:
        existing = {r.name for r in s.execute(select(Role)).scalars().all()}
        added = False
        for d in rbac.DEFAULT_ROLES:
            if d["name"] not in existing:
                s.add(Role(
                    name=d["name"], label=d["label"],
                    permissions=json.dumps(d["permissions"]),
                    builtin=True, created_ts=now, updated_ts=now,
                ))
                added = True
        if added:
            s.commit()
    _seeded = True
    invalidate()


def _load() -> dict[str, set[str]]:
    ensure_defaults()
    with get_session() as s:
        rows = s.execute(select(Role)).scalars().all()
    return {r.name: set(json.loads(r.permissions or "[]")) for r in rows}


def _get_cache() -> dict[str, set[str]]:
    global _cache
    if _cache is None:
        with _lock:
            if _cache is None:
                _cache = _load()
    return _cache


def permissions_for(name: str) -> set[str]:
    """Permissões de um papel (master → tudo; desconhecido → vazio)."""
    if name == MASTER_ROLE:
        return {"*"}
    return set(_get_cache().get(name, set()))


def is_assignable(name: str) -> bool:
    """Papéis atribuíveis a usuários do banco (master não é atribuível)."""
    if name == MASTER_ROLE:
        return False
    return name in _get_cache()


# --------------------------------------------------------------------------- #
# Listagem / CRUD
# --------------------------------------------------------------------------- #
def _master_entry() -> dict:
    return {
        "name": MASTER_ROLE, "label": "Master", "permissions": ["*"],
        "builtin": True, "assignable": False, "in_use": 0, "editable": False,
    }


def list_roles() -> list[dict]:
    ensure_defaults()
    with get_session() as s:
        rows = s.execute(select(Role).order_by(Role.name)).scalars().all()
        counts = dict(
            s.execute(select(User.role, func.count()).group_by(User.role)).all()
        )
    out = [_master_entry()]
    for r in rows:
        out.append({
            "name": r.name,
            "label": r.label,
            "permissions": sorted(json.loads(r.permissions or "[]")),
            "builtin": r.builtin,
            "assignable": True,
            "in_use": int(counts.get(r.name, 0)),
            "editable": True,
        })
    return out


def _validate_permissions(perms: list[str]) -> list[str]:
    allowed = rbac.all_permissions()
    clean = sorted(set(perms))
    bad = [p for p in clean if p not in allowed]
    if bad:
        raise RoleError(f"permissões inválidas: {', '.join(bad)}")
    return clean


def create_role(name: str, label: str, permissions: list[str]) -> dict:
    name = (name or "").strip().lower()
    if not _NAME_RE.match(name):
        raise RoleError("nome inválido (a-z, 0-9, '-', '_'; começa com letra; 2–40)")
    if name == MASTER_ROLE:
        raise RoleError("nome reservado ao papel master", status=409)
    perms = _validate_permissions(permissions or [])
    now = _now_ms()
    with get_session() as s:
        if s.get(Role, name) is not None:
            raise RoleError("papel já existe", status=409)
        row = Role(name=name, label=(label or name).strip(),
                   permissions=json.dumps(perms), builtin=False,
                   created_ts=now, updated_ts=now)
        s.add(row)
        s.commit()
    invalidate()
    return {"name": name, "label": (label or name).strip(), "permissions": perms,
            "builtin": False, "assignable": True, "in_use": 0, "editable": True}


def update_role(name: str, *, label: str | None = None,
                permissions: list[str] | None = None) -> dict:
    if name == MASTER_ROLE:
        raise RoleError("papel master não é editável", status=403)
    with get_session() as s:
        row = s.get(Role, name)
        if row is None:
            raise RoleError("papel não encontrado", status=404)
        if label is not None:
            row.label = label.strip()
        if permissions is not None:
            row.permissions = json.dumps(_validate_permissions(permissions))
        row.updated_ts = _now_ms()
        s.commit()
        result = {
            "name": row.name, "label": row.label,
            "permissions": sorted(json.loads(row.permissions or "[]")),
            "builtin": row.builtin, "assignable": True, "editable": True,
        }
    invalidate()
    return result


def delete_role(name: str) -> None:
    if name == MASTER_ROLE:
        raise RoleError("papel master não é editável", status=403)
    with get_session() as s:
        row = s.get(Role, name)
        if row is None:
            raise RoleError("papel não encontrado", status=404)
        if row.builtin:
            raise RoleError("papéis internos não podem ser removidos", status=403)
        in_use = s.execute(
            select(func.count()).select_from(User).where(User.role == name)
        ).scalar_one()
        if in_use:
            raise RoleError(f"papel em uso por {in_use} usuário(s)", status=409)
        s.execute(delete(Role).where(Role.name == name))
        s.commit()
    invalidate()
