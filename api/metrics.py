"""Coletor de métricas: amostra periódica gravada no banco + estado em memória.

Coleta CPU/memória/disco (sysinfo), conexões/req_s (stub_status do nginx) e
uplink/downlink (/proc/net/dev, via deltas). Roda numa thread daemon com cadência
igual a `sse_interval_seconds`. Aplica a retenção (`metrics_retention_days`).
"""
from __future__ import annotations

import os
import re
import threading
import time
import urllib.request

from . import appsettings, nginxctl, sysinfo
from .db import get_session
from .db.models import Metric

STATUS_URL = os.environ.get("NGINX_STATUS_URL", "http://127.0.0.1:8090/stub_status")

_lock = threading.Lock()
_prev: dict | None = None       # amostra anterior p/ deltas (ts, requests, rx, tx)
_latest: dict | None = None     # último sample calculado (para SSE / overview)
_thread: threading.Thread | None = None
_stop = threading.Event()


def _fetch_stub() -> dict | None:
    """Lê o stub_status do nginx: {active, requests}."""
    try:
        with urllib.request.urlopen(STATUS_URL, timeout=2) as resp:
            text = resp.read().decode("utf-8", "replace")
    except Exception:
        return None
    active = re.search(r"Active connections:\s+(\d+)", text)
    counts = re.search(r"^\s*(\d+)\s+(\d+)\s+(\d+)", text, re.MULTILINE)
    return {
        "active": int(active.group(1)) if active else None,
        "requests": int(counts.group(3)) if counts else None,
    }


def sample() -> dict:
    """Calcula uma amostra completa (usa deltas contra a amostra anterior)."""
    global _prev
    now_ms = int(time.time() * 1000)
    snap = sysinfo.snapshot()
    stub = _fetch_stub()
    net = sysinfo.net_bytes()
    running = nginxctl.running()

    req_per_s = connections = uplink = downlink = None
    if stub:
        connections = stub.get("active")
    if _prev is not None:
        dt = (now_ms - _prev["ts"]) / 1000.0
        if dt > 0:
            if stub and stub.get("requests") is not None and _prev.get("requests") is not None:
                req_per_s = max(0.0, round((stub["requests"] - _prev["requests"]) / dt, 2))
            if net and _prev.get("rx") is not None:
                downlink = max(0.0, round((net["rx"] - _prev["rx"]) / dt, 2))
                uplink = max(0.0, round((net["tx"] - _prev["tx"]) / dt, 2))

    _prev = {
        "ts": now_ms,
        "requests": stub.get("requests") if stub else None,
        "rx": net["rx"] if net else None,
        "tx": net["tx"] if net else None,
    }

    return {
        "ts": now_ms,
        "cpu_percent": snap["cpu"]["usage_percent"],
        "mem_percent": snap["memory"]["percent"],
        "mem_used": snap["memory"]["used"],
        "mem_total": snap["memory"]["total"],
        "disk_percent": snap["disk"]["percent"],
        "disk_used": snap["disk"]["used"],
        "disk_total": snap["disk"]["total"],
        "req_per_s": req_per_s,
        "requests_total": stub.get("requests") if stub else None,
        "connections": connections,
        "uplink_bps": uplink,
        "downlink_bps": downlink,
        "uplink_total": net["tx"] if net else None,
        "downlink_total": net["rx"] if net else None,
        "nginx_running": running,
    }


def _store(s: dict) -> None:
    retention_days = appsettings.get_int("metrics_retention_days")
    cutoff = int(time.time() * 1000) - retention_days * 86400 * 1000
    with get_session() as session:
        session.add(Metric(**s))
        session.query(Metric).filter(Metric.ts < cutoff).delete(synchronize_session=False)
        session.commit()


def _loop() -> None:
    while not _stop.is_set():
        try:
            s = sample()
            with _lock:
                globals()["_latest"] = s
            _store(s)
        except Exception as exc:  # noqa: BLE001 - coletor nunca deve morrer
            print(f"metrics: erro na coleta ({exc})", flush=True)
        interval = max(1.0, appsettings.get_float("sse_interval_seconds"))
        _stop.wait(interval)


def start_collector() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="metrics-collector", daemon=True)
    _thread.start()


def latest() -> dict | None:
    with _lock:
        return dict(_latest) if _latest else None


def as_point(s: dict) -> dict:
    """Normaliza uma amostra para o mesmo shape do histórico (chaves curtas)."""
    return {
        "ts": s.get("ts"),
        "cpu": s.get("cpu_percent"),
        "mem": s.get("mem_percent"),
        "disk": s.get("disk_percent"),
        "req_per_s": s.get("req_per_s"),
        "requests_total": s.get("requests_total"),
        "connections": s.get("connections"),
        "uplink_bps": s.get("uplink_bps"),
        "downlink_bps": s.get("downlink_bps"),
        "uplink_total": s.get("uplink_total"),
        "downlink_total": s.get("downlink_total"),
    }
