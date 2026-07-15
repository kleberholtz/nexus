"""Catálogo reutilizável de tags para monitores e heartbeats."""
from __future__ import annotations

import re
import time

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError

from .db import get_session
from .db.models import MonitorTag, MonitorTagLink

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class MonitorTagError(ValueError):
    def __init__(self, detail: str, status: int = 400):
        super().__init__(detail)
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json(row: MonitorTag, usage_count: int = 0) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "value": row.value,
        "color": row.color,
        "usage_count": usage_count,
        "created_ts": row.created_ts,
        "updated_ts": row.updated_ts,
    }


def _fields(payload: dict, previous: MonitorTag | None = None) -> tuple[str, str, str]:
    name = str(payload.get("name", previous.name if previous else "")).strip()
    value = str(payload.get("value", previous.value if previous else "")).strip()
    color = str(payload.get("color", previous.color if previous else "#64748b")).strip().lower()
    if not name:
        raise MonitorTagError("nome da tag é obrigatório")
    if len(name) > 120:
        raise MonitorTagError("nome da tag deve ter no máximo 120 caracteres")
    if len(value) > 200:
        raise MonitorTagError("valor da tag deve ter no máximo 200 caracteres")
    if not _HEX_COLOR.fullmatch(color):
        raise MonitorTagError("cor inválida; use o formato hexadecimal #RRGGBB")
    return name, value, color


def list_tags(*, search: str = "", page=None, limit: int = 50):
    with get_session() as s:
        q = s.query(MonitorTag)
        term = search.strip()
        if term:
            like = f"%{term}%"
            q = q.filter(or_(MonitorTag.name.ilike(like), MonitorTag.value.ilike(like)))
        total = q.count()
        pages = max(1, (total + max(1, min(limit, 50)) - 1) // max(1, min(limit, 50)))
        q = q.order_by(func.lower(MonitorTag.name), func.lower(MonitorTag.value), MonitorTag.id)
        if page is not None:
            page = max(1, min(int(page), pages))
            limit = max(1, min(int(limit), 50))
            q = q.offset((page - 1) * limit).limit(limit)
        rows = q.all()
        ids = [row.id for row in rows]
        counts = dict(s.query(MonitorTagLink.tag_id, func.count(MonitorTagLink.monitor_id))
                      .filter(MonitorTagLink.tag_id.in_(ids))
                      .group_by(MonitorTagLink.tag_id).all()) if ids else {}
        items = [_json(row, int(counts.get(row.id, 0))) for row in rows]
        if page is None:
            return items
        return {"items": items, "total": total, "pages": pages, "page": page}


def create_tag(payload: dict) -> dict:
    name, value, color = _fields(payload)
    now = _now_ms()
    with get_session() as s:
        duplicate = (s.query(MonitorTag)
                     .filter(func.lower(MonitorTag.name) == name.lower(),
                             func.lower(MonitorTag.value) == value.lower())
                     .first())
        if duplicate:
            raise MonitorTagError("já existe uma tag com este nome e valor", status=409)
        row = MonitorTag(name=name, value=value, color=color, created_ts=now, updated_ts=now)
        s.add(row)
        try:
            s.commit()
        except IntegrityError as exc:
            s.rollback()
            raise MonitorTagError("já existe uma tag com este nome e valor", status=409) from exc
        s.refresh(row)
        return _json(row)


def update_tag(tag_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(MonitorTag, tag_id)
        if row is None:
            raise MonitorTagError("tag não encontrada", status=404)
        name, value, color = _fields(payload, row)
        duplicate = (s.query(MonitorTag)
                     .filter(func.lower(MonitorTag.name) == name.lower(),
                             func.lower(MonitorTag.value) == value.lower(),
                             MonitorTag.id != tag_id)
                     .first())
        if duplicate:
            raise MonitorTagError("já existe uma tag com este nome e valor", status=409)
        row.name, row.value, row.color = name, value, color
        row.updated_ts = _now_ms()
        try:
            s.commit()
        except IntegrityError as exc:
            s.rollback()
            raise MonitorTagError("já existe uma tag com este nome e valor", status=409) from exc
        s.refresh(row)
        usage = s.query(MonitorTagLink).filter(MonitorTagLink.tag_id == tag_id).count()
        return _json(row, usage)


def delete_tag(tag_id: int) -> None:
    with get_session() as s:
        row = s.get(MonitorTag, tag_id)
        if row is None:
            raise MonitorTagError("tag não encontrada", status=404)
        s.query(MonitorTagLink).filter(MonitorTagLink.tag_id == tag_id).delete(
            synchronize_session=False)
        s.delete(row)
        s.commit()
