"""Rotas /auth: login por usuário/senha, verificação e logout.

Dois caminhos de login:
- **master**: usuário/senha do `.env` (`API_USER`/`API_PASSWORD`) → devolve o
  `API_TOKEN` (bearer "root", todas as permissões);
- **usuário do banco**: valida credenciais e emite um **token de sessão** próprio.

A resposta inclui o papel e as permissões para o painel liberar telas/ações.
"""
from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from .. import users
from ..auth import API_TOKEN, extract_token, require_token
from ..envelope import envelope
from ..users import Identity

router = APIRouter(prefix="/auth", tags=["auth"])

API_USER = os.environ.get("API_USER", "")
API_PASSWORD = os.environ.get("API_PASSWORD", "")


def _identity_payload(identity: Identity, token: str) -> dict:
    return {
        "token": token,
        "user": identity.username,
        "name": identity.name,
        "email": identity.email,
        "role": identity.role,
        "is_master": identity.is_master,
        "permissions": sorted(identity.permissions),
    }


@router.post("/login")
def login(payload: dict = Body(...)):
    username = str(payload.get("username", ""))
    password = str(payload.get("password", ""))

    # 1) master (usuário do .env) — devolve o API_TOKEN.
    if API_USER and API_PASSWORD and API_TOKEN:
        user_ok = hmac.compare_digest(username, API_USER)
        pass_ok = hmac.compare_digest(password, API_PASSWORD)
        if user_ok and pass_ok:
            return envelope(data=_identity_payload(users.master_identity(), API_TOKEN))

    # 2) usuário do banco — emite token de sessão.
    identity = users.verify_credentials(username, password)
    if identity is not None and identity.user_id is not None:
        token = users.create_session(identity.user_id)
        return envelope(data=_identity_payload(identity, token))

    raise HTTPException(status_code=401, detail="usuário ou senha inválidos")


@router.get("/verify", dependencies=[Depends(require_token)])
def verify(identity: Identity = Depends(require_token)):
    """Confirma o bearer e devolve a identidade (usado ao restaurar a sessão)."""
    return envelope(data={
        "valid": True,
        "user": identity.username,
        "name": identity.name,
        "email": identity.email,
        "role": identity.role,
        "is_master": identity.is_master,
        "permissions": sorted(identity.permissions),
    })


@router.post("/logout")
def logout(request: Request, identity: Identity = Depends(require_token)):
    """Invalida a sessão atual (no-op para o master, que usa o API_TOKEN)."""
    if not identity.is_master:
        users.delete_session(extract_token(request))
    return envelope(data={"ok": True})
