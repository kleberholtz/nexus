"""Configuração do banco de dados em **arquivo** (não em app_settings).

A tabela `app_settings` mora dentro do próprio banco, então a configuração de
*qual* banco usar não pode viver ali (seria circular). Fica num JSON lido no
boot para montar a URL do SQLAlchemy, com precedência **arquivo > variáveis de
ambiente** (compat). Editável pela UI (Configurações → Banco), mas só é gravado
depois de passar no **teste de conexão**; a troca vale no **restart** da API.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote_plus

CONFIG_FILE = Path(os.environ.get("DB_CONFIG_FILE", "/var/lib/nexus/db.json"))

_DEFAULT_PORTS = {"mysql": "3306", "mariadb": "3306", "postgresql": "5432"}
_DRIVERS = {
    "mysql": "mysql+pymysql",
    "mariadb": "mysql+pymysql",
    "postgresql": "postgresql+psycopg2",
    "postgres": "postgresql+psycopg2",
    "pg": "postgresql+psycopg2",
}
_FIELDS = ("type", "dsn", "host", "port", "user", "password", "name", "sqlite_path")


def env_config() -> dict:
    """Config derivada do ambiente (fallback e seed inicial da UI)."""
    return {
        "type": os.environ.get("DB_TYPE", "sqlite").strip().lower() or "sqlite",
        "dsn": os.environ.get("DB_DSN", "").strip(),
        "host": os.environ.get("DB_HOST", "127.0.0.1"),
        "port": os.environ.get("DB_PORT", ""),
        "user": os.environ.get("DB_USER", ""),
        "password": os.environ.get("DB_PASS", ""),
        "name": os.environ.get("DB_NAME", "nexus"),
        "sqlite_path": os.environ.get("DB_SQLITE_PATH", "/var/lib/nexus/nexus.db"),
    }


def load() -> dict | None:
    """Config gravada no arquivo (ou None se ausente/inválido)."""
    try:
        raw = json.loads(CONFIG_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    return {k: raw.get(k, "") for k in _FIELDS}


def save(cfg: dict) -> None:
    clean = {k: str(cfg.get(k, "") or "") for k in _FIELDS}
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(clean, indent=2), "utf-8")
    try:
        CONFIG_FILE.chmod(0o600)  # contém senha do banco
    except OSError:
        pass


def effective() -> dict:
    """Config em uso: arquivo se existir, senão ambiente."""
    return load() or env_config()


def build_url(cfg: dict) -> str:
    """Monta a URL do SQLAlchemy a partir de um dict de config."""
    dsn = (cfg.get("dsn") or "").strip()
    if dsn:
        return dsn
    db_type = (cfg.get("type") or "sqlite").strip().lower()
    if db_type == "sqlite":
        path = (cfg.get("sqlite_path") or "/var/lib/nexus/nexus.db").strip()
        return f"sqlite:///{path}"
    driver = _DRIVERS.get(db_type)
    if not driver:
        raise ValueError(f"DB_TYPE inválido: {db_type!r} (use sqlite/mysql/postgresql)")
    user = quote_plus(cfg.get("user", "") or "")
    passwd = quote_plus(cfg.get("password", "") or "")
    host = cfg.get("host", "") or "127.0.0.1"
    port = (cfg.get("port", "") or "").strip() or _DEFAULT_PORTS.get(
        db_type.replace("postgres", "postgresql"), "")
    name = cfg.get("name", "") or "nexus"
    auth = f"{user}:{passwd}@" if user else ""
    hostport = f"{host}:{port}" if port else host
    return f"{driver}://{auth}{hostport}/{name}"


def resolve_url() -> str:
    """URL efetiva (arquivo > ambiente) usada pelo engine no boot."""
    return build_url(effective())


def public(cfg: dict) -> dict:
    """Config para exibição: senha e DSN mascarados."""
    out = {k: cfg.get(k, "") for k in _FIELDS}
    if out.get("password"):
        out["password"] = "********"
    if out.get("dsn"):
        out["dsn"] = "********"
    return out


def test_connection(cfg: dict, timeout: int = 5) -> None:
    """Tenta conectar com a config dada. Levanta exceção em caso de falha."""
    from sqlalchemy import create_engine, text

    url = build_url(cfg)
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    elif url.startswith("mysql"):
        kwargs["connect_args"] = {"connect_timeout": timeout}
    elif url.startswith("postgresql"):
        kwargs["connect_args"] = {"connect_timeout": timeout}
    engine = create_engine(url, **kwargs)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()
