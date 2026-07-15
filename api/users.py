"""Usuários do painel: hashing de senha, CRUD, sessões e identidade.

O usuário do `.env` (`API_USER`) é o **master**: não vive no banco, não pode ser
editado/removido e tem todas as permissões. Os demais usuários ficam na tabela
`users` (papel em `role`, ver `api/rbac.py`). O login emite um token opaco
guardado como hash na tabela `user_sessions`.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import time
from dataclasses import dataclass, field

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError, VerifyMismatchError
from argon2.low_level import Type
from sqlalchemy import delete, select

from . import rbac, roles
from .db import get_session
from .db.models import User, UserSession

# Credenciais/dados do master (usuário do .env). MASTER_USERNAME nunca é gravado
# no banco; API_TOKEN continua sendo um bearer "root" válido. Nome/e-mail do
# master são só para exibição no perfil (opcionais).
MASTER_USERNAME = os.environ.get("API_USER", "") or "master"
MASTER_NAME = os.environ.get("API_NAME", "") or MASTER_USERNAME
MASTER_EMAIL = os.environ.get("API_EMAIL", "")

SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "7") or "7")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now_ms() -> int:
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- #
# Identidade (quem está fazendo a request)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Identity:
    username: str
    role: str
    permissions: frozenset[str] = field(default_factory=frozenset)
    is_master: bool = False
    user_id: int | None = None
    name: str = ""
    email: str = ""

    def has(self, resource: str, action: str) -> bool:
        return rbac.has_permission(self.permissions, resource, action)


def master_identity() -> Identity:
    return Identity(
        username=MASTER_USERNAME, role=rbac.MASTER_ROLE,
        permissions=frozenset(roles.permissions_for(rbac.MASTER_ROLE)),
        is_master=True, user_id=None, name=MASTER_NAME, email=MASTER_EMAIL,
    )


def identity_from_user(user: User) -> Identity:
    return Identity(
        username=user.username, role=user.role,
        permissions=frozenset(roles.permissions_for(user.role)),
        is_master=False, user_id=user.id,
        name=user.name or user.username, email=user.email or "",
    )


# --------------------------------------------------------------------------- #
# Hashing de senha (Argon2id via argon2-cffi; PHC `$argon2id$...`)
# --------------------------------------------------------------------------- #
_hasher = PasswordHasher(type=Type.ID)  # Argon2id


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def _verify_pbkdf2(password: str, stored: str) -> bool:
    """Compat: valida hashes pbkdf2 antigos (migrados p/ argon2 no 1º login)."""
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
    return hmac.compare_digest(dk.hex(), hash_hex)


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("$argon2"):
        try:
            return _hasher.verify(stored, password)
        except (VerifyMismatchError, InvalidHashError, Argon2Error):
            return False
    return _verify_pbkdf2(password, stored)


def password_needs_upgrade(stored: str) -> bool:
    """True se o hash não é argon2id ou usa parâmetros defasados (re-hash)."""
    if not stored.startswith("$argon2"):
        return True
    try:
        return _hasher.check_needs_rehash(stored)
    except Argon2Error:
        return True


# --------------------------------------------------------------------------- #
# Sessões (token opaco → usuário)
# --------------------------------------------------------------------------- #
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int, ttl_days: int | None = None) -> str:
    if ttl_days is None:
        from . import appsettings
        ttl_days = appsettings.get_int("session_ttl_days")
    token = secrets.token_urlsafe(32)
    now = _now_ms()
    with get_session() as s:
        s.add(UserSession(
            token_hash=_token_hash(token), user_id=user_id,
            created_ts=now, expires_ts=now + ttl_days * 86_400_000,
        ))
        s.commit()
    return token


def delete_session(token: str) -> None:
    with get_session() as s:
        s.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        s.commit()


def _delete_user_sessions(s, user_id: int) -> None:
    s.execute(delete(UserSession).where(UserSession.user_id == user_id))


def resolve_session(token: str) -> Identity | None:
    """Token de sessão válido e não expirado → Identidade do usuário (ativo)."""
    th = _token_hash(token)
    now = _now_ms()
    with get_session() as s:
        row = s.execute(select(UserSession).where(UserSession.token_hash == th)).scalar_one_or_none()
        if row is None:
            return None
        if row.expires_ts and row.expires_ts < now:
            s.execute(delete(UserSession).where(UserSession.id == row.id))
            s.commit()
            return None
        user = s.get(User, row.user_id)
        if user is None or not user.active:
            return None
        return identity_from_user(user)


# --------------------------------------------------------------------------- #
# CRUD de usuários
# --------------------------------------------------------------------------- #
class UserError(Exception):
    """Erro de validação/regras de negócio na gestão de usuários."""
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _serialize(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name or "",
        "email": user.email or "",
        "role": user.role,
        "active": user.active,
        "created_ts": user.created_ts,
        "updated_ts": user.updated_ts,
        "master": False,
        "editable": True,
    }


def master_entry() -> dict:
    """Linha sintética do master (para o painel listar; não é editável)."""
    return {
        "id": None,
        "username": MASTER_USERNAME,
        "name": MASTER_NAME,
        "email": MASTER_EMAIL,
        "role": rbac.MASTER_ROLE,
        "active": True,
        "created_ts": 0,
        "updated_ts": 0,
        "master": True,
        "editable": False,
    }


def list_users() -> list[dict]:
    with get_session() as s:
        rows = s.execute(select(User).order_by(User.username)).scalars().all()
    return [master_entry(), *(_serialize(u) for u in rows)]


def verify_credentials(username: str, password: str) -> Identity | None:
    """Valida usuário/senha do banco → Identidade (ou None). Master é tratado
    separadamente no router de login. Migra o hash p/ argon2id no 1º login."""
    with get_session() as s:
        user = s.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if user is None or not user.active or not verify_password(password, user.password_hash):
            return None
        if password_needs_upgrade(user.password_hash):
            user.password_hash = hash_password(password)
            user.updated_ts = _now_ms()
            s.commit()
        return identity_from_user(user)


def _validate_username(username: str) -> str:
    username = (username or "").strip()
    if not (3 <= len(username) <= 120):
        raise UserError("usuário deve ter entre 3 e 120 caracteres")
    if username == MASTER_USERNAME:
        raise UserError("nome reservado ao usuário master", status=409)
    return username


def _validate_password(password: str) -> None:
    if len(password or "") < 8:
        raise UserError("senha deve ter ao menos 8 caracteres")


def _validate_name(name: str) -> str:
    name = (name or "").strip()
    if not (2 <= len(name) <= 120):
        raise UserError("nome deve ter entre 2 e 120 caracteres")
    return name


def _validate_email(email: str) -> str:
    email = (email or "").strip()
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise UserError("e-mail inválido")
    return email


def create_user(username: str, password: str, role: str, name: str, email: str) -> dict:
    username = _validate_username(username)
    _validate_password(password)
    name = _validate_name(name)
    email = _validate_email(email)
    if not roles.is_assignable(role):
        raise UserError(f"papel inválido: {role!r}")
    now = _now_ms()
    with get_session() as s:
        exists = s.execute(select(User).where(User.username == username)).scalar_one_or_none()
        if exists is not None:
            raise UserError("usuário já existe", status=409)
        user = User(
            username=username, password_hash=hash_password(password),
            name=name, email=email,
            role=role, active=True, created_ts=now, updated_ts=now,
        )
        s.add(user)
        s.commit()
        s.refresh(user)
        return _serialize(user)


def update_user(user_id: int, *, role: str | None = None, active: bool | None = None,
                password: str | None = None, name: str | None = None,
                email: str | None = None) -> dict:
    with get_session() as s:
        user = s.get(User, user_id)
        if user is None:
            raise UserError("usuário não encontrado", status=404)
        if role is not None:
            if not roles.is_assignable(role):
                raise UserError(f"papel inválido: {role!r}")
            user.role = role
        if active is not None:
            user.active = bool(active)
        if name is not None:
            user.name = _validate_name(name)
        if email is not None:
            user.email = _validate_email(email)
        if password is not None and password != "":
            _validate_password(password)
            user.password_hash = hash_password(password)
        user.updated_ts = _now_ms()
        if active is False or password:
            _delete_user_sessions(s, user.id)   # força novo login
        s.commit()
        s.refresh(user)
        return _serialize(user)


def delete_user(user_id: int) -> None:
    with get_session() as s:
        user = s.get(User, user_id)
        if user is None:
            raise UserError("usuário não encontrado", status=404)
        _delete_user_sessions(s, user.id)
        s.execute(delete(User).where(User.id == user.id))
        s.commit()


# --------------------------------------------------------------------------- #
# Perfil (auto-serviço do próprio usuário)
# --------------------------------------------------------------------------- #
def get_profile(identity: Identity) -> dict:
    """Perfil da sessão atual (nome/e-mail/role). Master é read-only (.env)."""
    if identity.is_master:
        return {
            "username": identity.username, "name": MASTER_NAME, "email": MASTER_EMAIL,
            "role": identity.role, "is_master": True, "editable": False,
        }
    with get_session() as s:
        user = s.get(User, identity.user_id)
        if user is None:
            raise UserError("usuário não encontrado", status=404)
        return {
            "username": user.username, "name": user.name or "", "email": user.email or "",
            "role": user.role, "is_master": False, "editable": True,
        }


def update_profile(identity: Identity, *, name: str, email: str,
                   current_password: str | None = None,
                   new_password: str | None = None) -> dict:
    """Atualiza nome/e-mail (obrigatórios) e, opcionalmente, a senha (exige a
    senha atual). Não encerra a sessão atual. Master não é editável."""
    if identity.is_master:
        raise UserError("o perfil do master é definido no .env", status=403)
    name = _validate_name(name)
    email = _validate_email(email)
    with get_session() as s:
        user = s.get(User, identity.user_id)
        if user is None:
            raise UserError("usuário não encontrado", status=404)
        if new_password:
            if not current_password or not verify_password(current_password, user.password_hash):
                raise UserError("senha atual incorreta", status=403)
            _validate_password(new_password)
            user.password_hash = hash_password(new_password)
        user.name = name
        user.email = email
        user.updated_ts = _now_ms()
        s.commit()
        return {
            "username": user.username, "name": user.name, "email": user.email,
            "role": user.role, "is_master": False, "editable": True,
        }
