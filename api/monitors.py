"""Store/lógica de Monitores (healthcheck) e seus Grupos.

Um Monitor tem um `type` (HTTP/rede/domínio/bancos/mensageria/container/push) e
campos específicos guardados no JSON
`config`. Cada monitor pode pertencer a um Grupo (`group_id`, opcional).

O motor de execução real (thread que roda os checks, marca up/down e grava
heartbeats) fica em `api/monitorworker.py`; este módulo é só CRUD + validação.

Segredos do `config` (senhas/tokens de autenticação, chave privada mTLS) são
**mascarados** nas respostas e, num update, um valor vazio/mascarado mantém o
segredo salvo — mesmo padrão de `s3configs.py`/`projects.py`.
"""
from __future__ import annotations

import json
import secrets
import time
import urllib.parse

from sqlalchemy import func

from .db import get_session
from .db.models import (Monitor, MonitorEvent, MonitorGroup, MonitorHeartbeat,
                        MonitorIncident, MonitorIncidentUpdate, MonitorStat,
                        MonitorTag, MonitorTagLink)
from .domaincheck import DomainCheckError, normalize_domain

MASK = "********"

# Tipos de monitor implementados (form + motor de execução).
TYPES = ("http", "tcp", "ping", "dns", "domain", "postgresql", "mysql",
         "mongodb", "redis", "rabbitmq", "container", "push")
IMPLEMENTED_TYPES = TYPES

# Monitores push (heartbeat): recebem beats via webhook em vez de checar ativamente.
PUSH_INTERVAL_MIN = 15
# Tolerância extra além do intervalo antes de marcar down (segundos).
PUSH_GRACE_SECONDS = 5
PUSH_GRACE_MIN = 0
PUSH_GRACE_MAX = 86400
# Caminho público do webhook de heartbeat (o {token} é anexado).
PUSH_URL_PREFIX = "/uptime/heartbeats"


_B62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _b62(n: int) -> str:
    if n == 0:
        return "0"
    out = []
    while n:
        n, r = divmod(n, 62)
        out.append(_B62_ALPHABET[r])
    return "".join(reversed(out))


def _uuid7() -> str:
    """UUID v7 (timestamp ms de 48 bits + aleatório) codificado em **base62**
    (~22 chars, ordenável por tempo), mais curto que a forma hex."""
    ts = int(time.time() * 1000) & ((1 << 48) - 1)
    rand = secrets.token_bytes(10)
    b = bytearray(ts.to_bytes(6, "big") + rand)
    b[6] = (b[6] & 0x0F) | 0x70          # versão 7
    b[8] = (b[8] & 0x3F) | 0x80          # variante RFC 4122
    return _b62(int.from_bytes(b, "big"))

STATUSES = ("pending", "up", "down", "degraded", "maintenance")

# Catálogo de eventos (chave → emoji/label/categoria). Espelhado no front em
# web/src/lib/monitor-config.ts (EVENT_META, com ícones lucide) — manter em sync.
EVENT_CATALOG: dict[str, dict] = {
    "recovery":            {"emoji": "🟢", "label": "Serviço voltou a ficar online", "category": "Status"},
    "down":                {"emoji": "🔴", "label": "Serviço ficou offline",          "category": "Status"},
    "degraded":            {"emoji": "⚠️", "label": "Tempo de resposta acima do limite", "category": "Degradação"},
    "slow":                {"emoji": "🐌", "label": "Latência média elevada",         "category": "Performance"},
    "http_error":          {"emoji": "❌", "label": "Erro HTTP (4xx/5xx)",            "category": "Erro HTTP"},
    "ssl_expiring":        {"emoji": "🔒", "label": "Certificado prestes a expirar",  "category": "SSL"},
    "ssl_expired":         {"emoji": "🔒", "label": "Certificado expirado",           "category": "SSL"},
    "domain_expiring":     {"emoji": "🌐", "label": "Domínio prestes a expirar",      "category": "Domínio"},
    "domain_expired":      {"emoji": "🌐", "label": "Domínio expirado",               "category": "Domínio"},
    "domain_not_found":    {"emoji": "🌐", "label": "Domínio não encontrado",         "category": "Domínio"},
    "domain_unavailable":  {"emoji": "🌐", "label": "Consulta do domínio indisponível", "category": "Domínio"},
    "dns_failure":         {"emoji": "🌐", "label": "Falha na resolução DNS",         "category": "DNS"},
    "timeout":             {"emoji": "📡", "label": "Timeout",                        "category": "Rede"},
    "connection_refused":  {"emoji": "📡", "label": "Connection refused",             "category": "Rede"},
    "tls_failure":         {"emoji": "📡", "label": "Falha de TLS/Handshake",         "category": "Rede"},
    "proxy_failure":       {"emoji": "🔀", "label": "Falha no proxy",                  "category": "Proxy"},
    "maintenance_start":   {"emoji": "🛠", "label": "Início da janela de manutenção", "category": "Manutenção"},
    "maintenance_end":     {"emoji": "🛠", "label": "Fim da manutenção",              "category": "Manutenção"},
    "monitor_paused":      {"emoji": "🔁", "label": "Monitor pausado",                "category": "Monitor"},
    "monitor_reactivated": {"emoji": "🔁", "label": "Monitor reativado",              "category": "Monitor"},
    "availability_change": {"emoji": "📊", "label": "Mudança significativa na disponibilidade", "category": "Mudança"},
    "incident_created":    {"emoji": "🚨", "label": "Incidente criado",              "category": "Incidente"},
    "incident_resolved":   {"emoji": "✅", "label": "Incidente resolvido",           "category": "Incidente"},
}
EVENT_TYPES = tuple(EVENT_CATALOG)

# Aliases dos tipos legados (rows gravadas antes do catálogo).
_EVENT_ALIASES = {
    "healthy": "recovery", "unhealthy": "down",
    "activated": "monitor_reactivated", "deactivated": "monitor_paused",
}

INCIDENT_STATUSES = ("investigating", "identified", "monitoring", "resolved")
INCIDENT_SEVERITIES = ("operational", "degraded", "partial", "major", "maintenance")


def event_subject(event_type: str, monitor_name: str) -> str:
    """Assunto de notificação com emoji do evento."""
    meta = EVENT_CATALOG.get(event_type, {"emoji": "🔔", "label": event_type})
    return f"{meta['emoji']} {monitor_name} — {meta['label']}"

HOUR_MS = 3600 * 1000

# Janelas (segundos) → (fonte, alvo de pontos) para o gráfico de heartbeats.
# Ranges curtos usam heartbeats crus; longos usam os buckets horários. O alvo de
# pontos limita o downsample p/ o gráfico não travar no carregamento.
CHART_RANGES: dict[str, dict] = {
    "1min": {"seconds": 60, "source": "raw", "points": 60},
    "10min": {"seconds": 600, "source": "raw", "points": 60},
    "1h": {"seconds": 3600, "source": "raw", "points": 60},
    "3h": {"seconds": 3 * 3600, "source": "raw", "points": 90},
    "6h": {"seconds": 6 * 3600, "source": "raw", "points": 72},
    "12h": {"seconds": 12 * 3600, "source": "raw", "points": 72},
    "24h": {"seconds": 24 * 3600, "source": "hourly", "points": 96},
    "1w": {"seconds": 7 * 24 * 3600, "source": "hourly", "points": 84},
    "1m": {"seconds": 30 * 24 * 3600, "source": "hourly", "points": 120},
}

