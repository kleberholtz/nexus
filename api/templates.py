"""Catálogo de templates (templates.json) — busca/paginação no backend.

A lista é grande (~400 itens) e NÃO deve ser carregada inteira no front. Aqui
carregamos o JSON (cache por mtime), filtramos por `search` (substring em
name/description) e por `tags`, e paginamos (limite ≤ 50).

Caminho via env TEMPLATES_FILE (default /opt/templates.json, onde o Dockerfile
copia o arquivo).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

TEMPLATES_FILE = os.environ.get("TEMPLATES_FILE", "/opt/templates.json")
MAX_LIMIT = 50

_cache: tuple[float, list[dict]] | None = None


def _load() -> list[dict]:
    """Carrega templates.json, cacheando por mtime do arquivo."""
    global _cache
    path = Path(TEMPLATES_FILE)
    if not path.exists():
        return []
    mtime = path.stat().st_mtime
    if _cache and _cache[0] == mtime:
        return _cache[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    items = [t for t in data if isinstance(t, dict)] if isinstance(data, list) else []
    _cache = (mtime, items)
    return items


def all_tags() -> list[str]:
    """Lista distinta e ordenada de tags (para o filtro do front)."""
    tags: set[str] = set()
    for t in _load():
        for tag in t.get("tags") or []:
            if isinstance(tag, str):
                tags.add(tag)
    return sorted(tags)


def search(query: str = "", tags: list[str] | None = None,
           limit: int = MAX_LIMIT, offset: int = 0) -> dict:
    """Filtra por texto (name/description) e tags; devolve {items, total}."""
    query = (query or "").strip().lower()
    want = {t.strip().lower() for t in (tags or []) if t.strip()}
    limit = max(1, min(int(limit or MAX_LIMIT), MAX_LIMIT))
    offset = max(0, int(offset or 0))

    matched = []
    for t in _load():
        if query:
            hay = f"{t.get('name', '')} {t.get('description', '')}".lower()
            if query not in hay:
                continue
        if want:
            have = {str(x).lower() for x in (t.get("tags") or [])}
            if not want.issubset(have):
                continue
        matched.append(t)

    total = len(matched)
    return {"items": matched[offset:offset + limit], "total": total,
            "limit": limit, "offset": offset}
