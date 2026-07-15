"""Rotas /rtmp: aplicações de live streaming (módulo nginx-rtmp).

Cada "aplicação" é um bloco `application <name> {}` dentro de um `server {}`
agrupado por porta (`listen`) — 1 porta = 1 arquivo `rtmp-available/<porta>.conf`
(o bloco `rtmp {}` em si é fixo no `nginx.conf`, só com
`include rtmp-enabled/*.conf;`). Ativar/desativar (`enable`/`disable`) vale
pela PORTA inteira (todas as aplicações dela), já que a granularidade do
symlink `rtmp-enabled/` é por arquivo/porta, não por aplicação individual. O
CRUD é orientado a formulário (o painel monta o corpo do bloco); o backend só
armazena os nós e valida com `nginx -t` (backup → grava → testa → rollback).

Requer o módulo nginx-rtmp compilado; sem ele, salvar responde 409 (nginx -t).
"""
from __future__ import annotations

import socket

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import nginxctl
from ..auth import require_token
from ..config import store as S
from ..config.parser import Block, Comment, Directive, dump_nodes
from ..envelope import envelope, message
from ._common import as_json, handle_save, nodes_from_body, unwrap_single

router = APIRouter(prefix="/rtmp", tags=["rtmp"], dependencies=[Depends(require_token)])

# Prefixo do comentário que guarda a chave de transmissão sugerida da aplicação
# (o nginx-rtmp não tem diretiva de "chave"; persistimos como comentário no bloco).
_KEY_COMMENT = "stream_key "

# O módulo nginx-rtmp só GRAVA os segmentos HLS em disco (hls_path); nada serve
# esse diretório por HTTP. Sem um location dedicado, a URL do player cai no
# catch-all do server default (devolve o JSON da API, não o .m3u8) — por isso
# criamos/garantimos esse location sempre que alguma app liga `hls on`.
_HLS_URL_PREFIX = "/hls/"
_HLS_ROOT = "/var/www"  # casa com o hls_path padrão do formulário (/var/www/hls)


_KIND = "rtmp"


def _reload_msgs() -> list[dict]:
    res = nginxctl.reload()
    if res.get("ok"):
        return [message("nginx recarregado", "success")]
    return [message(f"config salva, mas o reload do nginx falhou: {res.get('output', '')}", "warn")]


def _save_and_reload(conf) -> list[dict]:
    """Grava a config (backup → nginx -t → rollback) e recarrega o nginx para
    que a aplicação passe a valer. O reload é best-effort: se falhar, a mudança
    já está salva/validada e devolvemos um aviso em vez de erro."""
    handle_save(conf)
    return _reload_msgs()


def _save_enable_and_reload(store: S.ConfigStore, conf) -> list[dict]:
    """Como `_save_and_reload`, mas também garante o symlink de ativação
    (idempotente — usado em create/update, onde a porta pode ser nova)."""
    filename = conf.path.name
    try:
        S.save_and_enable(store.prefix, _KIND, filename, conf)
    except S.ConfigError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return _reload_msgs()


def _port_app_count(conf) -> int:
    return sum(1 for srv in conf.root.children if isinstance(srv, Block) and srv.name == "server"
              for app in srv.children if isinstance(app, Block) and app.name == "application")


def _has_hls_location(server_block: Block) -> bool:
    return any(isinstance(c, Block) and c.name == "location" and c.args
              and c.args[-1] == _HLS_URL_PREFIX for c in server_block.children)


def _ensure_hls_location() -> list[dict]:
    """Garante que o server default sirva `{_HLS_URL_PREFIX}` (root `{_HLS_ROOT}`,
    tipos MIME + CORS) para tocar o HLS gerado pelo nginx-rtmp no navegador.
    Idempotente: não faz nada se o location já existir."""
    try:
        loc = S.ConfigStore().server("default")
    except S.NotFound:
        return []
    if _has_hls_location(loc.block):
        return []
    location = Block("location", [_HLS_URL_PREFIX], [
        Block("types", [], [
            Directive("application/vnd.apple.mpegurl", ["m3u8"]),
            Directive("video/mp2t", ["ts"]),
        ]),
        Directive("root", [_HLS_ROOT]),
        Directive("add_header", ["Cache-Control", "no-cache"]),
        Directive("add_header", ["Access-Control-Allow-Origin", "*"]),
    ])
    loc.block.children.append(location)
    handle_save(loc.conf)
    return [message(f"location '{_HLS_URL_PREFIX}' criada no server default (serve o HLS)", "success")]


