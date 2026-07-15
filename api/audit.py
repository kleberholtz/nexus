"""Registro de auditoria: grava toda modificação do sistema.

Um middleware captura métodos mutadores (POST/PUT/DELETE/PATCH), o usuário (do
header X-User enviado pelo frontend, ou API_USER), o horário em milissegundos, a
ação (derivada de método+rota), a rota e o status da resposta.
"""
from __future__ import annotations

import os
import re
import time

from starlette.requests import Request

from .db import get_session
from .db.models import AuditLog

API_USER = os.environ.get("API_USER", "") or "api"

# Rotas que não geram auditoria (ruído / não são modificações de sistema).
_SKIP_PREFIXES = ("/auth/login", "/auth/verify", "/auth/logout")

_VERB = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}


def _sanitize_user(value: str | None) -> str:
    if not value:
        return API_USER
    cleaned = re.sub(r"[^\w.@-]", "", value.strip())[:120]
    return cleaned or API_USER


def _action(method: str, path: str) -> str:
    parts = [p for p in path.strip("/").split("/") if p]
    resource = parts[0] if parts else "root"
    # nginx tem ações nomeadas (reload/restart/start/stop/test)
    if resource == "nginx" and len(parts) > 1:
        return f"nginx.{parts[1]}"
    return f"{resource}.{_VERB.get(method, method.lower())}"


def record(user: str, action: str, method: str, path: str, status: int,
           detail: str | None = None) -> None:
    try:
        with get_session() as s:
            s.add(AuditLog(
                ts=int(time.time() * 1000),
                user=user, action=action, method=method,
                path=path, status=status, detail=detail,
            ))
            s.commit()
    except Exception as exc:  # noqa: BLE001 - auditoria não deve quebrar a request
        print(f"audit: falha ao gravar ({exc})", flush=True)


async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.method in _VERB:
        path = request.url.path
        if not path.startswith(_SKIP_PREFIXES):
            # Usuário real vem da identidade resolvida pelo authz (não spoofável);
            # cai para o header X-User / API_USER se ausente (ex.: rota pública).
            user = getattr(request.state, "user", None) or request.headers.get("x-user")
            record(
                user=_sanitize_user(user),
                action=_action(request.method, path),
                method=request.method,
                path=path,
                status=response.status_code,
            )
    return response
