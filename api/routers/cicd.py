"""Rotas de Configurações do CI/CD: /ssh-keys e /registries.

Credenciais de deploy (chaves SSH p/ clone git; registries Docker p/ imagens
privadas). Segredos mascarados nas respostas. Recurso RBAC `deploy` (mesmas
credenciais dos provedores git).
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from .. import gitprovider as GP
from .. import gitproviders as GPS
from .. import projects as P
from .. import registries, sshkeys
from ..auth import require_token
from ..envelope import envelope, message

# Prefixo /deploy p/ o middleware RBAC mapear estas credenciais ao recurso
# `deploy` (mesma família dos provedores git). Paths: /deploy/ssh-keys, /deploy/registries.
router = APIRouter(prefix="/deploy", tags=["cicd"], dependencies=[Depends(require_token)])
git_router = APIRouter(prefix="/git", tags=["git"])


# --- Chaves SSH --------------------------------------------------------------

@router.get("/ssh-keys")
def list_ssh_keys():
    return envelope(data=sshkeys.list_keys())


@router.post("/ssh-keys", status_code=201)
def create_ssh_key(payload: dict = Body(...)):
    try:
        data = sshkeys.create(payload.get("name", ""), payload.get("private_key", ""),
                              payload.get("public_key", ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("chave SSH criada", "success")])


@router.put("/ssh-keys/{key_id}")
def update_ssh_key(key_id: int, payload: dict = Body(...)):
    try:
        data = sshkeys.update(key_id, payload.get("name"), payload.get("private_key"),
                              payload.get("public_key"))
    except KeyError:
        raise HTTPException(status_code=404, detail="chave SSH não encontrada")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("chave SSH atualizada", "success")])


@router.delete("/ssh-keys/{key_id}")
def delete_ssh_key(key_id: int):
    if not sshkeys.delete(key_id):
        raise HTTPException(status_code=404, detail="chave SSH não encontrada")
    return envelope(data={"deleted": key_id}, messages=[message("chave SSH removida", "success")])


# --- Registries Docker -------------------------------------------------------

@router.get("/registries")
def list_registries():
    return envelope(data=registries.list_registries())


@router.post("/registries", status_code=201)
def create_registry(payload: dict = Body(...)):
    try:
        data = registries.create(payload.get("name", ""), payload.get("url", ""),
                                 payload.get("username", ""), payload.get("password", ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("registry criado", "success")])


@router.put("/registries/{reg_id}")
def update_registry(reg_id: int, payload: dict = Body(...)):
    try:
        data = registries.update(reg_id, payload.get("name"), payload.get("url"),
                                 payload.get("username"), payload.get("password"))
    except KeyError:
        raise HTTPException(status_code=404, detail="registry não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("registry atualizado", "success")])


@router.delete("/registries/{reg_id}")
def delete_registry(reg_id: int):
    if not registries.delete(reg_id):
        raise HTTPException(status_code=404, detail="registry não encontrado")
    return envelope(data={"deleted": reg_id}, messages=[message("registry removido", "success")])


# --- Provedores Git ----------------------------------------------------------

@router.get("/providers")
def list_providers():
    return envelope(data=GPS.list_providers())


@router.post("/providers", status_code=201)
def create_provider(payload: dict = Body(...)):
    ptype = (payload.get("type") or payload.get("provider") or "").strip()
    if ptype not in GP.KINDS:
        raise HTTPException(status_code=422, detail=f"type inválido (use: {', '.join(GP.KINDS)})")
    try:
        data = GPS.create(
            ptype,
            (payload.get("name") or "").strip(),
            (payload.get("label") or "").strip(),
            (payload.get("provider_url") or payload.get("base_url") or "").strip(),
            (payload.get("app_id") or "").strip(),
            (payload.get("app_secret") or "").strip(),
            payload.get("token") or "",
            (payload.get("webhook_secret") or "").strip(),
            (payload.get("github_private_key") or "").strip(),
            (payload.get("github_client_id") or "").strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("provedor criado", "success")])


@router.post("/providers/test")
def test_provider(payload: dict = Body(...)):
    ptype = (payload.get("type") or payload.get("provider") or "").strip()
    if ptype not in GP.KINDS:
        raise HTTPException(status_code=422, detail=f"type inválido (use: {', '.join(GP.KINDS)})")
    try:
        data = GPS.test_config(
            ptype,
            (payload.get("name") or "").strip(),
            (payload.get("provider_url") or payload.get("base_url") or "").strip(),
            (payload.get("app_id") or "").strip(),
            (payload.get("app_secret") or "").strip(),
            payload.get("token") or "",
            (payload.get("callback_url") or "").strip(),
            int(payload.get("provider_id")) if payload.get("provider_id") else None,
            (payload.get("github_private_key") or "").strip(),
            (payload.get("github_client_id") or "").strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return envelope(data=data, messages=[message("configuração validada", "success")])


@router.get("/providers/{provider_id}/github/accounts")
def github_provider_accounts(provider_id: int):
    try:
        data = GPS.github_accounts(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return envelope(data=data)


@router.get("/providers/{provider_id}/github/repositories")
def github_provider_repositories(provider_id: int, installation_id: str = ""):
    try:
        data = GPS.github_repositories(provider_id, installation_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return envelope(data=data)


@router.get("/providers/{provider_id}/github/branches")
def github_provider_branches(provider_id: int, repo: str, installation_id: str = ""):
    try:
        data = GPS.github_branches(provider_id, repo, installation_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return envelope(data=data)


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, payload: dict = Body(...)):
    try:
        data = GPS.update(
            provider_id,
            payload.get("name"),
            payload.get("label"),
            payload.get("provider_url") if "provider_url" in payload else payload.get("base_url"),
            payload.get("app_id"),
            payload.get("app_secret"),
            payload.get("token"),
            payload.get("webhook_secret"),
            payload.get("github_private_key"),
            payload.get("github_client_id"),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data, messages=[message("provedor atualizado", "success")])


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int):
    try:
        GPS.delete(provider_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(messages=[message("provedor removido", "success")])


@git_router.get("/providers/{name}/callback")
def git_provider_callback(name: str, request: Request, code: str = "", installation_id: str = ""):
    redirect_uri = str(request.url).split("?", 1)[0]
    try:
        data = GPS.exchange_callback(name, code, redirect_uri, installation_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    provider_name_json = json.dumps(str(data["name"]))
    return HTMLResponse(f"""<!doctype html>
