"""Motor de execução dos monitores (healthcheck).

Uma thread agendadora (`_scheduler`) roda em background: a cada tick lê os
monitores **ativos** do banco, calcula o próximo horário de checagem de cada um
(em memória) e despacha os que estão vencidos para um pool de threads. Cada
checagem grava um **heartbeat** (histórico), atualiza o `status` do monitor
(pending|up|down) conforme a lógica de tentativas (`max_retries`) e incrementa
um contador de versão global consumido pelo SSE.

Os checkers cobrem HTTP, TCP, ping, DNS, domínio, bancos, mensageria e container.
Monitores push recebem seus heartbeats pelo webhook público.
"""
from __future__ import annotations

import base64
import http.client
import json
import math
import random
import re
import socket
import ssl
import struct
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import zlib

from sqlalchemy import or_

from .db import get_session
from .db.models import Monitor, MonitorEvent, MonitorHeartbeat, MonitorProxy, MonitorStat
from . import domaincheck

# Retenção de heartbeats por monitor (mantém os N mais recentes).
_KEEP_HEARTBEATS = 500
# Cadência do agendador e limite de checagens simultâneas.
_TICK_SECONDS = 0.5
_MAX_WORKERS = 8
# Teto de leitura do corpo da resposta (evita baixar respostas gigantes).
_READ_CAP = 1024 * 1024
# A validade do certificado é inspecionada separadamente dos heartbeats.
_DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
# Dias de antecedência p/ avisar que o certificado está prestes a expirar.
_SSL_EXPIRY_WARN_DAYS = 14

_stop = threading.Event()
_scheduler_thread: threading.Thread | None = None

# Estado em memória por monitor: próximo horário e falhas consecutivas.
_next_run: dict[int, float] = {}
_next_push_failure: dict[int, float] = {}
_fail_count: dict[int, int] = {}
_inflight: set[int] = set()
_state_lock = threading.Lock()
_pool_sem = threading.BoundedSemaphore(_MAX_WORKERS)
_proxy_cursor: dict[int, int] = {}
# Monitores atualmente sob manutenção (p/ detectar entrada/saída e emitir eventos).
_maintenance_active: set[int] = set()
# Monitores com falha parcial de proxy (modo `all`) — dedup do evento proxy_failure.
_proxy_partial: dict[int, bool] = {}
# Latência média da janela configurada acima do limite (estado/evento "degraded").
_slow_samples: dict[int, list[tuple[int, int]]] = {}  # (ts_ms, latency_ms) da janela
_slow_since: dict[int, int] = {}  # início do período continuamente acima do limite
_slow_flagged: dict[int, bool] = {}  # já emitiu o evento (dedup até normalizar)
_DEFAULT_SLOW_WINDOW_SECONDS = 60
_DEFAULT_PUSH_GRACE_SECONDS = 5

# Versão global p/ o SSE (bump a cada heartbeat gravado).
_version = 0
_version_cond = threading.Condition()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _bump_version() -> None:
    global _version
    with _version_cond:
        _version += 1
        _version_cond.notify_all()


def version() -> int:
    with _version_cond:
        return _version


def bump() -> None:
    """Sinaliza mudança externa (ex.: incidente) p/ os streams SSE."""
    _bump_version()


def wait_for_version(last: int, timeout: float) -> int:
    """Bloqueia até a versão mudar ou o timeout expirar; devolve a versão atual."""
    with _version_cond:
        if _version == last:
            _version_cond.wait(timeout)
        return _version


# --------------------------------------------------------------------------- #
# Checagem HTTP
# --------------------------------------------------------------------------- #
def _build_body(cfg: dict) -> tuple[bytes | None, dict[str, str]]:
    pairs = cfg.get("body") or []
    if not pairs or cfg.get("method") in ("GET", "HEAD", "OPTIONS"):
        return None, {}
    data = {p["key"]: p.get("value", "") for p in pairs}
    if cfg.get("body_encoding") == "form":
        raw = urllib.parse.urlencode(data).encode()
        return raw, {"Content-Type": "application/x-www-form-urlencoded"}
    raw = json.dumps(data).encode()
    return raw, {"Content-Type": "application/json"}


def _oauth2_token(auth: dict, timeout: int) -> str:
    """Obtém um access_token via client_credentials (best-effort)."""
    token_url = auth.get("token_url", "")
    if not token_url:
        raise ValueError("URL do token OAuth ausente")
    form = {"grant_type": "client_credentials"}
    if auth.get("scope"):
        form["scope"] = auth["scope"]
    if auth.get("audience"):
        form["audience"] = auth["audience"]
    headers = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
    if auth.get("method") == "header":
        cred = f"{auth.get('client_id', '')}:{auth.get('client_secret', '')}"
        headers["Authorization"] = "Basic " + base64.b64encode(cred.encode()).decode()
    else:  # body
        form["client_id"] = auth.get("client_id", "")
        form["client_secret"] = auth.get("client_secret", "")
    req = urllib.request.Request(token_url, data=urllib.parse.urlencode(form).encode(),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8", "replace"))
    token = payload.get("access_token")
    if not token:
        raise ValueError("resposta OAuth sem access_token")
    return str(token)


def _auth_headers(auth: dict, timeout: int) -> dict[str, str]:
    atype = auth.get("type", "none")
    if atype == "basic":
        cred = f"{auth.get('username', '')}:{auth.get('password', '')}"
        return {"Authorization": "Basic " + base64.b64encode(cred.encode()).decode()}
    if atype == "bearer":
        return {"Authorization": f"Bearer {auth.get('token', '')}"}
    if atype == "oauth2":
        return {"Authorization": f"Bearer {_oauth2_token(auth, timeout)}"}
    if atype == "other":
        header = auth.get("header", "")
        if header and ":" in header:
            k, _, v = header.partition(":")
            return {k.strip(): v.strip()}
    # ntlm: negociação NTLM não é suportada pela stdlib — sem cabeçalho por ora.
    return {}


def _ssl_context(auth: dict, ssl_cfg: dict) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if ssl_cfg.get("ignore_tls_errors"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    if auth.get("type") == "mtls":
        import tempfile
        import os
        # Grava cert/chave/ca em arquivos temporários p/ load_cert_chain.
        cert, key, ca = auth.get("cert", ""), auth.get("key", ""), auth.get("ca", "")
        if cert and key:
            cf = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
            kf = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
            try:
                cf.write(cert); cf.close()
                kf.write(key); kf.close()
                ctx.load_cert_chain(cf.name, kf.name)
            finally:
                os.unlink(cf.name); os.unlink(kf.name)
        if ca:
            caf = tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False)
            try:
                caf.write(ca); caf.close()
                ctx.load_verify_locations(caf.name)
            finally:
                os.unlink(caf.name)
    # Só falamos HTTP/1.1 (http.client); anuncia via ALPN p/ registrar o negociado.
    try:
        ctx.set_alpn_protocols(["http/1.1"])
    except (NotImplementedError, AttributeError):
        pass
    return ctx


def _cert_info(sock) -> dict | None:
    """Extrai o início e o fim da validade do certificado apresentado pelo peer."""
    try:
        der = sock.getpeercert(binary_form=True)
        if not der:
            return None
        from cryptography import x509
        cert = x509.load_der_x509_certificate(der)
        return {
            "issued_ts": int(cert.not_valid_before_utc.timestamp() * 1000),
            "expires_ts": int(cert.not_valid_after_utc.timestamp() * 1000),
        }
    except Exception:  # noqa: BLE001 — na dúvida, ignora
        return None


def _classify_exc(exc: Exception) -> str:
    """Classifica a exceção de rede num tipo de evento."""
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "timeout"
    if isinstance(exc, ConnectionRefusedError):
        return "connection_refused"
    if isinstance(exc, ssl.SSLError):
        return "tls_failure"
    if isinstance(exc, socket.gaierror):
        return "dns_failure"
    msg = str(exc).lower()
    if "timed out" in msg or "timeout" in msg:
        return "timeout"
    if "refused" in msg:
        return "connection_refused"
    if "name or service not known" in msg or "getaddrinfo" in msg or "temporary failure in name" in msg:
        return "dns_failure"
    if "ssl" in msg or "handshake" in msg or "certificate" in msg:
        return "tls_failure"
    return "down"


def _code_accepted(code: int, accepted: str) -> bool:
    for part in (accepted or "200-299").split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                if int(a) <= code <= int(b):
                    return True
            except ValueError:
                continue
        else:
            try:
                if code == int(part):
                    return True
            except ValueError:
                continue
    return False


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    out = b""
    while len(out) < size:
        chunk = sock.recv(size - len(out))
        if not chunk:
            raise OSError("proxy encerrou a conexão")
        out += chunk
    return out


class ProxyConnectionError(OSError):
    """Falha ocorrida antes de o túnel até o destino ser estabelecido."""


def _proxy_socket_impl(proxy: dict, host: str, port: int, timeout: float) -> socket.socket:
    """Abre um túnel TCP via HTTP(S), SOCKS4 ou SOCKS5."""
    sock = socket.create_connection((proxy["server"], int(proxy["port"])), timeout=timeout)
    protocol = proxy["protocol"]
    username, password = proxy.get("username", ""), proxy.get("password", "")
    if protocol == "https":
        sock = ssl.create_default_context().wrap_socket(sock, server_hostname=proxy["server"])
    if protocol in ("http", "https"):
        headers = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        if username or password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers += f"Proxy-Authorization: Basic {token}\r\n"
        sock.sendall((headers + "\r\n").encode())
        response = b""
        while b"\r\n\r\n" not in response and len(response) < 65536:
            response += sock.recv(4096)
        status = response.split(b"\r\n", 1)[0]
        if b" 200 " not in status:
            raise OSError(f"proxy recusou o túnel: {status.decode('latin1', 'replace')}")
        return sock
    if protocol == "socks4":
        try:
            ip = socket.inet_aton(socket.gethostbyname(host))
            tail = (username.encode() + b"\0")
        except socket.gaierror:
            ip, tail = b"\0\0\0\1", username.encode() + b"\0" + host.encode() + b"\0"
        sock.sendall(b"\x04\x01" + struct.pack("!H", port) + ip + tail)
        if _recv_exact(sock, 8)[1] != 0x5A:
            raise OSError("proxy SOCKS4 recusou a conexão")
        return sock
    methods = b"\x00\x02" if username or password else b"\x00"
    sock.sendall(b"\x05" + bytes([len(methods)]) + methods)
    method = _recv_exact(sock, 2)[1]
    if method == 0x02:
        user, pwd = username.encode(), password.encode()
        sock.sendall(b"\x01" + bytes([len(user)]) + user + bytes([len(pwd)]) + pwd)
        if _recv_exact(sock, 2)[1] != 0:
            raise OSError("autenticação SOCKS5 recusada")
    elif method != 0:
        raise OSError("proxy SOCKS5 não aceita a autenticação disponível")
    if protocol == "socks5h":
        encoded = host.encode()
        addr = b"\x03" + bytes([len(encoded)]) + encoded
    else:
        resolved = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)[0][4][0]
        addr = (b"\x04" + socket.inet_aton(resolved)) if ":" not in resolved else (b"\x04" + socket.inet_aton(socket.gethostbyname(host)))
    sock.sendall(b"\x05\x01\x00" + addr + struct.pack("!H", port))
    reply = _recv_exact(sock, 4)
    if reply[1] != 0:
        raise OSError(f"proxy SOCKS5 recusou a conexão ({reply[1]})")
    atyp = reply[3]
    length = 4 if atyp == 1 else 16 if atyp == 4 else _recv_exact(sock, 1)[0]
    _recv_exact(sock, length + 2)
    return sock


