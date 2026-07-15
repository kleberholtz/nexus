"""Emite certificados auto-assinados para `ssl_certificate` ainda ausentes.

Roda no **entrypoint** (`python3 -m api.certboot`), antes do `nginx -t`: varre os
server blocks (http/stream) gerenciados, encontra os `ssl_certificate` cujos
arquivos ainda não existem em disco e gera um self-signed no caminho exato
esperado — assim o nginx sobe mesmo antes de haver um cert "de verdade" (Let's
Encrypt, CA própria, etc.). Certificados já presentes nunca são sobrescritos.

Reaproveita `api.certs` e o parser de `api.config` (antes vivia em
`scripts/certs.py`). Desative com `NGINX_SELFSIGN=off` (tratado no entrypoint).
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import certs
from .config import store as S
from .config.parser import Directive

_SSL_CRT = "ssl_certificate"
_SSL_KEY = "ssl_certificate_key"


def _resolve(path: str, prefix: Path) -> Path:
    p = Path(path)
    return p if p.is_absolute() else prefix / p


def _server_names(block) -> list[str]:
    """server_name utilizáveis como SAN (descarta `_`, regex `~` e negativos)."""
    out: list[str] = []
    for c in block.children:
        if isinstance(c, Directive) and c.name == "server_name":
            for n in c.args:
                if n in ("_", "") or n.startswith(("~", "!")):
                    continue
                if n not in out:
                    out.append(n)
    return out


def collect_needs(store: S.ConfigStore) -> dict[str, dict]:
    """Agrega os certificados referenciados por caminho (cert → key + nomes)."""
    needs: dict[str, dict] = {}
    for loc in [*store.servers(), *store.streams()]:
        crt_dirs = [d for d in loc.block.children
                    if isinstance(d, Directive) and d.name == _SSL_CRT and d.args]
        key_dirs = [d for d in loc.block.children
                    if isinstance(d, Directive) and d.name == _SSL_KEY and d.args]
        if not crt_dirs:
            continue
        names = _server_names(loc.block)
        for i, d in enumerate(crt_dirs):
            cert_path = _resolve(d.args[0], store.prefix)
            key_path = (_resolve(key_dirs[i].args[0], store.prefix)
                        if i < len(key_dirs) else cert_path.with_suffix(".key"))
            need = needs.setdefault(str(cert_path),
                                    {"cert": cert_path, "key": key_path, "names": []})
            for n in names:
                if n not in need["names"]:
                    need["names"].append(n)
    return needs


def run(days: int = 825, use_rsa: bool = False) -> int:
    store = S.ConfigStore()
    issued = 0
    for _, need in sorted(collect_needs(store).items()):
        if need["cert"].exists():
            continue  # nunca sobrescreve um certificado existente
        names = need["names"] or ["localhost"]
        certs.issue_self_signed_at(need["cert"], need["key"], names, days=days, use_rsa=use_rsa)
        print(f"certboot: self-signed emitido para {', '.join(names)} -> {need['cert']}", flush=True)
        issued += 1
    if issued == 0:
        print("certboot: nenhum certificado ausente — nada a fazer", flush=True)
    return issued


def main() -> None:
    run(use_rsa="--rsa" in sys.argv)


if __name__ == "__main__":
    main()