<html>
  <meta charset="utf-8">
  <script>
    window.opener?.postMessage({{ type: "nexus:github-provider-connected", providerName: {provider_name_json} }}, "*");
    window.close();
  </script>
</html>""")


def _github_manifest_callback_response(code: str = "", name: str = "", label: str = "", base_url: str = ""):
    try:
        data = GPS.github_create_from_manifest(code, name, label, base_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    provider_name_json = json.dumps(str(data["name"]))
    return HTMLResponse(f"""<!doctype html>
<html>
  <meta charset="utf-8">
  <script>
    window.opener?.postMessage({{ type: "nexus:github-provider-created", providerName: {provider_name_json} }}, "*");
    window.close();
  </script>
</html>""")


@git_router.get("/providers/github/manifest/callback")
def github_manifest_callback(code: str = "", name: str = "", label: str = "", base_url: str = ""):
    return _github_manifest_callback_response(code, name, label, base_url)


@git_router.get("/providers/github/manifest")
def github_manifest_legacy_callback(code: str = "", name: str = "", label: str = "", base_url: str = ""):
    return _github_manifest_callback_response(code, name, label, base_url)


@git_router.post("/providers/{name}/webhook")
async def git_provider_webhook(name: str, request: Request, secret: str = ""):
    try:
        body = await request.body()
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            payload = {}
        data = P.handle_provider_webhook(name, secret, dict(request.headers), payload, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="provedor não encontrado")
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return envelope(data=data)
