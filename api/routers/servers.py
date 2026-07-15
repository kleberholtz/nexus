"""Rotas /servers e sub-recursos (locations, headers, cache, http3, ...)."""
from __future__ import annotations

import shutil
import re
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Directive, dump_nodes
from ..envelope import envelope, message
from ._common import (as_json, handle_save, mount_subresources, nodes_from_body,
                      nodes_in, unwrap_single)

router = APIRouter(prefix="/servers", tags=["servers"], dependencies=[Depends(require_token)])

_KIND = "http"
_SHARED_CACHE_ZONE = "nexus_cache"
# Layout: compartilhada em shared/, zonas dedicadas de server em zones/<zona>,
# zonas dedicadas de rota em routes/<zona> — todas irmãs sob /var/cache/nginx.
_SHARED_CACHE_PATH = "/var/cache/nginx/shared"
_SHARED_CACHE_MAX_SIZE = "1g"
_MANAGED_SERVICE_FILE = re.compile(r"^service-(\d+)-domain-[a-z0-9-]+\.conf$")


def _resolve(ident: str) -> S.Located:
    try:
        return S.ConfigStore().server(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _managed_service_id(loc: S.Located) -> int | None:
    match = _MANAGED_SERVICE_FILE.fullmatch(loc.conf.path.name)
    return int(match.group(1)) if match else None


def _reject_managed(loc: S.Located) -> None:
    if _managed_service_id(loc) is not None:
        raise HTTPException(status_code=409, detail="Controlado por um serviço")


def _node_signature(node):
    if isinstance(node, Directive):
        return ("directive", node.name, tuple(node.args))
    if isinstance(node, Block):
        return ("block", node.name, tuple(node.args), tuple(_node_signature(child) for child in node.children))
    return (type(node).__name__, str(node))


def _managed_fields_signature(block: Block) -> tuple:
    """Campos cuja origem continua sendo exclusivamente o serviço."""
    protected = []
    for node in block.children:
        if isinstance(node, Block) and node.name == "location":
            protected.append(_node_signature(node))
        elif isinstance(node, Directive) and (
            node.name in {"server_name", "listen", "root", "http2", "http3", "quic_retry"}
            or node.name.startswith("ssl_")
            or node.name.startswith("autoindex")
        ):
            protected.append(_node_signature(node))
    return tuple(sorted(protected, key=repr))


def _server_file_nodes(payload) -> tuple[Block, list]:
    """Divide o corpo em (bloco `server`, nós de nível de arquivo).

    Aceita tanto um `server { ... }` — possivelmente acompanhado de diretivas
    IRMÃS de contexto http (ex.: `proxy_cache_path` da zona de cache dedicada
    do server, que o nginx só aceita em `http{}`, não dentro do `server{}`) —
    quanto o conteúdo direto do server (sem wrapper). Como os arquivos de
    `http-available/` são incluídos dentro do `http{}` do nginx.conf, tudo que
    fica ao lado do `server{}` no arquivo vale como contexto http."""
    nodes = nodes_from_body(payload)
    servers = [n for n in nodes if isinstance(n, Block) and n.name == "server"]
    if len(servers) == 1:
        return servers[0], nodes
    block = Block("server", [], unwrap_single(nodes, "server"))
    return block, [block]


def _cache_path_info(args: list[str]) -> tuple[str | None, str | None, str | None]:
    path = args[0] if args and not args[0].startswith("=") and "=" not in args[0] else None
    zone = None
    max_size = None
    for arg in args:
        if arg.startswith("keys_zone="):
            value = arg.split("=", 1)[1]
            zone = value.split(":", 1)[0]
        elif arg.startswith("max_size="):
            max_size = arg.split("=", 1)[1]
    return zone, path, max_size


def _server_cache_zone(loc: S.Located) -> str | None:
    for node in loc.block.walk():
        if isinstance(node, Directive) and node.name == "proxy_cache" and node.args:
            zone = node.args[0]
            if zone and zone != "off" and not zone.startswith("$"):
                return zone
    return None


def _zone_map(loc: S.Located) -> dict[str, str]:
    """Zonas por rota do `map $uri $nexus_cachezone_*`: {zona: rota}.

    Quando o cache é por rota, `proxy_cache` usa uma variável e as zonas reais
    vivem no map (contexto http, irmão do server no mesmo arquivo)."""
    out: dict[str, str] = {}
    for node in loc.conf.root.walk():
        if not (isinstance(node, Block) and node.name == "map"):
            continue
        args = node.args or []
        if len(args) < 2 or not args[1].startswith("$nexus_cachezone_"):
            continue
        for entry in node.children:
            if not isinstance(entry, Directive) or not entry.name.startswith("~^"):
                continue
            zone = entry.args[0] if entry.args else ""
            if zone and zone not in ('""', "default"):
                out.setdefault(zone, entry.name[2:])  # tira o "~^" → rota
    return out


def _cache_zones(loc: S.Located, store: S.ConfigStore) -> list[dict]:
    """Todas as zonas de cache do server (zona única do server e/ou por rota),
    cada uma com path/dedicated/max_size e a rota associada (quando houver)."""
    zones: dict[str, str | None] = {}  # zona → rota (None = server inteiro)
    direct = _server_cache_zone(loc)
    if direct:
        zones[direct] = None
    for zone, route in _zone_map(loc).items():
        zones.setdefault(zone, route)
    out: list[dict] = []
    for zone, route in zones.items():
        path, dedicated, max_size = _path_for_zone(zone, loc, store)
        if not path:
            continue
        cache_dir = Path(path)
        size, files = _dir_size(cache_dir)
        # geral = zona compartilhada; zona = dedicada do server; rota = por rota.
        if zone == _SHARED_CACHE_ZONE:
            category = "geral"
        elif route is not None:
            category = "rota"
        else:
            category = "zona"
        out.append({
            "zone": zone, "route": route, "path": str(cache_dir), "category": category,
            "dedicated": dedicated, "exists": cache_dir.exists(),
            "size_bytes": size, "files": files, "max_size": max_size,
        })
    _order = {"geral": 0, "zona": 1, "rota": 2}
    out.sort(key=lambda z: (_order[z["category"]], z["route"] or "", z["zone"]))
    return out


def _server_uses_ssl(loc: S.Located) -> bool:
    for node in loc.block.walk():
        if not isinstance(node, Directive):
            continue
        if node.name == "ssl_certificate":
            return True
        if node.name == "listen":
            listen = " ".join(node.args).lower()
            if " ssl" in f" {listen} " or listen.startswith("443") or ":443" in listen:
                return True
    return False


def _path_for_zone(zone: str, loc: S.Located, store: S.ConfigStore | None = None) -> tuple[str | None, bool, str | None]:
    """Caminho/dedicated/max_size de uma zona de cache (por nome)."""
    if not zone:
        return None, False, None

    # Zonas dedicadas são gravadas como irmãs do server{} no arquivo
    # http-available/<server>.conf; ainda assim olhamos todos os arquivos para
    # cobrir configs existentes editadas manualmente.
    files = [loc.conf]
    if store is not None:
        files = [loc.conf, *[f for f in store.files if f is not loc.conf]]
    for conf in files:
        for node in conf.root.walk():
            if not isinstance(node, Directive) or node.name != "proxy_cache_path":
                continue
            found_zone, path, max_size = _cache_path_info(node.args)
            if found_zone == zone and path:
                return path, zone != _SHARED_CACHE_ZONE, max_size
    if zone == _SHARED_CACHE_ZONE:
        return _SHARED_CACHE_PATH, False, _SHARED_CACHE_MAX_SIZE
    return f"/var/cache/nginx/zones/{zone}", True, None


def _dir_size(path: Path) -> tuple[int, int]:
    total = 0
    files = 0
    if not path.exists():
        return total, files
    for item in path.rglob("*"):
        try:
            if item.is_file() or item.is_symlink():
                total += item.lstat().st_size
                files += 1
        except OSError:
            continue
    return total, files


def _clear_dir(path: Path) -> int:
    removed = 0
    if not path.exists():
        return removed
    for item in path.iterdir():
        try:
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()
            removed += 1
        except OSError as exc:
            raise HTTPException(status_code=409, detail=f"falha ao limpar cache: {exc}") from exc
    return removed


def _summary(loc: S.Located, store: S.ConfigStore) -> dict:
    direct = _server_cache_zone(loc)
    routes = _zone_map(loc)
    cache_zone = direct or (f"{len(routes)} rota(s)" if routes else None)
    service_id = _managed_service_id(loc)
    return {
        "id": loc.ident,
        "server_name": store._server_names(loc.block),
        "listen": store._server_listens(loc.block),
        "file": str(loc.conf.path),
        "removable": loc.ident != "default",
        "enabled": loc.enabled,
        "ssl_enabled": _server_uses_ssl(loc),
        "cache_enabled": direct is not None or bool(routes),
        "cache_zone": cache_zone,
        "managed_by_service": service_id is not None,
        "service_id": service_id,
    }


@router.get("")
def list_servers():
    store = S.ConfigStore()
    return envelope(data=[_summary(loc, store) for loc in store.servers()])


@router.post("", status_code=201)
def create_server(payload=Body(..., description='lista de nós ou {"raw": "..."}')):
    """Cria um novo server block em http-available/<id>.conf (ativo por padrão)."""
    block, root_children = _server_file_nodes(payload)
    names = [c.args for c in block.children if isinstance(c, Directive) and c.name == "server_name"]
    slug = S._slug(names[0][0]) if names and names[0] else "server"

    store = S.ConfigStore()
    if any(loc.ident == slug for loc in store.servers()):
        raise HTTPException(status_code=409, detail=f"server '{slug}' já existe")

    filename = f"{slug}.conf"
    path = store.prefix / "http-available" / filename
    conf = S.ConfFile(path=path, root=Block("", [], root_children), root_context="http")
    store.files.append(conf)
    try:
        S.save_and_enable(store.prefix, _KIND, filename, conf)
    except S.ConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": slug, "file": str(path), "enabled": True},
                    messages=[message(f"server '{slug}' criado", "success")])