# Limites de agendamento (segundos).
INTERVAL_MIN = 1
INTERVAL_MAX = 86400          # 1 dia
RESEND_MIN = 1
RESEND_MAX = 1000

# --- TCP: alertas TLS esperados (nome → código do alerta TLS) ---------------
TCP_TLS_ALERTS: dict[str, int] = {
    "certificate_required": 116,
    "bad_certificate": 42,
    "certificate_unknown": 46,
    "unknown_ca": 48,
    "access_denied": 49,
    "handshake_failure": 40,
    "certificate_expired": 45,
    "certificate_revoked": 44,
}

# --- DNS ---------------------------------------------------------------------
DNS_RECORD_TYPES = ("a", "aaaa", "caa", "cname", "mx", "ns", "ptr", "soa", "srv", "txt")
DNS_OPERATORS = (
    "equal", "not_equal", "contains", "not_contains",
    "starts_with", "not_starts_with", "ends_with", "not_ends_with",
)
DNS_MAX_RESOLVERS = 8

# Máximo de proxies simultâneos no modo `all` (cada checagem dispara 1 req/proxy).
MAX_ALL_PROXIES = 8

# --- Bancos / mensageria ----------------------------------------------------
CONNECTION_MONITOR_TYPES = ("postgresql", "mysql", "mongodb", "redis", "rabbitmq")
CONNECTION_DEFAULT_PORTS = {
    "postgresql": 5432, "mysql": 3306, "mongodb": 27017,
    "redis": 6379, "rabbitmq": 5672,
}
CONNECTION_URI_SCHEMES = {
    "postgresql": ("postgresql", "postgres"),
    "mysql": ("mysql", "mariadb"),
    "mongodb": ("mongodb", "mongodb+srv"),
    "redis": ("redis", "rediss"),
    "rabbitmq": ("amqp", "amqps"),
}

# --- Ping --------------------------------------------------------------------
PING_MAX_PACKETS = 10
PING_DEFAULT_PACKETS = 3
PING_DEFAULT_SIZE = 56

HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")
BODY_ENCODINGS = ("json", "form")   # JSON | x-www-form-urlencoded
AUTH_TYPES = ("none", "basic", "bearer", "oauth2", "ntlm", "mtls", "other")
OAUTH_METHODS = ("header", "body")  # Basic Auth Header | Form Data Body

# Chaves de segredo dentro do config.auth por tipo de autenticação.
_AUTH_SECRETS: dict[str, tuple[str, ...]] = {
    "basic": ("password",),
    "bearer": ("token",),
    "oauth2": ("client_secret",),
    "ntlm": ("password",),
    "mtls": ("key",),
}


def _now_ms() -> int:
    return int(time.time() * 1000)


# --- validação ---------------------------------------------------------------

class MonitorError(Exception):
    """Erro de validação/uso de monitor (vira 400/404/409 no router)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _int(value, name: str, lo: int, hi: int, default: int | None = None) -> int:
    if value is None or value == "":
        if default is not None:
            return default
        raise MonitorError(f"{name} é obrigatório")
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise MonitorError(f"{name} deve ser inteiro")
    if n < lo or n > hi:
        raise MonitorError(f"{name} deve estar entre {lo} e {hi}")
    return n


def _float(value, name: str, lo: float, hi: float, default: float | None = None) -> float:
    if value is None or value == "":
        if default is not None:
            return default
        raise MonitorError(f"{name} é obrigatório")
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise MonitorError(f"{name} deve ser numérico")
    if n < lo:
        n = lo
    if n > hi:
        n = hi
    return round(n, 3)


def _pairs(value, name: str) -> list[dict]:
    """Normaliza uma lista de {key,value} (corpo/cabeçalhos)."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise MonitorError(f"{name} deve ser uma lista de pares")
    out = []
    for item in value:
        if not isinstance(item, dict):
            raise MonitorError(f"{name}: cada item deve ter key/value")
        key = str(item.get("key", "")).strip()
        if not key:
            continue
        out.append({"key": key, "value": str(item.get("value", ""))})
    return out


def _validate_accepted_codes(raw: str) -> str:
    """Valida a lista de códigos aceitáveis (ex.: `200-299, 301`)."""
    raw = (raw or "").strip() or "200-299"
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                lo, hi = int(a), int(b)
            except ValueError:
                raise MonitorError(f"códigos aceitáveis: intervalo inválido '{part}'")
            if not (100 <= lo <= 599 and 100 <= hi <= 599 and lo <= hi):
                raise MonitorError(f"códigos aceitáveis: intervalo inválido '{part}'")
        else:
            try:
                code = int(part)
            except ValueError:
                raise MonitorError(f"códigos aceitáveis: código inválido '{part}'")
            if not (100 <= code <= 599):
                raise MonitorError(f"códigos aceitáveis: código inválido '{part}'")
    return raw


def _validate_auth(auth, previous: dict | None) -> dict:
    """Valida o bloco de autenticação; mantém segredos vazios/mascarados."""
    if not auth or not isinstance(auth, dict):
        return {"type": "none"}
    atype = str(auth.get("type", "none")).strip().lower()
    if atype not in AUTH_TYPES:
        raise MonitorError(f"tipo de autenticação inválido (use: {', '.join(AUTH_TYPES)})")
    if atype == "none":
        return {"type": "none"}

    prev = previous or {}
    prev_same = prev if prev.get("type") == atype else {}
    out: dict = {"type": atype}

    def keep_secret(field: str, incoming) -> str:
        val = "" if incoming is None else str(incoming)
        if val in ("", MASK):
            return str(prev_same.get(field, ""))
        return val

    if atype == "basic":
        out["username"] = str(auth.get("username", "")).strip()
        out["password"] = keep_secret("password", auth.get("password"))
    elif atype == "bearer":
        out["token"] = keep_secret("token", auth.get("token"))
    elif atype == "oauth2":
        method = str(auth.get("method", "header")).strip().lower()
        if method not in OAUTH_METHODS:
            raise MonitorError(f"método OAuth inválido (use: {', '.join(OAUTH_METHODS)})")
        out["method"] = method
        out["token_url"] = str(auth.get("token_url", "")).strip()
        out["client_id"] = str(auth.get("client_id", "")).strip()
        out["client_secret"] = keep_secret("client_secret", auth.get("client_secret"))
        out["scope"] = str(auth.get("scope", "")).strip()
        out["audience"] = str(auth.get("audience", "")).strip()
    elif atype == "ntlm":
        out["username"] = str(auth.get("username", "")).strip()
        out["password"] = keep_secret("password", auth.get("password"))
        out["domain"] = str(auth.get("domain", "")).strip()
        out["workstation"] = str(auth.get("workstation", "")).strip()
    elif atype == "mtls":
        out["cert"] = str(auth.get("cert", ""))
        out["key"] = keep_secret("key", auth.get("key"))
        out["ca"] = str(auth.get("ca", ""))
    elif atype == "other":
        out["header"] = str(auth.get("header", "")).strip()
        out["param"] = str(auth.get("param", "")).strip()
    return out


