"""Tuning do nginx conforme os recursos efetivos da máquina.

Detecta CPUs, file descriptors e memória *efetivos* (respeitando cpuset/cgroup
em container) e calcula `worker_processes`, `worker_rlimit_nofile` e
`worker_connections`. Grava dois includes que o `nginx.conf` carrega:

  - <prefix>/generated/tuning.conf         → contexto main  (worker_processes, worker_rlimit_nofile)
  - <prefix>/generated/events-tuning.conf  → contexto events (worker_connections)

Usado de duas formas:
  * no **entrypoint** (`python3 -m api.tune`), antes de subir o nginx;
  * pela **API** (`GET/POST /nginx/tune`) — ver `api/routers/nginx.py`.

Só depende de stdlib (nada de fastapi/sqlalchemy) para rodar leve no boot.
"""
from __future__ import annotations

import math
import os
import re
import resource
import sys
from pathlib import Path

NGINX_PREFIX = Path(os.environ.get("NGINX_PREFIX", "/etc/nginx"))

# Cada conexão consome ~2 fds (socket do cliente + possível socket do upstream).
FDS_PER_CONN = 2
# fds reservados para listening sockets, logs, mmaps de cache, etc.
RESERVED_FDS = 128
# Estimativa de memória por conexão ativa (buffers de leitura/escrita).
BYTES_PER_CONN = 32 * 1024
# Limites de sanidade para worker_connections.
MIN_CONNECTIONS = 1024
MAX_CONNECTIONS = 65535


def default_mem_fraction() -> float:
    try:
        return float(os.environ.get("NGINX_TUNE_MEM_FRACTION", "0.5") or "0.5")
    except ValueError:
        return 0.5


def detect_cpus() -> int:
    """CPUs efetivamente disponíveis (cpuset → quota cgroup v2/v1 → total)."""
    try:
        affinity = len(os.sched_getaffinity(0))
    except (AttributeError, OSError):
        affinity = os.cpu_count() or 1
    quota_cpus = affinity
    cpu_max = Path("/sys/fs/cgroup/cpu.max")
    if cpu_max.exists():
        try:
            quota_s, period_s = cpu_max.read_text().split()[:2]
            if quota_s != "max":
                quota_cpus = max(1, math.ceil(int(quota_s) / int(period_s)))
        except (ValueError, ZeroDivisionError):
            pass
    else:
        try:
            quota = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text())
            period = int(Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text())
            if quota > 0 and period > 0:
                quota_cpus = max(1, math.ceil(quota / period))
        except (OSError, ValueError, ZeroDivisionError):
            pass
    return max(1, min(affinity, quota_cpus))


def detect_memory_bytes() -> int:
    """Memória efetiva disponível (cgroup v2/v1) ou total do host."""
    mem_max = Path("/sys/fs/cgroup/memory.max")
    if mem_max.exists():
        raw = mem_max.read_text().strip()
        if raw != "max":
            try:
                return int(raw)
            except ValueError:
                pass
    try:
        val = int(Path("/sys/fs/cgroup/memory/memory.limit_in_bytes").read_text())
        if 0 < val < (1 << 62):
            return val
    except (OSError, ValueError):
        pass
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return 1 << 30  # 1 GiB como último recurso


def detect_nofile() -> tuple[int, int]:
    """Limite de file descriptors (soft, hard) do processo."""
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if hard == resource.RLIM_INFINITY:
        hard = 1 << 20
    if soft == resource.RLIM_INFINITY:
        soft = hard
    return soft, hard


def detect() -> dict:
    soft, hard = detect_nofile()
    return {
        "cpus": detect_cpus(),
        "mem_bytes": detect_memory_bytes(),
        "soft_nofile": soft,
        "hard_nofile": hard,
    }


def compute(mem_fraction: float | None = None) -> dict:
    frac = default_mem_fraction() if mem_fraction is None else float(mem_fraction)
    info = detect()
    cpus, mem, hard = info["cpus"], info["mem_bytes"], info["hard_nofile"]
    workers = cpus

    usable_fds = max(hard - RESERVED_FDS, MIN_CONNECTIONS * FDS_PER_CONN)
    conn_by_fd = (usable_fds // workers) // FDS_PER_CONN
    mem_budget = int(mem * frac)
    conn_by_mem = (mem_budget // workers) // BYTES_PER_CONN
    worker_connections = max(MIN_CONNECTIONS, min(conn_by_fd, conn_by_mem, MAX_CONNECTIONS))

    worker_rlimit_nofile = min(hard, worker_connections * FDS_PER_CONN + RESERVED_FDS)
    worker_rlimit_nofile = max(worker_rlimit_nofile, worker_connections)

    return {
        **info,
        "mem_fraction": frac,
        "worker_processes": workers,
        "worker_rlimit_nofile": worker_rlimit_nofile,
        "worker_connections": worker_connections,
    }


# Os includes gerados vivem em <prefix>/generated/ — um diretório que, no deploy
# de 3 containers, é um volume compartilhado entre a API (que gera) e o nginx
# (que inclui). No single-container é só uma subpasta comum.
def _gen_dir(prefix: Path) -> Path:
    return prefix / "generated"


def _paths(prefix: Path) -> tuple[Path, Path]:
    gen = _gen_dir(prefix)
    return gen / "tuning.conf", gen / "events-tuning.conf"


_HEADER = "# Gerado automaticamente por api/tune.py — NÃO editar à mão.\n"


def write_includes(vals: dict, prefix: Path = NGINX_PREFIX) -> tuple[Path, Path]:
    _gen_dir(prefix).mkdir(parents=True, exist_ok=True)
    main_path, events_path = _paths(prefix)
    main_path.write_text(
        _HEADER
        + f"worker_processes {int(vals['worker_processes'])};\n"
        + f"worker_rlimit_nofile {int(vals['worker_rlimit_nofile'])};\n"
    )
    events_path.write_text(
        _HEADER + f"    worker_connections {int(vals['worker_connections'])};\n"
    )
    return main_path, events_path


_NUM = {
    "worker_processes": re.compile(r"worker_processes\s+(\d+)"),
    "worker_rlimit_nofile": re.compile(r"worker_rlimit_nofile\s+(\d+)"),
    "worker_connections": re.compile(r"worker_connections\s+(\d+)"),
}


def read_current(prefix: Path = NGINX_PREFIX) -> dict:
    """Lê os valores atualmente gravados nos includes (ou None se ausentes)."""
    main_path, events_path = _paths(prefix)
    text = ""
    for p in (main_path, events_path):
        try:
            text += p.read_text()
        except OSError:
            pass
    out: dict = {}
    for key, rx in _NUM.items():
        m = rx.search(text)
        out[key] = int(m.group(1)) if m else None
    return out


def main() -> None:
    frac = default_mem_fraction()
    vals = compute(frac)
    print(
        "tune: cpus={cpus} mem={mem}MiB hard_nofile={hard} -> "
        "worker_processes={wp} worker_rlimit_nofile={wr} worker_connections={wc}".format(
            cpus=vals["cpus"], mem=vals["mem_bytes"] // (1024 * 1024),
            hard=vals["hard_nofile"], wp=vals["worker_processes"],
            wr=vals["worker_rlimit_nofile"], wc=vals["worker_connections"]),
        file=sys.stderr,
    )
    if "--print-only" in sys.argv:
        return
    main_path, events_path = write_includes(vals)
    print(f"tune: gravado {main_path} e {events_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
