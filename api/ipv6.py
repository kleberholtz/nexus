"""Interruptor mestre de IPv6: garante que nenhum `listen [::]...` chegue a ser
aberto pelo nginx quando a máquina/rede não suporta IPv6.

Algumas máquinas não têm o protocolo IPv6 disponível no kernel, e nesse caso
`listen [::]:80;` derruba o nginx inteiro no boot:

    nginx: [emerg] socket() [::]:80 failed (97: Address family not supported by protocol)

`nginx -t` não pega esse erro (o teste de config não chega a abrir sockets),
então a validação de escrita segura (`config.store.save_conf`) não protege
contra isso — só falha de verdade quando o nginx sobe/recarrega.

Em vez de apagar as diretivas `listen [::]...` (perderia a config do usuário),
elas são **comentadas** com um marcador (`_MARKER`) quando IPv6 é desativado, e
descomentadas quando reativado — reversível e sem perda de dados. Varre TODOS
os arquivos geridos por `ConfigStore` (server/stream/rtmp), não só o site
default, porque um único `listen [::]` esquecido em qualquer arquivo já
derruba o nginx.

Uso:
  * no **entrypoint** (`python3 -m api.ipv6`), antes do `nginx -t`, reconcilia
    os arquivos de config com a preferência persistida (`appsettings`);
  * pela **API** (`PUT /settings` com `ipv6_enabled`) — ver `api/routers/settings.py`.
"""
from __future__ import annotations

import sys

from .config import store as S
from .config.parser import Block, Comment, Directive, Node, dump, dump_nodes, parse

_MARKER = "nexus:ipv6-off "


def _is_ipv6_listen(node: Node) -> bool:
    return (
        isinstance(node, Directive)
        and node.name == "listen"
        and bool(node.args)
        and node.args[0].startswith("[")
    )


def _toggle(children: list[Node], enabled: bool) -> tuple[list[Node], bool]:
    """Reescreve `children` (recursivo) comentando/restaurando `listen [::]...`.

    Retorna a nova lista e se algo mudou.
    """
    changed = False
    out: list[Node] = []
    for node in children:
        if isinstance(node, Block):
            new_kids, kids_changed = _toggle(node.children, enabled)
            if kids_changed:
                node.children = new_kids
                changed = True
            out.append(node)
        elif not enabled and _is_ipv6_listen(node):
            out.append(Comment(_MARKER + dump_nodes([node]).strip()))
            changed = True
        elif enabled and isinstance(node, Comment) and node.text.startswith(_MARKER):
            restored = parse(node.text[len(_MARKER):]).children
            out.extend(restored or [node])
            changed = changed or bool(restored)
        else:
            out.append(node)
    return out, changed


def apply(enabled: bool, validate: bool = True) -> dict:
    """Aplica o estado (habilitado/desabilitado) a todas as confs geridas.

    Backup em memória de todos os arquivos tocados -> grava todos -> `nginx -t`
    uma única vez -> restaura todos em caso de falha (tudo ou nada).

    `validate=False` pula o `nginx -t` (e o rollback): usado no **boot** do deploy
    de 3 containers, onde o nginx ainda não subiu (depends_on: api healthy) e não
    há como validar via `docker exec` — o próprio container do nginx roda
    `nginx -t` no seu start.
    """
    store = S.ConfigStore()
    touched: list[S.ConfFile] = []
    for conf in store.files:
        new_children, changed = _toggle(conf.root.children, enabled)
        if changed:
            conf.root.children = new_children
            touched.append(conf)

    if not touched:
        return {"changed_files": 0}

    backups = {conf.path: (conf.path.read_bytes() if conf.path.exists() else None) for conf in touched}
    for conf in touched:
        conf.path.write_text(dump(conf.root), encoding="utf-8")
    if not validate:
        return {"changed_files": len(touched)}
    ok, output = S.nginx_test()
    if not ok:
        for path, data in backups.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(data)
        raise S.ConfigError(f"nginx -t rejeitou a mudança de IPv6:\n{output}")
    return {"changed_files": len(touched)}


def main() -> None:
    from . import appsettings, nginxctl

    enabled = appsettings.get_bool("ipv6_enabled")
    # No boot em modo docker o nginx ainda não está no ar (não dá p/ `docker exec
    # nginx -t`); grava sem validar — o container do nginx valida no seu start.
    validate = not nginxctl._docker_mode()
    try:
        res = apply(enabled, validate=validate)
    except S.ConfigError as exc:
        print(f"ipv6: falha ao aplicar (enabled={enabled}): {exc}", file=sys.stderr)
        return
    print(f"ipv6: enabled={enabled} changed_files={res['changed_files']}", file=sys.stderr)


if __name__ == "__main__":
    main()