def _validate_http_config(cfg: dict, previous: dict | None) -> dict:
    url = str(cfg.get("url", "")).strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise MonitorError("url deve começar com http:// ou https://")
    is_https = url.startswith("https://")

    ssl_in = cfg.get("ssl") or {}
    ssl = {
        "validate_expired": bool(ssl_in.get("validate_expired", True)),
        "ignore_tls_errors": bool(ssl_in.get("ignore_tls_errors", False)),
    }

    method = str(cfg.get("method", "GET")).strip().upper()
    if method not in HTTP_METHODS:
        raise MonitorError(f"método HTTP inválido (use: {', '.join(HTTP_METHODS)})")

    body_encoding = str(cfg.get("body_encoding", "json")).strip().lower()
    if body_encoding not in BODY_ENCODINGS:
        raise MonitorError(f"codificação do corpo inválida (use: {', '.join(BODY_ENCODINGS)})")

    max_response_bytes = _int(cfg.get("max_response_bytes", 0), "comprimento máximo da resposta",
                              0, 1024 * 1024 * 1024, default=0)

    prev_auth = (previous or {}).get("auth")

    return {
        "url": url,
        "ssl": ssl if is_https else {"validate_expired": True, "ignore_tls_errors": False},
        "method": method,
        "body_encoding": body_encoding,
        "body": _pairs(cfg.get("body"), "corpo"),
        "headers": _pairs(cfg.get("headers"), "cabeçalhos"),
        "auth": _validate_auth(cfg.get("auth"), prev_auth),
        "max_response_bytes": max_response_bytes,
        "accepted_codes": _validate_accepted_codes(cfg.get("accepted_codes", "200-299")),
        # Search Keyword: procura a palavra-chave no corpo (HTML/JSON), sensível a
        # maiúsculas/minúsculas. Vazio = desativado.
        "keyword": str(cfg.get("keyword", "")),
        # O que gravar por checagem (economia de espaço): timings (padrão on),
        # informações avançadas/meta (padrão off) e "apenas o último" (sobrescreve).
        "record_timings": bool(cfg.get("record_timings", True)),
        "record_advanced": bool(cfg.get("record_advanced", False)),
        "record_last_only": bool(cfg.get("record_last_only", False)),
        **_extras(cfg),
    }


def _channel_ids(raw) -> list[int]:
    """Normaliza a lista de IDs de canais de notificação vinculados."""
    if not isinstance(raw, list):
        return []
    out = []
    for x in raw:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def monitor_channel_ids(monitor_id: int) -> list[int]:
    """IDs dos canais de notificação vinculados a um monitor (via config)."""
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            return []
        try:
            cfg = json.loads(row.config)
        except (TypeError, ValueError, json.JSONDecodeError):
            return []
        return _channel_ids(cfg.get("notification_channel_ids"))


def find_push_monitor(token: str) -> dict | None:
    """Localiza um monitor push **ativo** pelo token do webhook."""
    token = (token or "").strip()
    if not token:
        return None
    with get_session() as s:
        rows = s.query(Monitor).filter(Monitor.type == "push",
                                       Monitor.active == True).all()  # noqa: E712
        for row in rows:
            try:
                cfg = json.loads(row.config)
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if cfg.get("token") == token:
                return {"id": row.id, "max_retries": row.max_retries,
                        "resend_every": row.resend_every}
    return None


def _host(cfg: dict) -> str:
    host = str(cfg.get("hostname", "")).strip()
    if not host:
        raise MonitorError("hostname é obrigatório")
    return host


def _extras(cfg: dict) -> dict:
    """Campos comuns opcionais mantidos no JSON de configuração."""
    return {"description": str(cfg.get("description", "")).strip()}


def _validate_tcp_config(cfg: dict) -> dict:
    port = _int(cfg.get("port"), "porta", 1, 65535)
    tls = bool(cfg.get("tls", False))
    alert = str(cfg.get("expected_tls_alert", "")).strip()
    if alert and alert not in TCP_TLS_ALERTS:
        raise MonitorError(f"alerta TLS inválido (use: {', '.join(TCP_TLS_ALERTS)})")
    return {"hostname": _host(cfg), "port": port, "tls": tls,
            "expected_tls_alert": alert if tls else "", **_extras(cfg)}


def _validate_ping_config(cfg: dict) -> dict:
    packets = _int(cfg.get("packets", PING_DEFAULT_PACKETS), "máximo de pacotes",
                   1, PING_MAX_PACKETS, default=PING_DEFAULT_PACKETS)
    size = _int(cfg.get("packet_size", PING_DEFAULT_SIZE), "tamanho do pacote",
                1, 65500, default=PING_DEFAULT_SIZE)
    per_ping = _float(cfg.get("per_ping_timeout", 2), "tempo limite por ping",
                      0.1, 60, default=2.0)
    return {"hostname": _host(cfg), "packets": packets, "packet_size": size,
            "per_ping_timeout": per_ping, **_extras(cfg)}


def _validate_dns_config(cfg: dict) -> dict:
    resolvers = cfg.get("resolvers") or ["1.1.1.1"]
    if not isinstance(resolvers, list):
        raise MonitorError("servidores de resolução devem ser uma lista")
    resolvers = [str(r).strip() for r in resolvers if str(r).strip()][:DNS_MAX_RESOLVERS]
    if not resolvers:
        resolvers = ["1.1.1.1"]
    port = _int(cfg.get("port", 53), "porta", 1, 65535, default=53)
    rtype = str(cfg.get("record_type", "a")).strip().lower()
    if rtype not in DNS_RECORD_TYPES:
        raise MonitorError(f"tipo de registro inválido (use: {', '.join(DNS_RECORD_TYPES)})")
    conditions = []
    for c in cfg.get("conditions") or []:
        if not isinstance(c, dict):
            continue
        op = str(c.get("operator", "")).strip().lower()
        if op not in DNS_OPERATORS:
            raise MonitorError(f"condição inválida (use: {', '.join(DNS_OPERATORS)})")
        conditions.append({"operator": op, "value": str(c.get("value", ""))})
    return {"hostname": _host(cfg), "resolvers": resolvers, "port": port,
            "record_type": rtype, "conditions": conditions, **_extras(cfg)}


def _validate_container_config(cfg: dict) -> dict:
    container = str(cfg.get("container", "")).strip()
    if not container:
        raise MonitorError("container é obrigatório")
    return {"container": container, **_extras(cfg)}


def _validate_domain_config(cfg: dict) -> dict:
    try:
        domain = normalize_domain(str(cfg.get("domain", "")))
    except DomainCheckError as exc:
        raise MonitorError(str(exc)) from exc
    return {"domain": domain, **_extras(cfg)}


def _connection_target_from_uri(uri: str) -> str:
    """Alvo seguro para listagens, sem usuário, senha ou query string."""
    try:
        parts = urllib.parse.urlsplit(uri)
    except ValueError:
        return ""
    authority = parts.netloc.rsplit("@", 1)[-1]
    target = f"{parts.scheme}://{authority}"
    if parts.path and parts.path != "/":
        target += parts.path
    return target


