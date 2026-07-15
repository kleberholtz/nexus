"""Rota /audit: consulta ao registro de auditoria."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth import require_token
from ..db import get_session
from ..db.models import AuditLog
from ..envelope import envelope

router = APIRouter(prefix="/audit", tags=["audit"], dependencies=[Depends(require_token)])


@router.get("")
def list_audit(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: str | None = Query(None, max_length=120),
    action: str | None = Query(None, max_length=160),
    since: int | None = Query(None, ge=0, description="epoch em milissegundos"),
):
    """Lista entradas de auditoria (mais recentes primeiro), com filtros."""
    with get_session() as s:
        q = s.query(AuditLog)
        if user:
            q = q.filter(AuditLog.user == user)
        if action:
            q = q.filter(AuditLog.action.like(f"{action}%"))
        if since is not None:
            q = q.filter(AuditLog.ts >= since)
        total = q.count()
        rows = q.order_by(AuditLog.ts.desc()).offset(offset).limit(limit).all()
    items = [
        {
            "id": r.id, "ts": r.ts, "user": r.user, "action": r.action,
            "method": r.method, "path": r.path, "status": r.status, "detail": r.detail,
        }
        for r in rows
    ]
    return envelope(data={"items": items, "total": total, "limit": limit, "offset": offset})
