"""Gerenciamento de até 3 Cloudflare Tunnels (`cloudflared tunnel run --token`).

O container não usa systemd; quando um tunnel está ativo, a API garante o
binário instalado e mantém um processo `cloudflared` em background por slot.
No boot do container/API chamamos `apply_from_settings()` para persistir o
estado salvo no banco.
"""
from __future__ import annotations

import os
import platform
import signal
import subprocess
import urllib.request
from pathlib import Path
from typing import Iterable

from . import appsettings

MAX_TUNNELS = 3
BIN = Path(os.environ.get("CLOUDFLARED_BIN", "/usr/local/bin/cloudflared"))
PID_DIR = Path(os.environ.get("CLOUDFLARED_PID_DIR", "/var/run"))
LOG_DIR = Path(os.environ.get("CLOUDFLARED_LOG_DIR", "/var/log/nexus"))


def _check_index(index: int) -> int:
    if index < 1 or index > MAX_TUNNELS:
        raise ValueError(f"tunnel inválido: {index}")
    return index


def _pid_path(index: int) -> Path:
    _check_index(index)
    return PID_DIR / f"cloudflared-{index}.pid"


def _log_path(index: int) -> Path:
    _check_index(index)
    return LOG_DIR / f"cloudflared-{index}.log"


def _arch() -> str:
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "amd64"
    if machine in ("aarch64", "arm64"):
        return "arm64"
    raise RuntimeError(f"arquitetura não suportada para cloudflared: {machine}")


def _download_url() -> str:
    return f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{_arch()}"


def ensure_installed() -> dict:
    """Instala o binário cloudflared se não existir."""
    if BIN.exists() and os.access(BIN, os.X_OK):
        return {"installed": True, "path": str(BIN), "changed": False}
    BIN.parent.mkdir(parents=True, exist_ok=True)
    tmp = BIN.with_suffix(".tmp")
    with urllib.request.urlopen(_download_url(), timeout=120) as resp:
        tmp.write_bytes(resp.read())
    tmp.chmod(0o755)
    tmp.replace(BIN)
    return {"installed": True, "path": str(BIN), "changed": True}


def _pid(index: int) -> int | None:
    pid_file = _pid_path(index)
    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return None
    try:
        os.kill(pid, 0)
        return pid
    except OSError:
        pid_file.unlink(missing_ok=True)
        return None


def _slot_key(index: int, suffix: str) -> str:
    return f"cloudflare_tunnel_{index}_{suffix}"


def _enabled(index: int) -> bool:
    if index == 1:
        return (
            appsettings.get_bool("cloudflare_tunnel_1_enabled")
            or appsettings.get_bool("cloudflare_tunnel_enabled")
        )
    return appsettings.get_bool(_slot_key(index, "enabled"))


def _token(index: int) -> str:
    token = appsettings.get_str(_slot_key(index, "token")).strip()
    if index == 1 and not token:
        token = appsettings.get_str("cloudflare_tunnel_token").strip()
    return token


def config(index: int) -> dict:
    _check_index(index)
    return {
        "index": index,
        "enabled": _enabled(index),
        "has_token": bool(_token(index)),
    }


def status(index: int | None = None) -> dict:
    if index is None:
        return {
            "installed": BIN.exists() and os.access(BIN, os.X_OK),
            "path": str(BIN),
            "tunnels": [status(i) for i in range(1, MAX_TUNNELS + 1)],
        }
    pid = _pid(index)
    return {
        **config(index),
        "installed": BIN.exists() and os.access(BIN, os.X_OK),
        "running": pid is not None,
        "pid": pid,
        "path": str(BIN),
        "log": str(_log_path(index)),
    }


def stop(index: int) -> dict:
    pid = _pid(index)
    if pid is None:
        return {"stopped": False, **status(index)}
    os.kill(pid, signal.SIGTERM)
    _pid_path(index).unlink(missing_ok=True)
    return {"stopped": True, **status(index)}


def start(index: int, token: str | None = None) -> dict:
    _check_index(index)
    token = (token if token is not None else _token(index)).strip()
    if not token:
        raise RuntimeError(f"cloudflare_tunnel_{index}_token não configurado")
    running = _pid(index)
    if running is not None:
        return {"started": False, **status(index)}
    install = ensure_installed()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logf = open(_log_path(index), "ab", buffering=0)
    proc = subprocess.Popen(
        [str(BIN), "tunnel", "--no-autoupdate", "run", "--token", token],
        stdout=logf,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    PID_DIR.mkdir(parents=True, exist_ok=True)
    _pid_path(index).write_text(str(proc.pid))
    return {"started": True, "install": install, **status(index)}


def apply_from_settings(restart_indexes: Iterable[int] | None = None) -> dict:
    restart = set(restart_indexes or [])
    results = []
    for index in range(1, MAX_TUNNELS + 1):
        if _enabled(index):
            if index in restart:
                stop(index)
            results.append(start(index))
        else:
            results.append(stop(index))
    return {"tunnels": results}


def read_log(index: int, max_bytes: int = 80_000) -> dict:
    path = _log_path(index)
    if not path.exists():
        return {"index": index, "path": str(path), "content": "", "exists": False}
    size = path.stat().st_size
    with path.open("rb") as fh:
        if size > max_bytes:
            fh.seek(size - max_bytes)
        data = fh.read()
    return {
        "index": index,
        "path": str(path),
        "content": data.decode("utf-8", errors="replace"),
        "exists": True,
        "truncated": size > max_bytes,
        "size": size,
    }


def main() -> None:
    from .db import ensure_db

    ensure_db()
    print(apply_from_settings(), flush=True)


if __name__ == "__main__":
    main()
