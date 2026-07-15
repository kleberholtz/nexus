"""Gerenciador de arquivos das aplicações SPA (grupo CI/CD).

Opera **dentro** do diretório da app estática (`/var/www/apps/<slug>`,
`projects.app_static_dir`) — listar, criar pasta, upload (arquivo/pasta),
mover, copiar e apagar. Toda operação é confinada à raiz da app: os caminhos
recebidos são resolvidos e barrados se escaparem (`..`, symlink que sai da
árvore, path absoluto). Só serve aplicações estáticas (`projects.is_static_app`).

As funções levantam `FileError` (o router mapeia p/ 4xx) e recebem/devolvem
caminhos **relativos** à raiz (o cliente nunca vê o caminho absoluto do host).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

from . import projects as P
from .db import get_session
from .db.models import ProjectService


class FileError(Exception):
    """Erro de operação de arquivo (vira 4xx no router)."""


def app_root(project_id: int, service_id: int) -> Path:
    """Raiz do gerenciador para um serviço (valida que é aplicação estática)."""
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if not P.is_static_app(row):
            raise FileError("gerenciador de arquivos disponível só para aplicações estáticas (SPA)")
        root = P.app_static_dir(row)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_join(root: Path, rel: str) -> Path:
    """Resolve `rel` sob `root` barrando qualquer escape (`..`, absoluto, symlink)."""
    root = root.resolve()
    rel = (rel or "").replace("\\", "/").lstrip("/")
    candidate = (root / rel).resolve()
    if candidate != root and root not in candidate.parents:
        raise FileError("caminho fora do diretório da aplicação")
    return candidate


def _clean_name(name: str) -> str:
    name = (name or "").strip().strip("/")
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\0" in name:
        raise FileError("nome inválido")
    return name


def _rel(root: Path, p: Path) -> str:
    return "" if p == root else str(p.relative_to(root))


def _entry(root: Path, p: Path) -> dict:
    st = p.lstat()
    is_link = p.is_symlink()
    is_dir = p.is_dir() and not is_link
    return {
        "name": p.name,
        "path": _rel(root, p),
        "type": "dir" if is_dir else ("symlink" if is_link else "file"),
        "size": 0 if is_dir else st.st_size,
        "mtime": int(st.st_mtime * 1000),
        "ext": "" if is_dir else p.suffix.lower().lstrip("."),
    }


def list_dir(root: Path, rel: str) -> dict:
    """Lista uma pasta (dirs primeiro, ordem alfabética case-insensitive)."""
    base = _safe_join(root, rel)
    if not base.exists():
        raise FileError("caminho não encontrado")
    if not base.is_dir():
        raise FileError("não é um diretório")
    entries = [
        _entry(root, p)
        for p in sorted(base.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    ]
    return {"path": _rel(root, base), "entries": entries}


def make_dir(root: Path, rel: str, name: str) -> dict:
    target = _safe_join(root, os.path.join(rel or "", _clean_name(name)))
    if target.exists():
        raise FileError("já existe um item com esse nome")
    target.mkdir(parents=True, exist_ok=False)
    return _entry(root, target)


def save_upload(root: Path, rel: str, filename: str, fileobj, max_bytes: int = 0) -> dict:
    """Grava um upload. `filename` pode conter subpastas (upload de pasta via
    `webkitRelativePath`); os diretórios intermediários são criados. `max_bytes`
    (0 = sem limite) corta e apaga o arquivo se o conteúdo exceder o limite."""
    filename = (filename or "").replace("\\", "/").strip("/")
    if not filename or any(part in ("", "..", ".") for part in filename.split("/")):
        raise FileError("nome de arquivo inválido")
    target = _safe_join(root, os.path.join(rel or "", filename))
    target.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with open(target, "wb") as out:
            while True:
                chunk = fileobj.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if max_bytes and total > max_bytes:
                    raise FileError(f"arquivo excede o limite de {max_bytes // (1024 * 1024)}MB")
                out.write(chunk)
    except FileError:
        target.unlink(missing_ok=True)
        raise
    return _entry(root, target)


def _resolve_dest(root: Path, src: Path, dst: str) -> Path:
    """Destino de move/copy. Se `dst` for uma pasta existente, entra nela
    mantendo o nome; senão é o caminho novo completo (permite renomear)."""
    d = _safe_join(root, dst)
    if d.is_dir() and not d.is_symlink():
        d = d / src.name
    if d == src or str(d).startswith(str(src) + os.sep):
        raise FileError("destino inválido (dentro da própria origem)")
    if d.exists():
        raise FileError("já existe um item com esse nome no destino")
    d.parent.mkdir(parents=True, exist_ok=True)
    return d


def move(root: Path, src: str, dst: str) -> dict:
    s = _safe_join(root, src)
    if s == root:
        raise FileError("não é possível mover a raiz")
    if not s.exists() and not s.is_symlink():
        raise FileError("origem não encontrada")
    d = _resolve_dest(root, s, dst)
    shutil.move(str(s), str(d))
    return _entry(root, d)


def copy(root: Path, src: str, dst: str) -> dict:
    s = _safe_join(root, src)
    if s == root:
        raise FileError("não é possível copiar a raiz")
    if not s.exists() and not s.is_symlink():
        raise FileError("origem não encontrada")
    d = _resolve_dest(root, s, dst)
    if s.is_dir() and not s.is_symlink():
        shutil.copytree(s, d, symlinks=True)
    else:
        shutil.copy2(s, d, follow_symlinks=False)
    return _entry(root, d)


def delete(root: Path, rel: str) -> None:
    p = _safe_join(root, rel)
    if p == root:
        raise FileError("não é possível apagar a raiz")
    if not p.exists() and not p.is_symlink():
        raise FileError("item não encontrado")
    if p.is_dir() and not p.is_symlink():
        shutil.rmtree(p)
    else:
        p.unlink()