def _proxy_socket(proxy: dict, host: str, port: int, timeout: float) -> socket.socket:
    try:
        return _proxy_socket_impl(proxy, host, port, timeout)
    except ProxyConnectionError:
        raise
    except Exception as exc:
        address = f"{proxy.get('server', '?')}:{proxy.get('port', '?')}"
        raise ProxyConnectionError(f"falha no proxy {address}: {exc}") from exc


class _ProxyHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, port: int, proxy: dict, timeout: float):
        super().__init__(host, port, timeout=timeout); self._proxy = proxy
    def connect(self) -> None:
        self.sock = _proxy_socket(self._proxy, self.host, self.port, self.timeout)


class _ProxyHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, proxy: dict, timeout: float, context: ssl.SSLContext):
        super().__init__(host, port, timeout=timeout, context=context); self._proxy = proxy
    def connect(self) -> None:
        raw = _proxy_socket(self._proxy, self.host, self.port, self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def _timed_connect(host: str, port: int, timeout: float | None,
                   source_address=None) -> tuple[socket.socket, float, float]:
    """Conecta separando **DNS** (getaddrinfo) e **TCP** (connect). Devolve
    (socket, segundos_dns, segundos_tcp)."""
    t0 = time.monotonic()
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    dns = time.monotonic() - t0
    err: Exception | None = None
    for af, stype, proto, _canon, sa in infos:
        sock = None
        try:
            sock = socket.socket(af, stype, proto)
            if timeout is not None:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            t1 = time.monotonic()
            sock.connect(sa)
            return sock, dns, time.monotonic() - t1
        except OSError as exc:
            err = exc
            if sock is not None:
                sock.close()
    raise err if err else OSError("getaddrinfo não retornou endereços")


class _TimedHTTPConnection(http.client.HTTPConnection):
    """HTTPConnection que registra os tempos de DNS/TCP em `connect()`."""
    _t_dns = _t_tcp = 0.0
    _t_tls: float | None = None

    def connect(self) -> None:
        self.sock, self._t_dns, self._t_tcp = _timed_connect(
            self.host, self.port, self.timeout, self.source_address)
        try:
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass


class _TimedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPSConnection que registra DNS/TCP/TLS em `connect()`."""
    _t_dns = _t_tcp = 0.0
    _t_tls: float | None = None

    def connect(self) -> None:
        self.sock, self._t_dns, self._t_tcp = _timed_connect(
            self.host, self.port, self.timeout, self.source_address)
        try:
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        t = time.monotonic()
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)
        self._t_tls = time.monotonic() - t


def _maybe_decompress(enc: str, data: bytes) -> bytes:
    """Descompacta gzip/deflate (stdlib). Best-effort: devolve `data` no erro."""
    enc = (enc or "").split(",")[0].strip().lower()
    if not data:
        return data
    try:
        if enc in ("gzip", "x-gzip"):
            return zlib.decompress(data, 16 + zlib.MAX_WBITS)
        if enc == "deflate":
            return zlib.decompress(data, -zlib.MAX_WBITS)
    except Exception:  # noqa: BLE001 — corpo truncado/inesperado
        return data
    return data


def _response_meta(resp, body_bytes: bytes, conn, is_https: bool, code: int) -> dict:
    """Metadados da resposta/conexão HTTP: tamanho (comprimido/descomprimido),
    tipo, IP remoto, versão HTTP e detalhes de TLS (versão/cipher/ALPN)."""
    enc = (resp.getheader("Content-Encoding") or "").split(",")[0].strip().lower()
    clen = resp.getheader("Content-Length")
    wire = int(clen) if clen and clen.isdigit() else len(body_bytes)
    uncompressed = None
    if enc:
        dec = _maybe_decompress(enc, body_bytes)
        if dec is not body_bytes:  # descompactou de fato (gzip/deflate)
            uncompressed = len(dec)
    meta = {
        "status": code,
        "content_type": (resp.getheader("Content-Type") or "").split(";")[0].strip(),
        "content_encoding": enc,
        "size": (uncompressed if enc else wire),        # descomprimido (None se desconhecido)
        "compressed": (wire if enc else None),          # tamanho na rede (só se codificado)
        "http_version": {11: "HTTP/1.1", 10: "HTTP/1.0"}.get(getattr(resp, "version", None), ""),
    }
    sock = getattr(conn, "sock", None)
    if sock is not None:
        try:
            meta["remote_ip"] = sock.getpeername()[0]
        except Exception:  # noqa: BLE001
            pass
        if is_https:
            try:
                meta["tls_version"] = sock.version() or ""
                cipher = sock.cipher()
                meta["tls_cipher"] = cipher[0] if cipher else ""
                meta["alpn"] = sock.selected_alpn_protocol() or ""
            except Exception:  # noqa: BLE001
                pass
    return meta


def check_http(cfg: dict, timeout: int) -> dict:
    """Executa a checagem HTTP; devolve {ok, code, latency_ms, message}."""
    url = cfg.get("url", "")
    parts = urllib.parse.urlsplit(url)
    is_https = parts.scheme == "https"
    host = parts.hostname or ""
    port = parts.port or (443 if is_https else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query

    ssl_cfg = cfg.get("ssl") or {}
    auth = cfg.get("auth") or {"type": "none"}
    headers = {"User-Agent": "nexus-monitor/1.0", "Accept": "*/*"}
    for p in cfg.get("headers") or []:
        headers[p["key"]] = p.get("value", "")

    body, body_headers = _build_body(cfg)
    headers.update(body_headers)
    # Pede compressão (como um browser) p/ medir tamanho comprimido — só stdlib
    # (gzip/deflate); descompactamos ao ler. Não sobrescreve se o usuário definiu.
    if not any(k.lower() == "accept-encoding" for k in headers):
        headers["Accept-Encoding"] = "gzip, deflate"

    started = time.monotonic()
    try:
        headers.update(_auth_headers(auth, timeout))
    except Exception as exc:  # noqa: BLE001 — falha ao obter token/credencial
        return {"ok": False, "code": "", "latency_ms": 0, "message": f"autenticação: {exc}"}

    try:
        proxy = cfg.get("_proxy")
        timed = not proxy  # o detalhamento por fase só vale sem proxy
        if is_https and proxy:
            ctx = _ssl_context(auth, ssl_cfg)
            conn = _ProxyHTTPSConnection(host, port, proxy, timeout, ctx)
        elif proxy:
            conn = _ProxyHTTPConnection(host, port, proxy, timeout)
        elif is_https:
            ctx = _ssl_context(auth, ssl_cfg)
            conn = _TimedHTTPSConnection(host, port, timeout=timeout, context=ctx)
        else:
            conn = _TimedHTTPConnection(host, port, timeout=timeout)
        try:
            t_start = time.monotonic()
            if timed:
                conn.connect()  # separa DNS/TCP/TLS antes de enviar a requisição
            t_connected = time.monotonic()
            conn.request(cfg.get("method", "GET"), path, body=body, headers=headers)
            t_requested = time.monotonic()
            resp = conn.getresponse()
            t_first_byte = time.monotonic()
            code = resp.status
            keyword = cfg.get("keyword") or ""
            cap = cfg.get("max_response_bytes") or _READ_CAP
            # Se há keyword, lê o corpo inteiro (até o teto) p/ pesquisar nele.
            read_cap = _READ_CAP if keyword else min(cap, _READ_CAP)
            body_bytes = resp.read(read_cap)
            t_done = time.monotonic()
            latency = int((time.monotonic() - started) * 1000)

            ok = _code_accepted(code, cfg.get("accepted_codes", "200-299"))
            msg = resp.reason if ok else f"código HTTP {code}"
            reason = None if ok else ("http_error" if 400 <= code <= 599 else "down")
            # Search Keyword: pesquisa no corpo (HTML/JSON), sensível a caixa.
            if ok and keyword:
                text = _maybe_decompress(resp.getheader("Content-Encoding") or "",
                                         body_bytes).decode("utf-8", "replace")
                if keyword not in text:
                    ok, reason, msg = False, "down", f"palavra-chave não encontrada: {keyword}"
            out = {"ok": ok, "code": str(code), "latency_ms": latency, "message": msg}
            if reason:
                out["reason"] = reason
            if timed and cfg.get("record_timings", True):
                ms = lambda x: max(0, round(x * 1000))
                out["timings"] = {
                    "dns": ms(conn._t_dns),
                    "tcp": ms(conn._t_tcp),
                    "tls": ms(conn._t_tls) if conn._t_tls is not None else None,
                    "request": ms(t_requested - t_connected),
                    "ttfb": ms(t_first_byte - t_requested),
                    "download": ms(t_done - t_first_byte),
                    "total": ms(t_done - t_start),
                }
            if timed and cfg.get("record_advanced", False):
                try:
                    out["meta"] = _response_meta(resp, body_bytes, conn, is_https, code)
                except Exception:  # noqa: BLE001 — meta é best-effort
                    pass
            return out
        finally:
            conn.close()
    except ProxyConnectionError as exc:
        return {"ok": False, "code": "PROXY", "latency_ms": int((time.monotonic() - started) * 1000),
                "reason": "proxy_failure", "message": str(exc)}
    except ssl.SSLError as exc:
        return {"ok": False, "code": "", "latency_ms": int((time.monotonic() - started) * 1000),
                "reason": "tls_failure", "message": f"erro TLS: {exc}"}
    except Exception as exc:  # noqa: BLE001 — timeout/DNS/conexão recusada
        return {"ok": False, "code": "", "latency_ms": int((time.monotonic() - started) * 1000),
                "reason": _classify_exc(exc), "message": str(exc) or type(exc).__name__}


# --------------------------------------------------------------------------- #
# Checagem TCP (+ TLS opcional)
# --------------------------------------------------------------------------- #
def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def check_tcp(cfg: dict, timeout: float) -> dict:
    host, port = cfg.get("hostname", ""), int(cfg.get("port", 0))
    tls, alert = bool(cfg.get("tls")), cfg.get("expected_tls_alert") or ""
    started = time.monotonic()
    try:
        sock, t_dns, t_tcp = _timed_connect(host, port, timeout)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "code": "", "latency_ms": int((time.monotonic() - started) * 1000),
                "reason": _classify_exc(exc), "message": str(exc) or type(exc).__name__}
    latency = int((time.monotonic() - started) * 1000)
    ms = lambda x: max(0, round(x * 1000))
    timings = {"dns": ms(t_dns), "tcp": ms(t_tcp), "tls": None,
               "request": None, "ttfb": None, "download": None, "total": latency}
    try:
        if not tls:
            return {"ok": True, "code": "", "latency_ms": latency, "message": "conectado",
                    "timings": timings}
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        t_tls = time.monotonic()
        try:
            with ctx.wrap_socket(sock, server_hostname=host or None):
                pass
        except ssl.SSLError as exc:
            if alert and _norm(alert) in _norm(str(exc)):
                return {"ok": True, "code": alert, "latency_ms": latency,
                        "message": f"alerta TLS esperado: {alert}", "timings": timings}
            return {"ok": False, "code": "", "latency_ms": latency,
                    "reason": "tls_failure", "message": f"erro TLS: {exc}"}
        timings["tls"] = ms(time.monotonic() - t_tls)
        timings["total"] = int((time.monotonic() - started) * 1000)
        # Handshake completou.
        if alert:
            return {"ok": False, "code": "", "latency_ms": latency, "reason": "tls_failure",
                    "message": f"esperado alerta TLS '{alert}', mas o handshake teve sucesso"}
        return {"ok": True, "code": "", "latency_ms": latency, "message": "handshake TLS ok",
                "timings": timings}
    finally:
        try:
            sock.close()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
# Inspeção diária do certificado SSL/TLS
# --------------------------------------------------------------------------- #
def _ssl_enabled(mtype: str, cfg: dict) -> bool:
    if mtype == "tcp":
        return bool(cfg.get("tls"))
    if mtype != "http":
        return False
    parts = urllib.parse.urlsplit(cfg.get("url", ""))
    ssl_cfg = cfg.get("ssl") or {}
    return parts.scheme == "https" and ssl_cfg.get("validate_expired", True) is not False


def _tls_certificate(host: str, port: int, timeout: float, *, proxy: dict | None,
                     auth: dict, ssl_cfg: dict, verify: bool) -> dict | None:
    raw = (_proxy_socket(proxy, host, port, timeout) if proxy
           else socket.create_connection((host, port), timeout=timeout))
    context_cfg = {**ssl_cfg, "ignore_tls_errors": not verify}
    context = _ssl_context(auth, context_cfg)
    try:
        tls_sock = context.wrap_socket(raw, server_hostname=host or None)
    except Exception:
        raw.close()
        raise
    with tls_sock:
        return _cert_info(tls_sock)


def _ssl_probe(mtype: str, cfg: dict, timeout: float,
               proxy: dict | None = None) -> dict:
    """Inspeciona o certificado fora do heartbeat normal (execução diária/manual)."""
    if mtype == "http":
        parts = urllib.parse.urlsplit(cfg.get("url", ""))
        host = parts.hostname or ""
        port = parts.port or 443
        auth = cfg.get("auth") or {"type": "none"}
        ssl_cfg = cfg.get("ssl") or {}
        verify = not bool(ssl_cfg.get("ignore_tls_errors"))
        expected_alert = ""
    else:
        host = cfg.get("hostname", "")
        port = int(cfg.get("port", 0))
        auth, ssl_cfg, verify = {"type": "none"}, {}, False
        expected_alert = cfg.get("expected_tls_alert") or ""

    info = None
    try:
        info = _tls_certificate(host, port, timeout, proxy=proxy, auth=auth,
                                ssl_cfg=ssl_cfg, verify=verify)
    except ssl.SSLCertVerificationError as exc:
        # Uma segunda conexão sem validação permite mostrar a duração até mesmo
        # quando o certificado expirou ou a cadeia/hostname é inválida.
        try:
            info = _tls_certificate(host, port, timeout, proxy=proxy, auth=auth,
                                    ssl_cfg=ssl_cfg, verify=False)
        except Exception:  # noqa: BLE001 — mantém o erro original
            pass
        expires = int((info or {}).get("expires_ts", 0))
        status = "expired" if expires and expires <= _now_ms() else "error"
        return {"status": status, **(info or {}), "message": f"erro TLS: {exc}"}
    except ssl.SSLError as exc:
        if expected_alert and _norm(expected_alert) in _norm(str(exc)):
            return {"status": "valid", "issued_ts": 0, "expires_ts": 0,
                    "message": f"alerta TLS esperado: {expected_alert}"}
        return {"status": "error", "issued_ts": 0, "expires_ts": 0,
                "message": f"erro TLS: {exc}"}
    except Exception as exc:  # noqa: BLE001 — DNS, timeout, conexão recusada
        return {"status": "unavailable", "issued_ts": 0, "expires_ts": 0,
                "message": str(exc) or type(exc).__name__}

    if not info:
        return {"status": "unavailable", "issued_ts": 0, "expires_ts": 0,
                "message": "certificado não apresentado pelo servidor"}

    now = _now_ms()
    expires = int(info["expires_ts"])
    remaining = expires - now
    if remaining <= 0:
        days_left = -max(1, math.ceil(abs(remaining) / 86_400_000))
        status, message = "expired", f"certificado expirado há {abs(days_left)} dia(s)"
    elif remaining <= _SSL_EXPIRY_WARN_DAYS * 86_400_000:
        days_left = math.ceil(remaining / 86_400_000)
        status, message = "expiring", f"certificado expira em {days_left} dia(s)"
    else:
        days_left = math.ceil(remaining / 86_400_000)
        status, message = "valid", f"certificado válido por mais {days_left} dia(s)"
    return {"status": status, **info, "days_left": days_left, "message": message}


# --------------------------------------------------------------------------- #
# Checagem Ping (via comando `ping` do sistema)
# --------------------------------------------------------------------------- #
def check_ping(cfg: dict, timeout: float) -> dict:
    host = cfg.get("hostname", "")
    count = int(cfg.get("packets", 3))
    size = int(cfg.get("packet_size", 56))
    per = float(cfg.get("per_ping_timeout", 2))
    deadline = max(1, int(math.ceil(count * max(per, 1) + 2)))
    cmd = ["ping", "-n", "-c", str(count), "-s", str(size),
           "-W", str(max(1, int(round(per)))), "-w", str(deadline), host]
    started = time.monotonic()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=deadline + 3)
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": "", "latency_ms": 0, "message": "ping expirou"}
    except FileNotFoundError:
        return {"ok": False, "code": "", "latency_ms": 0, "message": "comando 'ping' indisponível"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "code": "", "latency_ms": 0, "message": str(exc)}
    out = proc.stdout or ""
    ok = proc.returncode == 0
    m = re.search(r"=\s*[\d.]+/([\d.]+)/", out)  # rtt min/avg/max
    if not m:
        m = re.search(r"time[=<]([\d.]+)", out)
    latency = int(float(m.group(1))) if m else int((time.monotonic() - started) * 1000)
    loss = re.search(r"([\d.]+)%\s*packet loss", out)
    msg = f"{loss.group(1)}% de perda" if loss else ("respondeu" if ok else "sem resposta")
    res = {"ok": ok, "code": "", "latency_ms": latency, "message": msg}
    if not ok:
        res["reason"] = "timeout"
    return res


# --------------------------------------------------------------------------- #
# Checagem DNS (query UDP em stdlib)
# --------------------------------------------------------------------------- #
_DNS_TYPES = {"a": 1, "ns": 2, "cname": 5, "soa": 6, "ptr": 12, "mx": 15,
              "txt": 16, "aaaa": 28, "srv": 33, "caa": 257}


def _dns_encode_name(name: str) -> bytes:
    out = b""
    for label in name.rstrip(".").split("."):
        # ASCII cru (aceita underscores de SRV; hostnames IDN devem vir já em punycode).
        raw = label.encode("ascii", "ignore")[:63]
        out += bytes([len(raw)]) + raw
    return out + b"\x00"


def _dns_read_name(data: bytes, off: int) -> tuple[str, int]:
    labels, jumped, orig = [], False, off
    while True:
        length = data[off]
        if length & 0xC0 == 0xC0:  # ponteiro de compressão
            ptr = ((length & 0x3F) << 8) | data[off + 1]
            if not jumped:
                orig = off + 2
            off, jumped = ptr, True
            continue
        off += 1
        if length == 0:
            break
        labels.append(data[off:off + length].decode("ascii", "replace"))
        off += length
    return ".".join(labels), (orig if jumped else off)


def _dns_decode_rdata(rtype: int, data: bytes, off: int, rdlen: int) -> str:
    rd = data[off:off + rdlen]
    if rtype == 1 and rdlen == 4:
        return ".".join(str(b) for b in rd)
    if rtype == 28 and rdlen == 16:
        return ":".join(f"{rd[i]<<8|rd[i+1]:x}" for i in range(0, 16, 2))
    if rtype in (2, 5, 12):
        return _dns_read_name(data, off)[0]
    if rtype == 15:
        pref = int.from_bytes(rd[:2], "big")
        return f"{pref} {_dns_read_name(data, off + 2)[0]}"
    if rtype == 16:
        parts, i = [], 0
        while i < rdlen:
            ln = rd[i]
            parts.append(rd[i + 1:i + 1 + ln].decode("utf-8", "replace"))
            i += 1 + ln
        return "".join(parts)
    if rtype == 33:  # SRV
        pri, wt, port = (int.from_bytes(rd[i:i + 2], "big") for i in (0, 2, 4))
        return f"{pri} {wt} {port} {_dns_read_name(data, off + 6)[0]}"
    if rtype == 6:  # SOA
        mname, o2 = _dns_read_name(data, off)
        rname, _ = _dns_read_name(data, o2)
        return f"{mname} {rname}"
    if rtype == 257:  # CAA
        flags = rd[0]
        tlen = rd[1]
        tag = rd[2:2 + tlen].decode("ascii", "replace")
        val = rd[2 + tlen:].decode("utf-8", "replace")
        return f"{flags} {tag} {val}"
    return rd.hex()


def _dns_query(resolver: str, port: int, name: str, rtype: int, timeout: float) -> list[str]:
    tid = random.randint(0, 0xFFFF)
    header = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    query = header + _dns_encode_name(name) + struct.pack(">HH", rtype, 1)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(query, (resolver, port))
        data, _ = sock.recvfrom(4096)
    finally:
        sock.close()
    ancount = struct.unpack(">H", data[6:8])[0]
    # pula o cabeçalho + a pergunta
    _, off = _dns_read_name(data, 12)
    off += 4  # qtype + qclass
    records = []
    for _ in range(ancount):
        _, off = _dns_read_name(data, off)
        atype, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[off:off + 10])
        off += 10
        if atype == rtype:
            records.append(_dns_decode_rdata(atype, data, off, rdlen))
        off += rdlen
    return records


def _dns_condition_ok(op: str, value: str, records: list[str]) -> bool:
    def any_(pred):
        return any(pred(r) for r in records)
    if op == "equal":
        return any_(lambda r: r == value)
    if op == "not_equal":
        return not any_(lambda r: r == value)
    if op == "contains":
        return any_(lambda r: value in r)
    if op == "not_contains":
        return not any_(lambda r: value in r)
    if op == "starts_with":
        return any_(lambda r: r.startswith(value))
    if op == "not_starts_with":
        return not any_(lambda r: r.startswith(value))
    if op == "ends_with":
        return any_(lambda r: r.endswith(value))
    if op == "not_ends_with":
        return not any_(lambda r: r.endswith(value))
    return True


def check_dns(cfg: dict, timeout: float) -> dict:
    name = cfg.get("hostname", "")
    resolvers = cfg.get("resolvers") or ["1.1.1.1"]
    port = int(cfg.get("port", 53))
    rtype = _DNS_TYPES.get(str(cfg.get("record_type", "a")).lower(), 1)
    conditions = cfg.get("conditions") or []
    started = time.monotonic()
    last_err = "sem resposta"
    for resolver in resolvers:
        try:
            records = _dns_query(resolver, port, name, rtype, timeout)
        except Exception as exc:  # noqa: BLE001 — tenta o próximo resolvedor
            last_err = str(exc) or type(exc).__name__
            continue
        latency = int((time.monotonic() - started) * 1000)
        if not records:
            last_err = "nenhum registro retornado"
            continue
        for c in conditions:
            if not _dns_condition_ok(c.get("operator", ""), c.get("value", ""), records):
                return {"ok": False, "code": "", "latency_ms": latency,
                        "message": f"condição falhou: {c.get('operator')} {c.get('value')}"}
        return {"ok": True, "code": str(len(records)), "latency_ms": latency,
                "message": ", ".join(records[:3])}
    return {"ok": False, "code": "", "latency_ms": int((time.monotonic() - started) * 1000),
            "reason": "dns_failure", "message": last_err}


# --------------------------------------------------------------------------- #
# Checagem Container (Docker Engine)
# --------------------------------------------------------------------------- #
def check_container(cfg: dict, timeout: float) -> dict:
    from . import dockerclient
    if not dockerclient.available():
        return {"ok": False, "code": "", "latency_ms": 0, "message": "Docker indisponível"}
    name = cfg.get("container", "")
    try:
        info = dockerclient.inspect_container(name)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "code": "", "latency_ms": 0, "message": str(exc)}
    if not info:
        return {"ok": False, "code": "", "latency_ms": 0, "message": "container não encontrado"}
    state = info.get("State") or {}
    health = (state.get("Health") or {}).get("Status")
    if health:
        return {"ok": health == "healthy", "code": health, "latency_ms": 0,
                "message": f"health: {health}"}
    running = bool(state.get("Running"))
    return {"ok": running, "code": state.get("Status", ""), "latency_ms": 0,
            "message": state.get("Status", "")}


# --------------------------------------------------------------------------- #
# Checagem de validade do domínio (RDAP)
# --------------------------------------------------------------------------- #
def check_domain(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    inspection = domaincheck.check(str(cfg.get("domain", "")), timeout=max(5.0, timeout))
    status = str(inspection.get("status") or "unavailable")
    ok = status in ("valid", "expiring", "unknown")
    reason = {
        "expired": "domain_expired",
        "not_found": "domain_not_found",
        "unavailable": "domain_unavailable",
    }.get(status, "down")
    result = {
        "ok": ok,
        "code": status,
        "latency_ms": int((time.monotonic() - started) * 1000),
        "message": str(inspection.get("message") or ""),
        "domain": inspection,
    }
    if not ok:
        result["reason"] = reason
    return result


# --------------------------------------------------------------------------- #
# Checagens de bancos e mensageria
# --------------------------------------------------------------------------- #
def _argument_value(raw: str):
    """Converte valores simples/JSON dos argumentos opcionais dos drivers."""
    value = str(raw).strip()
    if not value:
        return ""
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def _connection_arguments(cfg: dict) -> dict:
    return {
        str(item.get("key", "")).strip(): _argument_value(item.get("value", ""))
        for item in (cfg.get("arguments") or [])
        if isinstance(item, dict) and str(item.get("key", "")).strip()
    }


def _connection_failure(started: float, exc: Exception, cfg: dict) -> dict:
    message = str(exc) or type(exc).__name__
    for secret in (str(cfg.get("password") or ""), str(cfg.get("uri") or "")):
        if secret:
            message = message.replace(secret, "********")
    message = re.sub(r"([a-z][a-z0-9+.-]*://[^:/@\s]+:)[^@\s]+@",
                     r"\1********@", message, flags=re.IGNORECASE)
    message = re.sub(r"((?:password|passwd|pwd|secret|token)=)[^&\s]+",
                     r"\1********", message, flags=re.IGNORECASE)
    return {
        "ok": False, "code": "", "latency_ms": int((time.monotonic() - started) * 1000),
        "reason": _classify_exc(exc), "message": message,
    }


def check_postgresql(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    conn = None
    try:
        import psycopg2
        args = _connection_arguments(cfg)
        args.setdefault("connect_timeout", max(1, math.ceil(timeout)))
        if cfg.get("connection_mode") == "uri":
            conn = psycopg2.connect(str(cfg.get("uri", "")), **args)
        else:
            args.update({
                "host": cfg.get("host", ""), "port": int(cfg.get("port") or 5432),
            })
            if cfg.get("username"):
                args["user"] = cfg["username"]
            if cfg.get("password"):
                args["password"] = cfg["password"]
            if cfg.get("database"):
                args["dbname"] = cfg["database"]
            conn = psycopg2.connect(**args)
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return {
            "ok": True, "code": str(getattr(conn, "server_version", "postgresql")),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "message": "PostgreSQL respondeu SELECT 1",
        }
    except Exception as exc:  # noqa: BLE001 — o driver varia por versão
        return _connection_failure(started, exc, cfg)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def _mysql_connection_args(cfg: dict, timeout: float) -> dict:
    args = _connection_arguments(cfg)
    if cfg.get("connection_mode") == "uri":
        parts = urllib.parse.urlsplit(str(cfg.get("uri", "")))
        query = {key: _argument_value(value) for key, value in urllib.parse.parse_qsl(parts.query)}
        args = {**query, **args}
        args.update({
            "host": parts.hostname or "", "port": parts.port or 3306,
        })
        if parts.username is not None:
            args["user"] = urllib.parse.unquote(parts.username)
        if parts.password is not None:
            args["password"] = urllib.parse.unquote(parts.password)
        if parts.path and parts.path != "/":
            args["database"] = urllib.parse.unquote(parts.path.lstrip("/"))
    else:
        args.update({
            "host": cfg.get("host", ""), "port": int(cfg.get("port") or 3306),
        })
        if cfg.get("username"):
            args["user"] = cfg["username"]
        if cfg.get("password"):
            args["password"] = cfg["password"]
        if cfg.get("database"):
            args["database"] = cfg["database"]
    args.setdefault("connect_timeout", max(1, math.ceil(timeout)))
    args.setdefault("read_timeout", max(1, math.ceil(timeout)))
    args.setdefault("write_timeout", max(1, math.ceil(timeout)))
    return args


def check_mysql(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    conn = None
    try:
        import pymysql
        conn = pymysql.connect(**_mysql_connection_args(cfg, timeout))
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return {
            "ok": True, "code": str(conn.get_server_info() or "mysql"),
            "latency_ms": int((time.monotonic() - started) * 1000),
            "message": "MySQL/MariaDB respondeu SELECT 1",
        }
    except Exception as exc:  # noqa: BLE001
        return _connection_failure(started, exc, cfg)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


def check_mongodb(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    client = None
    try:
        from pymongo import MongoClient
        args = _connection_arguments(cfg)
        timeout_ms = max(1, math.ceil(timeout * 1000))
        args.setdefault("serverSelectionTimeoutMS", timeout_ms)
        args.setdefault("connectTimeoutMS", timeout_ms)
        args.setdefault("socketTimeoutMS", timeout_ms)
        if cfg.get("connection_mode") == "uri":
            client = MongoClient(str(cfg.get("uri", "")), **args)
            database = client.get_default_database(default="admin")
        else:
            args.update({
                "host": cfg.get("host", ""), "port": int(cfg.get("port") or 27017),
                "username": cfg.get("username") or None,
                "password": cfg.get("password") or None,
            })
            client = MongoClient(**args)
            database = client[str(cfg.get("database") or "admin")]
        database.command("ping")
        return {
            "ok": True, "code": "ping", "latency_ms": int((time.monotonic() - started) * 1000),
            "message": "MongoDB respondeu ping",
        }
    except Exception as exc:  # noqa: BLE001
        return _connection_failure(started, exc, cfg)
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass


def check_redis(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    client = None
    try:
        import redis
        args = _connection_arguments(cfg)
        args.setdefault("socket_connect_timeout", timeout)
        args.setdefault("socket_timeout", timeout)
        if cfg.get("connection_mode") == "uri":
            client = redis.from_url(str(cfg.get("uri", "")), **args)
        else:
            args.update({
                "host": cfg.get("host", ""), "port": int(cfg.get("port") or 6379),
                "username": cfg.get("username") or None,
                "password": cfg.get("password") or None,
                "db": int(cfg.get("database") or 0),
            })
            client = redis.Redis(**args)
        if client.ping() is not True:
            raise ConnectionError("Redis não respondeu PONG")
        return {
            "ok": True, "code": "PONG", "latency_ms": int((time.monotonic() - started) * 1000),
            "message": "Redis respondeu PONG",
        }
    except Exception as exc:  # noqa: BLE001
        return _connection_failure(started, exc, cfg)
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass


def check_rabbitmq(cfg: dict, timeout: float) -> dict:
    started = time.monotonic()
    conn = None
    try:
        import pika
        if cfg.get("connection_mode") == "uri":
            params = pika.URLParameters(str(cfg.get("uri", "")))
            params.socket_timeout = timeout
            params.blocked_connection_timeout = timeout
        else:
            args = _connection_arguments(cfg)
            args.update({
                "host": cfg.get("host", ""), "port": int(cfg.get("port") or 5672),
                "virtual_host": cfg.get("database") or "/",
                "credentials": pika.PlainCredentials(
                    str(cfg.get("username") or "guest"), str(cfg.get("password") or "guest")),
            })
            args.setdefault("socket_timeout", timeout)
            args.setdefault("blocked_connection_timeout", timeout)
            params = pika.ConnectionParameters(**args)
        conn = pika.BlockingConnection(params)
        if not conn.is_open:
            raise ConnectionError("RabbitMQ não abriu a conexão AMQP")
        return {
            "ok": True, "code": "AMQP", "latency_ms": int((time.monotonic() - started) * 1000),
            "message": "RabbitMQ aceitou a conexão AMQP",
        }
    except Exception as exc:  # noqa: BLE001
        return _connection_failure(started, exc, cfg)
    finally:
        if conn is not None and conn.is_open:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass


_CHECKERS = {
    "http": check_http,
    "tcp": check_tcp,
    "ping": check_ping,
    "dns": check_dns,
    "domain": check_domain,
    "postgresql": check_postgresql,
    "mysql": check_mysql,
    "mongodb": check_mongodb,
    "redis": check_redis,
    "rabbitmq": check_rabbitmq,
    "container": check_container,
}


# --------------------------------------------------------------------------- #
# Persistência do resultado
# --------------------------------------------------------------------------- #
def _proxy_label(p: dict) -> str:
    """Rótulo do proxy usado na checagem — só o IP/host do servidor."""
    return str(p.get("server", ""))


def _record(monitor_id: int, mtype: str, cfg: dict, timeout: int, max_retries: int,
            resend_every: int) -> None:
    checker = _CHECKERS.get(mtype)
    if checker is None:
        return
    check_ssl = bool(cfg.pop("_check_ssl", False))
    proxies = cfg.pop("_proxies", []) if mtype == "http" else []
    ssl_proxy = None
    if proxies:
        mode = cfg.get("proxy_mode", "round_robin")
        if mode == "all":
            results = [checker({**cfg, "_proxy": proxy}, timeout) for proxy in proxies]
            ssl_proxy = proxies[0]
            up_count = sum(1 for item in results if item.get("ok"))
            total = len(results)
            # Fica `up` se PELO MENOS um proxy responder; disponibilidade = ok/total.
            ok = up_count > 0
            # Tempo de resposta = média dos proxies que responderam (ok).
            ok_lats = [int(item.get("latency_ms", 0)) for item in results if item.get("ok")]
            avg_latency = round(sum(ok_lats) / len(ok_lats)) if ok_lats else \
                max((int(item.get("latency_ms", 0)) for item in results), default=0)
            result = {
                "ok": ok,
                "up_ratio": up_count / total if total else 0.0,
                "code": ",".join(str(item.get("code", "")) for item in results),
                "latency_ms": avg_latency,
                "message": " | ".join(f"{proxy['server']}:{proxy['port']}: {item.get('message', '')}" for proxy, item in zip(proxies, results)),
                # Proxies separados por ";" (o front mostra 1 por linha), com o
                # tempo de resposta (ou "falha") de cada um.
                "proxy": "; ".join(
                    f"{proxy['server']}: {item.get('latency_ms', 0)} ms" if item.get("ok")
                    else f"{proxy['server']}: falha"
                    for proxy, item in zip(proxies, results)),
            }
            # Algum proxy falhou → evento proxy_failure (mesmo que ainda `up`).
            if up_count < total:
                result["proxy_failure"] = True
                result["reason"] = next((item.get("reason") for item in results if not item["ok"]), "proxy_failure")
        else:
            with _state_lock:
                cursor = _proxy_cursor.get(monitor_id, 0) % len(proxies)
                _proxy_cursor[monitor_id] = cursor + 1
            ssl_proxy = proxies[cursor]
            result = checker({**cfg, "_proxy": ssl_proxy}, timeout)
            result["message"] = f"{ssl_proxy['server']}:{ssl_proxy['port']}: {result.get('message', '')}"
            result["proxy"] = _proxy_label(ssl_proxy)
    else:
        result = checker(cfg, timeout)
    if check_ssl and _ssl_enabled(mtype, cfg):
        result["ssl"] = _ssl_probe(mtype, cfg, timeout, ssl_proxy)
    try:
        threshold = int(cfg.get("latency_threshold_ms") or 0)
    except (TypeError, ValueError):
        threshold = 0
    try:
        window_seconds = int(cfg.get("latency_window_seconds") or _DEFAULT_SLOW_WINDOW_SECONDS)
    except (TypeError, ValueError):
        window_seconds = _DEFAULT_SLOW_WINDOW_SECONDS
    _persist_result(monitor_id, result, max_retries, resend_every,
                    latency_threshold=threshold, latency_window_seconds=window_seconds,
                    record_last_only=bool(cfg.get("record_last_only", False)))


def _persist_result(monitor_id: int, result: dict, max_retries: int,
                    resend_every: int, latency_threshold: int = 0,
                    latency_window_seconds: int = _DEFAULT_SLOW_WINDOW_SECONDS,
                    update_last_check: bool = True,
                    record_last_only: bool = False) -> None:
    """Aplica um resultado de checagem (de checker ativo ou beat push): status,
    heartbeat, agregação, eventos, notificações e bump do SSE."""
    ok = bool(result["ok"])

    with _state_lock:
        if ok:
            _fail_count[monitor_id] = 0
        else:
            _fail_count[monitor_id] = _fail_count.get(monitor_id, 0) + 1
        fails = _fail_count[monitor_id]

    now = _now_ms()
    latency = int(result.get("latency_ms", 0))

    # Tempo de resposta MÉDIO da janela configurada acima do limite → estado/evento
    # "degraded". Enquanto a média ficar acima do limite o monitor fica
    # "degraded" (desempenho degradado) em vez de "up"; volta a "up" ao
    # normalizar. O evento em si só dispara na 1ª vez (dedup até normalizar).
    fire_degraded = False
    is_degraded = False
    slow_avg = latency
    if latency_threshold > 0:
        with _state_lock:
            if ok:
                samples = _slow_samples.setdefault(monitor_id, [])
                samples.append((now, latency))
                cutoff = now - latency_window_seconds * 1000
                samples[:] = [(t, l) for (t, l) in samples if t >= cutoff]
                slow_avg = round(sum(l for _, l in samples) / len(samples))
                if slow_avg > latency_threshold:
                    slow_since = _slow_since.setdefault(monitor_id, now)
                    if now - slow_since >= latency_window_seconds * 1000:
                        is_degraded = True
                        if not _slow_flagged.get(monitor_id):
                            _slow_flagged[monitor_id] = True
                            fire_degraded = True
                else:
                    # normalizou: zera a flag para poder disparar de novo depois.
                    _slow_since.pop(monitor_id, None)
                    _slow_flagged.pop(monitor_id, None)
            else:
                # caiu: descarta a janela e a flag.
                _slow_samples.pop(monitor_id, None)
                _slow_since.pop(monitor_id, None)
                _slow_flagged.pop(monitor_id, None)
    else:
        with _state_lock:
            _slow_samples.pop(monitor_id, None)
            _slow_since.pop(monitor_id, None)
            _slow_flagged.pop(monitor_id, None)
    if latency_window_seconds == 60:
        window_label = "no último minuto"
    elif latency_window_seconds == 3600:
        window_label = "na última hora"
    else:
        window_label = f"nos últimos {latency_window_seconds // 60} minutos"
    slow_msg = (f"Média do tempo de resposta {window_label}: {slow_avg} ms, "
                f"acima do limite ({latency_threshold} ms).")

    # Lógica de tentativas: cai p/ down após exceder max_retries falhas seguidas.
    # Quando está no ar mas lento de forma sustentada, fica "degraded".
    if ok:
        new_status = "degraded" if is_degraded else "up"
    elif fails > max_retries:
        new_status = "down"
    else:
        new_status = "pending"

    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            return
        prev_status = row.status
        row.status = new_status
        if update_last_check:
            row.last_check_ts = now
        ssl_result = result.get("ssl")
        if isinstance(ssl_result, dict):
            result["_previous_ssl_status"] = row.ssl_status or ""
            row.ssl_status = str(ssl_result.get("status") or "unavailable")[:20]
            row.ssl_checked_ts = now
            issued_ts = int(ssl_result.get("issued_ts") or 0)
            expires_ts = int(ssl_result.get("expires_ts") or 0)
            if issued_ts:
                row.ssl_issued_ts = issued_ts
            if expires_ts:
                row.ssl_expires_ts = expires_ts
            row.ssl_message = str(ssl_result.get("message") or "")[:500]
        domain_result = result.get("domain")
        if isinstance(domain_result, dict):
            result["_previous_domain_status"] = row.domain_status or ""
            row.domain_status = str(domain_result.get("status") or "unavailable")[:20]
            row.domain_checked_ts = now
            registered_ts = int(domain_result.get("registered_ts") or 0)
            domain_expires_ts = int(domain_result.get("expires_ts") or 0)
            if row.domain_status != "unavailable":
                row.domain_registered_ts = registered_ts
                row.domain_expires_ts = domain_expires_ts
            row.domain_message = str(domain_result.get("message") or "")[:500]
        # Disponibilidade fracionária da checagem (modo proxy `all` parcial).
        _ratio = result.get("up_ratio")
        ratio = float(_ratio) if isinstance(_ratio, (int, float)) else (1.0 if ok else 0.0)
        ratio = max(0.0, min(1.0, ratio))
        _timings = result.get("timings")
        s.add(MonitorHeartbeat(
            monitor_id=monitor_id, ts=now,
            status="up" if ok else "down",
            latency_ms=latency,
            code=str(result.get("code", ""))[:40],
            message=str(result.get("message", ""))[:500],
            timings=json.dumps(_timings) if isinstance(_timings, dict) else "",
            proxy=str(result.get("proxy", ""))[:500],
            up_ratio=ratio,
            meta=json.dumps(result["meta"]) if isinstance(result.get("meta"), dict) else "",
        ))

        # "Registrar apenas o último": zera timings/meta dos heartbeats anteriores
        # (o filtro limita ao único que ainda tem detalhe — sem varrer todo o histórico).
        if record_last_only:
            (s.query(MonitorHeartbeat)
             .filter(MonitorHeartbeat.monitor_id == monitor_id,
                     MonitorHeartbeat.ts < now,
                     or_(MonitorHeartbeat.timings != "", MonitorHeartbeat.meta != ""))
             .update({MonitorHeartbeat.timings: "", MonitorHeartbeat.meta: ""},
                     synchronize_session=False))

        # Agregação horária (uptime de longo prazo) — ponderada pela fração.
        bucket_ts = (now // 3_600_000) * 3_600_000
        stat = (s.query(MonitorStat)
                .filter(MonitorStat.monitor_id == monitor_id,
                        MonitorStat.bucket_ts == bucket_ts).one_or_none())
        if stat is None:
            stat = MonitorStat(monitor_id=monitor_id, bucket_ts=bucket_ts)
            s.add(stat)
        stat.up = (stat.up or 0) + ratio
        stat.down = (stat.down or 0) + (1 - ratio)
        if ok:
            stat.ping_sum = (stat.ping_sum or 0) + latency
            stat.ping_count = (stat.ping_count or 0) + 1

        # Falha parcial de proxy (ainda `up`): evento proxy_failure com dedup.
        partial_proxy = bool(result.get("proxy_failure")) and ok
        if partial_proxy and not _proxy_partial.get(monitor_id):
            _proxy_partial[monitor_id] = True
            fire_proxy_failure = True
            s.add(MonitorEvent(monitor_id=monitor_id, ts=now, type="proxy_failure",
                               message=result.get("message", "") or "Falha parcial de proxy"))
        else:
            fire_proxy_failure = False
            if not partial_proxy:
                _proxy_partial.pop(monitor_id, None)

        # Evento de transição de saúde (classificado pelo motivo da queda).
        down_reason = result.get("reason") or "down"
        if new_status == "up" and prev_status != "up":
            s.add(MonitorEvent(monitor_id=monitor_id, ts=now, type="recovery",
                               message=result.get("message", "") or "Serviço saudável"))
        elif new_status == "down" and prev_status != "down":
            s.add(MonitorEvent(monitor_id=monitor_id, ts=now, type=down_reason,
                               message=result.get("message", "") or "Serviço indisponível"))
        if fire_degraded:
            s.add(MonitorEvent(monitor_id=monitor_id, ts=now, type="degraded", message=slow_msg))

        # Poda: mantém só os N heartbeats mais recentes.
        old_ids = [r.id for r in (
            s.query(MonitorHeartbeat.id)
            .filter(MonitorHeartbeat.monitor_id == monitor_id)
            .order_by(MonitorHeartbeat.ts.desc())
            .offset(_KEEP_HEARTBEATS).all())]
        if old_ids:
            s.query(MonitorHeartbeat).filter(
                MonitorHeartbeat.id.in_(old_ids)).delete(synchronize_session=False)
        s.commit()

    _maybe_notify(monitor_id, prev_status, new_status, fails, resend_every, result)
    if fire_degraded:
        notify_event(monitor_id, "degraded", slow_msg)
    if fire_proxy_failure:
        notify_event(monitor_id, "proxy_failure", result.get("message", "") or "Falha parcial de proxy")
    _bump_version()


def _monitor_name(monitor_id: int) -> str:
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        return row.name if row else f"#{monitor_id}"


def _notify(subject: str, message: str, channel_ids: list[int] | None) -> None:
    """Dispara o broadcast numa thread (não bloqueia a checagem)."""
    from . import notifications

    def run():
        try:
            notifications.broadcast(subject, message, channel_ids)
        except Exception as exc:  # noqa: BLE001
            print(f"monitorworker: falha ao notificar: {exc}", flush=True)

    threading.Thread(target=run, name="monitor-notify", daemon=True).start()


def notify_event(monitor_id: int, event_type: str, message: str, *, name: str | None = None) -> None:
    """Monta o assunto (emoji do catálogo) e notifica os canais vinculados ao monitor."""
    from . import monitors
    subject = monitors.event_subject(event_type, name or _monitor_name(monitor_id))
    print(f"monitor {monitor_id}: {subject}", flush=True)
    _notify(subject, message, monitors.monitor_channel_ids(monitor_id))


def _maybe_notify(monitor_id: int, prev: str, new: str, fails: int,
                  resend_every: int, result: dict) -> None:
    """Notifica os canais habilitados nas transições de estado (e reincidências)."""
    became_down = new == "down" and prev != "down"
    recovered = new == "up" and prev == "down"
    resend = (new == "down" and resend_every > 0
              and fails > 0 and (fails % resend_every == 0))

    # O SSL só aparece no resultado da inspeção diária/manual. Heartbeats
    # intermediários não limpam a deduplicação desse alerta.
    ssl_result = result.get("ssl")
    fire_ssl = None
    if isinstance(ssl_result, dict):
        ssl_status = str(ssl_result.get("status") or "")
        previous_ssl_status = str(result.get("_previous_ssl_status") or "")
        if ssl_status in ("expiring", "expired") and ssl_status != previous_ssl_status:
            fire_ssl = ssl_status
    if fire_ssl:
        name = _monitor_name(monitor_id)
        event_type = "ssl_expired" if fire_ssl == "expired" else "ssl_expiring"
        detail = str(ssl_result.get("message") or "")
        from . import monitors
        monitors.add_event(monitor_id, event_type, detail)
        notify_event(monitor_id, event_type, detail, name=name)

    # Expiração próxima ainda é um estado saudável, portanto precisa de evento
    # próprio. Expirado/não encontrado são tratados pela transição para `down`.
    domain_result = result.get("domain")
    if (isinstance(domain_result, dict)
            and str(domain_result.get("status") or "") == "expiring"
            and str(result.get("_previous_domain_status") or "") != "expiring"):
        name = _monitor_name(monitor_id)
        event_type = "domain_expiring"
        detail = str(domain_result.get("message") or "")
        from . import monitors
        monitors.add_event(monitor_id, event_type, detail)
        notify_event(monitor_id, event_type, detail, name=name)

    if not (became_down or recovered or resend):
        return
    detail = result.get("message", "")
    if recovered:
        notify_event(monitor_id, "recovery", "O serviço voltou a responder.")
    elif resend:
        etype = result.get("reason") or "down"
        notify_event(monitor_id, etype, f"{fails} falhas consecutivas. {detail}".strip())
    else:
        etype = result.get("reason") or "down"
        notify_event(monitor_id, etype, detail or "O serviço não está respondendo.")


# --------------------------------------------------------------------------- #
# Agendador
# --------------------------------------------------------------------------- #
def _dispatch(mid: int, mtype: str, cfg: dict, timeout: int, max_retries: int,
              resend_every: int) -> None:
    def run():
        try:
            _record(mid, mtype, cfg, timeout, max_retries, resend_every)
        except Exception as exc:  # noqa: BLE001 — uma checagem nunca derruba o motor
            print(f"monitorworker: erro na checagem do monitor {mid}: {exc}", flush=True)
        finally:
            with _state_lock:
                _inflight.discard(mid)
            _pool_sem.release()

    threading.Thread(target=run, name=f"monitor-{mid}", daemon=True).start()


def _scheduler() -> None:
    while not _stop.is_set():
        try:
            _tick()
        except Exception as exc:  # noqa: BLE001 — o agendador nunca deve morrer
            print(f"monitorworker: erro no agendador: {exc}", flush=True)
        _stop.wait(_TICK_SECONDS)


def _tick() -> None:
    now = time.monotonic()
    now_ms = _now_ms()
    # Monitores sob janela de manutenção ativa não são checados (evita falsos
    # down/notificações enquanto o serviço está em manutenção programada).
    try:
        from . import maintenances
        maint_ids = maintenances.active_monitor_ids(now_ms)
    except Exception as exc:  # noqa: BLE001 — manutenção nunca derruba o agendador
        print(f"monitorworker: erro ao ler manutenções: {exc}", flush=True)
        maint_ids = set()
    global _maintenance_active
    entered = maint_ids - _maintenance_active   # começaram a manutenção agora
    left = _maintenance_active - maint_ids       # saíram da manutenção agora
    with get_session() as s:
        rows = s.query(Monitor).filter(Monitor.active == True).all()  # noqa: E712
        proxy_rows = s.query(MonitorProxy).filter(MonitorProxy.enabled == True).order_by(MonitorProxy.id).all()  # noqa: E712
        proxies_by_id = {}
        for proxy in proxy_rows:
            proxies_by_id[proxy.id] = {
                "protocol": proxy.protocol, "server": proxy.server, "port": proxy.port,
                "username": proxy.username, "password": proxy.password,
            }
        for mid in entered:
            s.add(MonitorEvent(monitor_id=mid, ts=now_ms, type="maintenance_start",
                               message="Entrou em janela de manutenção"))
        for mid in left:
            s.add(MonitorEvent(monitor_id=mid, ts=now_ms, type="maintenance_end",
                               message="Saiu da janela de manutenção"))
        active_ids = set()
        due = []
        push_down = []   # monitores push sem beat dentro do intervalo → marcar down
        for row in rows:
            active_ids.add(row.id)
            if row.id in maint_ids:
                # Em manutenção: pula a checagem e mostra status "maintenance".
                if row.status != "maintenance":
                    row.status = "maintenance"
                continue
            if row.status == "maintenance":
                # Saiu da manutenção: reseta p/ pending; será rechecado neste tick.
                row.status = "pending"
            if row.type == "push":
                # Watchdog: após intervalo + tolerância, registra falhas na cadência
                # do heartbeat para permitir retentativas e reenvios de notificação.
                try:
                    push_cfg = json.loads(row.config)
                except (TypeError, ValueError, json.JSONDecodeError):
                    push_cfg = {}
                try:
                    grace_period = int(push_cfg.get("grace_period_seconds", _DEFAULT_PUSH_GRACE_SECONDS))
                except (TypeError, ValueError):
                    grace_period = _DEFAULT_PUSH_GRACE_SECONDS
                grace = int(row.interval_seconds) + max(0, grace_period)
                overdue = bool(row.last_check_ts and now_ms - row.last_check_ts > grace * 1000)
                scheduled = _next_push_failure.get(row.id)
                if overdue and (scheduled is None or now >= scheduled):
                    push_down.append((row.id, row.max_retries, row.resend_every))
                    _next_push_failure[row.id] = now + max(1, int(row.interval_seconds))
                elif not overdue:
                    _next_push_failure.pop(row.id, None)
                continue
            if row.type not in _CHECKERS:
                continue
            scheduled = _next_run.get(row.id)
            if row.type == "domain" and scheduled is None and row.domain_checked_ts:
                remaining_ms = _DAILY_CHECK_INTERVAL_MS - (now_ms - row.domain_checked_ts)
                if remaining_ms > 0:
                    with _state_lock:
                        _next_run[row.id] = now + remaining_ms / 1000
                    continue
            if scheduled is None or now >= scheduled:
                try:
                    cfg = json.loads(row.config)
                except (TypeError, ValueError, json.JSONDecodeError):
                    cfg = {}
                cfg["_proxies"] = [proxies_by_id[pid] for pid in cfg.get("proxy_ids", []) if pid in proxies_by_id]
                if (_ssl_enabled(row.type, cfg)
                        and (not row.ssl_checked_ts
                             or now_ms - row.ssl_checked_ts >= _DAILY_CHECK_INTERVAL_MS)):
                    cfg["_check_ssl"] = True
                due.append((row.id, row.type, cfg, row.timeout_seconds,
                            row.max_retries, row.resend_every, row.interval_seconds))
        # Persiste transições de status (maintenance) e os eventos de manutenção.
        s.commit()

    if entered or left:
        _maintenance_active = set(maint_ids)
        _bump_version()  # atualiza o SSE com o novo status

    # Limpa estado de monitores que sumiram/foram desativados.
    with _state_lock:
        scheduled_ids = set(_next_run) | set(_next_push_failure)
        for stale in [mid for mid in scheduled_ids if mid not in active_ids]:
            _next_run.pop(stale, None)
            _next_push_failure.pop(stale, None)
            _fail_count.pop(stale, None)
            _slow_samples.pop(stale, None)
            _slow_since.pop(stale, None)
            _slow_flagged.pop(stale, None)
            _proxy_partial.pop(stale, None)

    # Push sem beat no prazo → marca down (uma vez por transição).
    for mid, max_retries, resend_every in push_down:
        try:
            _persist_result(mid, {"ok": False, "code": "push", "latency_ms": 0,
                                  "reason": "timeout",
                                  "message": "sem beat dentro do intervalo"},
                            max_retries, resend_every, update_last_check=False)
        except Exception as exc:  # noqa: BLE001
            print(f"monitorworker: erro no watchdog push {mid}: {exc}", flush=True)

    for mid, mtype, cfg, timeout, max_retries, resend_every, interval in due:
        with _state_lock:
            if mid in _inflight:
                continue
        if not _pool_sem.acquire(blocking=False):
            break  # pool cheio; tenta no próximo tick
        with _state_lock:
            _inflight.add(mid)
            _next_run[mid] = now + max(1, interval)
        _dispatch(mid, mtype, cfg, timeout, max_retries, resend_every)


def start() -> None:
    global _scheduler_thread
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _stop.clear()
    _scheduler_thread = threading.Thread(target=_scheduler, name="monitor-scheduler", daemon=True)
    _scheduler_thread.start()


def check_now(monitor_id: int) -> None:
    """Roda uma checagem imediata do monitor (usado pelo endpoint de teste)."""
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None or row.type not in _CHECKERS:
            return
        try:
            cfg = json.loads(row.config)
        except (TypeError, ValueError, json.JSONDecodeError):
            cfg = {}
        selected = set(cfg.get("proxy_ids", []))
        cfg["_proxies"] = [{"protocol": p.protocol, "server": p.server, "port": p.port,
                            "username": p.username, "password": p.password}
                           for p in s.query(MonitorProxy).filter(MonitorProxy.enabled == True).order_by(MonitorProxy.id).all()  # noqa: E712
                           if p.id in selected]
        if _ssl_enabled(row.type, cfg):
            cfg["_check_ssl"] = True
        mtype, timeout, max_retries, resend, interval = (
            row.type, row.timeout_seconds, row.max_retries, row.resend_every,
            row.interval_seconds)
    _record(monitor_id, mtype, cfg, timeout, max_retries, resend)
    with _state_lock:
        _next_run[monitor_id] = time.monotonic() + max(1, interval)


# --------------------------------------------------------------------------- #
# Monitores push (heartbeat via webhook)
# --------------------------------------------------------------------------- #
def push_beat(token: str, status: str = "up", message: str = "") -> bool:
    """Registra um beat recebido no webhook. Devolve False se o token é inválido."""
    from . import monitors
    mon = monitors.find_push_monitor(token)
    if mon is None:
        return False
    ok = status.lower() not in ("down", "fail", "failed", "error", "0", "false")
    result = {"ok": ok, "code": "push", "latency_ms": 0,
              "message": message or ("beat recebido" if ok else "beat de falha")}
    if not ok:
        result["reason"] = "down"
    with _state_lock:
        _next_push_failure.pop(mon["id"], None)
    _persist_result(mon["id"], result, mon["max_retries"], mon["resend_every"])
    return True
