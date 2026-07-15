"""Rotas /nginx: status, version, test, reload, restart, configuration, globals,
config (edição das opções globais) e tune (worker_processes/connections)."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import nginxctl, tune
from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Directive, dump_nodes
from ..envelope import envelope, message
from ._common import as_json, handle_save, nodes_from_body

router = APIRouter(prefix="/nginx", tags=["nginx"], dependencies=[Depends(require_token)])

# Blocos top-level preservados (não fazem parte das "diretivas globais" editáveis).
_TOP_BLOCKS = ("http", "stream", "mail")


def _data(res: dict) -> dict:
    """Remove o `ok` do payload — o status da operação já vai no `success`."""
    return {k: v for k, v in res.items() if k != "ok"}


@router.get("/status")
def status():
    return envelope(data=nginxctl.status())


@router.get("/version")
def version():
    res = nginxctl.version()
    msgs = [] if res["ok"] else [message(res["raw"], "error")]
    return envelope(data=_data(res), success=res["ok"], messages=msgs)


@router.post("/test")
def test():
    res = nginxctl.test()
    msgs = [] if res["ok"] else [message(res["output"], "error")]
    return envelope(data=_data(res), success=res["ok"], messages=msgs)


@router.post("/reload")
def reload():
    res = nginxctl.reload()
    return envelope(data=_data(res), success=res["ok"],
                    messages=[message(res["output"], "success" if res["ok"] else "error")])


@router.post("/start")
def start():
    res = nginxctl.start()
    return envelope(data=_data(res), success=res["ok"],
                    messages=[message(res["output"], "success" if res["ok"] else "error")])


@router.post("/stop")
def stop():
    res = nginxctl.stop()
    return envelope(data=_data(res), success=res["ok"],
                    messages=[message(res["output"], "success" if res["ok"] else "error")])


@router.post("/restart")
def restart():
    res = nginxctl.restart()
    return envelope(data=_data(res), success=res["ok"],
                    messages=[message(res["output"], "success" if res["ok"] else "error")])


@router.get("/configuration")
def configuration():
    """Config efetiva completa (nginx -T)."""
    res = nginxctl.configuration()
    return envelope(data=_data(res), success=res["ok"])


@router.get("/globals")
def globals_():
    """Diretivas de nível principal (fora de http/stream/events) e blocos top-level."""
    store = S.ConfigStore()
    directives, blocks = [], []
    for conf in store.files:
        for node in conf.root.children:
            if isinstance(node, Directive):
                directives.append({"file": str(conf.path), **node.to_json()})
            elif isinstance(node, Block) and node.name in ("events", "http", "stream", "mail"):
                blocks.append({"file": str(conf.path), "name": node.name,
                               "children": len(node.children)})
    return envelope(data={"directives": directives, "blocks": blocks})


# --------------------------------------------------------------------------- #
# Config global editável (contexto main + bloco events do nginx.conf principal)
# --------------------------------------------------------------------------- #
def _main_conf(store: S.ConfigStore) -> S.ConfFile:
    """O nginx.conf "principal": o arquivo com um bloco http (ou events) no topo."""
    for conf in store.files:
        if any(isinstance(n, Block) and n.name == "http" for n in conf.root.children):
            return conf
    for conf in store.files:
        if any(isinstance(n, Block) and n.name == "events" for n in conf.root.children):
            return conf
    raise HTTPException(status_code=404, detail="nginx.conf principal não encontrado")


def _events_block(conf: S.ConfFile) -> Block | None:
    return next((n for n in conf.root.children
                 if isinstance(n, Block) and n.name == "events"), None)


def _http_block(conf: S.ConfFile) -> Block | None:
    return next((n for n in conf.root.children
                 if isinstance(n, Block) and n.name == "http"), None)


@router.get("/config")
def get_config():
    """Opções globais editáveis: diretivas do contexto main, events e http."""
    store = S.ConfigStore()
    conf = _main_conf(store)
    main_nodes = [n for n in conf.root.children
                  if not (isinstance(n, Block) and n.name in (*_TOP_BLOCKS, "events"))]
    events = _events_block(conf)
    http = _http_block(conf)
    http_nodes = [n for n in (http.children if http else []) if not isinstance(n, Block)]
    return envelope(data={
        "file": str(conf.path),
        "main": {"raw": dump_nodes(main_nodes), "nodes": as_json(main_nodes)},
        "events": {
            "present": events is not None,
            "raw": dump_nodes(events.children) if events else "",
            "nodes": as_json(events.children) if events else [],
        },
        "http": {
            "present": http is not None,
            "raw": dump_nodes(http_nodes),
            "nodes": as_json(http_nodes),
        },
    })


@router.put("/config")
def put_config(payload: dict = Body(...)):
    """Reescreve diretivas globais (main), `events` e diretivas diretas de `http`,
    preservando sub-blocos http/stream/mail. Passa por backup → `nginx -t` →
    rollback (409 se a config ficar inválida)."""
    if "main" not in payload and "events" not in payload and "http" not in payload:
        raise HTTPException(status_code=400, detail="informe 'main', 'events' e/ou 'http'")
    store = S.ConfigStore()
    conf = _main_conf(store)

    new_main = nodes_from_body(payload["main"]) if "main" in payload else None
    new_events = nodes_from_body(payload["events"]) if "events" in payload else None
    new_http = nodes_from_body(payload["http"]) if "http" in payload else None

    # Reconstrói os filhos: substitui as diretivas main (inseridas antes do 1º
    # bloco top-level/events), o conteúdo do events, e as diretivas diretas do
    # http, mantendo os sub-blocos internos dele.
    result: list = []
    main_done = False

    def flush_main():
        nonlocal main_done
        if new_main is not None and not main_done:
            result.extend(new_main)
            main_done = True

    events_seen = False
    for node in conf.root.children:
        if isinstance(node, Block) and node.name == "events":
            flush_main()
            if new_events is not None:
                node.children = new_events
            result.append(node)
            events_seen = True
        elif isinstance(node, Block) and node.name == "http":
            flush_main()
            if new_http is not None:
                merged_http: list = []
                i = 0
                for child in node.children:
                    if isinstance(child, Block):
                        merged_http.append(child)
                    elif i < len(new_http):
                        merged_http.append(new_http[i])
                        i += 1
                merged_http.extend(new_http[i:])
                node.children = merged_http
            result.append(node)
        elif isinstance(node, Block) and node.name in _TOP_BLOCKS:
            flush_main()
            result.append(node)
        else:
            # diretiva/comentário de nível main: mantém só se não estamos substituindo
            if new_main is None:
                result.append(node)
    flush_main()
    # events pedido mas inexistente no arquivo → cria um bloco events novo.
    if new_events is not None and not events_seen:
        result.append(Block("events", [], new_events))

    conf.root.children = result
    handle_save(conf)
    return envelope(data={"file": str(conf.path)},
                    messages=[message("configuração global salva", "success")])


# --------------------------------------------------------------------------- #
# Tune (worker_processes / worker_rlimit_nofile / worker_connections)
# --------------------------------------------------------------------------- #
@router.get("/tune")
def tune_info():
    """Recursos detectados, valores calculados e valores atualmente aplicados."""
    computed = tune.compute()
    return envelope(data={
        "detected": {
            "cpus": computed["cpus"],
            "mem_bytes": computed["mem_bytes"],
            "soft_nofile": computed["soft_nofile"],
            "hard_nofile": computed["hard_nofile"],
        },
        "computed": {
            "worker_processes": computed["worker_processes"],
            "worker_rlimit_nofile": computed["worker_rlimit_nofile"],
            "worker_connections": computed["worker_connections"],
        },
        "current": tune.read_current(),
        "mem_fraction": computed["mem_fraction"],
    })


def _int_or(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@router.post("/tune")
def tune_apply(payload: dict = Body(default={})):
    """Aplica o tuning: usa os valores manuais informados ou os calculados.
    Grava os includes, valida com `nginx -t` e faz rollback se falhar. O
    worker_processes/rlimit exige **restart**; worker_connections, **reload**."""
    computed = tune.compute(mem_fraction=payload.get("mem_fraction"))
    vals = {
        "worker_processes": _int_or(payload.get("worker_processes"), computed["worker_processes"]),
        "worker_rlimit_nofile": _int_or(payload.get("worker_rlimit_nofile"), computed["worker_rlimit_nofile"]),
        "worker_connections": _int_or(payload.get("worker_connections"), computed["worker_connections"]),
    }
    if not (1 <= vals["worker_processes"] <= 1024):
        raise HTTPException(status_code=400, detail="worker_processes deve estar entre 1 e 1024")
    if not (tune.MIN_CONNECTIONS <= vals["worker_connections"] <= tune.MAX_CONNECTIONS):
        raise HTTPException(status_code=400,
                            detail=f"worker_connections deve estar entre {tune.MIN_CONNECTIONS} e {tune.MAX_CONNECTIONS}")
    if vals["worker_rlimit_nofile"] < vals["worker_connections"]:
        raise HTTPException(status_code=400, detail="worker_rlimit_nofile deve ser >= worker_connections")

    prefix = S.NGINX_PREFIX
    # Os includes vivem em <prefix>/generated/ (ver api/tune.py) — usar a mesma
    # lógica de caminho garante que backup/rollback batam com o que write_includes
    # grava (no split, esse dir é o volume compartilhado com o nginx).
    main_path, events_path = tune._paths(prefix)
    backups = {p: (p.read_bytes() if p.exists() else None) for p in (main_path, events_path)}
    tune.write_includes(vals, prefix)
    ok, output = S.nginx_test()
    if not ok:
        for p, data in backups.items():  # rollback
            if data is None:
                p.unlink(missing_ok=True)
            else:
                p.write_bytes(data)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou o tuning: {output}")
    return envelope(data={"applied": vals},
                    messages=[message("tuning aplicado — recarregue/reinicie o nginx", "success")])