@router.get("/{ident}")
def get_server(ident: str):
    loc = _resolve(ident)
    # `nodes`/`raw` expõem o ARQUIVO inteiro (o `server{}` + eventuais irmãos
    # de contexto http, ex.: `proxy_cache_path` da zona dedicada) para o form
    # conseguir repopular e o modo raw não perder nada.
    nodes = loc.conf.root.children
    service_id = _managed_service_id(loc)
    return envelope(data={"id": loc.ident, "file": str(loc.conf.path),
                          "removable": loc.ident != "default",
                          "enabled": loc.enabled,
                          "managed_by_service": service_id is not None,
                          "service_id": service_id,
                          "nodes": as_json(nodes),
                          "raw": dump_nodes(nodes)})


@router.get("/{ident}/cache/status")
def cache_status(ident: str):
    store = S.ConfigStore()
    loc = _resolve(ident)
    zones = _cache_zones(loc, store)
    if not zones:
        raise HTTPException(status_code=404, detail=f"server '{ident}' não tem cache ativo")
    return envelope(data={"id": loc.ident, "enabled": True, "zones": zones})


@router.post("/{ident}/cache/clear")
def clear_cache(ident: str, zone: str = Query("", description="zona específica; vazio limpa todas")):
    store = S.ConfigStore()
    loc = _resolve(ident)
    zones = _cache_zones(loc, store)
    if not zones:
        raise HTTPException(status_code=404, detail=f"server '{ident}' não tem cache ativo")
    targets = zones
    if zone:
        targets = [z for z in zones if z["zone"] == zone]
        if not targets:
            raise HTTPException(status_code=404, detail=f"zona '{zone}' não encontrada neste server")
    removed = 0
    for z in targets:
        removed += _clear_dir(Path(z["path"]))
    label = f"zona '{zone}'" if zone else "todas as zonas"
    fresh = _cache_zones(loc, store)  # tamanhos atualizados
    return envelope(
        data={"id": loc.ident, "enabled": True, "zones": fresh, "removed_entries": removed},
        messages=[message(f"cache do server '{loc.ident}' limpo ({label})", "success")],
    )


