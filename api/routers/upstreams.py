"""Rotas /upstreams e sub-recurso servers."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Comment, Directive, dump_nodes
from ..envelope import envelope, message
from ._common import (as_json, handle_save, mount_subresources, nodes_from_body,
                      nodes_in, unwrap_single)

router = APIRouter(prefix="/upstreams", tags=["upstreams"],
                   dependencies=[Depends(require_token)])

_KIND = "upstream"


def _resolve(ident: str) -> S.Located:
    try:
        return S.ConfigStore().upstream(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("")
def list_upstreams():
    store = S.ConfigStore()
    out = []
    for loc in store.upstreams():
        servers = [d.args for d in loc.block.children
                   if isinstance(d, Directive) and d.name == "server"]
        users = sorted(set(store.upstream_usage(loc.ident)))
        out.append({"id": loc.ident, "context": loc.context,
                    "file": str(loc.conf.path), "servers": servers,
                    "in_use": bool(users), "used_by": users,
                    "enabled": loc.enabled})
    return envelope(data=out)


@router.post("", status_code=201)
def create_upstream(name: str, context: str = "http", payload=Body(default=[])):
    """Cria um upstream em upstream-available/<name>.conf (ativo por padrão).
    Sem wrapper `http{}`/`stream{}` (criaria um 2º bloco `http{}` de nível
    raiz, que o nginx rejeita como duplicado — o `include upstream-enabled/`
    já está dentro de AMBOS os blocos `http{}`/`stream{}` do nginx.conf). O
    `context` fica só como comentário-marcador, lido por
    `ConfigStore._upstream_context` (exibição/organização na API)."""
    if context not in ("http", "stream"):
        raise HTTPException(status_code=400, detail="context deve ser 'http' ou 'stream'")
    store = S.ConfigStore()
    if any(loc.ident == name for loc in store.upstreams()):
        raise HTTPException(status_code=409, detail=f"upstream '{name}' já existe")
    block = Block("upstream", [name], unwrap_single(nodes_from_body(payload), "upstream"))

    filename = f"{S._slug(name)}.conf"
    path = store.prefix / "upstream-available" / filename
    marker = Comment(f"{S._UPSTREAM_CTX_MARKER}{context}")
    conf = S.ConfFile(path=path, root=Block("", [], [marker, block]), root_context="http")
    store.files.append(conf)
    try:
        S.save_and_enable(store.prefix, _KIND, filename, conf)
    except S.ConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": name, "context": context, "file": str(path), "enabled": True},
                    messages=[message(f"upstream '{name}' criado", "success")])


@router.get("/{ident}")
def get_upstream(ident: str):
    loc = _resolve(ident)
    return envelope(data={"id": loc.ident, "context": loc.context,
                          "file": str(loc.conf.path), "enabled": loc.enabled,
                          "nodes": as_json(loc.block.children),
                          "raw": dump_nodes(loc.block.children)})


@router.put("/{ident}")
def replace_upstream(ident: str, payload=Body(...)):
    loc = _resolve(ident)
    loc.block.children = unwrap_single(nodes_from_body(payload), "upstream")
    handle_save(loc.conf)
    return envelope(data={"id": loc.ident, "nodes": as_json(loc.block.children),
                          "raw": dump_nodes(loc.block.children)},
                    messages=[message(f"upstream '{loc.ident}' substituído", "success")])


@router.post("/{ident}/enable")
def enable_upstream(ident: str):
    loc = _resolve(ident)
    filename = loc.conf.path.name
    S.enable_resource(loc.conf.path.parent.parent, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.disable_resource(loc.conf.path.parent.parent, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a ativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": True},
                    messages=[message(f"upstream '{loc.ident}' ativado", "success")])


@router.post("/{ident}/disable")
def disable_upstream(ident: str):
    loc = _resolve(ident)
    users = sorted(set(S.ConfigStore().upstream_usage(loc.ident)))
    if users:
        raise HTTPException(status_code=409,
                            detail=f"upstream em uso por: {', '.join(users)}")
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.enable_resource(prefix, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a desativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": False},
                    messages=[message(f"upstream '{loc.ident}' desativado", "success")])


@router.delete("/{ident}")
def delete_upstream(ident: str):
    loc = _resolve(ident)
    # Não permite remover upstream referenciado por algum server/stream ATIVO.
    users = sorted(set(S.ConfigStore().upstream_usage(loc.ident)))
    if users:
        raise HTTPException(status_code=409,
                            detail=f"upstream em uso por: {', '.join(users)}")
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    loc.conf.path.unlink(missing_ok=True)
    ok, out = S.nginx_test()
    if not ok:
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a remoção:\n{out}")
    return envelope(data={"deleted": loc.ident},
                    messages=[message(f"upstream '{loc.ident}' removido", "success")])


mount_subresources(router, "/upstreams", _resolve, S.UPSTREAM_RESOURCES)
