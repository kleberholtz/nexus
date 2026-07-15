"""Wrappers de controle do nginx (test/reload/restart/start/stop/reopen).

Dois modos, escolhidos por ambiente:

* **local** (padrão) — o nginx roda no MESMO container/host: controla por
  `subprocess` + sinais, descobrindo o master pelo pidfile e, como fallback,
  varrendo /proc (o pidfile pode estar defasado logo após um restart).
* **docker** — quando `NGINX_CONTAINER` está definido, o nginx roda em OUTRO
  container (deploy de 3 containers: nginx/api/web) e a API o controla pela
  Docker Engine API (o socket que a API já monta): `nginx -t/-s reload/-s
  reopen/-T/-v` via `docker exec` e start/stop/restart pelo ciclo de vida do
  container. Reusa `api/dockerclient.py`.

O restante do código (config/store, logrotate, metrics, routers) chama só as
funções públicas daqui — o modo é transparente para eles.
"""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path

NGINX_BIN = os.environ.get("NGINX_BIN", "nginx")
PID_PATH = Path(os.environ.get("NGINX_PID", "/run/nginx.pid"))
# Nome/ID do container do nginx. Definido => modo "docker" (containers separados).
NGINX_CONTAINER = os.environ.get("NGINX_CONTAINER", "").strip()


def _docker_mode() -> bool:
    return bool(NGINX_CONTAINER)


# --------------------------------------------------------------------------- #
# Execução de comandos do nginx (transparente entre local e docker)
# --------------------------------------------------------------------------- #
def _run(args: list[str]) -> tuple[int, str]:
    """Roda `nginx <args>` e devolve (returncode, saída combinada).

    Em modo docker isso vira um `docker exec` no container do nginx; em modo
    local, um `subprocess` do binário. Mantém a mesma assinatura usada por
    logrotate (`-s reopen`) e pelos wrappers abaixo.
    """
    if _docker_mode():
        from . import dockerclient

        try:
            code, out = dockerclient.exec_run(NGINX_CONTAINER, [NGINX_BIN, *args])
        except Exception as exc:  # socket ausente/container fora do ar
            return 1, f"docker exec falhou: {exc}"
        return code, out.decode("utf-8", "replace").strip()
    proc = subprocess.run([NGINX_BIN, *args], capture_output=True, text=True)
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def version() -> dict:
    code, out = _run(["-v"])
    m = re.search(r"nginx/(\S+)", out)
    return {"version": m.group(1) if m else None, "raw": out, "ok": code == 0}


def test() -> dict:
    code, out = _run(["-t"])
    return {"ok": code == 0, "output": out}


# --------------------------------------------------------------------------- #
# Descoberta do processo master (modo local: pidfile + varredura de /proc)
# --------------------------------------------------------------------------- #
def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _pid_from_file() -> int | None:
    try:
        return int(PID_PATH.read_text().strip())
    except (OSError, ValueError):
        return None


def _scan_master() -> int | None:
    """Procura o master do nginx varrendo /proc (nginx reescreve o título do
    processo para 'nginx: master process ...')."""
    proc_dir = Path("/proc")
    if not proc_dir.exists():
        return None
    for entry in proc_dir.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ")
        except OSError:
            continue
        if b"nginx: master" in cmdline:
            return int(entry.name)
    return None


def master_pid() -> int | None:
    """Pid do master vivo: pidfile se válido, senão varredura de /proc.

    Só faz sentido no modo local (mesmo namespace de processos). No modo docker
    o "estar rodando" vem do estado do container (`running`) — ver `status()`.
    """
    pid = _pid_from_file()
    if _alive(pid):
        return pid
    return _scan_master()


