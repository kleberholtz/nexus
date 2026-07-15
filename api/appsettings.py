"""Configurações persistentes da aplicação (tabela app_settings), com validação.

Chaves float:
  * sse_interval_seconds   — cadência do SSE/coleta (1..300, padrão 1)
Chaves inteiras:
  * metrics_retention_days — retenção do histórico (1..365, padrão 30)
  * docker_scan_rate_limit_seconds — intervalo mínimo entre scans por imagem
  * docker_scan_max_details — máximo de CVEs detalhados salvos por scan
  * docker_scan_workers — quantidade de workers paralelos do scan de imagens
Chaves string:
  * acme_email             — e-mail da conta ACME (Let's Encrypt)
  * cloudflare_tunnel_token   — token legado do Cloudflare Tunnel (slot 1)
  * cloudflare_tunnel_{1..3}_token — tokens dos Cloudflare Tunnels
  * backup_encryption_secret  — senha global para criptografia de backups
  * deployment_preview_domain — domínio wildcard para previews (ex.: *.preview.io)
  * deployment_preview_ip     — IP/host usado quando não há domínio wildcard
"""
from __future__ import annotations

import os
import re

from .db import get_session
from .db.models import AppSetting

_TRUE_ENV = {"1", "true", "on", "yes"}


def _env_bool(key: str, default: str = "off") -> bool:
    return os.environ.get(key, default).strip().lower() in _TRUE_ENV

FLOAT_DEFAULTS: dict[str, float] = {
    # cadência do SSE/coleta em segundos.
    "sse_interval_seconds": 1.0,
}
FLOAT_LIMITS: dict[str, tuple[float, float]] = {
    "sse_interval_seconds": (1.0, 300.0),
}
INT_DEFAULTS: dict[str, int] = {
    "metrics_retention_days": 30,
    # Rotação de logs
    "log_rotate_max_mb": 100,       # rotaciona quando o access.log passa disso
    "log_rotate_keep": 7,           # quantos arquivos rotacionados manter
    "log_rotate_interval_min": 10,  # cadência de checagem do worker
    "log_s3_config_id": 0,          # config S3 destino (0 = nenhuma)
    "deployment_preview_port": 0,   # 0 = sem porta explícita
    "deployment_preview_limit": 0,  # 0 = listar todos
    # Gerenciador de arquivos das apps SPA:
    "upload_max_mb": 100,           # tamanho máximo por arquivo (MB)
    "upload_concurrency": 8,        # arquivos processados em paralelo na fila
    # Sessões dos usuários do banco (default do env SESSION_TTL_DAYS por compat).
    "session_ttl_days": int(os.environ.get("SESSION_TTL_DAYS", "7") or "7"),
    # Scan de vulnerabilidades das imagens (trivy).
    "docker_scan_rate_limit_seconds": int(os.environ.get("TRIVY_RATE_LIMIT_SECONDS", "60") or "60"),
    "docker_scan_max_details": int(os.environ.get("TRIVY_MAX_DETAILS", "2000") or "2000"),
    "docker_scan_workers": int(os.environ.get("TRIVY_SCAN_WORKERS", "1") or "1"),
    # Cadência (s) do SSE de uso (cpu/memória) dos containers na página Docker.
    "docker_stats_interval_seconds": 1,
}
INT_LIMITS: dict[str, tuple[int, int]] = {
    "metrics_retention_days": (1, 365),
    "log_rotate_max_mb": (1, 10240),
    "log_rotate_keep": (1, 365),
    "log_rotate_interval_min": (1, 1440),
    "log_s3_config_id": (0, 1_000_000_000),
    "deployment_preview_port": (0, 65535),
    "deployment_preview_limit": (0, 10000),
    "upload_max_mb": (1, 10240),
    "upload_concurrency": (1, 64),
    "session_ttl_days": (1, 3650),
    "docker_scan_rate_limit_seconds": (10, 86400),
    "docker_scan_max_details": (0, 50000),
    "docker_scan_workers": (1, 4),
    "docker_stats_interval_seconds": (1, 60),
}
STR_DEFAULTS: dict[str, str] = {
    "acme_email": "",
    # Origens CORS permitidas (lista separada por vírgula; "*" = qualquer).
    # Default do env API_CORS_ORIGINS por compat. Aplica no restart da API.
    "api_cors_origins": os.environ.get("API_CORS_ORIGINS", "*"),
    "cloudflare_tunnel_token": "",
    "cloudflare_tunnel_1_token": "",
    "cloudflare_tunnel_2_token": "",
    "cloudflare_tunnel_3_token": "",
    "backup_encryption_secret": "",
    "deployment_preview_domain": "",
    "deployment_preview_ip": "",
}
SECRET_STR_KEYS = {
    "cloudflare_tunnel_token",
    "cloudflare_tunnel_1_token",
    "cloudflare_tunnel_2_token",
    "cloudflare_tunnel_3_token",
    "backup_encryption_secret",
}
BOOL_DEFAULTS: dict[str, bool] = {
    "log_rotate_enabled": False,   # liga a rotação automática
    "log_compress": True,          # comprime (gzip) os rotacionados
    "log_s3_enabled": False,       # envia os rotacionados ao S3
    "ipv6_enabled": False,         # habilita `listen [::]...` (nem toda máquina/rede suporta)
    "cloudflare_tunnel_enabled": False,  # habilita cloudflared tunnel run --token
    "cloudflare_tunnel_1_enabled": False,
    "cloudflare_tunnel_2_enabled": False,
    "cloudflare_tunnel_3_enabled": False,
    "deployment_preview_https": False,
    # Scan de vulnerabilidades das imagens (trivy). Default do env TRIVY_ENABLED.
    "docker_scan_enabled": _env_bool("TRIVY_ENABLED"),
    # HTTPS self-signed da própria API. Default do env API_TLS. Aplica no restart.
    "api_tls_enabled": _env_bool("API_TLS"),
}

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TRUE = {"1", "true", "on", "yes"}

