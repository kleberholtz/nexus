"""Camada de banco: engine, sessão e URL montada a partir do ambiente.

Suporta sqlite (padrão), mysql/mariadb e postgresql. A URL vem da config
persistida em arquivo (`api/dbconfig.py`, editável pela UI) com fallback para as
variáveis de ambiente `DB_DSN`/`DB_TYPE`/DB_USER/DB_PASS/DB_HOST/DB_PORT/DB_NAME.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .. import dbconfig
from .models import Base


def database_url() -> str:
    return dbconfig.resolve_url()


def _make_engine():
    url = database_url()
    kwargs: dict = {"pool_pre_ping": True, "future": True}
    if url.startswith("sqlite"):
        # Garante o diretório do arquivo e permite uso entre threads.
        path = url.replace("sqlite:///", "", 1)
        if path and path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, class_=Session, expire_on_commit=False, future=True)

_initialized = False


def ensure_db() -> None:
    """Aplica as migrations uma única vez (idempotente). Chamado no startup do
    app e, de forma preguiçosa, na primeira sessão (cobre testes/uso direto)."""
    global _initialized
    if _initialized:
        return
    _initialized = True  # marca antes de rodar p/ evitar reentrância
    try:
        from alembic import command
        from alembic.config import Config

        cfg = Config()
        cfg.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
        cfg.set_main_option("sqlalchemy.url", database_url())
        command.upgrade(cfg, "head")
    except Exception as exc:  # noqa: BLE001
        print(f"db: migrations falharam ({exc}); criando tabelas via metadata", flush=True)
        Base.metadata.create_all(engine)


def get_session() -> Session:
    ensure_db()
    return SessionLocal()