def _other_app_paths(directive_name: str, exclude_ident: str | None) -> set[str]:
    """Valores de `directive_name` (hls_path/record_path) usados por OUTRAS
    aplicações (exclui `exclude_ident`, a própria app sendo criada/editada)."""
    paths: set[str] = set()
    for loc in S.ConfigStore().rtmp_apps():
        if loc.ident == exclude_ident:
            continue
        v = _directive_val(loc.block, directive_name)
        if v:
            paths.add(v.rstrip("/"))
    return paths


def _dedupe_path(block: Block, directive_name: str, app_name: str, used: set[str]) -> None:
    """O nginx-rtmp exige `hls_path`/`record_path` únicos entre aplicações —
    duas apps apontando pro mesmo diretório fazem o `nginx -t` rejeitar com
    "the same path name used in ... and in ...". Como o formulário sugere o
    mesmo caminho padrão pra toda app nova, namespacia por nome (<path>/<app>)
    quando detecta colisão, em vez de deixar o usuário travado sem entender."""
    for c in block.children:
        if isinstance(c, Directive) and c.name == directive_name and c.args:
            if c.args[0].rstrip("/") in used:
                c.args = [f"{c.args[0].rstrip('/')}/{S._slug(app_name)}"]
            return


def _listen_of(server_block: Block) -> str:
    for c in server_block.children:
        if isinstance(c, Directive) and c.name == "listen" and c.args:
            return c.args[0]
    return ""


def _port(listen: str) -> str:
    return listen.rsplit(":", 1)[-1]


def _directive_val(block: Block, name: str) -> str | None:
    for c in block.children:
        if isinstance(c, Directive) and c.name == name and c.args:
            return c.args[0]
    return None


def _stream_key(block: Block) -> str:
    for c in block.children:
        if isinstance(c, Comment) and c.text.startswith(_KEY_COMMENT):
            return c.text[len(_KEY_COMMENT):].strip()
    return ""


def _summary(loc: S.Located) -> dict:
    return {
        "id": loc.ident,
        "name": loc.block.args[0] if loc.block.args else "",
        "listen": _listen_of(loc.parent),
        "live": _directive_val(loc.block, "live") or "off",
        "hls": _directive_val(loc.block, "hls") or "off",
        "record": _directive_val(loc.block, "record") or "off",
        "key": _stream_key(loc.block),
        "file": str(loc.conf.path),
        "enabled": loc.enabled,
    }


def _app_name(block: Block) -> str:
    return block.args[0] if block.args else ""


def _find_ident(store: S.ConfigStore, name: str, listen: str) -> str | None:
    for loc in store.rtmp_apps():
        if _app_name(loc.block) == name and _port(_listen_of(loc.parent)) == _port(str(listen)):
            return loc.ident
    return None


@router.get("")
def list_rtmp():
    return envelope(data=[_summary(loc) for loc in S.ConfigStore().rtmp_apps()])


@router.post("", status_code=201)
def create_rtmp(name: str, listen: str = "1935", payload=Body(default=[])):
    app_name = name.strip()
    if not app_name:
        raise HTTPException(status_code=400, detail="name é obrigatório")
    if not _port(str(listen)).isdigit():
        raise HTTPException(status_code=400, detail="listen deve ser uma porta")
    store = S.ConfigStore()
    srv, conf = store.ensure_rtmp_server(_port(str(listen)))
    if any(isinstance(a, Block) and a.name == "application" and _app_name(a) == app_name
           for a in srv.children):
        raise HTTPException(status_code=409,
                            detail=f"aplicação '{app_name}' já existe na porta {_port(str(listen))}")
    block = Block("application", [app_name], unwrap_single(nodes_from_body(payload), "application"))
    if (_directive_val(block, "hls") or "off") == "on":
        _dedupe_path(block, "hls_path", app_name, _other_app_paths("hls_path", None))
    if (_directive_val(block, "record") or "off") != "off":
        _dedupe_path(block, "record_path", app_name, _other_app_paths("record_path", None))
    srv.children.append(block)
    extra = _ensure_hls_location() if (_directive_val(block, "hls") or "off") == "on" else []
    msgs = [*extra, *_save_enable_and_reload(store, conf)]
    ident = _find_ident(S.ConfigStore(), app_name, listen) or S._slug(app_name)
    return envelope(data={"id": ident, "name": app_name, "listen": _port(str(listen)), "enabled": True},
                    messages=[message(f"aplicação rtmp '{app_name}' criada", "success"), *msgs])


