"""Coleta de métricas da máquina/container via stdlib (Linux /proc).

Sem dependências externas: lê /proc/meminfo, /proc/stat, /proc/uptime e usa
os.statvfs/os.getloadavg. Campos indisponíveis retornam None em vez de quebrar.
"""
from __future__ import annotations

import os
import platform
import socket
import time


def _read(path: str) -> str | None:
    try:
        with open(path) as fh:
            return fh.read()
    except OSError:
        return None


def _cpu_times() -> tuple[int, int] | None:
    """Retorna (idle, total) da linha agregada `cpu` de /proc/stat."""
    data = _read("/proc/stat")
    if not data:
        return None
    for line in data.splitlines():
        if line.startswith("cpu "):
            parts = [int(x) for x in line.split()[1:]]
            idle = parts[3] + (parts[4] if len(parts) > 4 else 0)  # idle + iowait
            return idle, sum(parts)
    return None


def cpu() -> dict:
    usage = None
    a = _cpu_times()
    if a:
        time.sleep(0.1)
        b = _cpu_times()
        if b and (b[1] - a[1]) > 0:
            idle_delta = b[0] - a[0]
            total_delta = b[1] - a[1]
            usage = round((1 - idle_delta / total_delta) * 100, 1)
    load = None
    try:
        load = [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        pass
    return {"count": os.cpu_count(), "usage_percent": usage, "load": load}


def memory() -> dict:
    data = _read("/proc/meminfo")
    if not data:
        return {"total": None, "used": None, "free": None,
                "available": None, "percent": None}
    vals = {}
    for line in data.splitlines():
        k, _, rest = line.partition(":")
        vals[k.strip()] = int(rest.strip().split()[0]) * 1024  # kB -> bytes
    total = vals.get("MemTotal")
    available = vals.get("MemAvailable", vals.get("MemFree"))
    used = total - available if (total and available is not None) else None
    percent = round(used / total * 100, 1) if (total and used is not None) else None
    return {"total": total, "used": used, "free": vals.get("MemFree"),
            "available": available, "percent": percent}


def disk(path: str = "/") -> dict:
    try:
        st = os.statvfs(path)
    except OSError:
        return {"path": path, "total": None, "used": None, "free": None, "percent": None}
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    percent = round(used / total * 100, 1) if total else None
    return {"path": path, "total": total, "used": used, "free": free, "percent": percent}


def host() -> dict:
    uptime = None
    data = _read("/proc/uptime")
    if data:
        try:
            uptime = int(float(data.split()[0]))
        except (ValueError, IndexError):
            pass
    os_name = platform.system()
    pretty = _read("/etc/os-release")
    if pretty:
        for line in pretty.splitlines():
            if line.startswith("PRETTY_NAME="):
                os_name = line.split("=", 1)[1].strip().strip('"')
                break
    return {
        "hostname": socket.gethostname(),
        "os": os_name,
        "kernel": platform.release(),
        "uptime_seconds": uptime,
    }


def net_bytes() -> dict | None:
    """Total de bytes rx/tx somando as interfaces (exceto loopback)."""
    data = _read("/proc/net/dev")
    if not data:
        return None
    rx = tx = 0
    for line in data.splitlines()[2:]:
        iface, _, rest = line.partition(":")
        if iface.strip() in ("lo", ""):
            continue
        fields = rest.split()
        if len(fields) >= 9:
            rx += int(fields[0])
            tx += int(fields[8])
    return {"rx": rx, "tx": tx}


def snapshot() -> dict:
    return {"host": host(), "cpu": cpu(), "memory": memory(), "disk": disk()}
