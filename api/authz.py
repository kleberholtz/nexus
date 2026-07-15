"""Middleware de autorização (RBAC).

Ponto único de enforcement: resolve a identidade do bearer (header ou `?token=`),
descobre a permissão exigida a partir de (método, rota) e barra com 401/403 no
envelope padrão. Também expõe a identidade em `request.state` para a auditoria
registrar o usuário real (não o header `X-User`, que é spoofável).
"""
from __future__ import annotations

import re

from starlette.requests import Request

from . import rbac
from .auth import identity_from_request
from .envelope import json_response, message

# Rotas públicas (sem autenticação).
_PUBLIC_PATHS = frozenset({
    "/health", "/auth/login", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect",
})

_PUBLIC_PREFIXES: tuple[str, ...] = ("/uptime/heartbeats/", "/status/")

# Rotas que exigem apenas estar autenticado (qualquer papel), sem permissão específica.
# `/users/roles*` NÃO entra aqui: leitura exige `users:read` e escrita `users:write`
# (gestão de papéis é restrita a admin/master).
_AUTH_ONLY_PATHS = frozenset({
    "/auth/verify", "/auth/logout", "/users/me", "/users/profile",
})


def _is_public(path: str) -> bool:
    if re.fullmatch(r"/projects/\d+/services/\d+/webhook", path):
        return True
    if re.fullmatch(r"/git/providers/[a-z0-9_-]+/callback", path):
        return True
    if path in {"/git/providers/github/manifest", "/git/providers/github/manifest/callback"}:
        return True
    if re.fullmatch(r"/git/providers/[a-z0-9_-]+/webhook", path):
        return True
    return path in _PUBLIC_PATHS or path.startswith(_PUBLIC_PREFIXES)


def _required_permission(method: str, path: str) -> tuple[str, str] | None:
    """(recurso, ação) exigidos, ou None se a rota só precisa de autenticação."""
    if path in _AUTH_ONLY_PATHS:
        return None
    resource = path.strip("/").split("/", 1)[0]
    if resource not in rbac.RESOURCES:
        return None  # rota desconhecida/sem recurso mapeado: basta autenticar
    return resource, rbac.action_for_method(method)


async def authz_middleware(request: Request, call_next):
    path = request.url.path
    method = request.method

    # Preflight CORS e rotas públicas passam direto.
    if method == "OPTIONS" or _is_public(path):
        return await call_next(request)

    identity = identity_from_request(request)
    if identity is None:
        return json_response(success=False, status_code=401,
                             messages=[message("token inválido ou ausente", "error")])

    # Identidade disponível para a auditoria e handlers.
    request.state.identity = identity
    request.state.user = identity.username

    req = _required_permission(method, path)
    if req is not None:
        resource, action = req
        if not identity.has(resource, action):
            return json_response(
                success=False, status_code=403,
                messages=[message(f"sem permissão para {resource}:{action}", "error")],
            )

    return await call_next(request)
