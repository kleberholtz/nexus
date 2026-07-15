"""Cliente mínimo da Docker Engine API sobre o unix socket (stdlib puro, sem
docker-py nem CLI). Usado só para `docker build` (fase atual não roda
container). Ao contrário do http.client comum, a Docker Engine API vive num
unix socket (`/var/run/docker.sock`), então precisamos de uma HTTPConnection
que conecte via AF_UNIX em vez de host:porta.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
from collections.abc import Callable
from urllib.parse import quote, urlencode

SOCKET_PATH = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")
API_VERSION = os.environ.get("DOCKER_API_VERSION", "1.44")


class DockerError(Exception):
    """Erro de domínio ao falar com o Docker (indisponível, build falhou)."""


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: int):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout if self.timeout else None)
        sock.connect(self._path)
        self.sock = sock


def available() -> bool:
    return os.path.exists(SOCKET_PATH)


def ping(timeout: int = 5) -> bool:
    if not available():
        return False
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.request("GET", f"/v{API_VERSION}/_ping")
        return conn.getresponse().status == 200
    except OSError:
        return False
    finally:
        conn.close()


def _require() -> None:
    if not available():
        raise DockerError(
            f"Docker não disponível ({SOCKET_PATH} ausente) — monte o socket no container")


def _request(method: str, path: str, body: dict | None = None,
             timeout: int = 60) -> tuple[int, bytes]:
    """Requisição JSON simples à Engine API. Retorna (status, corpo)."""
    _require()
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        conn.request(method, f"/v{API_VERSION}{path}", body=data, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read()
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao falar com o Docker: {exc}")
    finally:
        conn.close()


def _ok(status: int, payload: bytes, *, ok=(200, 201, 204, 304)) -> dict:
    if status not in ok:
        raise DockerError(f"Docker HTTP {status}: {payload[:300]!r}")
    if not payload:
        return {}
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {}


def ensure_network(name: str) -> None:
    """Cria a rede bridge `name` se ainda não existir (idempotente)."""
    status, payload = _request("POST", "/networks/create",
                               {"Name": name, "Driver": "bridge", "CheckDuplicate": True})
    if status not in (201, 409):  # 409 = já existe
        raise DockerError(f"criar rede {name}: HTTP {status}: {payload[:200]!r}")


def ensure_volume(name: str) -> None:
    _ok(*_request("POST", "/volumes/create", {"Name": name}), ok=(200, 201))


def pull_image(image: str, on_line: Callable[[str], None] | None = None,
               timeout: int = 600) -> None:
    """Puxa uma imagem (`repo:tag`). Consome o NDJSON de progresso."""
    _require()
    if ":" in image.rsplit("/", 1)[-1]:
        from_image, _, tag = image.rpartition(":")
    else:
        from_image, tag = image, "latest"
    query = urlencode({"fromImage": from_image, "tag": tag})
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.request("POST", f"/v{API_VERSION}/images/create?{query}")
        resp = conn.getresponse()
        if resp.status != 200:
            raise DockerError(f"pull {image}: HTTP {resp.status}: {resp.read()[:300]!r}")
        buf = b""
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "error" in obj:
                    raise DockerError(obj.get("error"))
                if on_line and obj.get("status"):
                    on_line(f"{obj.get('status')} {obj.get('id', '')}".strip())
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao puxar imagem: {exc}")
    finally:
        conn.close()


def create_container(name: str, spec: dict) -> str:
    """Cria um container (remove antes se já existir com esse nome). Retorna o id."""
    remove_container(name, force=True, volumes=False, missing_ok=True)
    query = urlencode({"name": name})
    status, payload = _request("POST", f"/containers/create?{query}", spec)
    data = _ok(status, payload, ok=(201,))
    return data.get("Id", "")


def start_container(cid: str) -> None:
    status, payload = _request("POST", f"/containers/{cid}/start")
    if status not in (204, 304):
        raise DockerError(f"start {cid}: HTTP {status}: {payload[:200]!r}")


def stop_container(cid: str, t: int = 10) -> None:
    status, payload = _request("POST", f"/containers/{cid}/stop?t={t}")
    if status not in (204, 304, 404):
        raise DockerError(f"stop {cid}: HTTP {status}: {payload[:200]!r}")


def restart_container(cid: str, t: int = 10) -> None:
    status, payload = _request("POST", f"/containers/{cid}/restart?t={t}")
    if status not in (204,):
        raise DockerError(f"restart {cid}: HTTP {status}: {payload[:200]!r}")


def remove_container(cid: str, force: bool = True, volumes: bool = False,
                     missing_ok: bool = True) -> None:
    query = urlencode({"force": "1" if force else "0", "v": "1" if volumes else "0"})
    status, payload = _request("DELETE", f"/containers/{cid}?{query}")
    if status not in (204,) and not (missing_ok and status == 404):
        raise DockerError(f"remove {cid}: HTTP {status}: {payload[:200]!r}")


def list_containers(all_: bool = True, filters: dict | None = None) -> list[dict]:
    """Lista containers do host: `{id, name, state, status, image}`.

    `filters` é repassado à Engine API (ex.: `{"label": ["com.docker.compose.project=x"]}`).
    """
    params = {"all": "1" if all_ else "0"}
    if filters:
        params["filters"] = json.dumps(filters)
    query = urlencode(params)
    data = _ok(*_request("GET", f"/containers/json?{query}"))
    items = data if isinstance(data, list) else []
    out = []
    for c in items:
        names = c.get("Names") or []
        name = (names[0] if names else c.get("Id", "")).lstrip("/")
        out.append({
            "id": c.get("Id", ""), "name": name, "state": c.get("State", ""),
            "status": c.get("Status", ""), "image": c.get("Image", ""),
            "image_id": c.get("ImageID", ""),
            "created": int(c.get("Created", 0) or 0),  # epoch (s)
        })
    return out


def container_stats(cid: str, timeout: int = 10) -> dict:
    """Snapshot de uso (stream=false): calcula cpu% e memória usada/limite,
    no mesmo estilo do `docker stats` (desconta o page cache do uso de memória)."""
    data = _ok(*_request("GET", f"/containers/{cid}/stats?stream=false", timeout=timeout))
    cpu = data.get("cpu_stats") or {}
    pre = data.get("precpu_stats") or {}
    cpu_total = (cpu.get("cpu_usage") or {}).get("total_usage", 0) or 0
    pre_total = (pre.get("cpu_usage") or {}).get("total_usage", 0) or 0
    sys_total = cpu.get("system_cpu_usage", 0) or 0
    pre_sys = pre.get("system_cpu_usage", 0) or 0
    online = cpu.get("online_cpus") or len((cpu.get("cpu_usage") or {}).get("percpu_usage") or []) or 1
    cpu_delta = cpu_total - pre_total
    sys_delta = sys_total - pre_sys
    cpu_pct = (cpu_delta / sys_delta) * online * 100.0 if sys_delta > 0 and cpu_delta > 0 else 0.0
    mem = data.get("memory_stats") or {}
    usage = mem.get("usage", 0) or 0
    mstats = mem.get("stats") or {}
    cache = mstats.get("inactive_file", mstats.get("total_inactive_file", mstats.get("cache", 0))) or 0
    mem_used = max(usage - cache, 0)
    mem_limit = mem.get("limit", 0) or 0
    return {
        "cpu": round(cpu_pct, 2),
        "mem": mem_used,
        "mem_limit": mem_limit,
        "mem_pct": round((mem_used / mem_limit) * 100.0, 2) if mem_limit else 0.0,
    }


# --- Imagens -----------------------------------------------------------------

def list_images(all_: bool = False) -> list[dict]:
    """Imagens locais (cru da Engine API: Id/RepoTags/RepoDigests/Size/Created)."""
    data = _ok(*_request("GET", f"/images/json?all={'1' if all_ else '0'}"))
    return data if isinstance(data, list) else []


def inspect_image(name: str) -> dict | None:
    status, payload = _request("GET", f"/images/{name}/json")
    if status == 404:
        return None
    return _ok(status, payload)


def image_history(name: str) -> list[dict]:
    data = _ok(*_request("GET", f"/images/{name}/history"))
    return data if isinstance(data, list) else []


def remove_image(name: str, force: bool = False, noprune: bool = False) -> list[dict]:
    query = urlencode({"force": "1" if force else "0", "noprune": "1" if noprune else "0"})
    status, payload = _request("DELETE", f"/images/{name}?{query}")
    if status == 404:
        raise DockerError("imagem não encontrada")
    if status == 409:
        raise DockerError(_ok(status, payload, ok=()).get("message")
                          if payload else "imagem em uso — pare/remova os containers primeiro")
    data = _ok(status, payload)
    return data if isinstance(data, list) else []


# --- Volumes -----------------------------------------------------------------

def list_volumes() -> list[dict]:
    """Volumes locais (cru da Engine API: Name/Driver/Mountpoint/CreatedAt/…)."""
    data = _ok(*_request("GET", "/volumes"))
    vols = data.get("Volumes") if isinstance(data, dict) else None
    return vols or []


def volumes_usage() -> dict[str, dict]:
    """Name → {size, refcount} via /system/df (campo UsageData)."""
    data = _ok(*_request("GET", "/system/df"))
    out: dict[str, dict] = {}
    for v in (data.get("Volumes") or []) if isinstance(data, dict) else []:
        usage = v.get("UsageData") or {}
        out[v.get("Name", "")] = {
            "size": int(usage.get("Size", -1)),
            "refcount": int(usage.get("RefCount", -1)),
        }
    return out


def inspect_volume(name: str) -> dict | None:
    status, payload = _request("GET", f"/volumes/{quote(name, safe='')}")
    if status == 404:
        return None
    return _ok(status, payload)


def remove_volume(name: str, force: bool = False) -> None:
    query = urlencode({"force": "1" if force else "0"})
    status, payload = _request("DELETE", f"/volumes/{quote(name, safe='')}?{query}")
    if status == 404:
        raise DockerError("volume não encontrado")
    if status == 409:
        raise DockerError("volume em uso — pare/remova os containers que o usam primeiro")
    if status != 204:
        raise DockerError(f"remove volume: HTTP {status}: {payload[:200]!r}")


# --- Execução one-shot (container efêmero) -----------------------------------

def wait_container(cid: str, timeout: int = 600) -> int:
    """Bloqueia até o container parar e devolve o StatusCode (POST /wait)."""
    status, payload = _request("POST", f"/containers/{cid}/wait", timeout=timeout)
    data = _ok(status, payload)
    return int(data.get("StatusCode", -1))


def _demux(data: bytes) -> tuple[bytes, bytes]:
    """Separa o stream enquadrado (sem TTY) em (stdout, stderr)."""
    out, err = bytearray(), bytearray()
    i = 0
    while i + 8 <= len(data):
        stream = data[i]
        size = int.from_bytes(data[i + 4:i + 8], "big")
        i += 8
        chunk = data[i:i + size]
        i += size
        (err if stream == 2 else out).extend(chunk)
    return bytes(out), bytes(err)


def container_logs(cid: str, timeout: int = 120) -> tuple[bytes, bytes]:
    """(stdout, stderr) completos de um container já parado (sem follow)."""
    _require()
    query = urlencode({"stdout": "1", "stderr": "1", "follow": "0", "timestamps": "0"})
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.request("GET", f"/v{API_VERSION}/containers/{cid}/logs?{query}")
        resp = conn.getresponse()
        if resp.status != 200:
            raise DockerError(f"logs {cid}: HTTP {resp.status}")
        return _demux(resp.read())
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao ler logs: {exc}")
    finally:
        conn.close()


# --- Redes -------------------------------------------------------------------

def list_networks() -> list[dict]:
    """Redes locais (cru da Engine API)."""
    data = _ok(*_request("GET", "/networks"))
    return data if isinstance(data, list) else []


def inspect_network(name: str) -> dict | None:
    status, payload = _request("GET", f"/networks/{quote(name, safe='')}")
    if status == 404:
        return None
    return _ok(status, payload)


def export_image(name: str, timeout: int = 600):
    """Gera o tar da imagem (docker save) em chunks — GET /images/{name}/get."""
    _require()
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.request("GET", f"/v{API_VERSION}/images/{quote(name, safe='')}/get")
        resp = conn.getresponse()
        if resp.status != 200:
            raise DockerError(f"export {name}: HTTP {resp.status}: {resp.read()[:200]!r}")
        while True:
            chunk = resp.read(1024 * 64)
            if not chunk:
                break
            yield chunk
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao exportar imagem: {exc}")
    finally:
        conn.close()


def inspect_container(cid: str) -> dict | None:
    """Estado do container, ou None se não existir."""
    status, payload = _request("GET", f"/containers/{cid}/json")
    if status == 404:
        return None
    return _ok(status, payload)


def container_state(cid: str) -> str:
    """running|exited|created|… ou 'absent' se o container não existe."""
    info = inspect_container(cid)
    if not info:
        return "absent"
    return (info.get("State") or {}).get("Status", "unknown")


def stream_logs(cid: str, tail: int = 200, follow: bool = True, timeout: int = 3600,
                timestamps: bool = False):
    """Gera linhas de log do container (demux do frame stdout/stderr de 8 bytes).

    Com TTY o stream não é enquadrado; sem TTY cada frame tem cabeçalho
    `[tipo,0,0,0, tamanho(4, big-endian)]`. Detectamos e tratamos ambos.
    """
    _require()
    query = urlencode({
        "stdout": "1", "stderr": "1", "follow": "1" if follow else "0",
        "tail": str(tail), "timestamps": "1" if timestamps else "0",
    })
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.request("GET", f"/v{API_VERSION}/containers/{cid}/logs?{query}")
        resp = conn.getresponse()
        if resp.status != 200:
            raise DockerError(f"logs {cid}: HTTP {resp.status}")
        buf = b""
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk
            # Sem framing (TTY): emite por linha.
            while len(buf) >= 8 and buf[0] in (0, 1, 2) and buf[1:4] == b"\x00\x00\x00":
                size = int.from_bytes(buf[4:8], "big")
                if len(buf) < 8 + size:
                    break
                frame, buf = buf[8:8 + size], buf[8 + size:]
                for line in frame.decode("utf-8", "replace").splitlines():
                    yield line
            else:
                while b"\n" in buf and not (len(buf) >= 8 and buf[0] in (0, 1, 2)):
                    line, buf = buf.split(b"\n", 1)
                    yield line.decode("utf-8", "replace")
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao ler logs: {exc}")
    finally:
        conn.close()


def exec_run(cid: str, cmd: list[str], timeout: int = 300) -> tuple[int, bytes]:
    """Executa um comando one-shot no container; retorna (exit_code, saída bruta)."""
    status, payload = _request("POST", f"/containers/{cid}/exec",
                               {"AttachStdout": True, "AttachStderr": True, "Cmd": cmd},
                               timeout=timeout)
    exec_id = _ok(status, payload, ok=(201,)).get("Id", "")
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    out = b""
    try:
        data = json.dumps({"Detach": False, "Tty": False}).encode()
        conn.request("POST", f"/v{API_VERSION}/exec/{exec_id}/start",
                     body=data, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        out = resp.read()
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"exec falhou: {exc}")
    finally:
        conn.close()
    info = _ok(*_request("GET", f"/exec/{exec_id}/json"))
    return int(info.get("ExitCode") or 0), _demux_exec_output(out)


def _demux_exec_output(data: bytes) -> bytes:
    """Remove frames stdout/stderr da Engine API quando Tty=False.

    Docker prefixa cada frame com 8 bytes: stream, 0,0,0, tamanho. Para dumps
    binários isso precisa sair, senão o arquivo restaurado fica corrompido.
    """
    if not (len(data) >= 8 and data[0] in (0, 1, 2) and data[1:4] == b"\x00\x00\x00"):
        return data
    out = bytearray()
    pos = 0
    while pos + 8 <= len(data) and data[pos] in (0, 1, 2) and data[pos + 1:pos + 4] == b"\x00\x00\x00":
        size = int.from_bytes(data[pos + 4:pos + 8], "big")
        start = pos + 8
        end = start + size
        if end > len(data):
            break
        out.extend(data[start:end])
        pos = end
    if pos < len(data):
        out.extend(data[pos:])
    return bytes(out)


def exec_run_input(cid: str, cmd: list[str], stdin: bytes, timeout: int = 600) -> tuple[int, bytes]:
    """Executa comando com stdin anexado; retorna (exit_code, saída bruta)."""
    status, payload = _request("POST", f"/containers/{cid}/exec", {
        "AttachStdin": True, "AttachStdout": True, "AttachStderr": True,
        "Tty": False, "Cmd": cmd,
    }, timeout=timeout)
    exec_id = _ok(status, payload, ok=(201,)).get("Id", "")
    if not exec_id:
        raise DockerError("exec não criado")

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    out = b""
    try:
        sock.settimeout(timeout)
        sock.connect(SOCKET_PATH)
        body = json.dumps({"Detach": False, "Tty": False}).encode()
        req = (
            f"POST /v{API_VERSION}/exec/{exec_id}/start HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n"
        ).encode() + body
        sock.sendall(req)
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        _, _, rest = buf.partition(b"\r\n\r\n")
        out += rest
        if stdin:
            sock.sendall(stdin)
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            out += chunk
    except (OSError, socket.timeout) as exc:
        raise DockerError(f"exec falhou: {exc}")
    finally:
        sock.close()
    info = _ok(*_request("GET", f"/exec/{exec_id}/json"))
    return int(info.get("ExitCode") or 0), _demux_exec_output(out)


def exec_resize(exec_id: str, cols: int, rows: int) -> None:
    """Redimensiona o TTY de um exec (após iniciado). Best-effort."""
    query = urlencode({"h": max(1, int(rows)), "w": max(1, int(cols))})
    status, payload = _request("POST", f"/exec/{exec_id}/resize?{query}")
    if status not in (200, 201):
        raise DockerError(f"resize {exec_id}: HTTP {status}: {payload[:120]!r}")


def exec_interactive(cid: str, cmd: list[str], cols: int = 80, rows: int = 24):
    """Cria um exec com **TTY** e faz o *hijack* do socket p/ um terminal real.

    Retorna `(exec_id, sock, initial_bytes)`: `sock` é o socket unix cru já em
    modo duplex (stdin↔stdout, stream NÃO multiplexado por causa do TTY);
    `initial_bytes` é o que já veio junto da resposta de upgrade. O chamador é
    responsável por ler/escrever no socket e fechá-lo.
    """
    _require()
    status, payload = _request("POST", f"/containers/{cid}/exec", {
        "AttachStdin": True, "AttachStdout": True, "AttachStderr": True,
        "Tty": True, "Cmd": cmd,
    })
    exec_id = _ok(status, payload, ok=(201,)).get("Id", "")
    if not exec_id:
        raise DockerError("exec não criado")

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(SOCKET_PATH)
        body = json.dumps({"Detach": False, "Tty": True}).encode()
        req = (
            f"POST /v{API_VERSION}/exec/{exec_id}/start HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Content-Type: application/json\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n"
        ).encode() + body
        sock.sendall(req)
        # Lê os cabeçalhos da resposta (101/200); o resto do buffer já é o TTY.
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        _, _, rest = buf.partition(b"\r\n\r\n")
    except OSError as exc:
        sock.close()
        raise DockerError(f"falha ao abrir o terminal: {exc}")

    try:
        exec_resize(exec_id, cols, rows)
    except DockerError:
        pass  # tamanho é ajustado pelo cliente logo em seguida
    return exec_id, sock, rest


def build_image(tag: str, context_tar: bytes, dockerfile: str = "Dockerfile",
                buildargs: dict | None = None, on_line: Callable[[str], None] | None = None,
                timeout: int = 1800, no_cache: bool = False) -> None:
    """Builda e tageia uma imagem a partir de um tar de contexto (stdlib `tarfile`).

    Consome o streaming NDJSON da Docker Engine API linha a linha, repassando
    `{"stream": "..."}` para `on_line` e levantando `DockerError` em `{"error": ...}`.
    """
    if not available():
        raise DockerError(f"Docker não disponível ({SOCKET_PATH} ausente) — monte o socket no container")

    # version=1 = builder clássico. O BuildKit (version=2) exige uma sessão gRPC
    # negociada pelo cliente (`docker build` faz isso) p/ auth e resolução de
    # imagem — sem ela dá "no active sessions"; o cliente stdlib puro daqui não
    # implementa sessão, então usamos o clássico (puxa a imagem base sozinho).
    query = urlencode({
        "t": tag, "dockerfile": dockerfile, "rm": "1", "forcerm": "1",
        "version": "1",
        "nocache": "1" if no_cache else "0",
        "buildargs": json.dumps(buildargs or {}),
    })
    conn = _UnixHTTPConnection(SOCKET_PATH, timeout)
    try:
        conn.putrequest("POST", f"/v{API_VERSION}/build?{query}")
        conn.putheader("Content-Type", "application/x-tar")
        conn.putheader("Content-Length", str(len(context_tar)))
        conn.endheaders()
        conn.send(context_tar)

        resp = conn.getresponse()
        if resp.status != 200:
            raise DockerError(f"docker build HTTP {resp.status}: {resp.read()[:400]!r}")

        buf = b""
        while True:
            chunk = resp.read(8192)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "error" in obj:
                    raise DockerError(obj.get("errorDetail", {}).get("message") or obj["error"])
                if "stream" in obj and on_line:
                    text = obj["stream"].rstrip("\n")
                    if text:
                        on_line(text)
                elif "status" in obj and on_line:
                    text = obj["status"].rstrip("\n")
                    if text:
                        on_line(text)
                elif "aux" in obj and on_line:
                    on_line(json.dumps(obj["aux"], ensure_ascii=False))
    except (OSError, http.client.HTTPException) as exc:
        raise DockerError(f"falha ao falar com o Docker: {exc}")
    finally:
        conn.close()