def running() -> bool:
    """True se o nginx está no ar, nos dois modos.

    Leve (sem `nginx -t`): modo docker olha o estado do container; modo local usa
    o pidfile/varredura de /proc. Usada pelo coletor de métricas a cada amostra —
    por isso NÃO faz exec/subprocess de validação.
    """
    if _docker_mode():
        from . import dockerclient

        try:
            return dockerclient.container_state(NGINX_CONTAINER) == "running"
        except Exception:
            return False
    return master_pid() is not None


# compat: nome interno usado por este módulo
_running = running


def _wait(predicate, timeout: float = 8.0, interval: float = 0.2) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


# --------------------------------------------------------------------------- #
# Ações
# --------------------------------------------------------------------------- #
def status() -> dict:
    running = _running()
    pid = master_pid() if not _docker_mode() else None
    return {
        "running": running,
        "pid": pid,
        "config_ok": test()["ok"] if running else False,
        "version": version()["version"],
    }


def reload() -> dict:
    if not _running():
        return {"ok": False, "output": "nginx não está rodando"}
    code, out = _run(["-s", "reload"])
    return {"ok": code == 0, "output": out or "reload sinalizado"}


def start() -> dict:
    if _running():
        return {"ok": True, "output": "nginx já está rodando"}
    if _docker_mode():
        from . import dockerclient

        cfg = test()
        # Container parado não permite exec p/ `nginx -t`; se test falhou por
        # isso, seguimos e deixamos o próprio start do container validar.
        try:
            dockerclient.start_container(NGINX_CONTAINER)
        except Exception as exc:
            return {"ok": False, "output": f"falha ao iniciar container: {exc}"}
        started = _wait(_running)
        return {"ok": started, "output": "nginx iniciado" if started else "nginx não subiu"}
    cfg = test()
    if not cfg["ok"]:
        return {"ok": False, "output": f"config inválida: {cfg['output']}"}
    # Sobe em modo daemon (o master escreve o pidfile e destaca-se).
    code, out = _run([])
    started = _wait(_running)
    if not started:
        return {"ok": False, "output": out or "nginx não subiu (master não encontrado)"}
    return {"ok": code == 0, "output": out or "nginx iniciado"}


def stop() -> dict:
    if not _running():
        return {"ok": True, "output": "nginx já está parado"}
    if _docker_mode():
        from . import dockerclient

        try:
            dockerclient.stop_container(NGINX_CONTAINER)
        except Exception as exc:
            return {"ok": False, "output": f"falha ao parar container: {exc}"}
        stopped = _wait(lambda: not _running())
        return {"ok": stopped, "output": "nginx parado" if stopped else "falha ao parar"}
    pid = master_pid()
    code, out = _run(["-s", "stop"])
    if code != 0 and pid:
        # fallback: TERM direto no master
        try:
            os.kill(pid, 15)
        except OSError:
            pass
    stopped = _wait(lambda: not _running())
    return {"ok": stopped, "output": out or ("nginx parado" if stopped else "falha ao parar")}


def restart() -> dict:
    """Reinicia o nginx.

    Modo docker: `docker restart` (atômico, o Docker cuida do ciclo). Modo
    local: para (aguardando o master sumir) e sobe de novo (aguardando o novo
    master aparecer), evitando a corrida quit/start que 'perdia' o pid.
    """
    if _docker_mode():
        from . import dockerclient

        try:
            dockerclient.restart_container(NGINX_CONTAINER)
        except Exception as exc:
            return {"ok": False, "output": f"falha ao reiniciar container: {exc}"}
        up = _wait(_running)
        return {"ok": up, "output": "nginx reiniciado" if up else "nginx não voltou"}
    if master_pid() is not None:
        s = stop()
        if not s["ok"]:
            return {"ok": False, "output": f"falha ao parar: {s['output']}"}
    st = start()
    return {"ok": st["ok"], "output": st["output"] if st["ok"] else f"falha ao iniciar: {st['output']}"}


def configuration() -> dict:
    """Dump completo da config efetiva (nginx -T)."""
    code, out = _run(["-T"])
    return {"ok": code == 0, "config": out}
