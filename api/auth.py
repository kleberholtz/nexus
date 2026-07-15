"""Autenticação: identidade a partir do Bearer token.

Dois tipos de token são aceitos:
- o `API_TOKEN` do `.env` → identidade **master** (usuário do .env, todas as
  permissões). Continua sendo um bearer "root" válido (scripts/automação);
- um **token de sessão** emitido no login de um usuário do banco → identidade
  daquele usuário, com as permissões do seu papel (ver `api/rbac.py`).

A checagem de permissão por rota fica no middleware `api/authz.py`.
"""
from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, Request, status

from . import users
from .users import Identity

API_TOKEN = os.environ.get("API_TOKEN", "")


def resolve_identity(token: str) -> Identity | None:
    """Token → Identidade (master ou usuário do banco), ou None se inválido."""
    if not token:
        return None
    if API_TOKEN and hmac.compare_digest(token, API_TOKEN):
        return users.master_identity()
    return users.resolve_session(token)


def extract_token(request: Request) -> str:
    """Extrai o token do header `Authorization: Bearer` ou da query `?token=`
    (EventSource/SSE não manda header)."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.query_params.get("token", "")


def identity_from_request(request: Request) -> Identity | None:
    return resolve_identity(extract_token(request))


async def require_token(request: Request, authorization: str = Header(default="")) -> Identity:
    """Dependência: exige um bearer válido e devolve a Identidade.

    O enforcement de permissão por rota é feito no middleware; esta dependência
    garante autenticação (401) para as rotas que a declaram.
    """
    if not API_TOKEN:
        # Sem token configurado, a API recusa tudo para não ficar aberta por acidente.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API_TOKEN não configurado no servidor",
        )
    prefix = "Bearer "
    supplied = authorization[len(prefix):] if authorization.startswith(prefix) else request.query_params.get("token", "")
    identity = resolve_identity(supplied)
    if identity is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token inválido ou ausente",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return identity
