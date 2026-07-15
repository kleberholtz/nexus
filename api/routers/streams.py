"""Rotas /streams e sub-recursos (upstream, access, logs, proxy)."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Directive, dump_nodes
from ..envelope import envelope, message
from ._common import (as_json, handle_save, mount_subresources, nodes_from_body,
                      nodes_in, unwrap_single)

router = APIRouter(prefix="/streams", tags=["streams"],
                   dependencies=[Depends(require_token)])

_KIND = "stream"


def _resolve(ident: str) -> S.Located:
    try:
        return S.ConfigStore().stream(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("")
def list_streams():
    store = S.ConfigStore()
    return envelope(data=[{"id": loc.ident, "listen": store._server_listens(loc.block),
                           "file": str(loc.conf.path), "enabled": loc.enabled}
                          for loc in store.streams()])


@router.post("", status_code=201)
def create_stream(payload=Body(..., description='lista de nós ou {"raw": "..."}')):
    """Cria um novo server block em stream-available/<id>.conf (ativo por
    padrão). Sem wrapper `stream{}` — o contexto vem do diretório físico."""
    store = S.ConfigStore()
    children = unwrap_single(nodes_from_body(payload), "server")
    block = Block("server", [], children)
    listens = [c.args for c in children
              if isinstance(c, Directive) and c.name == "listen"]
    slug = S._slug(" ".join(listens[0])) if listens and listens[0] else "stream"

    if any(loc.ident == slug for loc in store.streams()):
        raise HTTPException(status_code=409, detail=f"stream '{slug}' já existe")

    filename = f"{slug}.conf"
    path = store.prefix / "stream-available" / filename
    conf = S.ConfFile(path=path, root=Block("", [], [block]), root_context="stream")
    store.files.append(conf)
    try:
        S.save_and_enable(store.prefix, _KIND, filename, conf)
    except S.ConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": slug, "file": str(path), "enabled": True},
                    messages=[message(f"stream '{slug}' criado", "success")])


@router.get("/{ident}")
def get_stream(ident: str):
    loc = _resolve(ident)
    return envelope(data={"id": loc.ident, "file": str(loc.conf.path),
                          "enabled": loc.enabled,
                          "nodes": as_json(loc.block.children),
                          "raw": dump_nodes(loc.block.children)})


@router.put("/{ident}")
def replace_stream(ident: str, payload=Body(...)):
    loc = _resolve(ident)
    loc.block.children = unwrap_single(nodes_from_body(payload), "server")
    handle_save(loc.conf)
    return envelope(data={"id": loc.ident, "nodes": as_json(loc.block.children),
                          "raw": dump_nodes(loc.block.children)},
                    messages=[message(f"stream '{loc.ident}' substituído", "success")])


@router.post("/{ident}/enable")
def enable_stream(ident: str):
    loc = _resolve(ident)
    filename = loc.conf.path.name
    S.enable_resource(loc.conf.path.parent.parent, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.disable_resource(loc.conf.path.parent.parent, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a ativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": True},
                    messages=[message(f"stream '{loc.ident}' ativado", "success")])


@router.post("/{ident}/disable")
def disable_stream(ident: str):
    loc = _resolve(ident)
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.enable_resource(prefix, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a desativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": False},
                    messages=[message(f"stream '{loc.ident}' desativado", "success")])


@router.delete("/{ident}")
def delete_stream(ident: str):
    loc = _resolve(ident)
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    loc.conf.path.unlink(missing_ok=True)
    ok, out = S.nginx_test()
    if not ok:
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a remoção:\n{out}")
    return envelope(data={"deleted": loc.ident},
                    messages=[message(f"stream '{loc.ident}' removido", "success")])


mount_subresources(router, "/streams", _resolve, S.STREAM_RESOURCES)