@router.put("/{ident}")
def replace_server(ident: str, payload=Body(...)):
    loc = _resolve(ident)
    block, root_children = _server_file_nodes(payload)
    if (_managed_service_id(loc) is not None
            and _managed_fields_signature(block) != _managed_fields_signature(loc.block)):
        raise HTTPException(status_code=409, detail=(
            "Controlado por um serviço: server_name, listen, IPv6, root, autoindex, "
            "SSL/TLS e conteúdo não podem ser alterados"))
    loc.conf.root.children = root_children
    handle_save(loc.conf)
    return envelope(data={"id": loc.ident, "nodes": as_json(loc.conf.root.children),
                          "raw": dump_nodes(loc.conf.root.children)},
                    messages=[message(f"server '{loc.ident}' substituído", "success")])


@router.post("/{ident}/enable")
def enable_server(ident: str):
    loc = _resolve(ident)
    _reject_managed(loc)
    filename = loc.conf.path.name
    S.enable_resource(loc.conf.path.parent.parent, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.disable_resource(loc.conf.path.parent.parent, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a ativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": True},
                    messages=[message(f"server '{loc.ident}' ativado", "success")])


@router.post("/{ident}/disable")
def disable_server(ident: str):
    loc = _resolve(ident)
    _reject_managed(loc)
    if loc.ident == "default":
        raise HTTPException(status_code=403, detail="o server 'default' não pode ser desativado")
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.enable_resource(prefix, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a desativação:\n{out}")
    return envelope(data={"id": loc.ident, "enabled": False},
                    messages=[message(f"server '{loc.ident}' desativado", "success")])


@router.delete("/{ident}")
def delete_server(ident: str):
    loc = _resolve(ident)
    _reject_managed(loc)
    if loc.ident == "default":
        raise HTTPException(status_code=403, detail="o server 'default' não pode ser removido")
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.disable_resource(prefix, _KIND, filename)
    loc.conf.path.unlink(missing_ok=True)
    ok, out = S.nginx_test()
    if not ok:
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a remoção:\n{out}")
    return envelope(data={"deleted": loc.ident},
                    messages=[message(f"server '{loc.ident}' removido", "success")])


mount_subresources(router, "/servers", _resolve, S.SERVER_RESOURCES)