def _validate_connection_config(mtype: str, cfg: dict, previous: dict | None) -> dict:
    prev = previous or {}
    mode = str(cfg.get("connection_mode", prev.get("connection_mode", "fields"))).strip().lower()
    if mode not in ("fields", "uri"):
        raise MonitorError("modo de conexão inválido (use: fields ou uri)")

    if mode == "uri":
        uri = str(cfg.get("uri", "")).strip()
        if uri in ("", MASK) and prev.get("connection_mode") == "uri":
            uri = str(prev.get("uri", ""))
        if not uri:
            raise MonitorError("URI de conexão é obrigatória")
        try:
            parts = urllib.parse.urlsplit(uri)
        except ValueError as exc:
            raise MonitorError("URI de conexão inválida") from exc
        schemes = CONNECTION_URI_SCHEMES[mtype]
        if parts.scheme.lower() not in schemes:
            raise MonitorError(f"URI deve usar: {', '.join(schemes)}")
        if not parts.netloc.rsplit("@", 1)[-1]:
            raise MonitorError("URI de conexão deve informar o host")
        return {
            "connection_mode": "uri",
            "uri": uri,
            "connection_target": _connection_target_from_uri(uri),
            **_extras(cfg),
        }

    host = str(cfg.get("host", "")).strip()
    if not host:
        raise MonitorError("host é obrigatório")
    port = _int(cfg.get("port"), "porta", 1, 65535,
                default=CONNECTION_DEFAULT_PORTS[mtype])
    username = str(cfg.get("username", "")).strip()
    password = "" if cfg.get("password") is None else str(cfg.get("password"))
    if password in ("", MASK) and prev.get("connection_mode") == "fields":
        password = str(prev.get("password", ""))
    database = str(cfg.get("database", "")).strip()
    if mtype == "redis" and database:
        _int(database, "database do Redis", 0, 1_000_000)
    arguments = _pairs(cfg.get("arguments"), "argumentos")
    reserved = {"host", "port", "user", "username", "password", "passwd",
                "database", "dbname", "db", "uri", "virtual_host", "credentials"}
    for arg in arguments:
        key = arg["key"].lower()
        if key in reserved:
            raise MonitorError(f"argumento reservado '{arg['key']}': use o campo correspondente")
        if any(secret in key for secret in ("password", "passwd", "secret", "token")):
            raise MonitorError(f"argumento sensível '{arg['key']}': use o campo de senha ou a URI")
    shown_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    target = f"{shown_host}:{port}"
    if database:
        target += f"/{database}"
    return {
        "connection_mode": "fields", "host": host, "port": port,
        "username": username, "password": password, "database": database,
        "arguments": arguments, "connection_target": target, **_extras(cfg),
    }


def _validate_push_config(cfg: dict, prev: dict | None) -> dict:
    # Token do webhook: gerado na criação, mantido no update.
    token = (prev or {}).get("token") or str(cfg.get("token") or "").strip() or _uuid7()
    grace_period = _int(
        cfg.get("grace_period_seconds", (prev or {}).get("grace_period_seconds", PUSH_GRACE_SECONDS)),
        "grace period", PUSH_GRACE_MIN, PUSH_GRACE_MAX, default=PUSH_GRACE_SECONDS,
    )
    return {"token": token, "grace_period_seconds": grace_period, **_extras(cfg)}


_CONFIG_VALIDATORS = {
    "tcp": lambda cfg, prev: _validate_tcp_config(cfg),
    "ping": lambda cfg, prev: _validate_ping_config(cfg),
    "dns": lambda cfg, prev: _validate_dns_config(cfg),
    "domain": lambda cfg, prev: _validate_domain_config(cfg),
    "postgresql": lambda cfg, prev: _validate_connection_config("postgresql", cfg, prev),
    "mysql": lambda cfg, prev: _validate_connection_config("mysql", cfg, prev),
    "mongodb": lambda cfg, prev: _validate_connection_config("mongodb", cfg, prev),
    "redis": lambda cfg, prev: _validate_connection_config("redis", cfg, prev),
    "rabbitmq": lambda cfg, prev: _validate_connection_config("rabbitmq", cfg, prev),
    "container": lambda cfg, prev: _validate_container_config(cfg),
    "push": _validate_push_config,
    "http": _validate_http_config,
}

# Tipos que exibem/usam o campo de timeout no formulário (os demais usam padrão).
TIMEOUT_TYPES = ("http", "ping", *CONNECTION_MONITOR_TYPES)
LATENCY_WINDOW_SECONDS = (60, 300, 600, 900, 1800, 3600)


def _validate(payload: dict, previous: Monitor | None) -> dict:
    """Valida o payload de create/update e devolve os campos normalizados."""
    mtype = str(payload.get("type", "http")).strip().lower()
    if mtype not in TYPES:
        raise MonitorError(f"tipo inválido (use: {', '.join(TYPES)})")
    if mtype not in IMPLEMENTED_TYPES:
        raise MonitorError(f"o tipo '{mtype}' ainda não está disponível", status=422)

    name = str(payload.get("name", "")).strip()
    if not name:
        raise MonitorError("rótulo (name) é obrigatório")

    group_id = payload.get("group_id")
    if group_id in ("", None):
        group_id = None
    else:
        group_id = _int(group_id, "group_id", 1, 2**31 - 1)

    # A validade de domínio tem cadência fixa; o endpoint `check` continua
    # disponível para uma consulta manual imediata.
    interval = (INTERVAL_MAX if mtype == "domain" else
                _int(payload.get("interval_seconds", 60), "intervalo",
                     INTERVAL_MIN, INTERVAL_MAX, default=60))
    if mtype == "push" and interval < PUSH_INTERVAL_MIN:
        raise MonitorError(f"o intervalo do heartbeat deve ser no mínimo {PUSH_INTERVAL_MIN}s")
    max_retries = (0 if mtype == "domain" else
                   _int(payload.get("max_retries", 0), "falhas", 0, 1000, default=0))

    # timeout: no máximo 80% do intervalo (auto-clamp — o `_float` corta ao teto
    # em vez de erro). Suporta frações (ex.: 0.8 = 80% de 1s).
    timeout_cap = round(interval * 0.8, 3)
    timeout = (10.0 if mtype == "domain" else
               _float(payload.get("timeout_seconds", min(48.0, timeout_cap)),
                      "timeout", 0.1, timeout_cap, default=min(48.0, timeout_cap)))

    resend = payload.get("resend_every", 0)
    if payload.get("resend_enabled") is False:
        resend = 0
    if resend in ("", None, 0, "0", False):
        resend = 0
    else:
        resend = _int(resend, "reenviar notificação a cada", RESEND_MIN, RESEND_MAX)

    prev_cfg = None
    if previous is not None:
        try:
            prev_cfg = json.loads(previous.config)
        except (TypeError, ValueError, json.JSONDecodeError):
            prev_cfg = None

    raw_config = payload.get("config") or {}
    validator = _CONFIG_VALIDATORS[mtype]
    config = validator(raw_config, prev_cfg)
    # Canais de notificação vinculados (comum a todos os tipos).
    config["notification_channel_ids"] = _channel_ids(raw_config.get("notification_channel_ids"))
    proxy_mode = str(raw_config.get("proxy_mode", (prev_cfg or {}).get("proxy_mode", "round_robin")))
    if proxy_mode not in ("round_robin", "all"):
        raise MonitorError("modo de proxy inválido (use: round_robin ou all)")
    config["proxy_mode"] = proxy_mode
    ids = raw_config.get("proxy_ids", (prev_cfg or {}).get("proxy_ids", []))
    if not isinstance(ids, list): raise MonitorError("proxy_ids deve ser uma lista")
    proxy_ids = list(dict.fromkeys(int(v) for v in ids if str(v).isdigit()))
    if proxy_mode == "all" and len(proxy_ids) > MAX_ALL_PROXIES:
        raise MonitorError(f"no modo 'all' são permitidos no máximo {MAX_ALL_PROXIES} proxies")
    config["proxy_ids"] = proxy_ids
    # Limite de tempo de resposta (ms): acima dele durante a janela configurada
    # dispara o evento "degraded". 0 = desligado.
    config["latency_threshold_ms"] = (0 if mtype == "domain" else _int(
        raw_config.get("latency_threshold_ms", (prev_cfg or {}).get("latency_threshold_ms", 0)),
        "limite de tempo de resposta", 0, 600000, default=0))
    latency_window = _int(
        raw_config.get("latency_window_seconds", (prev_cfg or {}).get("latency_window_seconds", 60)),
        "intervalo para identificar lentidão", 60, 3600, default=60)
    if latency_window not in LATENCY_WINDOW_SECONDS:
        raise MonitorError("intervalo para identificar lentidão inválido "
                           "(use: 60, 300, 600, 900, 1800 ou 3600)")
    config["latency_window_seconds"] = latency_window

    raw_tag_ids = payload.get("tag_ids") or []
    if not isinstance(raw_tag_ids, list):
        raise MonitorError("tag_ids deve ser uma lista")
    try:
        tag_ids = list(dict.fromkeys(int(value) for value in raw_tag_ids if int(value) > 0))
    except (TypeError, ValueError) as exc:
        raise MonitorError("tag_ids contém um identificador inválido") from exc

    return {
        "type": mtype, "name": name, "group_id": group_id,
        "interval_seconds": interval, "max_retries": max_retries,
        "timeout_seconds": timeout, "resend_every": resend,
        "active": bool(payload.get("active", True)),
        "config": config, "tag_ids": tag_ids,
    }


