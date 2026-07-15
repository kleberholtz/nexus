"""Camada de acesso à configuração: localiza recursos e grava com segurança.

Cada tipo de recurso (http/stream/upstream/rtmp) vive num par de diretórios
`<tipo>-available`/`<tipo>-enabled`, ao estilo do sites-available/sites-enabled
do Debian: criar grava em `<tipo>-available/<nome>.conf`; "ativar" cria um
symlink relativo em `<tipo>-enabled/<nome>.conf -> ../<tipo>-available/<nome>.conf`
— só o que está symlinkado em `*-enabled/` é de fato incluído pelo nginx.conf
e vale no nginx rodando. O `ConfigStore` carrega sempre o arquivo de
`*-available/` (nunca o symlink, que é conteúdo idêntico) e calcula `enabled`
resolvendo se o symlink correspondente existe.

Classifica os blocos `server`/`application` como contexto http/stream/rtmp
pelo PRÓPRIO DIRETÓRIO (`http-*`/`stream-*`/`rtmp-*`, forçado desde a raiz do
arquivo). Upstreams são exceção: `upstream-available`/`upstream-enabled` é um
ÚNICO par compartilhado pelos contextos http e stream (o `include
upstream-enabled/*.conf;` está tanto dentro do `http{}` quanto do `stream{}`
do nginx.conf — um upstream não referenciado no outro contexto é apenas
ignorado, sem custo). Os arquivos NÃO têm wrapper `http{}`/`stream{}` (isso
criaria um 2º bloco `http{}` de nível raiz, que o nginx rejeita como
duplicado) — o contexto pretendido é só um comentário-marcador
(`# nexus:upstream-context=http|stream`), lido por `_upstream_context()`
e usado apenas para exibição/organização na API, nunca pelo nginx em si.

Toda escrita passa por: backup -> grava -> `nginx -t` -> mantém em caso de
sucesso, ou restaura o backup em caso de falha.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

from .parser import Block, Comment, Directive, Node, dump, parse

NGINX_PREFIX = Path(os.environ.get("NGINX_PREFIX", "/etc/nginx"))
NGINX_BIN = os.environ.get("NGINX_BIN", "nginx")

# Tipos de recurso com par de diretórios <tipo>-available/<tipo>-enabled.
RESOURCE_KINDS = ("http", "stream", "upstream", "rtmp")

# Diretórios cujo contexto de varredura é forçado pelo próprio path (em vez de
# depender de um wrapper http{}/stream{} explícito dentro do arquivo).
_DIR_CONTEXT = {
    "http-available": "http", "http-enabled": "http",
    "stream-available": "stream", "stream-enabled": "stream",
    "rtmp-available": "rtmp", "rtmp-enabled": "rtmp",
    # upstream-available/upstream-enabled ficam de fora: os dois contextos
    # compartilham o mesmo par de diretórios (ver _upstream_context()).
}

# Comentário-marcador do contexto pretendido de um upstream (ver docstring do
# módulo — os arquivos de upstream não têm wrapper http{}/stream{}).
_UPSTREAM_CTX_MARKER = "nexus:upstream-context="


def _upstream_context(conf: ConfFile) -> str:
    for node in conf.root.children:
        if isinstance(node, Comment) and node.text.strip().startswith(_UPSTREAM_CTX_MARKER):
            ctx = node.text.strip()[len(_UPSTREAM_CTX_MARKER):].strip()
            if ctx in ("http", "stream"):
                return ctx
    return "http"


class ConfigError(Exception):
    """Falha de validação/gravação da config (mapear para HTTP 4xx/409)."""


class NotFound(Exception):
    """Recurso inexistente (mapear para HTTP 404)."""


def _root_context(path: Path, prefix: Path) -> str:
    """Contexto inicial de varredura de um arquivo, pelo 1º segmento do path
    relativo ao prefix (ex.: 'stream-enabled/8080.conf' -> 'stream'). Fora de
    qualquer *-available/*-enabled conhecido (nginx.conf, nexus/*, upstream-*),
    mantém o padrão "http" — o wrapper explícito no conteúdo é quem decide."""
    try:
        rel = path.relative_to(prefix)
    except ValueError:
        return "http"
    top = rel.parts[0] if rel.parts else ""
    return _DIR_CONTEXT.get(top, "http")


# --------------------------------------------------------------------------- #
# Arquivos carregados
# --------------------------------------------------------------------------- #
@dataclass
class ConfFile:
    path: Path
    root: Block
    root_context: str = "http"
    enabled: bool = True


@dataclass
class Located:
    """Um bloco encontrado, com o arquivo e o bloco pai onde ele vive."""
    block: Block
    conf: ConfFile
    parent: Block
    context: str  # "http" | "stream" | "rtmp"
    ident: str = field(default="")
    enabled: bool = True


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", text.strip()).strip("-.")
    return s or "default"


# Diretivas que referenciam certificados (para detectar "em uso").
_CERT_DIRECTIVES = {"ssl_certificate", "ssl_certificate_key",
                    "ssl_trusted_certificate", "ssl_client_certificate"}
# Diretivas *_pass que referenciam um upstream pelo nome (host de destino).
_PASS_DIRECTIVES = {"proxy_pass", "fastcgi_pass", "uwsgi_pass", "scgi_pass",
                    "grpc_pass", "memcached_pass"}
_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://")


def _pass_host(target: str) -> str:
    """Host/nome de destino de um `*_pass` (sem esquema, porta ou caminho).

    Ex.: `http://api_backend/x` → `api_backend`; `1.2.3.4:8080` → `1.2.3.4`.
    """
    v = target.strip()
    m = _SCHEME_RE.match(v)
    if m:
        v = v[m.end():]
    return re.split(r"[/:]", v, 1)[0]


class ConfigStore:
    def __init__(self, prefix: Path = NGINX_PREFIX):
        self.prefix = prefix
        self.files: list[ConfFile] = []
        self.reload()

    # -- carga -------------------------------------------------------------- #
    def reload(self) -> None:
        self.files = []
        # 1) resolve os symlinks de cada <tipo>-enabled/ num set de alvos
        #    absolutos, pra saber quais arquivos de <tipo>-available/ estão
        #    de fato ativos (incluídos pelo nginx.conf).
        enabled_targets: set[Path] = set()
        for kind in RESOURCE_KINDS:
            enabled_dir = self.prefix / f"{kind}-enabled"
            if not enabled_dir.is_dir():
                continue
            for link in enabled_dir.glob("*.conf"):
                if link.is_symlink():
                    try:
                        enabled_targets.add(link.resolve())
                    except OSError:
                        continue

        for path in sorted(self.prefix.rglob("*.conf")):
            # Confs em internal/ são infra (ex.: o server block do painel na
            # 3000) e não devem ser gerenciadas/listadas pela API.
            if "internal" in path.parts:
                continue
            top = path.relative_to(self.prefix).parts[0] if path.is_relative_to(self.prefix) else ""
            if top.endswith("-enabled"):
                # Symlinks em *-enabled/ nunca têm conteúdo próprio — o
                # arquivo real é o de *-available/, carregado abaixo.
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            enabled = True
            if top.endswith("-available"):
                try:
                    enabled = path.resolve() in enabled_targets
                except OSError:
                    enabled = False
            self.files.append(ConfFile(path=path, root=parse(text),
                                       root_context=_root_context(path, self.prefix),
                                       enabled=enabled))

    # -- travessia genérica ------------------------------------------------- #
    def _iter_blocks(self, name: str):
        """Rende (Located) de cada bloco chamado `name`, com contexto/pai."""
        for conf in self.files:
            results: list[Located] = []
            self._walk(conf, conf.root, conf.root_context, name, results)
            for loc in results:
                loc.enabled = conf.enabled
            yield from results

    def _walk(self, conf, parent, context, target, results):
        for child in parent.children:
            if isinstance(child, Block):
                if child.name == "stream":
                    ctx = "stream"
                elif child.name == "rtmp":
                    ctx = "rtmp"
                else:
                    ctx = context
                if child.name == target:
                    results.append(Located(child, conf, parent, ctx))
                self._walk(conf, child, ctx, target, results)

    # -- servers ------------------------------------------------------------ #
    def _server_names(self, block: Block) -> list[str]:
        for c in block.children:
            if isinstance(c, Directive) and c.name == "server_name":
                return c.args
        return []

    def _server_listens(self, block: Block) -> list[str]:
        out = []
        for c in block.children:
            if isinstance(c, Directive) and c.name == "listen":
                out.append(" ".join(c.args))
        return out

    def servers(self) -> list[Located]:
        """Server blocks de contexto http, com id estável e único."""
        out: list[Located] = []
        seen: dict[str, int] = {}
        for loc in self._iter_blocks("server"):
            if loc.context != "http":
                continue
            names = self._server_names(loc.block)
            base = _slug(names[0]) if names and names[0] not in ("", "_") else "default"
            n = seen.get(base, 0)
            seen[base] = n + 1
            loc.ident = base if n == 0 else f"{base}-{n + 1}"
            out.append(loc)
        return out

    def server(self, server_id: str) -> Located:
        for loc in self.servers():
            if loc.ident == server_id:
                return loc
        raise NotFound(f"server '{server_id}' não encontrado")

    # -- streams ------------------------------------------------------------ #
    def streams(self) -> list[Located]:
        out: list[Located] = []
        seen: dict[str, int] = {}
        for loc in self._iter_blocks("server"):
            if loc.context != "stream":
                continue
            listens = self._server_listens(loc.block)
            base = _slug(listens[0]) if listens else "stream"
            n = seen.get(base, 0)
            seen[base] = n + 1
            loc.ident = base if n == 0 else f"{base}-{n + 1}"
            out.append(loc)
        return out

    def stream(self, stream_id: str) -> Located:
        for loc in self.streams():
            if loc.ident == stream_id:
                return loc
        raise NotFound(f"stream '{stream_id}' não encontrado")

    # -- upstreams ---------------------------------------------------------- #
    def upstreams(self) -> list[Located]:
        out: list[Located] = []
        for loc in self._iter_blocks("upstream"):
            loc.ident = loc.block.args[0] if loc.block.args else "upstream"
            loc.context = _upstream_context(loc.conf)
            out.append(loc)
        return out

    def upstream(self, upstream_id: str) -> Located:
        for loc in self.upstreams():
            if loc.ident == upstream_id:
                return loc
        raise NotFound(f"upstream '{upstream_id}' não encontrado")

    def main_conf(self) -> ConfFile:
        """O nginx.conf principal — caminho explícito, sem heurística de scan."""
        path = self.prefix / "nginx.conf"
        for conf in self.files:
            if conf.path == path:
                return conf
        raise NotFound("nginx.conf não encontrado")

    # -- rtmp (live streaming) ---------------------------------------------- #
    # Cada porta ganha seu próprio arquivo `rtmp-available/<porta>.conf`, com
    # um único `server{listen <porta>; application ...; ...}` "nu" (o contexto
    # "rtmp" já vem do diretório, sem precisar de wrapper `rtmp{}` no arquivo —
    # o wrapper fixo mora só no nginx.conf: `rtmp { include rtmp-enabled/*.conf; }`).
    def rtmp_apps(self) -> list[Located]:
        """`application {}` dentro do `server{}` de cada arquivo rtmp — cada
        aplicação é um live app; agrupamento por porta = 1 arquivo."""
        out: list[Located] = []
        seen: dict[str, int] = {}
        for conf in self.files:
            if conf.root_context != "rtmp":
                continue
            for srv in conf.root.children:
                if not (isinstance(srv, Block) and srv.name == "server"):
                    continue
                for app in srv.children:
                    if isinstance(app, Block) and app.name == "application":
                        base = _slug(app.args[0]) if app.args else "app"
                        n = seen.get(base, 0)
                        seen[base] = n + 1
                        ident = base if n == 0 else f"{base}-{n + 1}"
                        out.append(Located(app, conf, srv, "rtmp", ident, enabled=conf.enabled))
        return out

    def rtmp_app(self, ident: str) -> Located:
        for loc in self.rtmp_apps():
            if loc.ident == ident:
                return loc
        raise NotFound(f"aplicação rtmp '{ident}' não encontrada")

    def _rtmp_conf_path(self, port: str) -> Path:
        return self.prefix / "rtmp-available" / f"{port}.conf"

    def ensure_rtmp_server(self, listen: str) -> tuple[Block, ConfFile]:
        """Server rtmp da porta informada — reusa `rtmp-available/<porta>.conf`
        se já existir (mesmo arquivo p/ todas as apps da porta); cria um
        `ConfFile` novo em memória senão (persistir/ativar é responsabilidade
        de quem chama, ver `save_and_enable`)."""
        port = str(listen)
        for conf in self.files:
            if conf.root_context != "rtmp":
                continue
            for srv in conf.root.children:
                if isinstance(srv, Block) and srv.name == "server":
                    for c in srv.children:
                        if isinstance(c, Directive) and c.name == "listen" and c.args \
                                and c.args[0].rsplit(":", 1)[-1] == port:
                            return srv, conf
        path = self._rtmp_conf_path(port)
        srv = Block("server", [], [Directive("listen", [port])])
        conf = ConfFile(path=path, root=Block("", [], [srv]), root_context="rtmp", enabled=True)
        self.files.append(conf)
        return srv, conf

    def rtmp_prune(self, conf: ConfFile) -> None:
        """Remove o `server{}` da porta se ficou sem nenhuma `application` —
        quem decide apagar o arquivo físico é o router (mesmo padrão dos
        outros recursos: o store só mexe na árvore em memória)."""
        conf.root.children = [
            srv for srv in conf.root.children
            if not (isinstance(srv, Block) and srv.name == "server"
                    and not any(isinstance(a, Block) and a.name == "application"
                                for a in srv.children))
        ]

    def rtmp_is_empty(self, conf: ConfFile) -> bool:
        """True se o arquivo rtmp não tem mais nenhum `server{}` (após prune)."""
        return not any(isinstance(n, Block) and n.name == "server" for n in conf.root.children)

    # -- referências (uso) -------------------------------------------------- #
    def _iter_directives(self, block: Block):
        """Rende todos os Directive descendentes de `block` (recursivo)."""
        for child in block.children:
            if isinstance(child, Directive):
                yield child
            elif isinstance(child, Block):
                yield from self._iter_directives(child)

    def certificate_usage(self, name: str) -> list[str]:
        """Idents de server/stream ATIVOS que referenciam o certificado `name`
        (um recurso desativado não afeta o nginx rodando, então não conta)."""
        users: list[str] = []
        for loc in [*self.servers(), *self.streams()]:
            if not loc.enabled:
                continue
            for d in self._iter_directives(loc.block):
                if d.name in _CERT_DIRECTIVES and d.args and Path(d.args[0]).stem == name:
                    users.append(loc.ident)
                    break
        return users

    def upstream_usage(self, name: str) -> list[str]:
        """Idents de server/stream ATIVOS que referenciam o upstream `name`
        num *_pass (mesma lógica de `certificate_usage` sobre `enabled`)."""
        users: list[str] = []
        for loc in [*self.servers(), *self.streams()]:
            if not loc.enabled:
                continue
            for d in self._iter_directives(loc.block):
                if d.name in _PASS_DIRECTIVES and d.args and _pass_host(d.args[0]) == name:
                    users.append(loc.ident)
                    break
        return users

    # -- gravação segura ---------------------------------------------------- #
    def save(self, conf: ConfFile) -> None:
        save_conf(conf)


# --------------------------------------------------------------------------- #
# Ativação/desativação (padrão available/enabled) — symlink relativo atômico,
# mesmo estilo de api/deploy.py::_switch_current.
# --------------------------------------------------------------------------- #
def enable_resource(prefix: Path, kind: str, filename: str) -> None:
    """Cria/atualiza o symlink `<kind>-enabled/<filename> -> ../<kind>-available/<filename>`.
    Idempotente (troca atômica mesmo se já ativo)."""
    enabled_dir = prefix / f"{kind}-enabled"
    enabled_dir.mkdir(parents=True, exist_ok=True)
    link = enabled_dir / filename
    tmp = enabled_dir / f".{filename}.tmp"
    tmp.unlink(missing_ok=True)
    os.symlink(f"../{kind}-available/{filename}", tmp)
    os.replace(tmp, link)


def disable_resource(prefix: Path, kind: str, filename: str) -> None:
    """Remove o symlink de ativação (o arquivo em `<kind>-available/` continua intacto)."""
    (prefix / f"{kind}-enabled" / filename).unlink(missing_ok=True)


def save_and_enable(prefix: Path, kind: str, filename: str, conf: ConfFile) -> None:
    """Cria/atualiza `conf` em `<kind>-available/` E garante o symlink em
    `<kind>-enabled/` (recurso nasce ativo por padrão), validando o conjunto
    com `nginx -t` (o teste só valida o que está incluído via *-enabled/, daí
    o symlink precisar existir ANTES do `save_conf`). Desfaz o symlink também
    se a gravação falhar e ele não existia antes (criação nova)."""
    link_existed = (prefix / f"{kind}-enabled" / filename).exists()
    enable_resource(prefix, kind, filename)
    try:
        save_conf(conf)
    except Exception:
        if not link_existed:
            disable_resource(prefix, kind, filename)
        raise


def _ensure_cache_dirs(conf: ConfFile) -> None:
    """Cria os diretórios de `proxy_cache_path` antes do `nginx -t`.

    O nginx só cria o **último** nível do cache_path (não a árvore de pais), então
    um path como `/var/cache/nginx-routes/<zona>` faz o teste falhar com
    `mkdir() ... failed (2: No such file or directory)` se `/var/cache/nginx-routes`
    ainda não existe. Criamos a árvore inteira (idempotente)."""
    for node in conf.root.walk():
        if not (isinstance(node, Directive) and node.name == "proxy_cache_path"):
            continue
        for arg in node.args:
            if "=" in arg:
                continue
            p = Path(arg)
            try:
                existed = p.exists()
                p.mkdir(parents=True, exist_ok=True)
                # herda o dono do pai (www-data) p/ o worker do nginx escrever.
                if not existed:
                    st = p.parent.stat()
                    os.chown(p, st.st_uid, st.st_gid)
            except OSError:
                pass  # sem permissão/fora do container: deixa o nginx -t reportar
            break  # o path é sempre o 1º argumento sem '='


def save_conf(conf: ConfFile) -> None:
    """Serializa `conf`, valida com nginx -t e faz rollback se falhar."""
    new_text = dump(conf.root)
    # Nome único mesmo sob concorrência (duas gravações no mesmo segundo não
    # podem colidir no mesmo arquivo de backup — ver histórico do rtmp.py).
    backup = conf.path.with_suffix(conf.path.suffix + f".bak-{os.getpid()}-{time.time_ns()}")
    had_original = conf.path.exists()
    conf.path.parent.mkdir(parents=True, exist_ok=True)
    if had_original:
        shutil.copy2(conf.path, backup)
    try:
        conf.path.write_text(new_text, encoding="utf-8")
        _ensure_cache_dirs(conf)  # cria os cache_path (pais) antes do teste
        ok, output = nginx_test()
        if not ok:
            raise ConfigError(f"nginx -t rejeitou a mudança:\n{output}")
    except Exception:
        if had_original and backup.exists():
            shutil.copy2(backup, conf.path)
        elif not had_original:
            conf.path.unlink(missing_ok=True)
        raise
    finally:
        backup.unlink(missing_ok=True)


# --------------------------------------------------------------------------- #
# Seletores de sub-recurso (nome do recurso -> predicado sobre um Node)
# --------------------------------------------------------------------------- #
def _by_names(*names: str):
    s = set(names)
    return lambda node: isinstance(node, (Directive, Block)) and node.name in s


def _by_prefix(*prefixes: tuple[str, ...]):
    flat = tuple(p for grp in prefixes for p in ((grp,) if isinstance(grp, str) else grp))
    return lambda node: isinstance(node, (Directive, Block)) and node.name.startswith(flat)


def _websocket(node: Node) -> bool:
    if isinstance(node, Directive) and node.name == "proxy_http_version":
        return True
    if isinstance(node, Directive) and node.name == "proxy_set_header":
        return bool(node.args) and node.args[0] in ("Upgrade", "Connection")
    return False


def _http2(node: Node) -> bool:
    if isinstance(node, Directive) and node.name in ("http2", "http2_push", "http2_push_preload"):
        return True
    if isinstance(node, Directive) and node.name == "listen":
        return "http2" in node.args
    return False


def _http3(node: Node) -> bool:
    if isinstance(node, Directive) and (node.name == "http3" or node.name.startswith("quic")):
        return True
    if isinstance(node, Directive) and node.name == "listen":
        return "http3" in node.args or "quic" in node.args
    if isinstance(node, Directive) and node.name == "add_header":
        return bool(node.args) and node.args[0].lower() == "alt-svc"
    return False


# Cada seletor recebe um Node e retorna True se ele pertence ao sub-recurso.
SERVER_RESOURCES = {
    "locations": _by_names("location"),
    "upstream": _by_names("proxy_pass", "fastcgi_pass", "uwsgi_pass",
                          "scgi_pass", "grpc_pass", "memcached_pass"),
    "certificates": _by_names("ssl_certificate", "ssl_certificate_key",
                              "ssl_trusted_certificate", "ssl_client_certificate",
                              "ssl_dhparam", "ssl_verify_client", "ssl_password_file"),
    "redirects": _by_names("return", "rewrite"),
    "headers": _by_names("add_header", "add_trailer", "more_set_headers",
                         "more_clear_headers", "proxy_hide_header", "proxy_set_header"),
    "logs": _by_names("access_log", "error_log"),
    "rate-limits": _by_names("limit_req", "limit_req_status", "limit_req_log_level",
                             "limit_conn", "limit_conn_status", "limit_rate",
                             "limit_rate_after"),
    "access": _by_names("allow", "deny", "satisfy", "auth_basic",
                        "auth_basic_user_file", "auth_request"),
    "cache": _by_prefix("proxy_cache", "fastcgi_cache", "uwsgi_cache", "scgi_cache"),
    "gzip": _by_prefix("gzip"),
    "brotli": _by_prefix("brotli"),
    "proxy": _by_prefix("proxy_"),
    "websocket": _websocket,
    "http2": _http2,
    "http3": _http3,
    "security": _by_names("ssl_protocols", "ssl_ciphers", "ssl_prefer_server_ciphers",
                          "ssl_session_tickets", "server_tokens", "add_header",
                          "more_set_headers"),
    "snippets": _by_names("include"),
}

STREAM_RESOURCES = {
    "upstream": _by_names("proxy_pass"),
    "access": _by_names("access_log"),
    "logs": _by_names("error_log", "access_log"),
    "proxy": _by_prefix("proxy_"),
}

UPSTREAM_RESOURCES = {
    "servers": _by_names("server"),
}


# --------------------------------------------------------------------------- #
# Operações sobre a lista de filhos de um bloco (server/stream)
# --------------------------------------------------------------------------- #
def select(block: Block, predicate) -> list[Node]:
    return [c for c in block.children if predicate(c)]


def replace(block: Block, predicate, new_nodes: list[Node]) -> None:
    """PUT: remove os nós que casam e insere `new_nodes` na posição do 1º."""
    kept: list[Node] = []
    inserted = False
    for c in block.children:
        if predicate(c):
            if not inserted:
                kept.extend(new_nodes)
                inserted = True
        else:
            kept.append(c)
    if not inserted:
        kept.extend(new_nodes)
    block.children = kept


def append(block: Block, new_nodes: list[Node]) -> None:
    block.children.extend(new_nodes)


def delete(block: Block, predicate) -> int:
    before = len(block.children)
    block.children = [c for c in block.children if not predicate(c)]
    return before - len(block.children)


# --------------------------------------------------------------------------- #
# Controle do nginx (compartilhado)
# --------------------------------------------------------------------------- #
def _run(args: list[str]) -> tuple[int, str]:
    # Delega ao nginxctl p/ respeitar o modo: subprocess local (single-container)
    # OU `docker exec` no container do nginx (deploy de 3 containers, quando
    # NGINX_CONTAINER está definido). Ver api/nginxctl.py.
    from .. import nginxctl

    return nginxctl._run(args)


def nginx_test() -> tuple[bool, str]:
    from .. import nginxctl

    res = nginxctl.test()
    return res["ok"], res["output"]
