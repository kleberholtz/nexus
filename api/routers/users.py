"""Rotas /users: gestão de usuários, papéis, perfil e a identidade da sessão.

O enforcement de permissão (`users:read`/`users:write`) é feito no middleware
`api/authz.py`. `/users/me` e `/users/profile` exigem apenas estar autenticado.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends

from .. import rbac, roles as roles_store, users
from ..auth import require_token
from ..envelope import envelope, message
from ..users import Identity

router = APIRouter(prefix="/users", tags=["users"])


def _identity_payload(identity: Identity) -> dict:
    return {
        "username": identity.username,
        "name": identity.name,
        "email": identity.email,
        "role": identity.role,
        "is_master": identity.is_master,
        "permissions": sorted(identity.permissions),
    }


@router.get("/me")
def me(identity: Identity = Depends(require_token)):
    """Identidade da sessão atual (usada pelo painel para liberar telas/ações)."""
    return envelope(data=_identity_payload(identity))


# --------------------------------------------------------------------------- #
# Perfil próprio (auto-serviço — qualquer usuário autenticado)
# --------------------------------------------------------------------------- #
@router.get("/profile")
def get_profile(identity: Identity = Depends(require_token)):
    return envelope(data=users.get_profile(identity))


@router.put("/profile")
def update_profile(identity: Identity = Depends(require_token), payload: dict = Body(...)):
    data = users.update_profile(
        identity,
        name=str(payload.get("name", "")),
        email=str(payload.get("email", "")),
        current_password=payload.get("current_password"),
        new_password=payload.get("new_password"),
    )
    return envelope(data=data, messages=[message("perfil atualizado", "success")])


# --------------------------------------------------------------------------- #
# Papéis e permissões (gestão restrita a admin/master via users:read/users:write)
# --------------------------------------------------------------------------- #
@router.get("/roles", dependencies=[Depends(require_token)])
def list_roles():
    """Papéis (com permissões) + catálogo de permissões (matriz recurso×ação)."""
    return envelope(data={
        "roles": roles_store.list_roles(),
        "permissions": rbac.permission_catalog(),
    })


@router.post("/roles", dependencies=[Depends(require_token)])
def create_role(payload: dict = Body(...)):
    role = roles_store.create_role(
        name=str(payload.get("name", "")),
        label=str(payload.get("label", "")),
        permissions=list(payload.get("permissions", []) or []),
    )
    return envelope(data=role, messages=[message("papel criado", "success")])


@router.put("/roles/{name}", dependencies=[Depends(require_token)])
def update_role(name: str, payload: dict = Body(...)):
    role = roles_store.update_role(
        name,
        label=payload.get("label"),
        permissions=payload.get("permissions"),
    )
    return envelope(data=role, messages=[message("papel atualizado", "success")])


@router.delete("/roles/{name}", dependencies=[Depends(require_token)])
def delete_role(name: str):
    roles_store.delete_role(name)
    return envelope(data={"deleted": name}, messages=[message("papel removido", "success")])


@router.get("", dependencies=[Depends(require_token)])
def list_users():
    return envelope(data=users.list_users())


@router.post("", dependencies=[Depends(require_token)])
def create_user(payload: dict = Body(...)):
    user = users.create_user(
        username=str(payload.get("username", "")),
        password=str(payload.get("password", "")),
        role=str(payload.get("role", "viewer")),
        name=str(payload.get("name", "")),
        email=str(payload.get("email", "")),
    )
    return envelope(data=user, messages=[message("usuário criado", "success")])


@router.put("/{user_id}", dependencies=[Depends(require_token)])
def update_user(user_id: int, payload: dict = Body(...)):
    user = users.update_user(
        user_id,
        role=payload.get("role"),
        active=payload.get("active"),
        password=payload.get("password"),
        name=payload.get("name"),
        email=payload.get("email"),
    )
    return envelope(data=user, messages=[message("usuário atualizado", "success")])


@router.delete("/{user_id}")
def delete_user(user_id: int, identity: Identity = Depends(require_token)):
    if identity.user_id == user_id:
        raise users.UserError("você não pode remover a própria conta", status=403)
    users.delete_user(user_id)
    return envelope(data={"deleted": user_id}, messages=[message("usuário removido", "success")])