@router.get("/{ident}")
def get_rtmp(ident: str):
    try:
        loc = S.ConfigStore().rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return envelope(data={
        "id": loc.ident,
        "name": _app_name(loc.block),
        "listen": _listen_of(loc.parent),
        "nodes": as_json(loc.block.children),
        "raw": dump_nodes(loc.block.children),
    })


@router.put("/{ident}")
def replace_rtmp(ident: str, name: str | None = None, listen: str | None = None, payload=Body(...)):
    store = S.ConfigStore()
    try:
        loc = store.rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    new_children = unwrap_single(nodes_from_body(payload), "application")
    cur_name = _app_name(loc.block)
    cur_port = _port(_listen_of(loc.parent))
    target_name = (name or cur_name).strip() or cur_name
    target_port = _port(str(listen)) if listen else cur_port
    old_conf = loc.conf
    conf = loc.conf
    moved = target_port != cur_port

    # move para outra porta (arquivo) se mudou
    if moved:
        if not target_port.isdigit():
            raise HTTPException(status_code=400, detail="listen deve ser uma porta")
        loc.parent.children = [c for c in loc.parent.children if c is not loc.block]
        srv, conf = store.ensure_rtmp_server(target_port)
    else:
        srv = loc.parent

    # unicidade do nome no server de destino (ignorando o próprio bloco)
    if any(isinstance(a, Block) and a.name == "application" and a is not loc.block
           and _app_name(a) == target_name for a in srv.children):
        raise HTTPException(status_code=409,
                            detail=f"aplicação '{target_name}' já existe na porta {target_port}")

    if moved:
        srv.children.append(loc.block)
    loc.block.args = [target_name]
    loc.block.children = new_children
    if (_directive_val(loc.block, "hls") or "off") == "on":
        _dedupe_path(loc.block, "hls_path", target_name, _other_app_paths("hls_path", ident))
    if (_directive_val(loc.block, "record") or "off") != "off":
        _dedupe_path(loc.block, "record_path", target_name, _other_app_paths("record_path", ident))

    if moved:
        # grava/apaga a porta de ORIGEM primeiro (sem a app que saiu; some do
        # disco se ficou vazia), depois grava+ativa a porta de DESTINO — nessa
        # ordem, um único reload no final já reflete o estado final coerente.
        store.rtmp_prune(old_conf)
        old_prefix = old_conf.path.parent.parent
        old_filename = old_conf.path.name
        if store.rtmp_is_empty(old_conf):
            S.disable_resource(old_prefix, _KIND, old_filename)
            old_conf.path.unlink(missing_ok=True)
        else:
            handle_save(old_conf)
        try:
            S.save_and_enable(store.prefix, _KIND, conf.path.name, conf)
        except S.ConfigError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
    else:
        handle_save(conf)

    extra = _ensure_hls_location() if (_directive_val(loc.block, "hls") or "off") == "on" else []
    msgs = [*extra, *_reload_msgs()]
    ident2 = _find_ident(S.ConfigStore(), target_name, target_port) or S._slug(target_name)
    return envelope(data={"id": ident2, "name": target_name, "listen": target_port},
                    messages=[message(f"aplicação rtmp '{target_name}' atualizada", "success"), *msgs])


