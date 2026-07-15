"""Helpers compartilhados entre routers e montagem genérica de sub-recursos."""
from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Body, Depends, HTTPException

from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Comment, Node, node_from_json, parse
from ..envelope import envelope, message


def unwrap_single(nodes: list[Node], name: str) -> list[Node]:
    """Se `nodes` é essencialmente um único bloco `name { ... }`, devolve os
    filhos dele; senão devolve `nodes` como estão. Permite que o corpo cru seja
    tanto o conteúdo direto quanto o bloco completo (ex.: `server { ... }`)."""
    meaningful = [n for n in nodes if not isinstance(n, Comment)]
    if len(meaningful) == 1 and isinstance(meaningful[0], Block) \
            and meaningful[0].name == name:
        return meaningful[0].children
    return nodes


def nodes_in(payload: list[dict]) -> list[Node]:
    try:
        return [node_from_json(n) for n in payload]
    except Exception as exc:  # noqa: BLE001 - vira 400 pro cliente
        raise HTTPException(status_code=400, detail=f"corpo inválido: {exc}")


def nodes_from_body(payload) -> list[Node]:
    """Aceita tanto uma lista de nós quanto {"raw": "<config em texto>"}."""
    if isinstance(payload, dict) and "raw" in payload:
        try:
            return parse(payload["raw"]).children
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"config inválida: {exc}")
    if isinstance(payload, list):
        return nodes_in(payload)
    raise HTTPException(status_code=400,
                        detail='corpo deve ser uma lista de nós ou {"raw": "..."}')


def as_json(nodes: list[Node]) -> list[dict]:
    return [n.to_json() for n in nodes]


def handle_save(conf) -> None:
    try:
        S.save_conf(conf)
    except S.ConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


def mount_subresources(
    router: APIRouter,
    base: str,
    resolve: Callable[[str], "S.Located"],
    resources: dict[str, Callable[[Node], bool]],
) -> None:
    """Registra GET/PUT/POST/DELETE para cada sub-recurso de um bloco.

    `resolve(ident)` deve devolver um S.Located (com .block e .conf) a partir de
    um ConfigStore recém-carregado.
    """
    tag = base.strip("/") or "sub"
    for res_name, predicate in resources.items():
        path = f"/{{ident}}/{res_name}"

        def make(pred):
            def get(ident: str):
                loc = resolve(ident)
                return envelope(data=as_json(S.select(loc.block, pred)))

            def put(ident: str, payload: list[dict] = Body(...)):
                loc = resolve(ident)
                S.replace(loc.block, pred, nodes_in(payload))
                handle_save(loc.conf)
                return envelope(data=as_json(S.select(loc.block, pred)),
                                messages=[message("sub-recurso substituído", "success")])

            def post(ident: str, payload: list[dict] = Body(...)):
                loc = resolve(ident)
                S.append(loc.block, nodes_in(payload))
                handle_save(loc.conf)
                return envelope(data=as_json(S.select(loc.block, pred)),
                                messages=[message("nós adicionados", "success")])

            def remove(ident: str):
                loc = resolve(ident)
                removed = S.delete(loc.block, pred)
                handle_save(loc.conf)
                return envelope(data={"removed": removed},
                                messages=[message(f"{removed} nó(s) removido(s)", "success")])

            return get, put, post, remove

        get, put, post, remove = make(predicate)
        deps = [Depends(require_token)]
        safe = res_name.replace("-", "_")
        router.add_api_route(path, get, methods=["GET"], dependencies=deps,
                             name=f"{tag}_{safe}_get")
        router.add_api_route(path, put, methods=["PUT"], dependencies=deps,
                             name=f"{tag}_{safe}_put")
        router.add_api_route(path, post, methods=["POST"], dependencies=deps,
                             name=f"{tag}_{safe}_post")
        router.add_api_route(path, remove, methods=["DELETE"], dependencies=deps,
                             name=f"{tag}_{safe}_delete")
