"""Rotas /system: overview, histórico de métricas e stream SSE."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import Integer, func

from .. import appsettings, metrics, nginxctl, sysinfo
from ..auth import identity_from_request, require_token
from ..db import get_session
from ..db.models import Metric
from ..envelope import envelope

router = APIRouter(prefix="/system", tags=["system"])

_RANGE_POINTS = (
    (1, 60),
    (30, 180),
    (60, 240),
    (360, 300),
    (720, 360),
    (1440, 480),
    (10080, 480),
    (21600, 600),
    (43200, 720),
)


def _target_points(minutes: int) -> int:
    for max_minutes, points in _RANGE_POINTS:
        if minutes <= max_minutes:
            return points
    return 720


def _metric_payload(row: Metric) -> dict:
    return {
        "ts": row.ts,
        "cpu": row.cpu_percent,
        "mem": row.mem_percent,
        "disk": row.disk_percent,
        "req_per_s": row.req_per_s,
        "requests_total": row.requests_total,
        "connections": row.connections,
        "uplink_bps": row.uplink_bps,
        "downlink_bps": row.downlink_bps,
        "uplink_total": row.uplink_total,
        "downlink_total": row.downlink_total,
    }


def _overview() -> dict:
    snap = sysinfo.snapshot()
    st = nginxctl.status()
    live = metrics.latest() or {}
    snap["nginx"] = {
        "running": st["running"], "pid": st["pid"],
        "version": st["version"], "config_ok": st["config_ok"],
    }
    snap["live"] = {
        "req_per_s": live.get("req_per_s"),
        "requests_total": live.get("requests_total"),
        "connections": live.get("connections"),
        "uplink_bps": live.get("uplink_bps"),
        "downlink_bps": live.get("downlink_bps"),
        "uplink_total": live.get("uplink_total"),
        "downlink_total": live.get("downlink_total"),
    }
    return snap


@router.get("", dependencies=[Depends(require_token)])
def overview():
    """Snapshot completo (host/cpu/mem/disco/nginx + métricas ao vivo)."""
    return envelope(data=_overview())


@router.get("/metrics", dependencies=[Depends(require_token)])
def history(
    minutes: int = Query(60, ge=1, le=365 * 24 * 60),
    max_points: int | None = Query(None, ge=30, le=1000),
):
    """Histórico de métricas dos últimos `minutes` minutos (para os gráficos)."""
    import time

    since = int(time.time() * 1000) - minutes * 60 * 1000
    target_points = max_points or _target_points(minutes)
    with get_session() as s:
        total = s.query(func.count(Metric.id)).filter(Metric.ts >= since).scalar() or 0
        if total <= target_points:
            rows = (
                s.query(Metric)
                .filter(Metric.ts >= since)
                .order_by(Metric.ts.asc())
                .all()
            )
            data = [_metric_payload(r) for r in rows]
        else:
            bucket_ms = max(1, (minutes * 60 * 1000) // target_points)
            bucket = ((Metric.ts - since) / bucket_ms).cast(Integer).label("bucket")
            rows = (
                s.query(
                    bucket,
                    func.max(Metric.ts).label("ts"),
                    func.avg(Metric.cpu_percent).label("cpu"),
                    func.avg(Metric.mem_percent).label("mem"),
                    func.avg(Metric.disk_percent).label("disk"),
                    func.avg(Metric.req_per_s).label("req_per_s"),
                    func.max(Metric.requests_total).label("requests_total"),
                    func.avg(Metric.connections).label("connections"),
                    func.avg(Metric.uplink_bps).label("uplink_bps"),
                    func.avg(Metric.downlink_bps).label("downlink_bps"),
                    func.max(Metric.uplink_total).label("uplink_total"),
                    func.max(Metric.downlink_total).label("downlink_total"),
                )
                .filter(Metric.ts >= since)
                .group_by(bucket)
                .order_by(bucket.asc())
                .all()
            )
            data = [
                {
                    "ts": r.ts,
                    "cpu": r.cpu,
                    "mem": r.mem,
                    "disk": r.disk,
                    "req_per_s": r.req_per_s,
                    "requests_total": r.requests_total,
                    "connections": r.connections,
                    "uplink_bps": r.uplink_bps,
                    "downlink_bps": r.downlink_bps,
                    "uplink_total": r.uplink_total,
                    "downlink_total": r.downlink_total,
                }
                for r in rows
            ]
    return envelope(data=data)


def _check_token(request: Request) -> None:
    # SSE via EventSource não envia header Authorization; aceitamos ?token=.
    # Aceita tanto o API_TOKEN (master) quanto tokens de sessão de usuários.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")


@router.get("/stream")
async def stream(request: Request):
    """Server-Sent Events: envia o snapshot ao vivo a cada `sse_interval_seconds`."""
    _check_token(request)

    async def event_gen():
        # Primeiro envio imediato (overview completo), depois só métricas ao vivo.
        yield f"event: overview\ndata: {json.dumps(_overview())}\n\n"
        while True:
            if await request.is_disconnected():
                break
            sample = metrics.latest()
            payload = metrics.as_point(sample) if sample else {}
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(max(1.0, appsettings.get_float("sse_interval_seconds")))

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