@router.post("/{ident}/enable")
def enable_rtmp(ident: str):
    """Ativa a PORTA inteira (todas as aplicações dela) — o toggle no nginx
    só existe por arquivo, e o arquivo rtmp é sempre 1 porta = todas as apps."""
    try:
        loc = S.ConfigStore().rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    S.enable_resource(prefix, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.disable_resource(prefix, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a ativação:\n{out}")
    n = _port_app_count(loc.conf)
    msgs = _reload_msgs()
    return envelope(data={"id": loc.ident, "enabled": True},
                    messages=[message(f"porta {_port(_listen_of(loc.parent))} ativada "
                                      f"(afeta {n} aplicação(ões))", "success"), *msgs])


@router.post("/{ident}/disable")
def disable_rtmp(ident: str):
    """Desativa a PORTA inteira (todas as aplicações dela) — ver `enable_rtmp`."""
    try:
        loc = S.ConfigStore().rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    prefix = loc.conf.path.parent.parent
    filename = loc.conf.path.name
    port = _port(_listen_of(loc.parent))
    n = _port_app_count(loc.conf)
    S.disable_resource(prefix, _KIND, filename)
    ok, out = S.nginx_test()
    if not ok:
        S.enable_resource(prefix, _KIND, filename)
        raise HTTPException(status_code=409, detail=f"nginx -t rejeitou a desativação:\n{out}")
    msgs = _reload_msgs()
    return envelope(data={"id": loc.ident, "enabled": False},
                    messages=[message(f"porta {port} desativada (afeta {n} aplicação(ões))", "success"), *msgs])


@router.post("/{ident}/test")
def test_rtmp(ident: str):
    """Testa o live streaming: verifica se o nginx está escutando na porta RTMP
    (TCP connect em 127.0.0.1:porta) e devolve os endpoints/comando de exemplo."""
    try:
        loc = S.ConfigStore().rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    name = _app_name(loc.block)
    port_s = _port(_listen_of(loc.parent)) or "1935"
    try:
        port = int(port_s)
    except ValueError:
        port = 1935

    listening = False
    detail = ""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2.0):
            listening = True
    except OSError as exc:
        detail = str(exc)

    endpoint = f"rtmp://<host>:{port}/{name}"
    key = _stream_key(loc.block) or "test"
    hls_on = (_directive_val(loc.block, "hls") or "off") == "on"
    hls_url = ""
    hls_notice = ""

    # Auto-corrige o location /hls/ se faltar (ex.: app criada antes dessa
    # verificação existir) — sem isso o player HLS nunca vai funcionar. NÃO
    # recarrega o nginx aqui: esse "teste" roda sozinho ao abrir o modal, e um
    # reload durante uma publicação/gravação ativa pode derrubar o worker que
    # está gravando (o módulo record do nginx-rtmp não lida bem com isso). O
    # reload fica para create/update, que são ações explícitas do usuário.
    if hls_on:
        if _ensure_hls_location():
            hls_notice = ("location '/hls/' criada — recarregue o nginx em Configurações → Nginx "
                          "para valer (evitamos recarregar automaticamente aqui pra não "
                          "interromper uma transmissão/gravação em andamento)")
        hls_path = (_directive_val(loc.block, "hls_path") or _HLS_ROOT + "/hls").rstrip("/")
        hls_nested = (_directive_val(loc.block, "hls_nested") or "off") == "on"
        rel_dir = hls_path[len(_HLS_ROOT):] if hls_path.startswith(_HLS_ROOT) else "/hls"
        if hls_nested:
            rel_dir = f"{rel_dir}/{name}"
        hls_url = f"http://<host>{rel_dir}/{key}.m3u8"

    data = {
        "listening": listening,
        "port": port,
        "app": name,
        "key": key,
        "endpoint": endpoint,
        "publish_example": f"ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 "
                           f"-c:v libx264 -preset veryfast -tune zerolatency -f flv "
                           f"{endpoint}/{key}",
        "hls": hls_on,
        "hls_url": hls_url,
        "hls_notice": hls_notice,
        "detail": detail,
    }
    kind = "success" if listening else "warn"
    msg = (f"RTMP escutando na porta {port}" if listening
           else f"nginx não está escutando na porta {port} ({detail or 'sem conexão'})")
    msgs = [message(msg, kind)]
    if hls_notice:
        msgs.append(message(hls_notice, "warn"))
    return envelope(data=data, messages=msgs)


@router.delete("/{ident}")
def delete_rtmp(ident: str):
    store = S.ConfigStore()
    try:
        loc = store.rtmp_app(ident)
    except S.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    loc.parent.children = [c for c in loc.parent.children if c is not loc.block]
    store.rtmp_prune(loc.conf)
    if store.rtmp_is_empty(loc.conf):
        prefix = loc.conf.path.parent.parent
        filename = loc.conf.path.name
        S.disable_resource(prefix, _KIND, filename)
        loc.conf.path.unlink(missing_ok=True)
        msgs = _reload_msgs()
    else:
        msgs = _save_and_reload(loc.conf)
    return envelope(data={"deleted": loc.ident},
                    messages=[message(f"aplicação rtmp '{loc.ident}' removida", "success"), *msgs])