# --- máscara / serialização --------------------------------------------------

def _mask_config(config: dict) -> dict:
    """Devolve uma cópia do config com os segredos de auth mascarados."""
    cfg = json.loads(json.dumps(config))  # cópia profunda barata
    auth = cfg.get("auth") or {}
    for field in _AUTH_SECRETS.get(auth.get("type", ""), ()):  # type: ignore[arg-type]
        if auth.get(field):
            auth[field] = MASK
    if cfg.get("password"):
        cfg["password"] = MASK
    if cfg.get("uri"):
        cfg["uri"] = MASK
    return cfg


def _monitor_json(row: Monitor, *, group: MonitorGroup | None = None,
                  tags: list[dict] | None = None) -> dict:
    try:
        config = json.loads(row.config)
    except (TypeError, ValueError, json.JSONDecodeError):
        config = {}
    # Tags livres antigas foram substituídas pelo catálogo relacional.
    config.pop("tags", None)
    data = {
        "id": row.id, "type": row.type, "name": row.name,
        "group_id": row.group_id,
        "group_name": group.name if group else None,
        "tags": tags or [],
        "interval_seconds": row.interval_seconds,
        "max_retries": row.max_retries,
        "timeout_seconds": row.timeout_seconds,
        "resend_every": row.resend_every,
        "active": bool(row.active),
        "status": row.status,
        "last_check_ts": row.last_check_ts,
        "ssl_info": {
            "status": row.ssl_status or "pending",
            "checked_ts": row.ssl_checked_ts,
            "issued_ts": row.ssl_issued_ts,
            "expires_ts": row.ssl_expires_ts,
            "message": row.ssl_message,
        },
        "domain_info": {
            "status": row.domain_status or "pending",
            "checked_ts": row.domain_checked_ts,
            "registered_ts": row.domain_registered_ts,
            "expires_ts": row.domain_expires_ts,
            "message": row.domain_message,
        },
        "config": _mask_config(config),
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }
    if row.type == "push":
        token = config.get("token", "")
        data["push_url"] = f"{PUSH_URL_PREFIX}/{token}" if token else ""
    return data


def _group_json(row: MonitorGroup, *, monitor_count: int | None = None) -> dict:
    data = {
        "id": row.id, "name": row.name, "color": row.color,
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }
    if monitor_count is not None:
        data["monitor_count"] = monitor_count
    return data


# --- Grupos ------------------------------------------------------------------

def list_groups() -> list[dict]:
    with get_session() as s:
        rows = s.query(MonitorGroup).order_by(MonitorGroup.name.asc()).all()
        counts = {
            gid: cnt for gid, cnt in
            s.query(Monitor.group_id, func.count(Monitor.id))
            .group_by(Monitor.group_id).all()
        }
        return [_group_json(r, monitor_count=counts.get(r.id, 0)) for r in rows]


def create_group(name: str, color: str = "") -> dict:
    name = (name or "").strip()
    if not name:
        raise MonitorError("nome do grupo é obrigatório")
    now = _now_ms()
    with get_session() as s:
        row = MonitorGroup(name=name, color=(color or "").strip(),
                           created_ts=now, updated_ts=now)
        s.add(row)
        s.commit()
        s.refresh(row)
        return _group_json(row, monitor_count=0)


def update_group(group_id: int, name: str | None, color: str | None) -> dict:
    with get_session() as s:
        row = s.get(MonitorGroup, group_id)
        if row is None:
            raise MonitorError("grupo não encontrado", status=404)
        if name is not None:
            n = name.strip()
            if not n:
                raise MonitorError("nome do grupo é obrigatório")
            row.name = n
        if color is not None:
            row.color = color.strip()
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        return _group_json(row)


def delete_group(group_id: int) -> None:
    """Remove o grupo; os monitores dele ficam sem grupo (group_id = NULL)."""
    with get_session() as s:
        row = s.get(MonitorGroup, group_id)
        if row is None:
            raise MonitorError("grupo não encontrado", status=404)
        s.query(Monitor).filter(Monitor.group_id == group_id).update(
            {Monitor.group_id: None}, synchronize_session=False)
        s.delete(row)
        s.commit()


# --- Monitores ---------------------------------------------------------------

def _groups_map(s) -> dict[int, MonitorGroup]:
    return {g.id: g for g in s.query(MonitorGroup).all()}


def _tag_json(row: MonitorTag) -> dict:
    return {"id": row.id, "name": row.name, "value": row.value, "color": row.color}


def _monitor_tags_map(s, monitor_ids: list[int]) -> dict[int, list[dict]]:
    result: dict[int, list[dict]] = {monitor_id: [] for monitor_id in monitor_ids}
    if not monitor_ids:
        return result
    rows = (s.query(MonitorTagLink.monitor_id, MonitorTag)
            .join(MonitorTag, MonitorTag.id == MonitorTagLink.tag_id)
            .filter(MonitorTagLink.monitor_id.in_(monitor_ids))
            .order_by(func.lower(MonitorTag.name), func.lower(MonitorTag.value), MonitorTag.id).all())
    for monitor_id, tag in rows:
        result.setdefault(monitor_id, []).append(_tag_json(tag))
    return result


def _replace_monitor_tags(s, monitor_id: int, tag_ids: list[int]) -> None:
    if tag_ids:
        existing = {row.id for row in s.query(MonitorTag).filter(MonitorTag.id.in_(tag_ids)).all()}
        missing = [tag_id for tag_id in tag_ids if tag_id not in existing]
        if missing:
            raise MonitorError(f"tag não encontrada: {missing[0]}", status=404)
    s.query(MonitorTagLink).filter(MonitorTagLink.monitor_id == monitor_id).delete(
        synchronize_session=False)
    for tag_id in tag_ids:
        s.add(MonitorTagLink(monitor_id=monitor_id, tag_id=tag_id))


# Nº de heartbeats recentes anexados a cada monitor na listagem (barra de status).
LIST_BEATS = 90


