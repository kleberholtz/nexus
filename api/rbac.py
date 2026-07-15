"""Papéis (roles) e permissões — controle de acesso baseado em papéis (RBAC).

Permissões são strings `"<recurso>:<ação>"` com `ação ∈ {read, write}`. O
curinga `"*"` concede tudo. O usuário definido no `.env` (`API_USER`) é o
**master**: papel implícito, não editável, todas as permissões.

Os papéis atribuíveis a usuários do banco são **editáveis** e ficam persistidos
(ver `api/roles.py`, tabela `roles`). Este módulo é lógica pura (sem banco):
define os recursos/ações, os papéis-semente (`DEFAULT_ROLES`) e helpers usados no
enforcement (`api/authz.py`) e no catálogo consumido pelo painel.
"""
from __future__ import annotations

# Recursos protegidos (1º segmento da rota). `users` cobre a gestão de usuários.
RESOURCES: tuple[str, ...] = (
    "servers", "upstreams", "streams", "rtmp", "deploy", "projects", "docker",
    "monitors", "certificates", "dns", "logs", "nginx", "system", "settings",
    "audit", "s3", "ai", "users",
)

ACTIONS: tuple[str, ...] = ("read", "write")

# Papel implícito do usuário do .env — não é atribuível/editável.
MASTER_ROLE = "master"

# Rótulos amigáveis dos recursos (pt) — usados na matriz de permissões do painel.
RESOURCE_LABELS: dict[str, str] = {
    "servers": "Servers",
    "upstreams": "Upstreams",
    "streams": "Streams",
    "rtmp": "RTMP",
    "deploy": "Deploy",
    "projects": "Projetos",
    "docker": "Docker",
    "monitors": "Monitores",
    "certificates": "Certificados",
    "dns": "DNS",
    "logs": "Logs",
    "nginx": "Nginx",
    "system": "Sistema",
    "settings": "Configurações",
    "audit": "Auditoria",
    "s3": "S3",
    "ai": "Providers IA",
    "users": "Usuários",
}


def _rw(*resources: str) -> set[str]:
    return {f"{r}:{a}" for r in resources for a in ACTIONS}


def _ro(*resources: str) -> set[str]:
    return {f"{r}:read" for r in resources}


# Tudo que dá pra ler exceto a gestão de usuários.
_READ_NON_USERS = _ro(
    "servers", "upstreams", "streams", "rtmp", "deploy", "projects", "docker",
    "monitors", "certificates", "dns", "logs", "nginx", "system", "settings", "audit", "s3", "ai",
)
# Recursos de configuração do nginx que o operador pode modificar.
_OPERATOR_WRITE = _rw("servers", "upstreams", "streams", "rtmp", "deploy", "projects",
                      "docker", "monitors", "certificates", "dns", "nginx", "logs")

# Papéis-semente gravados na 1ª inicialização (depois são editáveis no painel).
# `master` NÃO entra aqui (é implícito). São marcados `builtin` (não deletáveis).
DEFAULT_ROLES: list[dict] = [
    {"name": "admin", "label": "Administrador", "permissions": ["*"]},
    {"name": "operator", "label": "Operador",
     "permissions": sorted(_READ_NON_USERS | _OPERATOR_WRITE)},
    {"name": "viewer", "label": "Visualizador", "permissions": sorted(_READ_NON_USERS)},
]


def has_permission(perms: set[str] | frozenset[str], resource: str, action: str) -> bool:
    """Verdadeiro se `perms` concede `resource:action` (ou tem o curinga `*`)."""
    return "*" in perms or f"{resource}:{action}" in perms


def action_for_method(method: str) -> str:
    """Métodos de leitura → `read`; o resto (POST/PUT/PATCH/DELETE) → `write`."""
    return "read" if method in ("GET", "HEAD", "OPTIONS") else "write"


def all_permissions() -> set[str]:
    """Conjunto de todas as permissões válidas (`*` + `recurso:ação`)."""
    perms = {"*"}
    for r in RESOURCES:
        for a in ACTIONS:
            perms.add(f"{r}:{a}")
    return perms


def permission_catalog() -> list[dict]:
    """Catálogo recurso→(read/write) para a matriz de permissões do painel."""
    return [
        {"resource": r, "label": RESOURCE_LABELS.get(r, r),
         "read": f"{r}:read", "write": f"{r}:write"}
        for r in RESOURCES
    ]