# Compat: várias partes ainda referenciam LIMITS/DEFAULTS (inteiros).
LIMITS = INT_LIMITS
DEFAULTS = INT_DEFAULTS


def _as_bool(v) -> bool:
    return str(v).strip().lower() in _TRUE if not isinstance(v, bool) else v


def get_all(mask_secrets: bool = False) -> dict:
    with get_session() as s:
        stored = {row.key: row.value for row in s.query(AppSetting).all()}
    out: dict = {}
    for key, default in FLOAT_DEFAULTS.items():
        raw = stored.get(key)
        try:
            out[key] = float(raw) if raw is not None else default
        except (TypeError, ValueError):
            out[key] = default
    for key, default in INT_DEFAULTS.items():
        raw = stored.get(key)
        try:
            out[key] = int(raw) if raw is not None else default
        except (TypeError, ValueError):
            out[key] = default
    for key, default in STR_DEFAULTS.items():
        value = stored.get(key, default)
        out[key] = "********" if mask_secrets and key in SECRET_STR_KEYS and value else value
    for key, default in BOOL_DEFAULTS.items():
        raw = stored.get(key)
        out[key] = _as_bool(raw) if raw is not None else default
    return out


def get_bool(key: str) -> bool:
    return bool(get_all()[key])


def get_int(key: str) -> int:
    return int(get_all()[key])


def get_float(key: str) -> float:
    return float(get_all()[key])


def get_str(key: str) -> str:
    return str(get_all()[key])


def validate(key: str, value):
    if key in FLOAT_LIMITS:
        try:
            fv = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key} deve ser um número")
        lo, hi = FLOAT_LIMITS[key]
        if not (lo <= fv <= hi):
            raise ValueError(f"{key} deve estar entre {lo} e {hi}")
        # arredonda a 3 casas (ms) para evitar ruído de ponto flutuante
        return round(fv, 3)
    if key in INT_LIMITS:
        try:
            iv = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key} deve ser um inteiro")
        lo, hi = INT_LIMITS[key]
        if not (lo <= iv <= hi):
            raise ValueError(f"{key} deve estar entre {lo} e {hi}")
        return iv
    if key in STR_DEFAULTS:
        v = "" if value is None else str(value).strip()
        if key == "acme_email" and v and not _EMAIL.match(v):
            raise ValueError("acme_email: e-mail inválido")
        if key in SECRET_STR_KEYS and v == "********":
            return v
        return v
    if key in BOOL_DEFAULTS:
        return _as_bool(value)
    raise ValueError(f"configuração desconhecida: {key}")


def known_keys() -> set[str]:
    return set(FLOAT_LIMITS) | set(INT_LIMITS) | set(STR_DEFAULTS) | set(BOOL_DEFAULTS)


def update(values: dict) -> dict:
    normalized = {k: validate(k, v) for k, v in values.items()}
    with get_session() as s:
        for key, val in normalized.items():
            if key in SECRET_STR_KEYS and val == "********":
                continue
            # bools persistidos como "1"/"0" (get_all reinterpreta).
            stored = "1" if (key in BOOL_DEFAULTS and val) else "0" if key in BOOL_DEFAULTS else str(val)
            row = s.get(AppSetting, key)
            if row is None:
                s.add(AppSetting(key=key, value=stored))
            else:
                row.value = stored
        s.commit()
    return get_all()