def _parse_timings(raw: str) -> dict | None:
    """Detalhamento do tempo de resposta (JSON) → dict, ou None se vazio."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _recent_beats(s, monitor_id: int, n: int = LIST_BEATS) -> list[dict]:
    rows = (s.query(MonitorHeartbeat.ts, MonitorHeartbeat.status,
                    MonitorHeartbeat.latency_ms, MonitorHeartbeat.timings,
                    MonitorHeartbeat.proxy, MonitorHeartbeat.up_ratio,
                    MonitorHeartbeat.meta)
            .filter(MonitorHeartbeat.monitor_id == monitor_id)
            .order_by(MonitorHeartbeat.ts.desc()).limit(n).all())
    return [{"ts": ts, "status": st, "latency_ms": lat,
             "timings": _parse_timings(tm), "proxy": px or "",
             "up_ratio": ur if ur is not None else 1.0, "meta": _parse_timings(mt)}
            for ts, st, lat, tm, px, ur, mt in reversed(rows)]


def paginate(items: list, page, limit=50, max_limit=50) -> dict:
    """Paginação server-side de uma lista já pronta (envelope {items,total,pages,page})."""
    try:
        page = max(1, int(page))
    except (TypeError, ValueError):
        page = 1
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = max_limit
    limit = max(1, min(limit, max_limit))
    total = len(items)
    pages = max(1, (total + limit - 1) // limit)
    page = min(page, pages)
    start = (page - 1) * limit
    return {"items": items[start:start + limit], "total": total, "pages": pages, "page": page}


def list_monitors(group_id: int | None = None, push: bool | None = None,
                  *, no_group: bool = False, search: str = "", page=None, limit=50):
    with get_session() as s:
        q = s.query(Monitor)
        if no_group:
            q = q.filter(Monitor.group_id.is_(None))
        elif group_id is not None:
            q = q.filter(Monitor.group_id == group_id)
        if push is True:
            q = q.filter(Monitor.type == "push")
        elif push is False:
            q = q.filter(Monitor.type != "push")
        rows = q.order_by(Monitor.name.asc()).all()
        groups = _groups_map(s)
        tags = _monitor_tags_map(s, [row.id for row in rows])
        out = []
        for r in rows:
            data = _monitor_json(r, group=groups.get(r.group_id), tags=tags.get(r.id))
            data["beats"] = _recent_beats(s, r.id)
            out.append(data)
    term = (search or "").strip().lower()
    if term:
        def hay(m: dict) -> str:
            cfg = m.get("config") or {}
            return " ".join(str(v) for v in [
                m.get("name", ""), m.get("type", ""), m.get("group_name") or "",
                cfg.get("url", ""), cfg.get("hostname", ""), cfg.get("host", ""),
                cfg.get("container", ""), cfg.get("domain", ""), cfg.get("host", ""),
                cfg.get("connection_target", ""),
                " ".join(f"{tag.get('name', '')} {tag.get('value', '')}" for tag in m.get("tags", [])),
            ]).lower()
        out = [m for m in out if term in hay(m)]
    if page is None:
        return out
    return paginate(out, page, limit)


def get_monitor(monitor_id: int) -> dict:
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            raise MonitorError("monitor não encontrado", status=404)
        group = s.get(MonitorGroup, row.group_id) if row.group_id else None
        tags = _monitor_tags_map(s, [row.id]).get(row.id, [])
        data = _monitor_json(row, group=group, tags=tags)
        data["beats"] = _recent_beats(s, row.id)
        return data


def _ssl_signature(mtype: str, cfg: dict) -> str | None:
    """Parte da configuração que identifica a inspeção SSL persistida."""
    if mtype == "tcp":
        if not cfg.get("tls"):
            return None
        data = ["tcp", cfg.get("hostname", ""), cfg.get("port", 0),
                cfg.get("expected_tls_alert", "")]
    elif mtype == "http":
        url = str(cfg.get("url", ""))
        ssl_cfg = cfg.get("ssl") or {}
        if not url.lower().startswith("https://") or ssl_cfg.get("validate_expired", True) is False:
            return None
        auth = cfg.get("auth") or {}
        mtls = ({key: auth.get(key, "") for key in ("cert", "key", "ca")}
                if auth.get("type") == "mtls" else {})
        data = ["http", url, ssl_cfg, mtls]
    else:
        return None
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def _clear_ssl_info(row: Monitor) -> None:
    row.ssl_status = ""
    row.ssl_checked_ts = 0
    row.ssl_issued_ts = 0
    row.ssl_expires_ts = 0
    row.ssl_message = ""


def _domain_signature(cfg: dict) -> str | None:
    return str(cfg.get("domain") or "") or None


def _clear_domain_info(row: Monitor) -> None:
    row.domain_status = ""
    row.domain_checked_ts = 0
    row.domain_registered_ts = 0
    row.domain_expires_ts = 0
    row.domain_message = ""


def create_monitor(payload: dict) -> dict:
    fields = _validate(payload, None)
    now = _now_ms()
    with get_session() as s:
        if fields["group_id"] is not None and s.get(MonitorGroup, fields["group_id"]) is None:
            raise MonitorError("grupo não encontrado", status=404)
        row = Monitor(
            type=fields["type"], name=fields["name"], group_id=fields["group_id"],
            config=json.dumps(fields["config"]),
            interval_seconds=fields["interval_seconds"], max_retries=fields["max_retries"],
            timeout_seconds=fields["timeout_seconds"], resend_every=fields["resend_every"],
            active=fields["active"], status="pending", last_check_ts=0,
            created_ts=now, updated_ts=now,
        )
        s.add(row)
        s.flush()
        _replace_monitor_tags(s, row.id, fields["tag_ids"])
        s.commit()
        s.refresh(row)
        group = s.get(MonitorGroup, row.group_id) if row.group_id else None
        tags = _monitor_tags_map(s, [row.id]).get(row.id, [])
        return _monitor_json(row, group=group, tags=tags)


def update_monitor(monitor_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            raise MonitorError("monitor não encontrado", status=404)
        try:
            previous_config = json.loads(row.config)
        except (TypeError, ValueError, json.JSONDecodeError):
            previous_config = {}
        # `type` não muda no update — preserva o existente.
        payload = {**payload, "type": row.type}
        fields = _validate(payload, row)
        if fields["group_id"] is not None and s.get(MonitorGroup, fields["group_id"]) is None:
            raise MonitorError("grupo não encontrado", status=404)
        row.name = fields["name"]
        row.group_id = fields["group_id"]
        row.config = json.dumps(fields["config"])
        row.interval_seconds = fields["interval_seconds"]
        row.max_retries = fields["max_retries"]
        row.timeout_seconds = fields["timeout_seconds"]
        row.resend_every = fields["resend_every"]
        row.active = fields["active"]
        if (_ssl_signature(row.type, previous_config)
                != _ssl_signature(row.type, fields["config"])):
            _clear_ssl_info(row)
        if (row.type == "domain"
                and _domain_signature(previous_config) != _domain_signature(fields["config"])):
            _clear_domain_info(row)
        _replace_monitor_tags(s, row.id, fields["tag_ids"])
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        group = s.get(MonitorGroup, row.group_id) if row.group_id else None
        tags = _monitor_tags_map(s, [row.id]).get(row.id, [])
        return _monitor_json(row, group=group, tags=tags)


def move_monitor_to_group(monitor_id: int, group_id) -> dict:
    """Altera somente o grupo, sem revalidar ou regravar a configuração."""
    if group_id in ("", None):
        normalized_group_id = None
    else:
        normalized_group_id = _int(group_id, "group_id", 1, 2**31 - 1)

    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            raise MonitorError("monitor não encontrado", status=404)
        group = None
        if normalized_group_id is not None:
            group = s.get(MonitorGroup, normalized_group_id)
            if group is None:
                raise MonitorError("grupo não encontrado", status=404)
        row.group_id = normalized_group_id
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        tags = _monitor_tags_map(s, [row.id]).get(row.id, [])
        return _monitor_json(row, group=group, tags=tags)


def set_active(monitor_id: int, active: bool) -> dict:
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            raise MonitorError("monitor não encontrado", status=404)
        changed = bool(row.active) != active
        row.active = active
        if not active:
            row.status = "pending"
        row.updated_ts = _now_ms()
        if changed:
            s.add(MonitorEvent(
                monitor_id=monitor_id, ts=_now_ms(),
                type="activated" if active else "deactivated",
                message="Monitor ativado" if active else "Monitor pausado"))
        s.commit()
        s.refresh(row)
        tags = _monitor_tags_map(s, [row.id]).get(row.id, [])
        return _monitor_json(row, tags=tags)


def delete_monitor(monitor_id: int) -> None:
    with get_session() as s:
        row = s.get(Monitor, monitor_id)
        if row is None:
            raise MonitorError("monitor não encontrado", status=404)
        s.query(MonitorHeartbeat).filter(
            MonitorHeartbeat.monitor_id == monitor_id).delete(synchronize_session=False)
        s.query(MonitorTagLink).filter(
            MonitorTagLink.monitor_id == monitor_id).delete(synchronize_session=False)
        s.delete(row)
        s.commit()


def heartbeats(monitor_id: int, limit: int = 100) -> list[dict]:
    limit = max(1, min(limit, 1000))
    with get_session() as s:
        rows = (s.query(MonitorHeartbeat)
                .filter(MonitorHeartbeat.monitor_id == monitor_id)
                .order_by(MonitorHeartbeat.ts.desc()).limit(limit).all())
        return [{
            "ts": r.ts, "status": r.status, "latency_ms": r.latency_ms,
            "code": r.code, "message": r.message, "timings": _parse_timings(r.timings),
            "proxy": r.proxy or "", "up_ratio": r.up_ratio if r.up_ratio is not None else 1.0,
        } for r in reversed(rows)]


# --- uptime / gráfico / eventos ---------------------------------------------

def _uptime_for(s, monitor_id: int, seconds: int) -> float | None:
    cutoff = _now_ms() - seconds * 1000
    up, down = (s.query(func.coalesce(func.sum(MonitorStat.up), 0),
                        func.coalesce(func.sum(MonitorStat.down), 0))
                .filter(MonitorStat.monitor_id == monitor_id,
                        MonitorStat.bucket_ts >= cutoff).one())
    total = (up or 0) + (down or 0)
    if total == 0:
        return None
    return round((up or 0) / total * 100, 3)


def uptime(monitor_id: int) -> dict:
    """Percentual de disponibilidade em 24h, 30d e 1 ano (dos buckets horários)."""
    with get_session() as s:
        return {
            "h24": _uptime_for(s, monitor_id, 24 * 3600),
            "d30": _uptime_for(s, monitor_id, 30 * 24 * 3600),
            "y1": _uptime_for(s, monitor_id, 365 * 24 * 3600),
        }


def _downsample(rows: list[dict], start: int, span_ms: int, points: int) -> list[dict]:
    """Agrupa linhas (ts/up/down/ping_sum/ping_count/message?) em `points` baldes.

    `message` do balde guarda a mensagem da última falha (p/ o tooltip do gráfico).
    """
    if points < 1:
        points = 1
    bucket = max(1, span_ms // points)
    buckets: dict[int, dict] = {}
    for r in rows:
        idx = int((r["ts"] - start) // bucket)
        b = buckets.setdefault(idx, {"up": 0, "down": 0, "ping_sum": 0, "ping_count": 0,
                                     "msg": "", "timings": None, "_tmax": -1,
                                     "proxy": "", "_pmax": -1})
        b["up"] += r["up"]
        b["down"] += r["down"]
        b["ping_sum"] += r["ping_sum"]
        b["ping_count"] += r["ping_count"]
        if r["down"] and r.get("message"):
            b["msg"] = r["message"]
        # Guarda o detalhamento do beat mais lento do balde (mais informativo).
        tm = r.get("timings")
        if tm is not None and r.get("ping_sum", 0) >= b["_tmax"]:
            b["_tmax"] = r.get("ping_sum", 0)
            b["timings"] = tm
        # Idem para o proxy (independente de ter timings — proxied http não tem).
        px = r.get("proxy")
        if px and r.get("ping_sum", 0) >= b["_pmax"]:
            b["_pmax"] = r.get("ping_sum", 0)
            b["proxy"] = px
    out = []
    for idx in sorted(buckets):
        b = buckets[idx]
        total = b["up"] + b["down"]
        out.append({
            "ts": start + idx * bucket,
            "up": b["up"], "down": b["down"],
            "uptime": round(b["up"] / total * 100, 1) if total else None,
            "avg_latency": round(b["ping_sum"] / b["ping_count"]) if b["ping_count"] else None,
            "status": "up" if b["down"] == 0 and b["up"] > 0 else
                      ("down" if b["up"] == 0 and b["down"] > 0 else "partial"),
            "message": b["msg"],
            "timings": b["timings"],
            "proxy": b["proxy"],
        })
    return out


def chart(monitor_id: int, range_key: str) -> dict:
    """Pontos do gráfico de heartbeats para a janela pedida (downsampled)."""
    cfg = CHART_RANGES.get(range_key)
    if cfg is None:
        raise MonitorError(f"range inválido (use: {', '.join(CHART_RANGES)})")
    span_ms = cfg["seconds"] * 1000
    start = _now_ms() - span_ms
    with get_session() as s:
        if cfg["source"] == "raw":
            hbs = (s.query(MonitorHeartbeat)
                   .filter(MonitorHeartbeat.monitor_id == monitor_id,
                           MonitorHeartbeat.ts >= start)
                   .order_by(MonitorHeartbeat.ts.asc()).all())
            rows = []
            for h in hbs:
                # Disponibilidade fracionária (modo proxy `all`): up = up_ratio.
                up = (h.up_ratio if h.up_ratio is not None else 1.0) if h.status == "up" else 0.0
                rows.append({
                    "ts": h.ts,
                    "up": up,
                    "down": 1 - up,
                    "ping_sum": h.latency_ms, "ping_count": 1,
                    "message": h.message,
                    "timings": _parse_timings(h.timings),
                    "proxy": h.proxy or "",
                })
        else:
            stats = (s.query(MonitorStat)
                     .filter(MonitorStat.monitor_id == monitor_id,
                             MonitorStat.bucket_ts >= start)
                     .order_by(MonitorStat.bucket_ts.asc()).all())
            rows = [{
                "ts": st.bucket_ts, "up": st.up, "down": st.down,
                "ping_sum": st.ping_sum, "ping_count": st.ping_count,
            } for st in stats]
    return {"range": range_key, "start": start, "end": _now_ms(),
            "points": _downsample(rows, start, span_ms, cfg["points"])}


def events(monitor_id: int, limit: int = 100) -> list[dict]:
    limit = max(1, min(limit, 1000))
    with get_session() as s:
        rows = (s.query(MonitorEvent)
                .filter(MonitorEvent.monitor_id == monitor_id)
                .order_by(MonitorEvent.ts.desc()).limit(limit).all())
        return [{"ts": r.ts, "type": _EVENT_ALIASES.get(r.type, r.type),
                 "message": r.message} for r in rows]


def add_event(monitor_id: int, event_type: str, message: str) -> None:
    """Grava um evento avulso (usado por incidentes/manutenção)."""
    with get_session() as s:
        s.add(MonitorEvent(monitor_id=monitor_id, ts=_now_ms(),
                           type=event_type, message=message[:500]))
        s.commit()


def clear_events(monitor_id: int) -> int:
    """Remove todos os eventos do monitor. Devolve a quantidade removida."""
    with get_session() as s:
        if s.get(Monitor, monitor_id) is None:
            raise MonitorError("monitor não encontrado", status=404)
        n = (s.query(MonitorEvent)
             .filter(MonitorEvent.monitor_id == monitor_id)
             .delete(synchronize_session=False))
        s.commit()
        return n


def clear_heartbeats(monitor_id: int) -> int:
    """Remove todos os heartbeats + agregados horários do monitor (zera o
    histórico de tempo de resposta/uptime). Devolve a qtd de heartbeats removidos."""
    with get_session() as s:
        if s.get(Monitor, monitor_id) is None:
            raise MonitorError("monitor não encontrado", status=404)
        n = (s.query(MonitorHeartbeat)
             .filter(MonitorHeartbeat.monitor_id == monitor_id)
             .delete(synchronize_session=False))
        (s.query(MonitorStat)
         .filter(MonitorStat.monitor_id == monitor_id)
         .delete(synchronize_session=False))
        s.commit()
        return n


# --- Incidentes --------------------------------------------------------------

def _incident_updates(s, incident_id: int) -> list[dict]:
    rows = (s.query(MonitorIncidentUpdate)
            .filter(MonitorIncidentUpdate.incident_id == incident_id)
            .order_by(MonitorIncidentUpdate.created_ts.desc(),
                      MonitorIncidentUpdate.id.desc()).all())
    return [{"id": r.id, "status": r.status, "message": r.message,
             "created_ts": r.created_ts} for r in rows]


def _incident_json(row: MonitorIncident, s=None) -> dict:
    return {
        "id": row.id, "monitor_id": row.monitor_id, "title": row.title,
        "description": row.description, "status": row.status,
        "severity": row.severity, "created_ts": row.created_ts,
        "updated_ts": row.updated_ts, "resolved_ts": row.resolved_ts or None,
        "updates": _incident_updates(s, row.id) if s is not None else [],
    }


def list_incidents(monitor_id: int) -> list[dict]:
    with get_session() as s:
        rows = (s.query(MonitorIncident)
                .filter(MonitorIncident.monitor_id == monitor_id)
                .order_by(MonitorIncident.created_ts.desc()).all())
        return [_incident_json(r, s) for r in rows]


def list_all_incidents(*, search: str = "", page=None, limit=50):
    """Todos os incidentes (de todos os monitores), com o nome do monitor."""
    with get_session() as s:
        rows = (s.query(MonitorIncident)
                .order_by(MonitorIncident.created_ts.desc()).all())
        names = {m.id: m.name for m in s.query(Monitor.id, Monitor.name).all()}
        out = []
        for r in rows:
            data = _incident_json(r, s)
            data["monitor_name"] = names.get(r.monitor_id)
            out.append(data)
    term = (search or "").strip().lower()
    if term:
        out = [i for i in out if term in
               f"{i['title']} {i.get('monitor_name') or ''} {i['status']} {i['severity']}".lower()]
    if page is None:
        return out
    return paginate(out, page, limit)


def _validate_severity(value: str) -> str:
    sev = str(value).strip().lower()
    if sev not in INCIDENT_SEVERITIES:
        raise MonitorError(f"severidade inválida (use: {', '.join(INCIDENT_SEVERITIES)})")
    return sev


def create_incident(monitor_id: int, payload: dict) -> dict:
    title = str(payload.get("title", "")).strip()
    if not title:
        raise MonitorError("título é obrigatório")
    status = str(payload.get("status", "investigating")).strip().lower()
    if status not in INCIDENT_STATUSES:
        raise MonitorError(f"status inválido (use: {', '.join(INCIDENT_STATUSES)})")
    severity = _validate_severity(payload.get("severity", "degraded"))
    description = str(payload.get("description", "")).strip()
    now = _now_ms()
    with get_session() as s:
        if s.get(Monitor, monitor_id) is None:
            raise MonitorError("monitor não encontrado", status=404)
        row = MonitorIncident(
            monitor_id=monitor_id, title=title, description=description,
            status=status, severity=severity, created_ts=now, updated_ts=now,
            resolved_ts=now if status == "resolved" else 0)
        s.add(row)
        s.flush()
        # primeira entrada da linha do tempo
        s.add(MonitorIncidentUpdate(incident_id=row.id, status=status,
                                    message=description, created_ts=now))
        resolved = status == "resolved"
        s.add(MonitorEvent(monitor_id=monitor_id, ts=now,
                           type="incident_resolved" if resolved else "incident_created",
                           message=title[:500]))
        s.commit()
        s.refresh(row)
        data = _incident_json(row, s)
        data["_event"] = "incident_resolved" if resolved else "incident_created"
        return data


def update_incident(monitor_id: int, incident_id: int, payload: dict) -> dict:
    """Edita metadados do incidente (título/descrição/severidade).

    Mudanças de status ficam por conta de `add_incident_update` (linha do tempo).
    """
    with get_session() as s:
        row = s.get(MonitorIncident, incident_id)
        if row is None or row.monitor_id != monitor_id:
            raise MonitorError("incidente não encontrado", status=404)
        if payload.get("title") is not None:
            title = str(payload["title"]).strip()
            if not title:
                raise MonitorError("título é obrigatório")
            row.title = title
        if payload.get("description") is not None:
            row.description = str(payload["description"]).strip()
        if payload.get("severity") is not None:
            row.severity = _validate_severity(payload["severity"])
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        return _incident_json(row, s)


def add_incident_update(monitor_id: int, incident_id: int, payload: dict) -> dict:
    """Publica uma atualização na linha do tempo do incidente.

    Move o status atual (se informado) e registra a mensagem. Resolver marca
    `resolved_ts` e emite o evento `incident_resolved`.
    """
    message = str(payload.get("message", "")).strip()
    with get_session() as s:
        row = s.get(MonitorIncident, incident_id)
        if row is None or row.monitor_id != monitor_id:
            raise MonitorError("incidente não encontrado", status=404)
        was_resolved = row.status == "resolved"
        new_status = row.status
        if payload.get("status") is not None:
            new_status = str(payload["status"]).strip().lower()
            if new_status not in INCIDENT_STATUSES:
                raise MonitorError(f"status inválido (use: {', '.join(INCIDENT_STATUSES)})")
        if payload.get("severity") is not None:
            row.severity = _validate_severity(payload["severity"])
        if not message and new_status == row.status and payload.get("severity") is None:
            raise MonitorError("informe uma mensagem ou uma mudança de status/severidade")
        now = _now_ms()
        newly_resolved = new_status == "resolved" and not was_resolved
        row.status = new_status
        if newly_resolved:
            row.resolved_ts = now
        elif new_status != "resolved":
            row.resolved_ts = 0
        row.updated_ts = now
        s.add(MonitorIncidentUpdate(incident_id=incident_id, status=new_status,
                                    message=message, created_ts=now))
        if newly_resolved:
            s.add(MonitorEvent(monitor_id=monitor_id, ts=now,
                               type="incident_resolved", message=row.title[:500]))
        s.commit()
        s.refresh(row)
        data = _incident_json(row, s)
        if newly_resolved:
            data["_event"] = "incident_resolved"
        return data


def delete_incident(monitor_id: int, incident_id: int) -> None:
    with get_session() as s:
        row = s.get(MonitorIncident, incident_id)
        if row is None or row.monitor_id != monitor_id:
            raise MonitorError("incidente não encontrado", status=404)
        s.query(MonitorIncidentUpdate).filter(
            MonitorIncidentUpdate.incident_id == incident_id).delete()
        s.delete(row)
        s.commit()
