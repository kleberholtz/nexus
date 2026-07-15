"""Store/lógica de Projetos e Serviços (grupo CI/CD).

Um Projeto agrupa Serviços de 4 tipos (`kind`): application, database, compose,
template. Os campos específicos de cada tipo ficam no JSON `config` do serviço.

Segredos (hoje só a senha de banco) são **mascarados** nas respostas GET/list e,
num update, um valor vazio/mascarado mantém o segredo salvo — mesmo padrão de
`s3configs.py`/`gitproviders.py`.
"""
from __future__ import annotations

import bz2
import gzip
import hashlib
import hmac
import ipaddress
import io
import json
import lzma
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
from urllib.parse import urlsplit
import uuid
import datetime as dt
import zipfile

from sqlalchemy.orm import object_session

from .db import get_session
from .db.models import GitProviderRow, Project, ProjectDeployment, ProjectService

MASK = "********"
KINDS = ("application", "database", "compose", "template")
_DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

# Catálogo de bancos: engine -> (imagem docker, versões suportadas). Espelhado no
# front em web/src/lib/db-catalog.ts — manter em sincronia.
DB_ENGINES: dict[str, dict] = {
    "postgres": {"label": "PostgreSQL", "image": "postgres", "versions": ["18", "17", "16"]},
    "mysql": {"label": "MySQL", "image": "mysql", "versions": ["8"]},
    "mariadb": {"label": "MariaDB", "image": "mariadb", "versions": ["11"]},
    "mongodb": {"label": "MongoDB", "image": "mongo", "versions": ["8"]},
    "redis": {"label": "Redis", "image": "redis", "versions": ["7", "6"]},
    "cassandra": {"label": "Cassandra", "image": "cassandra", "versions": ["5"]},
}

# Porta interna e esquema de URL de conexão por engine.
DB_PORTS: dict[str, int] = {
    "postgres": 5432, "mysql": 3306, "mariadb": 3306,
    "mongodb": 27017, "redis": 6379, "cassandra": 9042,
}
DB_URL_SCHEMES: dict[str, str] = {
    "postgres": "postgresql", "mysql": "mysql", "mariadb": "mysql",
    "mongodb": "mongodb", "redis": "redis", "cassandra": "cassandra",
}

# Providers de aplicação e tipos de build aceitos.
APP_PROVIDERS = ("github", "gitlab", "bitbucket", "gitea", "docker", "git", "spa")
CONFIGURED_APP_PROVIDERS = ("github", "gitlab", "gitea", "bitbucket")
BUILD_TYPES = ("dockerfile", "static")
APP_WEBHOOK_TRIGGERS = ("manual", "push", "tag")
BACKUP_DIR = Path(os.environ.get("PROJECT_BACKUP_DIR", "/var/lib/nexus/backups"))
SNAPSHOT_DIR = Path(os.environ.get("PROJECT_SNAPSHOT_DIR", "/var/lib/nexus/snapshots"))
_BACKUP_JOBS: dict[str, dict] = {}
_BACKUP_JOBS_LOCK = threading.Lock()
_RESTORE_JOBS: dict[str, dict] = {}
_RESTORE_JOBS_LOCK = threading.Lock()
_SNAPSHOT_JOBS: dict[str, dict] = {}
_SNAPSHOT_JOBS_LOCK = threading.Lock()
_SNAPSHOT_RESTORE_JOBS: dict[str, dict] = {}
_SNAPSHOT_RESTORE_JOBS_LOCK = threading.Lock()
_RUNTIME_JOBS: dict[str, dict] = {}
_RUNTIME_JOBS_LOCK = threading.Lock()
_BACKUP_SCHEDULER_STARTED = False
_SERVICE_STATUS_MONITOR_STARTED = False
BACKUP_FILE_FORMAT = "backup-{name}-{datetime}"
BACKUP_NAME_VARIABLES = {
    "name", "date", "time", "datetime", "hostname", "server", "uuid", "version", "random",
}
BACKUP_SPLIT_SIZES_MB = (0, 1024, 2048, 4096, 8192)
BACKUP_COMPRESSION: dict[str, dict] = {
    "zip": {"ext": "zip", "levels": (0, 9), "default": 6},
    "bzip2": {"ext": "bz2", "levels": (1, 9), "default": 6},
    "gzip": {"ext": "gz", "levels": (0, 9), "default": 6},
    "7z": {"ext": "7z", "levels": (0, 9), "default": 5},
    "xz": {"ext": "xz", "levels": (0, 9), "default": 6},
    "zstd": {"ext": "zst", "levels": (1, 22), "default": 3},
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def container_name(row: ProjectService) -> str:
    """Nome estável do container do serviço (único: slug + id).

    Aplicações usam o prefixo `app-`; os demais serviços (banco/compose) seguem
    com `nexus-`.
    """
    slug = row.slug or slugify(row.name)
    prefix = "app" if row.kind == "application" else "nexus"
    return f"{prefix}-{slug}-{row.id}"


def volume_name(row: ProjectService) -> str:
    return f"{container_name(row)}-data"


# Raiz dos arquivos das aplicações estáticas (SPA), compartilhada com deploy.py.
APPS_DIR = Path(os.environ.get("DEPLOY_APPS_DIR", "/var/www/apps"))


def is_static_app(row: ProjectService) -> bool:
    """Aplicação servida como arquivos estáticos (SPA) — sem container."""
    return row.kind == "application" and _config(row).get("build_type") == "static"


def app_static_dir(row: ProjectService) -> Path:
    """Diretório onde os arquivos da aplicação estática são publicados."""
    return APPS_DIR / (row.slug or slugify(row.name))


def network_name() -> str:
    return "nexus"


def slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text[:63]


def gen_password(length: int = 20) -> str:
    """Senha aleatória segura para provisionamento de banco (sem símbolos ambíguos)."""
    return secrets.token_urlsafe(length)[:length]


# --- Projetos ----------------------------------------------------------------

def _tags(row: Project) -> list[str]:
    try:
        val = json.loads(row.tags)
        return [str(t) for t in val] if isinstance(val, list) else []
    except json.JSONDecodeError:
        return []


def _service_kind_counts(session, project_id: int) -> dict[str, int]:
    return {
        kind: session.query(ProjectService)
        .filter(ProjectService.project_id == project_id, ProjectService.kind == kind)
        .count()
        for kind in KINDS
    }


def _project_json(row: Project, *, service_count: int | None = None,
                  service_kind_counts: dict[str, int] | None = None) -> dict:
    data = {
        "id": row.id, "name": row.name, "description": row.description,
        "tags": _tags(row), "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }
    if service_count is not None:
        data["service_count"] = service_count
    if service_kind_counts is not None:
        data["service_kind_counts"] = service_kind_counts
    return data


def list_projects() -> list[dict]:
    with get_session() as s:
        rows = s.query(Project).order_by(Project.name.asc()).all()
        out = []
        for r in rows:
            n = s.query(ProjectService).filter(ProjectService.project_id == r.id).count()
            out.append(_project_json(r, service_count=n,
                                     service_kind_counts=_service_kind_counts(s, r.id)))
        return out


def get_project(project_id: int) -> dict:
    with get_session() as s:
        row = s.get(Project, project_id)
        if not row:
            raise KeyError("projeto não encontrado")
        n = s.query(ProjectService).filter(ProjectService.project_id == project_id).count()
        data = _project_json(row, service_count=n,
                             service_kind_counts=_service_kind_counts(s, project_id))
        services = s.query(ProjectService).filter(ProjectService.project_id == project_id).order_by(ProjectService.id.asc()).all()
        for sv in services:
            _ensure_application_webhook(s, sv)
            _sync_runtime_status(s, sv)
        data["services"] = [_service_json(sv) for sv in services]
        return data


def create_project(name: str, description: str, tags: list[str]) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("nome é obrigatório")
    with get_session() as s:
        now = _now_ms()
        row = Project(name=name, description=(description or "").strip(),
                      tags=json.dumps([str(t).strip() for t in (tags or []) if str(t).strip()]),
                      created_ts=now, updated_ts=now)
        s.add(row)
        s.commit()
        s.refresh(row)
        return _project_json(row, service_count=0,
                             service_kind_counts={kind: 0 for kind in KINDS})


def update_project(project_id: int, name: str | None, description: str | None,
                   tags: list[str] | None) -> dict:
    with get_session() as s:
        row = s.get(Project, project_id)
        if not row:
            raise KeyError("projeto não encontrado")
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("nome é obrigatório")
            row.name = name
        if description is not None:
            row.description = description.strip()
        if tags is not None:
            row.tags = json.dumps([str(t).strip() for t in tags if str(t).strip()])
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        n = s.query(ProjectService).filter(ProjectService.project_id == project_id).count()
        return _project_json(row, service_count=n,
                             service_kind_counts=_service_kind_counts(s, project_id))


def delete_project(project_id: int) -> str:
    from . import deployments
    deleted_deployments = 0
    with get_session() as s:
        row = s.get(Project, project_id)
        if not row:
            raise KeyError("projeto não encontrado")
        name = row.name
        deleted_deployments = deployments.delete_for_project_in_session(s, project_id)
        s.query(ProjectService).filter(ProjectService.project_id == project_id) \
            .delete(synchronize_session=False)
        s.delete(row)
        s.commit()
        if deleted_deployments:
            deployments.notify_changed()
        return name


# --- Serviços ----------------------------------------------------------------

def _unique_slug(session, project_id: int, name: str) -> str:
    """Slug derivado do nome, único dentro do projeto (sufixa -2, -3, … se colidir)."""
    base = slugify(name) or "svc"
    slug, n = base, 2
    while session.query(ProjectService).filter(
        ProjectService.project_id == project_id, ProjectService.slug == slug,
    ).first():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _config(row: ProjectService) -> dict:
    try:
        val = json.loads(row.config)
        return val if isinstance(val, dict) else {}
    except json.JSONDecodeError:
        return {}


def _masked_config(kind: str, cfg: dict) -> dict:
    """Mascara segredos conforme o tipo (hoje: password de database)."""
    out = dict(cfg)
    if kind == "database" and out.get("password"):
        out["password"] = MASK
    return out


def _has_successful_deployment(session, row: ProjectService) -> bool:
    return session.query(ProjectDeployment.id).filter(
        ProjectDeployment.project_id == row.project_id,
        ProjectDeployment.service_id == row.id,
        ProjectDeployment.status == "deployed",
    ).first() is not None


def _service_json(row: ProjectService) -> dict:
    cfg = _config(row)
    session = object_session(row)
    return {
        "id": row.id, "project_id": row.project_id, "kind": row.kind,
        "name": row.name, "slug": row.slug, "description": row.description,
        "status": row.status, "config": _masked_config(row.kind, cfg),
        "container_id": row.container_id,
        "has_successful_deployment": _has_successful_deployment(session, row) if session else False,
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }


def _ensure_application_webhook(session, row: ProjectService) -> None:
    if row.kind != "application":
        return
    cfg = _config(row)
    changed = False
    if not cfg.get("webhook_secret"):
        cfg["webhook_secret"] = secrets.token_hex(24)
        changed = True
    if not cfg.get("webhook_trigger"):
        cfg["webhook_trigger"] = "manual"
        changed = True
    if "webhook_enabled" not in cfg:
        cfg["webhook_enabled"] = False
        changed = True
    if changed:
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        session.commit()


def database_credentials(row: ProjectService) -> dict:
    """Credenciais efetivas de um serviço de banco (com senha REAL, p/ o painel).

    `internal_host` é o nome do container (resolvível na rede docker `nexus`);
    a URL de conexão embute a senha real — exibida no bloco de credenciais.
    """
    cfg = _config(row)
    engine = cfg.get("engine") or ""
    user = cfg.get("user") or ""
    password = cfg.get("password") or ""
    database = cfg.get("database") or user or "app"
    host = container_name(row)
    port = DB_PORTS.get(engine, 0)
    scheme = DB_URL_SCHEMES.get(engine, engine)
    if engine == "redis":
        url = f"{scheme}://:{password}@{host}:{port}"
    else:
        url = f"{scheme}://{user}:{password}@{host}:{port}/{database}"
    return {
        "engine": engine, "user": user, "password": password, "database": database,
        "internal_host": host, "internal_port": port, "connection_url": url,
        "expose": bool(cfg.get("expose")), "external_port": _int(cfg.get("external_port"), 0),
    }


def get_service(project_id: int, service_id: int) -> dict:
    """Serviço único; inclui credenciais reais (database) e nome do container."""
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        _ensure_application_webhook(s, row)
        _sync_runtime_status(s, row)
        data = _service_json(row)
        data["container_name"] = container_name(row)
        if row.kind == "database":
            data["credentials"] = database_credentials(row)
        return data


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


ULIMIT_TYPES = {
    "nofile", "nproc", "memlock", "stack", "core", "cpu", "data",
    "fsize", "locks", "msgqueue", "nice", "rtprio", "sigpending",
}


def _list_of_dicts(v) -> list[dict]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _float(v, default: float = 0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _runtime_resources(v) -> dict:
    r = v or {}
    cpu_limit = _float(r.get("cpu_limit"), 0)
    if not cpu_limit:
        cpu_limit = _float(r.get("cpu"), 0)  # compatibilidade
    memory_limit = _int(r.get("memory_limit_mb"), 0)
    if not memory_limit:
        memory_limit = _int(r.get("memory_mb"), 0)  # compatibilidade
    return {
        "cpu_reservation": _float(r.get("cpu_reservation"), 0),
        "cpu_limit": cpu_limit,
        "memory_reservation_mb": _int(r.get("memory_reservation_mb"), 0),
        "memory_limit_mb": memory_limit,
    }


def _runtime_ulimits(v) -> list[dict]:
    out = []
    for item in _list_of_dicts(v):
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        if name not in ULIMIT_TYPES:
            raise ValueError(f"ulimit inválido '{name}' (use: {', '.join(sorted(ULIMIT_TYPES))})")
        soft = _int(item.get("soft"), 0)
        hard = _int(item.get("hard"), 0)
        out.append({"name": name, "soft": soft, "hard": hard or soft})
    return out


def _runtime_fields(cfg: dict) -> dict:
    """Campos de runtime comuns (env/volumes/ports/resources/command).

    Passthrough leniente: chaves ausentes ficam de fora; tipos são coeridos.
    - env: texto KEY=VALUE (uma por linha), como o editor devolve.
    - volumes: lista de {source, target}.
    - ports: lista de {host, container}.
    - resources: {cpu_reservation, cpu_limit, memory_reservation_mb, memory_limit_mb}.
    - ulimits: lista de {name, soft, hard}.
    - command: string (run/custom command).
    - command_args: argumentos extras do comando.
    """
    out: dict = {}
    if "env" in cfg:
        out["env"] = str(cfg.get("env") or "")
    if "volumes" in cfg:
        out["volumes"] = _list_of_dicts(cfg.get("volumes"))
    if "ports" in cfg:
        out["ports"] = _list_of_dicts(cfg.get("ports"))
    if "resources" in cfg:
        out["resources"] = _runtime_resources(cfg.get("resources"))
    if "ulimits" in cfg:
        out["ulimits"] = _runtime_ulimits(cfg.get("ulimits"))
    if "command" in cfg:
        out["command"] = str(cfg.get("command") or "")
    if "command_args" in cfg:
        out["command_args"] = _list_of_dicts(cfg.get("command_args"))
    return out


def _git_provider_configured(provider: str) -> bool:
    with get_session() as s:
        return s.query(GitProviderRow).filter(GitProviderRow.type == provider).first() is not None


def _validate_config(kind: str, cfg: dict) -> dict:
    """Valida/normaliza o config por tipo. Retorna o config limpo a persistir."""
    cfg = dict(cfg or {})
    runtime = _runtime_fields(cfg)
    if kind == "application":
        provider = (cfg.get("provider") or "git").strip()
        if provider not in APP_PROVIDERS:
            raise ValueError(f"provider inválido (use: {', '.join(APP_PROVIDERS)})")
        if provider in CONFIGURED_APP_PROVIDERS and not _git_provider_configured(provider):
            raise ValueError(f"configure um provedor {provider} em CI/CD antes de selecionar esta origem")
        build_type = (cfg.get("build_type") or "dockerfile").strip()
        if provider == "spa":
            build_type = "static"
            cfg["spa"] = True
        elif provider == "docker":
            build_type = "dockerfile"
            cfg["spa"] = False
        if build_type not in BUILD_TYPES:
            raise ValueError(f"build_type inválido (use: {', '.join(BUILD_TYPES)})")
        webhook_trigger = str(cfg.get("webhook_trigger") or "manual").strip()
        if webhook_trigger not in APP_WEBHOOK_TRIGGERS:
            raise ValueError(f"trigger inválido (use: {', '.join(APP_WEBHOOK_TRIGGERS)})")
        webhook_enabled = bool(cfg.get("webhook_enabled"))
        if provider not in CONFIGURED_APP_PROVIDERS:
            webhook_trigger = "manual"
            webhook_enabled = False
        if not webhook_enabled:
            webhook_trigger = "manual"
        data = {
            "provider": provider, "build_type": build_type,
            "git_url": (cfg.get("git_url") or "").strip(),
            "webhook_secret": str(cfg.get("webhook_secret") or secrets.token_hex(24)).strip(),
            "webhook_enabled": webhook_enabled,
            "webhook_trigger": webhook_trigger,
            "github_installation_id": (cfg.get("github_installation_id") or "").strip(),
            "github_account": (cfg.get("github_account") or "").strip(),
            "github_repo": (cfg.get("github_repo") or "").strip(),
            "branch": (cfg.get("branch") or "").strip(),
            "dockerfile": (cfg.get("dockerfile") or "Dockerfile").strip(),
            "docker_context": (cfg.get("docker_context") or ".").strip(),
            "build_stage": (cfg.get("build_stage") or "").strip(),
            "docker_build_cache": cfg.get("docker_build_cache") is not False,
            "spa": bool(cfg.get("spa")),
            "nginx": bool(cfg.get("nginx")),
            "nginx_server_name": (cfg.get("nginx_server_name") or "").strip(),
            "nginx_port": _int(cfg.get("nginx_port"), 0),
        }
        # Todo deploy de aplicação clona um repositório — exige-o ao configurar.
        # Exceções: o rascunho da criação (config vazio, repo preenchido depois)
        # e o provider `spa`, cujos arquivos são geridos manualmente (file
        # manager em /var/www/apps), sem repositório.
        if cfg and provider != "spa" and not (data["git_url"] or data["github_repo"]):
            raise ValueError(
                "configure o repositório da aplicação: informe a git_url "
                "ou selecione um repositório do provider")
        data.update(runtime)
        return data
    if kind == "database":
        engine = (cfg.get("engine") or "").strip()
        if engine not in DB_ENGINES:
            raise ValueError(f"engine inválido (use: {', '.join(DB_ENGINES)})")
        image = (cfg.get("image") or "").strip()
        version = (cfg.get("version") or "").strip()
        if not image:
            if version not in DB_ENGINES[engine]["versions"]:
                raise ValueError(
                    f"versão inválida para {engine} (use: {', '.join(DB_ENGINES[engine]['versions'])})")
        user = (cfg.get("user") or "").strip()
        password = cfg.get("password") or ""
        if not password:
            raise ValueError("password é obrigatório")
        expose = bool(cfg.get("expose"))
        external_port = _int(cfg.get("external_port"), 0) or (DB_PORTS[engine] if expose else 0)
        data = {
            "engine": engine, "version": version, "user": user,
            "password": password, "image": image,
            "database": (cfg.get("database") or "").strip(),
            "expose": expose,
            "external_port": external_port,
            "backup_s3_id": _int(cfg.get("backup_s3_id"), 0) or None,
            "backup_s3_enabled": bool(cfg.get("backup_s3_enabled", True)),
            "backup_compress": bool(cfg.get("backup_compress", cfg.get("backup_compress", True))),
            "backup_database": str(cfg.get("backup_database") or "").strip(),
            "backup_file_format": _backup_file_format(cfg.get("backup_file_format") or "backup-{name}-{datetime}"),
            "backup_compression_method": _backup_compression_method(cfg.get("backup_compression_method")),
            "backup_compression_level": _backup_compression_level(
                cfg.get("backup_compression_method"), cfg.get("backup_compression_level")),
            "backup_local_retention": _backup_retention(cfg.get("backup_local_retention"), 50),
            "backup_s3_retention": _backup_retention(cfg.get("backup_s3_retention"), 50),
            "backup_split_size_mb": _backup_split_size_mb(cfg.get("backup_split_size_mb")),
            "backup_encryption_enabled": bool(cfg.get("backup_encryption_enabled")),
            "backup_schedule_enabled": bool(cfg.get("backup_schedule_enabled")),
            "backup_schedule_cron": (cfg.get("backup_schedule_cron") or "").strip(),
            "snapshot_s3_id": _int(cfg.get("snapshot_s3_id"), 0) or None,
            "snapshot_s3_enabled": bool(cfg.get("snapshot_s3_enabled", True)),
            "snapshot_compress": bool(cfg.get("snapshot_compress", True)),
            "snapshot_file_format": _backup_file_format(cfg.get("snapshot_file_format") or "snapshot-{name}-{datetime}"),
            "snapshot_compression_method": _backup_compression_method(cfg.get("snapshot_compression_method")),
            "snapshot_compression_level": _backup_compression_level(
                cfg.get("snapshot_compression_method"), cfg.get("snapshot_compression_level")),
            "snapshot_local_retention": _backup_retention(cfg.get("snapshot_local_retention"), 20),
            "snapshot_s3_retention": _backup_retention(cfg.get("snapshot_s3_retention"), 20),
            "snapshot_split_size_mb": _backup_split_size_mb(cfg.get("snapshot_split_size_mb")),
            "snapshot_encryption_enabled": bool(cfg.get("snapshot_encryption_enabled")),
            "snapshot_schedule_enabled": bool(cfg.get("snapshot_schedule_enabled")),
            "snapshot_schedule_cron": (cfg.get("snapshot_schedule_cron") or "").strip(),
            "snapshots": _list_of_dicts(cfg.get("snapshots")),
            "backups": _list_of_dicts(cfg.get("backups")),  # histórico de backups
        }
        data.update(runtime)
        return data
    if kind == "compose":
        mode = (cfg.get("mode") or "compose").strip()
        if mode not in ("compose", "stack"):
            raise ValueError("mode deve ser 'compose' ou 'stack'")
        data = {"mode": mode, "content": cfg.get("content") or ""}
        data.update(runtime)
        return data
    if kind == "template":
        tid = (cfg.get("template_id") or "").strip()
        if not tid:
            raise ValueError("template_id é obrigatório")
        return {
            "template_id": tid, "name": cfg.get("name") or "",
            "version": cfg.get("version") or "", "logo": cfg.get("logo") or "",
            "tags": [str(t) for t in (cfg.get("tags") or [])],
        }
    raise ValueError(f"kind inválido (use: {', '.join(KINDS)})")


def create_service(project_id: int, kind: str, name: str, description: str,
                   config: dict) -> dict:
    kind = (kind or "").strip()
    if kind not in KINDS:
        raise ValueError(f"kind inválido (use: {', '.join(KINDS)})")
    name = (name or "").strip()
    if not name:
        raise ValueError("nome é obrigatório")
    clean = _validate_config(kind, config)
    with get_session() as s:
        if not s.get(Project, project_id):
            raise KeyError("projeto não encontrado")
        now = _now_ms()
        row = ProjectService(project_id=project_id, kind=kind, name=name,
                             slug=_unique_slug(s, project_id, name),
                             description=(description or "").strip(),
                             status="created", config=json.dumps(clean),
                             created_ts=now, updated_ts=now)
        s.add(row)
        s.commit()
        s.refresh(row)
        return _service_json(row)


def update_service(project_id: int, service_id: int, name: str | None,
                   description: str | None, config: dict | None) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if name is not None:
            name = name.strip()
            if not name:
                raise ValueError("nome é obrigatório")
            row.name = name
        if description is not None:
            row.description = description.strip()
        if config is not None:
            merged = dict(_config(row))
            for k, v in config.items():
                # segredo vazio/mascarado → mantém o atual
                if row.kind == "database" and k == "password" and (not v or v == MASK):
                    continue
                merged[k] = v
            clean = _validate_config(row.kind, merged)
            row.config = json.dumps(clean)
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        return _service_json(row)


def update_service_config(project_id: int, service_id: int, patch: dict) -> dict:
    return update_service(project_id, service_id, None, None, patch)


def _webhook_event_kind(provider: str, headers: dict, payload: dict) -> str:
    lowered = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    if provider == "github":
        event = lowered.get("x-github-event", "")
        ref = str((payload or {}).get("ref") or "")
        if event == "push" and ref.startswith("refs/tags/"):
            return "tag"
        return "push" if event == "push" else event
    if provider == "gitlab":
        event = lowered.get("x-gitlab-event", "").lower()
        if "tag push" in event:
            return "tag"
        if "push" in event:
            return "push"
        return event
    if provider == "gitea":
        event = lowered.get("x-gitea-event", "")
        ref = str((payload or {}).get("ref") or "")
        if event == "push" and ref.startswith("refs/tags/"):
            return "tag"
        return "push" if event == "push" else event
    if provider == "bitbucket":
        event = lowered.get("x-event-key", "").lower()
        if event == "repo:push":
            changes = ((payload or {}).get("push") or {}).get("changes") or []
            for change in changes:
                new = (change or {}).get("new") or {}
                if str(new.get("type") or "").lower() == "tag":
                    return "tag"
            return "push"
        return event
    return ""


def _webhook_secret_matches(provider: str, expected: str, provided: str, headers: dict, body: bytes) -> bool:
    lowered = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    if provided and secrets.compare_digest(str(provided), expected):
        return True
    github_sha256 = lowered.get("x-hub-signature-256", "")
    if github_sha256:
        digest = "sha256=" + hmac.new(expected.encode("utf-8"), body, hashlib.sha256).hexdigest()
        if secrets.compare_digest(github_sha256, digest):
            return True
    github_sha1 = lowered.get("x-hub-signature", "")
    if github_sha1:
        digest = "sha1=" + hmac.new(expected.encode("utf-8"), body, hashlib.sha1).hexdigest()
        if secrets.compare_digest(github_sha1, digest):
            return True
    if provider == "gitlab" or "x-gitlab-event" in lowered:
        token = lowered.get("x-gitlab-token", "")
        return bool(token) and secrets.compare_digest(token, expected)
    if provider == "gitea" or "x-gitea-event" in lowered:
        signature = lowered.get("x-gitea-signature", "")
        digest = hmac.new(expected.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return bool(signature) and secrets.compare_digest(signature, digest)
    if provider == "bitbucket" or "x-event-key" in lowered:
        signature = lowered.get("x-hub-signature", "")
        if signature.startswith("sha256="):
            digest = "sha256=" + hmac.new(expected.encode("utf-8"), body, hashlib.sha256).hexdigest()
            return secrets.compare_digest(signature, digest)
    return False


def _repo_key(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    match = re.match(r"^(?:ssh://)?git@([^/:]+)[:/]([^#?]+)$", value)
    if match:
        path = match.group(2)
        if path.endswith(".git"):
            path = path[:-4]
        return f"{match.group(1).lower()}/{path.strip('/').lower()}"
    parsed = urlsplit(value)
    if parsed.hostname:
        path = parsed.path.strip("/")
        if path.endswith(".git"):
            path = path[:-4]
        return f"{parsed.hostname.lower()}/{path.lower()}"
    path = value.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return path.lower()


def _repo_candidates(provider: str, payload: dict) -> set[str]:
    out: set[str] = set()

    def add(value) -> None:
        key = _repo_key(str(value or ""))
        if key:
            out.add(key)

    repo = (payload or {}).get("repository") or {}
    project = (payload or {}).get("project") or {}
    for src in (repo, project):
        if not isinstance(src, dict):
            continue
        for key in ("clone_url", "git_http_url", "http_url", "web_url", "html_url", "ssh_url", "git_ssh_url", "full_name", "path_with_namespace"):
            add(src.get(key))
        links = src.get("links")
        if isinstance(links, dict):
            html = links.get("html")
            if isinstance(html, dict):
                add(html.get("href"))
            clones = links.get("clone")
            if isinstance(clones, list):
                for clone in clones:
                    if isinstance(clone, dict):
                        add(clone.get("href"))
    if provider == "bitbucket":
        add(repo.get("full_name") if isinstance(repo, dict) else "")
    return out


def _repo_matches(git_url: str, candidates: set[str]) -> bool:
    key = _repo_key(git_url)
    if not key:
        return False
    return any(key == candidate or key.endswith(f"/{candidate}") for candidate in candidates)


def handle_app_webhook(project_id: int, service_id: int, secret: str, headers: dict, payload: dict, body: bytes = b"") -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "application":
            raise ValueError("webhook disponível só para aplicações")
        cfg = _config(row)
        expected = str(cfg.get("webhook_secret") or "")
        provider = str(cfg.get("provider") or "")
        if not expected or not _webhook_secret_matches(provider, expected, str(secret or ""), headers, body):
            raise PermissionError("secret inválida")
        enabled = bool(cfg.get("webhook_enabled"))
        trigger = str(cfg.get("webhook_trigger") or "manual")
    event_kind = _webhook_event_kind(provider, headers, payload)
    if not enabled:
        return {"accepted": True, "triggered": False, "reason": "webhook desativado", "event": event_kind}
    if trigger == "manual":
        return {"accepted": True, "triggered": False, "reason": "trigger manual", "event": event_kind}
    if trigger == "push" and event_kind != "push":
        return {"accepted": True, "triggered": False, "reason": "evento ignorado", "event": event_kind}
    if trigger == "tag" and event_kind != "tag":
        return {"accepted": True, "triggered": False, "reason": "evento ignorado", "event": event_kind}
    job = start_runtime_action_job(project_id, service_id, "deploy")
    return {"accepted": True, "triggered": True, "event": event_kind, "job": job}


def handle_provider_webhook(provider_name: str, secret: str, headers: dict, payload: dict, body: bytes = b"") -> dict:
    provider_name = (provider_name or "").strip()
    with get_session() as s:
        provider_row = s.query(GitProviderRow).filter(GitProviderRow.name == provider_name).first()
        if not provider_row and provider_name.isdigit():
            provider_row = s.get(GitProviderRow, int(provider_name))
        if not provider_row:
            raise KeyError("provedor não encontrado")
        expected = str(provider_row.webhook_secret or "")
        provider = str(provider_row.type or "")
        if not expected or not _webhook_secret_matches(provider, expected, str(secret or ""), headers, body):
            raise PermissionError("secret inválida")
        event_kind = _webhook_event_kind(provider, headers, payload)
        candidates = _repo_candidates(provider, payload)
        rows = s.query(ProjectService).filter(ProjectService.kind == "application").all()
        matched: list[tuple[int, int, str, str, bool]] = []
        for row in rows:
            cfg = _config(row)
            if str(cfg.get("provider") or "") != provider:
                continue
            if not _repo_matches(str(cfg.get("git_url") or ""), candidates):
                continue
            matched.append((row.project_id, row.id, row.name, str(cfg.get("webhook_trigger") or "manual"), bool(cfg.get("webhook_enabled"))))

    deployments = []
    ignored = []
    for project_id, service_id, service_name, trigger, enabled in matched:
        if not enabled:
            ignored.append({"service_id": service_id, "service": service_name, "reason": "webhook desativado"})
            continue
        if trigger == "manual":
            ignored.append({"service_id": service_id, "service": service_name, "reason": "trigger manual"})
            continue
        if trigger == "push" and event_kind != "push":
            ignored.append({"service_id": service_id, "service": service_name, "reason": "evento ignorado", "event": event_kind})
            continue
        if trigger == "tag" and event_kind != "tag":
            ignored.append({"service_id": service_id, "service": service_name, "reason": "evento ignorado", "event": event_kind})
            continue
        job = start_runtime_action_job(project_id, service_id, "deploy")
        deployments.append({"project_id": project_id, "service_id": service_id, "service": service_name, "job": job})
    return {
        "accepted": True,
        "triggered": bool(deployments),
        "event": event_kind,
        "matched": len(matched),
        "deployments": deployments,
        "ignored": ignored,
    }


def delete_service(project_id: int, service_id: int) -> str:
    from . import deployments
    deleted_deployments = 0
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        name = row.name
        for domain in _config(row).get("domains", []):
            try:
                _remove_domain_server(str(domain.get("server_file") or ""))
            except Exception:
                pass
        deleted_deployments = deployments.delete_for_service_in_session(s, project_id, service_id)
        # Best-effort: remove o container/volume se provisionado (não falha o delete).
        try:
            from . import provision
            provision.remove(row, with_volume=True)
        except Exception:  # noqa: BLE001 — docker ausente/erro não deve travar o delete
            pass
        s.delete(row)
        s.commit()
        if deleted_deployments:
            deployments.notify_changed()
        return name


def _domain_server_filename(service_id: int, host: str) -> str:
    return f"service-{service_id}-domain-{slugify(host)}.conf"


def _remove_domain_server(filename: str) -> None:
    if not filename or not re.fullmatch(r"service-\d+-domain-[a-z0-9-]+\.conf", filename):
        return
    from .config import store as config_store
    prefix = config_store.ConfigStore().prefix
    config_store.disable_resource(prefix, "http", filename)
    (prefix / "http-available" / filename).unlink(missing_ok=True)
    ok, output = config_store.nginx_test()
    if not ok:
        raise ValueError(f"nginx -t rejeitou a remoção do domínio:\n{output}")


def service_domains(project_id: int, service_id: int) -> list[dict]:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "application":
            raise ValueError("domínios estão disponíveis apenas para aplicações")
        items = list(_config(row).get("domains", []))
        return [({**item, "path": "/", "internal_path": item.get("path") or "/"}
                 if item.get("app_type") == "spa" and "internal_path" not in item else item)
                for item in items]


def add_service_domain(project_id: int, service_id: int, payload: dict, domain_id: str = "") -> dict:
    from . import appsettings, certs, dnsproviders
    from .config import store as config_store
    from .config.parser import parse
    from .dns.base import DnsError, zone_of

    host = str(payload.get("host") or "").strip().lower().rstrip(".")
    path = "/" + str(payload.get("path") or "/").strip().lstrip("/")
    path = re.sub(r"/{2,}", "/", path)
    if path != "/":
        path = path.rstrip("/")
    if ".." in Path(path).parts:
        raise ValueError("path público inválido")
    if not _DOMAIN_RE.fullmatch(host):
        raise ValueError("host inválido")
    https = bool(payload.get("https"))
    provider = str(payload.get("provider") or "self-signed") if https else ""
    cert_name = str(payload.get("cert_name") or "").strip()
    if https and provider not in {"self-signed", "ca-signed", "letsencrypt"}:
        raise ValueError("provider HTTPS inválido")
    if https and not any(item["name"] == cert_name and item.get("has_key") for item in certs.list_certs()):
        raise ValueError("certificado HTTPS não encontrado")

    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "application":
            raise ValueError("domínios estão disponíveis apenas para aplicações")
        cfg = _config(row)
        spa = bool(cfg.get("spa")) or cfg.get("provider") == "spa"
        port: int | None = None
        static_root: Path | None = None
        internal_path = ""
        if spa:
            internal_path = "/" + str(payload.get("internal_path") or "/").strip().lstrip("/")
            internal_path = re.sub(r"/{2,}", "/", internal_path)
            if internal_path != "/":
                internal_path = internal_path.rstrip("/")
            relative = internal_path.lstrip("/")
            if relative in {"", "."}:
                relative = ""
            if any(part in {"", ".", ".."} for part in Path(relative).parts):
                raise ValueError("path da pasta SPA inválido")
            base_dir = app_static_dir(row).resolve()
            static_root = (base_dir / relative).resolve()
            if not static_root.is_relative_to(base_dir):
                raise ValueError("path da pasta SPA inválido")
            if not static_root.is_dir():
                raise ValueError("pasta SPA não encontrada; envie os arquivos antes de vincular o domain")
        else:
            try:
                port = int(payload.get("container_port"))
            except (TypeError, ValueError):
                raise ValueError("container_port deve ser uma porta válida")
            if not 1 <= port <= 65535:
                raise ValueError("container_port deve estar entre 1 e 65535")
        domains = list(cfg.get("domains", []))
        previous = next((item for item in domains if item.get("id") == domain_id), None) if domain_id else None
        if domain_id and previous is None:
            raise KeyError("domínio não encontrado")
        if any(item.get("id") != domain_id and item.get("host") == host and item.get("path") == path for item in domains):
            raise ValueError("host e path já vinculados a este serviço")
        filename = _domain_server_filename(service_id, host)
        store = config_store.ConfigStore()
        if any(loc.ident == slugify(host) and loc.ident != (previous or {}).get("server_id") for loc in store.servers()):
            raise ValueError(f"já existe um server para '{host}'")
        listen = "443 ssl" if https else "80"
        ssl_lines = ""
        if https:
            cert = next(item for item in certs.list_certs() if item["name"] == cert_name)
            ssl_lines = f"ssl_certificate {cert['cert_path']};\nssl_certificate_key {cert['key_path']};"
        dns_link = bool(payload.get("dns_link"))
        dns_provider_id: int | None = None
        dns_status = ""
        dns_record_id = ""
        if dns_link:
            try:
                dns_provider_id = int(payload.get("dns_provider_id"))
            except (TypeError, ValueError):
                raise ValueError("selecione um DNS provider")
            target_ip = appsettings.get_str("deployment_preview_ip").strip()
            try:
                if ipaddress.ip_address(target_ip).version != 4:
                    raise ValueError
            except ValueError:
                raise ValueError("configure um IPv4 válido em deployment_preview_ip")
            try:
                dns_provider = dnsproviders.build_instance(dns_provider_id)
                zone = zone_of(host, dns_provider.list_zones())
                if not zone:
                    raise ValueError(f"nenhuma zona DNS encontrada para {host}")
                records = dns_provider.list_records(str(zone["id"]))
                zone_name = str(zone.get("name") or "").rstrip(".").lower()
                def record_fqdn(record: dict) -> str:
                    name = str(record.get("name") or "").rstrip(".").lower()
                    if name in {"", "@"}:
                        return zone_name
                    if name == zone_name or name.endswith("." + zone_name):
                        return name
                    return f"{name}.{zone_name}"
                current = next((record for record in records
                                if str(record.get("type") or "").upper() == "A"
                                and record_fqdn(record) == host), None)
                if current:
                    updated = dns_provider.update_record(
                        str(zone["id"]), str(current["id"]), "A", host, target_ip,
                        int(current.get("ttl") or 300))
                    dns_record_id = str(updated.get("id") or current["id"])
                    dns_status = "exists"
                else:
                    created = dns_provider.create_record(str(zone["id"]), "A", host, target_ip, 300)
                    dns_record_id = str(created.get("id") or "")
                    dns_status = "created"
            except KeyError:
                raise ValueError("DNS provider não encontrado")
            except DnsError as exc:
                raise ValueError(f"falha ao vincular DNS: {exc}") from exc
        if spa:
            if path == "/":
                location = f"""location / {{
        root {static_root};
        try_files $uri $uri/ /index.html;
    }}"""
            else:
                route = path + "/"
                location = f"""location = {path} {{
        return 301 {route};
    }}
    location {route} {{
        alias {str(static_root).rstrip('/')}/;
        try_files $uri $uri/ {route}index.html;
    }}"""
        else:
            container = container_name(row)
            location = f"""location {path} {{
        proxy_pass http://{container}:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection \"upgrade\";
    }}"""
        raw = f"""# nexus-managed-service: {service_id}
server {{
    listen {listen};
    server_name {host};
    {ssl_lines}
    {location}
}}
"""
        parsed = parse(raw)
        target = store.prefix / "http-available" / filename
        conf = config_store.ConfFile(path=target, root=parsed, root_context="http")
        store.files.append(conf)
        try:
            config_store.save_and_enable(store.prefix, "http", filename, conf)
        except config_store.ConfigError as exc:
            raise ValueError(str(exc)) from exc
        item = {"id": domain_id or secrets.token_hex(6), "host": host, "path": path,
                "container_port": port, "https": https, "provider": provider,
                "cert_name": cert_name, "server_id": slugify(host), "server_file": filename,
                "app_type": "spa" if spa else "container",
                "internal_path": internal_path if spa else "",
                "dns_link": dns_link, "dns_provider_id": dns_provider_id,
                "dns_record_id": dns_record_id, "dns_status": dns_status}
        if previous:
            domains = [item if entry.get("id") == domain_id else entry for entry in domains]
            old_filename = str(previous.get("server_file") or "")
            if old_filename != filename:
                _remove_domain_server(old_filename)
        else:
            domains.append(item)
        cfg["domains"] = domains
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return item


def delete_service_domain(project_id: int, service_id: int, domain_id: str) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.status == "running":
            raise ValueError("pare o serviço antes de remover o domain")
        cfg = _config(row)
        domains = list(cfg.get("domains", []))
        item = next((entry for entry in domains if entry.get("id") == domain_id), None)
        if item is None:
            raise KeyError("domínio não encontrado")
        _remove_domain_server(str(item.get("server_file") or ""))
        cfg["domains"] = [entry for entry in domains if entry.get("id") != domain_id]
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return item


# --- Runtime (Docker) --------------------------------------------------------

RUNTIME_VERBS = ("deploy", "start", "stop", "restart", "rebuild")


def _docker_state_to_status(row: ProjectService, state: str, info: dict | None = None) -> str:
    if row.status == "deploying" and state != "running":
        return row.status
    if state == "running":
        return "running"
    if state in ("exited", "dead"):
        exit_code = _int(((info or {}).get("State") or {}).get("ExitCode"), 0)
        return "failed" if exit_code else "stopped"
    if state in ("created", "paused", "restarting"):
        return "stopped"
    if state == "absent":
        return "created" if row.status == "created" else "stopped"
    return row.status


def _sync_runtime_status(session, row: ProjectService) -> None:
    if row.kind == "template":
        return
    # Aplicação estática não tem container — o status vem do deploy dos arquivos.
    if is_static_app(row):
        return
    from . import dockerclient
    if not dockerclient.available():
        return
    current = row.status
    try:
        if row.kind == "compose":
            containers = dockerclient.list_containers(
                all_=True, filters={"label": [f"com.docker.compose.project={container_name(row)}"]})
            if any(c.get("state") == "running" for c in containers):
                current = "running"
            elif containers:
                current = "stopped" if row.status != "deploying" else row.status
            elif row.status not in ("created", "deploying"):
                current = "stopped"
        else:
            info = dockerclient.inspect_container(container_name(row))
            state = ((info or {}).get("State") or {}).get("Status", "absent") if info else "absent"
            current = _docker_state_to_status(row, state, info)
    except dockerclient.DockerError:
        return
    if current != row.status:
        row.status = current
        row.updated_ts = _now_ms()
        session.commit()


def sync_runtime_statuses() -> None:
    """Sincroniza status persistido com o estado real dos containers Docker."""
    with get_session() as s:
        rows = s.query(ProjectService).filter(ProjectService.kind != "template").all()
        for row in rows:
            _sync_runtime_status(s, row)


def start_service_status_monitor() -> None:
    """Thread servidor-side que evita status stale quando Docker muda por fora."""
    global _SERVICE_STATUS_MONITOR_STARTED
    if _SERVICE_STATUS_MONITOR_STARTED:
        return
    _SERVICE_STATUS_MONITOR_STARTED = True
    interval = max(2, _int(os.environ.get("PROJECT_STATUS_SYNC_SECONDS"), 10))

    def loop() -> None:
        while True:
            try:
                sync_runtime_statuses()
            except Exception as exc:
                print(f"service-status-monitor: {exc}", flush=True)
            time.sleep(interval)

    threading.Thread(target=loop, name="service-status-monitor", daemon=True).start()


def container_for(project_id: int, service_id: int, requested: str = "") -> str:
    """Nome do container de um serviço (p/ logs/terminal)."""
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        default = container_name(row)

    if not requested:
        return default
    containers = service_containers(project_id, service_id)
    selected = next(
        (item for item in containers if requested in {item.get("id"), item.get("name")}),
        None,
    )
    if selected is None:
        raise ValueError("container não pertence ao serviço")
    return str(selected.get("id") or selected.get("name"))


def service_containers(project_id: int, service_id: int) -> list[dict]:
    """Containers de um serviço p/ o seletor de logs/terminal.

    compose → todos os containers do projeto compose (via label); demais tipos →
    o container único do serviço. Se o Docker estiver indisponível, devolve o
    nome esperado (o seletor ainda funciona quando o serviço subir)."""
    from . import dockerclient
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind == "template" or is_static_app(row):
            return []
        name = container_name(row)
        if not dockerclient.available():
            return [{"id": name, "name": name, "state": "unknown"}]
        try:
            if row.kind == "compose":
                items = dockerclient.list_containers(
                    all_=True, filters={"label": [f"com.docker.compose.project={name}"]})
                return [{"id": c["id"], "name": c["name"], "state": c["state"]} for c in items]
            info = dockerclient.inspect_container(name)
            if info is None:
                return [{"id": name, "name": name, "state": "absent"}]
            return [{"id": info.get("Id", name), "name": name,
                     "state": (info.get("State") or {}).get("Status", "")}]
        except dockerclient.DockerError:
            return [{"id": name, "name": name, "state": "unknown"}]


# Comando de dump por engine (executado dentro do container via docker exec).
def _dump_command(cfg: dict, database: str = "") -> tuple[list[str], str]:
    """(cmd, extensão) para dump do banco. Levanta ValueError se não suportado."""
    engine = cfg.get("engine")
    user = (cfg.get("user") or "").strip()
    pw = cfg.get("password") or ""
    selected_db = str(database or cfg.get("backup_database") or "").strip()
    db = selected_db or (cfg.get("database") or user or "app").strip()
    if engine == "postgres":
        if not selected_db:
            return ["sh", "-c", f"PGPASSWORD={pw!r} pg_dumpall -U {user or 'postgres'}"], "sql"
        return ["sh", "-c", f"PGPASSWORD={pw!r} pg_dump -U {user or 'postgres'} {db!r}"], "sql"
    if engine in ("mysql", "mariadb"):
        target = "--all-databases" if not selected_db else repr(db)
        return ["sh", "-c",
                f"dump_bin=$(command -v mariadb-dump || command -v mysqldump) "
                f"&& \"$dump_bin\" -u root -p{pw!r} {target}"], "sql"
    if engine == "mongodb":
        db_arg = f" --db {selected_db!r}" if selected_db else ""
        return ["sh", "-c",
                f"mongodump --archive --username {user or 'root'} "
                f"--password {pw!r} --authenticationDatabase admin{db_arg}"], "archive"
    raise ValueError(f"backup não suportado para o engine '{engine}'")


def _backup_file_format(value: object) -> str:
    fmt = str(value or BACKUP_FILE_FORMAT).strip() or BACKUP_FILE_FORMAT
    unknown = sorted({m.group(1) for m in re.finditer(r"\{([a-zA-Z0-9_]+)\}", fmt)} - BACKUP_NAME_VARIABLES)
    if unknown:
        raise ValueError(f"variáveis inválidas no formato do arquivo: {', '.join(unknown)}")
    return fmt[:120]


def _backup_compression_method(value: object) -> str:
    method = str(value or "gzip").strip().lower()
    if method not in BACKUP_COMPRESSION:
        raise ValueError(f"compressão inválida (use: {', '.join(BACKUP_COMPRESSION)})")
    return method


def _backup_compression_level(method_value: object, level_value: object) -> int:
    method = _backup_compression_method(method_value)
    spec = BACKUP_COMPRESSION[method]
    default = int(spec["default"])
    if level_value in (None, ""):
        return default
    level = _int(level_value, default)
    low, high = spec["levels"]
    return max(int(low), min(int(high), level))


def _backup_retention(value: object, default: int) -> int:
    return max(0, min(10_000, _int(value, default)))


def _backup_split_size_mb(value: object) -> int:
    size = _int(value, 0)
    return max(0, min(1024 * 1024, size))


def _backup_file_base(fmt: str, *, service_slug: str, server_name: str, cfg: dict,
                      backup_id: str, ts: int) -> str:
    when = dt.datetime.fromtimestamp(ts / 1000, tz=dt.timezone.utc)
    variables = {
        "name": service_slug,
        "date": when.strftime("%Y%m%d"),
        "time": when.strftime("%H%M%S"),
        "datetime": when.strftime("%Y%m%d-%H%M%S"),
        "hostname": os.uname().nodename,
        "server": server_name,
        "uuid": backup_id,
        "version": str(cfg.get("version") or cfg.get("engine") or ""),
        "random": secrets.token_hex(4),
    }
    raw = fmt
    for key, value in variables.items():
        raw = raw.replace(f"{{{key}}}", value)
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", raw).strip("-") or f"{service_slug}-{variables['datetime']}"


def _backup_encrypt(data: bytes, secret: str) -> bytes:
    exe = shutil.which("openssl")
    if not exe:
        raise ValueError("criptografia de backup requer o binário 'openssl' instalado")
    proc = subprocess.run(
        [exe, "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "env:BACKUP_SECRET"],
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "BACKUP_SECRET": secret},
        check=False,
    )
    if proc.returncode != 0:
        raise ValueError(proc.stderr.decode(errors="ignore")[:300] or "falha ao criptografar backup")
    return proc.stdout


def _backup_decrypt(data: bytes, secret: str) -> bytes:
    exe = shutil.which("openssl")
    if not exe:
        raise ValueError("descriptografia de backup requer o binário 'openssl' instalado")
    proc = subprocess.run(
        [exe, "enc", "-d", "-aes-256-cbc", "-salt", "-pbkdf2", "-pass", "env:BACKUP_SECRET"],
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "BACKUP_SECRET": secret},
        check=False,
    )
    if proc.returncode != 0:
        raise ValueError(proc.stderr.decode(errors="ignore")[:300] or "falha ao descriptografar backup")
    return proc.stdout


def _backup_compress(data: bytes, source_name: str, method: str, level: int) -> tuple[bytes, str]:
    spec = BACKUP_COMPRESSION[method]
    level = _backup_compression_level(method, level)
    if method == "gzip":
        return gzip.compress(data, compresslevel=level), str(spec["ext"])
    if method == "bzip2":
        return bz2.compress(data, compresslevel=level), str(spec["ext"])
    if method == "xz":
        return lzma.compress(data, preset=level), str(spec["ext"])
    if method == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=level) as zf:
            zf.writestr(source_name, data)
        return buf.getvalue(), str(spec["ext"])
    if method == "zstd":
        exe = shutil.which("zstd")
        if not exe:
            raise ValueError("compressão zstd requer o binário 'zstd' instalado")
        proc = subprocess.run([exe, f"-{level}", "-c"], input=data, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        if proc.returncode != 0:
            raise ValueError(proc.stderr.decode(errors="ignore")[:300] or "falha ao comprimir com zstd")
        return proc.stdout, str(spec["ext"])
    if method == "7z":
        exe = next((p for p in (shutil.which("7z"), shutil.which("7zz"), shutil.which("7za")) if p), None)
        if not exe:
            raise ValueError("compressão 7z requer o binário '7z', '7zz' ou '7za' instalado")
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            src = tmpdir / source_name
            dest = tmpdir / "backup.7z"
            src.write_bytes(data)
            proc = subprocess.run([exe, "a", "-t7z", f"-mx={level}", str(dest), str(src.name)],
                                  cwd=tmpdir, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  check=False)
            if proc.returncode != 0 or not dest.is_file():
                err = (proc.stderr or proc.stdout).decode(errors="ignore")[:300]
                raise ValueError(err or "falha ao comprimir com 7z")
            return dest.read_bytes(), str(spec["ext"])
    raise ValueError(f"compressão inválida: {method}")


def _backup_decompress(data: bytes, method: str) -> bytes:
    method = _backup_compression_method(method)
    if method == "gzip":
        return gzip.decompress(data)
    if method == "bzip2":
        return bz2.decompress(data)
    if method == "xz":
        return lzma.decompress(data)
    if method == "zip":
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            names = [n for n in zf.namelist() if not n.endswith("/")]
            if not names:
                raise ValueError("arquivo zip não contém dump")
            return zf.read(names[0])
    if method == "zstd":
        exe = shutil.which("zstd")
        if not exe:
            raise ValueError("restauração zstd requer o binário 'zstd' instalado")
        proc = subprocess.run([exe, "-d", "-c"], input=data, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        if proc.returncode != 0:
            raise ValueError(proc.stderr.decode(errors="ignore")[:300] or "falha ao descompactar zstd")
        return proc.stdout
    if method == "7z":
        exe = next((p for p in (shutil.which("7z"), shutil.which("7zz"), shutil.which("7za")) if p), None)
        if not exe:
            raise ValueError("restauração 7z requer o binário '7z', '7zz' ou '7za' instalado")
        with tempfile.TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            archive = tmpdir / "backup.7z"
            outdir = tmpdir / "out"
            outdir.mkdir()
            archive.write_bytes(data)
            proc = subprocess.run([exe, "x", "-y", f"-o{outdir}", str(archive)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            if proc.returncode != 0:
                err = (proc.stderr or proc.stdout).decode(errors="ignore")[:300]
                raise ValueError(err or "falha ao descompactar 7z")
            files = [p for p in outdir.rglob("*") if p.is_file()]
            if not files:
                raise ValueError("arquivo 7z não contém dump")
            return files[0].read_bytes()
    raise ValueError(f"compressão inválida: {method}")


def _parse_database_lines(out: bytes) -> list[str]:
    seen: set[str] = set()
    items: list[str] = []
    for raw in out.decode("utf-8", "replace").splitlines():
        name = raw.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        items.append(name)
    return items


def _backup_database_options(row: ProjectService, cfg: dict) -> list[dict]:
    from . import dockerclient
    engine = str(cfg.get("engine") or "")
    user = (cfg.get("user") or "").strip()
    pw = cfg.get("password") or ""
    configured = str(cfg.get("database") or user or "app").strip()
    fallback = [{"value": configured, "label": configured}] if configured else []
    if not dockerclient.available():
        return fallback
    try:
        if engine == "postgres":
            cmd = ["sh", "-c",
                   f"PGPASSWORD={pw!r} psql -U {user or 'postgres'} -d postgres -At "
                   "-c \"select datname from pg_database where datallowconn and not datistemplate order by datname\""]
        elif engine in ("mysql", "mariadb"):
            cmd = ["sh", "-c",
                   f"mysql_bin=$(command -v mariadb || command -v mysql) "
                   f"&& \"$mysql_bin\" -N -B -u root -p{pw!r} "
                   "-e \"SHOW DATABASES\" | grep -Ev '^(information_schema|mysql|performance_schema|sys)$'"]
        elif engine == "mongodb":
            js = "db.adminCommand('listDatabases').databases.map(function(d){return d.name}).join('\\n')"
            cmd = ["sh", "-c",
                   f"mongo_bin=$(command -v mongosh || command -v mongo) "
                   f"&& \"$mongo_bin\" --quiet --username {user or 'root'} --password {pw!r} "
                   f"--authenticationDatabase admin --eval {js!r}"]
        else:
            return fallback
        code, out = dockerclient.exec_run(container_name(row), cmd, timeout=30)
        if code != 0:
            return fallback
        return [{"value": name, "label": name} for name in _parse_database_lines(out)] or fallback
    except Exception:
        return fallback


def _backup_settings(cfg: dict) -> dict:
    method = _backup_compression_method(cfg.get("backup_compression_method"))
    return {
        "s3_enabled": bool(cfg.get("backup_s3_enabled", True)),
        "s3_config_id": _int(cfg.get("backup_s3_id"), 0) or None,
        "compress": bool(cfg.get("backup_compress", cfg.get("backup_compress", True))),
        "database": str(cfg.get("backup_database") or ""),
        "database_options": [],
        "file_format": _backup_file_format(cfg.get("backup_file_format")),
        "compression_method": method,
        "compression_level": _backup_compression_level(method, cfg.get("backup_compression_level")),
        "compression_methods": [
            {
                "value": key,
                "extension": spec["ext"],
                "min_level": spec["levels"][0],
                "max_level": spec["levels"][1],
                "default_level": spec["default"],
            }
            for key, spec in BACKUP_COMPRESSION.items()
        ],
        "name_variables": sorted(BACKUP_NAME_VARIABLES),
        "local_retention": _backup_retention(cfg.get("backup_local_retention"), 50),
        "s3_retention": _backup_retention(cfg.get("backup_s3_retention"), 50),
        "split_size_mb": _backup_split_size_mb(cfg.get("backup_split_size_mb")),
        "split_sizes_mb": list(BACKUP_SPLIT_SIZES_MB),
        "encryption_enabled": bool(cfg.get("backup_encryption_enabled")),
        "schedule_enabled": bool(cfg.get("backup_schedule_enabled")),
        "schedule_cron": str(cfg.get("backup_schedule_cron") or ""),
    }


def backup_settings(project_id: int, service_id: int) -> dict:
    from . import s3configs
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        settings = _backup_settings(cfg)
        settings["database_options"] = _backup_database_options(row, cfg)
        settings["s3_configs"] = s3configs.list_configs()
        return settings


def update_backup_settings(project_id: int, service_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("backup disponível só para banco de dados")
        cfg = _config(row)
        if "s3_enabled" in payload:
            cfg["backup_s3_enabled"] = bool(payload.get("s3_enabled"))
        if "s3_config_id" in payload:
            cfg["backup_s3_id"] = _int(payload.get("s3_config_id"), 0) or None
        if "compress" in payload or "compact" in payload:
            cfg["backup_compress"] = bool(payload.get("compress", payload.get("compact")))
            cfg.pop("backup_compress", None)
        if "database" in payload:
            cfg["backup_database"] = str(payload.get("database") or "").strip()
        if "file_format" in payload:
            cfg["backup_file_format"] = _backup_file_format(payload.get("file_format"))
        if "compression_method" in payload:
            cfg["backup_compression_method"] = _backup_compression_method(payload.get("compression_method"))
            cfg["backup_compression_level"] = _backup_compression_level(
                cfg["backup_compression_method"], payload.get("compression_level"))
        elif "compression_level" in payload:
            cfg["backup_compression_level"] = _backup_compression_level(
                cfg.get("backup_compression_method"), payload.get("compression_level"))
        if "local_retention" in payload:
            cfg["backup_local_retention"] = _backup_retention(payload.get("local_retention"), 50)
        if "s3_retention" in payload:
            cfg["backup_s3_retention"] = _backup_retention(payload.get("s3_retention"), 50)
        if "split_size_mb" in payload:
            cfg["backup_split_size_mb"] = _backup_split_size_mb(payload.get("split_size_mb"))
        if "encryption_enabled" in payload:
            cfg["backup_encryption_enabled"] = bool(payload.get("encryption_enabled"))
        if "schedule_enabled" in payload:
            cfg["backup_schedule_enabled"] = bool(payload.get("schedule_enabled"))
        if "schedule_cron" in payload:
            cfg["backup_schedule_cron"] = str(payload.get("schedule_cron") or "").strip()
        if cfg.get("backup_schedule_enabled") and not str(cfg.get("backup_schedule_cron") or "").strip():
            cfg["backup_schedule_cron"] = "0 3 * * *"
        if cfg.get("backup_schedule_enabled") and len(str(cfg.get("backup_schedule_cron") or "").split()) != 5:
            raise ValueError("cron do backup deve ter 5 campos (ex.: 0 3 * * *)")
        row.config = json.dumps(_validate_config(row.kind, cfg))
        row.updated_ts = _now_ms()
        s.commit()
        saved = _config(row)
        settings = _backup_settings(saved)
        settings["database_options"] = _backup_database_options(row, saved)
        return settings


def _snapshot_settings(cfg: dict) -> dict:
    method = _backup_compression_method(cfg.get("snapshot_compression_method"))
    return {
        "s3_enabled": bool(cfg.get("snapshot_s3_enabled", True)),
        "s3_config_id": _int(cfg.get("snapshot_s3_id"), 0) or None,
        "compress": bool(cfg.get("snapshot_compress", True)),
        "file_format": _backup_file_format(cfg.get("snapshot_file_format") or "snapshot-{name}-{datetime}"),
        "compression_method": method,
        "compression_level": _backup_compression_level(method, cfg.get("snapshot_compression_level")),
        "compression_methods": [
            {
                "value": key,
                "extension": spec["ext"],
                "min_level": spec["levels"][0],
                "max_level": spec["levels"][1],
                "default_level": spec["default"],
            }
            for key, spec in BACKUP_COMPRESSION.items()
        ],
        "name_variables": sorted(BACKUP_NAME_VARIABLES),
        "local_retention": _backup_retention(cfg.get("snapshot_local_retention"), 20),
        "s3_retention": _backup_retention(cfg.get("snapshot_s3_retention"), 20),
        "split_size_mb": _backup_split_size_mb(cfg.get("snapshot_split_size_mb")),
        "split_sizes_mb": list(BACKUP_SPLIT_SIZES_MB),
        "encryption_enabled": bool(cfg.get("snapshot_encryption_enabled")),
        "schedule_enabled": bool(cfg.get("snapshot_schedule_enabled")),
        "schedule_cron": str(cfg.get("snapshot_schedule_cron") or ""),
    }


def snapshot_settings(project_id: int, service_id: int) -> dict:
    from . import s3configs
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        settings = _snapshot_settings(cfg)
        settings["s3_configs"] = s3configs.list_configs()
        return settings


def update_snapshot_settings(project_id: int, service_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("snapshots disponíveis só para banco de dados")
        cfg = _config(row)
        if "s3_enabled" in payload:
            cfg["snapshot_s3_enabled"] = bool(payload.get("s3_enabled"))
        if "s3_config_id" in payload:
            cfg["snapshot_s3_id"] = _int(payload.get("s3_config_id"), 0) or None
        if "compress" in payload:
            cfg["snapshot_compress"] = bool(payload.get("compress"))
        if "file_format" in payload:
            cfg["snapshot_file_format"] = _backup_file_format(payload.get("file_format"))
        if "compression_method" in payload:
            cfg["snapshot_compression_method"] = _backup_compression_method(payload.get("compression_method"))
            cfg["snapshot_compression_level"] = _backup_compression_level(
                cfg["snapshot_compression_method"], payload.get("compression_level"))
        elif "compression_level" in payload:
            cfg["snapshot_compression_level"] = _backup_compression_level(
                cfg.get("snapshot_compression_method"), payload.get("compression_level"))
        if "local_retention" in payload:
            cfg["snapshot_local_retention"] = _backup_retention(payload.get("local_retention"), 20)
        if "s3_retention" in payload:
            cfg["snapshot_s3_retention"] = _backup_retention(payload.get("s3_retention"), 20)
        if "split_size_mb" in payload:
            cfg["snapshot_split_size_mb"] = _backup_split_size_mb(payload.get("split_size_mb"))
        if "encryption_enabled" in payload:
            cfg["snapshot_encryption_enabled"] = bool(payload.get("encryption_enabled"))
        if "schedule_enabled" in payload:
            cfg["snapshot_schedule_enabled"] = bool(payload.get("schedule_enabled"))
        if "schedule_cron" in payload:
            cfg["snapshot_schedule_cron"] = str(payload.get("schedule_cron") or "").strip()
        if cfg.get("snapshot_schedule_enabled") and not str(cfg.get("snapshot_schedule_cron") or "").strip():
            cfg["snapshot_schedule_cron"] = "0 2 * * *"
        if cfg.get("snapshot_schedule_enabled") and len(str(cfg.get("snapshot_schedule_cron") or "").split()) != 5:
            raise ValueError("cron do snapshot deve ter 5 campos (ex.: 0 2 * * *)")
        row.config = json.dumps(_validate_config(row.kind, cfg))
        row.updated_ts = _now_ms()
        s.commit()
        return _snapshot_settings(_config(row))


def _backup_local_path(project_id: int, service_id: int, name: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip("-") or "backup"
    return BACKUP_DIR / str(project_id) / str(service_id) / safe


def _snapshot_local_path(project_id: int, service_id: int, name: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip("-") or "snapshot"
    return SNAPSHOT_DIR / str(project_id) / str(service_id) / safe


def _existing_paths(item: dict) -> list[Path]:
    paths = [Path(str(p)) for p in item.get("local_paths") or [] if str(p)]
    if not paths and item.get("local_path"):
        paths = [Path(str(item.get("local_path")))]
    return paths


def _backup_write_local(project_id: int, service_id: int, name: str, body: bytes, split_size_mb: int) -> tuple[list[str], int]:
    split_bytes = split_size_mb * 1024 * 1024
    if split_bytes <= 0 or len(body) <= split_bytes:
        path = _backup_local_path(project_id, service_id, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return [str(path)], 1

    parts: list[str] = []
    total = (len(body) + split_bytes - 1) // split_bytes
    for idx in range(total):
        part_name = f"{name}.part{idx + 1:04d}"
        path = _backup_local_path(project_id, service_id, part_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body[idx * split_bytes:(idx + 1) * split_bytes])
        parts.append(str(path))
    return parts, total


def _snapshot_write_local(project_id: int, service_id: int, name: str, body: bytes, split_size_mb: int) -> tuple[list[str], int]:
    split_bytes = split_size_mb * 1024 * 1024
    if split_bytes <= 0 or len(body) <= split_bytes:
        path = _snapshot_local_path(project_id, service_id, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return [str(path)], 1
    parts: list[str] = []
    total = (len(body) + split_bytes - 1) // split_bytes
    for idx in range(total):
        part_name = f"{name}.part{idx + 1:04d}"
        path = _snapshot_local_path(project_id, service_id, part_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body[idx * split_bytes:(idx + 1) * split_bytes])
        parts.append(str(path))
    return parts, total


def _backup_s3_keys(service_slug: str, backup_name: str, parts: int) -> list[str]:
    if parts <= 1:
        return [f"nexus-backups/{service_slug}/{backup_name}"]
    return [f"nexus-backups/{service_slug}/{backup_name}.part{idx + 1:04d}" for idx in range(parts)]


def _snapshot_s3_keys(service_slug: str, snapshot_name: str, parts: int) -> list[str]:
    if parts <= 1:
        return [f"nexus-snapshots/{service_slug}/{snapshot_name}"]
    return [f"nexus-snapshots/{service_slug}/{snapshot_name}.part{idx + 1:04d}" for idx in range(parts)]


def _delete_local_backup_files(item: dict) -> None:
    for path in _existing_paths(item):
        if path.is_file():
            path.unlink()
    item["local_path"] = ""
    item["local_paths"] = []


def _delete_s3_backup_objects(item: dict, fallback_s3_id: int = 0) -> None:
    from . import s3client, s3configs
    s3_id = _int(item.get("s3_config_id"), 0) or fallback_s3_id
    keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
    if not keys and item.get("s3_key"):
        keys = [str(item.get("s3_key"))]
    if not s3_id or not keys:
        return
    cfg = s3configs.raw_config(int(s3_id))
    for key in keys:
        s3client.delete_object(cfg, key)
    item.update({"s3_available": False, "s3_key": "", "s3_keys": []})


def _has_s3_backup_objects(item: dict) -> bool:
    return bool(item.get("s3_available") or item.get("s3_key") or item.get("s3_keys"))


def _backup_entry_json(item: dict) -> dict:
    name = str(item.get("name") or item.get("key") or "backup")
    local_path = str(item.get("local_path") or "")
    local_paths = [str(p) for p in item.get("local_paths") or [] if str(p)]
    exists = all(Path(p).is_file() for p in local_paths) if local_paths else bool(local_path and Path(local_path).is_file())
    s3_key = str(item.get("s3_key") or item.get("key") or "")
    s3_keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
    s3_available = bool(item.get("s3_available")) or bool(s3_key) or bool(s3_keys)
    compressed_size = _int(item.get("compressed_size"), _int(item.get("size"), 0))
    original_size = _int(item.get("original_size"), 0)
    ratio = round(original_size / compressed_size, 2) if original_size and compressed_size else 0
    return {
        "id": str(item.get("id") or s3_key or name),
        "name": name,
        "ts": _int(item.get("ts"), 0),
        "engine": str(item.get("engine") or ""),
        "database": str(item.get("database") or ""),
        "compress": bool(item.get("compress", item.get("compact"))),
        "compression_method": str(item.get("compression_method") or ("gzip" if item.get("compress", item.get("compact")) else "")),
        "compression_level": item.get("compression_level"),
        "encrypted": bool(item.get("encrypted")),
        "elapsed_ms": _int(item.get("elapsed_ms"), 0),
        "original_size": original_size,
        "compressed_size": compressed_size,
        "size": compressed_size,
        "compression_ratio": ratio,
        "sha256": str(item.get("sha256") or ""),
        "parts": _int(item.get("parts"), 1),
        "split_size_mb": _int(item.get("split_size_mb"), 0),
        "local": {"available": exists, "path": local_path, "paths": local_paths},
        "s3": {
            "available": s3_available,
            "key": s3_key,
            "keys": s3_keys,
            "config_id": item.get("s3_config_id"),
            "error": item.get("s3_error") or "",
        },
    }


def list_backups(project_id: int, service_id: int, page: int = 1, page_size: int = 10) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        items = [_backup_entry_json(item) for item in reversed(_list_of_dicts(_config(row).get("backups")))]
        total = len(items)
        page_size = max(1, min(100, int(page_size or 10)))
        pages = max(1, (total + page_size - 1) // page_size)
        page = max(1, min(pages, int(page or 1)))
        start = (page - 1) * page_size
        return {
            "items": items[start:start + page_size],
            "pagination": {"page": page, "page_size": page_size, "total": total, "pages": pages},
        }


def _snapshot_entry_json(item: dict) -> dict:
    data = _backup_entry_json(item)
    data["compression_method"] = str(item.get("compression_method") or "")
    data["compression_level"] = item.get("compression_level")
    data["compress"] = bool(item.get("compress"))
    return data


def list_snapshots(project_id: int, service_id: int, page: int = 1, page_size: int = 10) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        items = [_snapshot_entry_json(item) for item in reversed(_list_of_dicts(_config(row).get("snapshots")))]
        total = len(items)
        page_size = max(1, min(100, int(page_size or 10)))
        pages = max(1, (total + page_size - 1) // page_size)
        page = max(1, min(pages, int(page or 1)))
        start = (page - 1) * page_size
        return {
            "items": items[start:start + page_size],
            "pagination": {"page": page, "page_size": page_size, "total": total, "pages": pages},
        }


def _apply_backup_retention(
    backups: list[dict],
    local_keep: int,
    s3_keep: int,
    fallback_s3_id: int = 0,
    s3_enabled: bool = False,
) -> list[dict]:
    newest = list(reversed(backups))
    for idx, item in enumerate(newest):
        if local_keep <= 0:
            if s3_enabled and _has_s3_backup_objects(item):
                _delete_local_backup_files(item)
        elif idx >= local_keep:
            _delete_local_backup_files(item)
        if s3_keep > 0 and idx >= s3_keep:
            try:
                _delete_s3_backup_objects(item, fallback_s3_id=fallback_s3_id)
            except Exception as exc:
                item["s3_error"] = str(exc)
    return list(reversed(newest))[-500:]


def _apply_snapshot_retention(
    snapshots: list[dict],
    local_keep: int,
    s3_keep: int,
    fallback_s3_id: int = 0,
    s3_enabled: bool = False,
) -> list[dict]:
    newest = list(reversed(snapshots))
    for idx, item in enumerate(newest):
        if local_keep <= 0:
            if s3_enabled and _has_s3_backup_objects(item):
                _delete_local_backup_files(item)
        elif idx >= local_keep:
            _delete_local_backup_files(item)
        if s3_keep > 0 and idx >= s3_keep:
            try:
                _delete_s3_backup_objects(item, fallback_s3_id=fallback_s3_id)
            except Exception as exc:
                item["s3_error"] = str(exc)
    return list(reversed(newest))[-500:]


def _job_event(job_id: str, status: str, percent: int, message: str, **extra) -> None:
    event = {
        "seq": 0, "job_id": job_id, "status": status,
        "percent": max(0, min(100, int(percent))), "message": message,
        "ts": _now_ms(), **extra,
    }
    with _BACKUP_JOBS_LOCK:
        job = _BACKUP_JOBS.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"]) + 1
        job["events"].append(event)
        job["status"] = status
        job["percent"] = event["percent"]


def backup_job_events(job_id: str, after: int = 0) -> tuple[list[dict], bool]:
    with _BACKUP_JOBS_LOCK:
        job = _BACKUP_JOBS.get(job_id)
        if not job:
            raise KeyError("job não encontrado")
        return [e for e in job["events"] if e["seq"] > after], job["status"] in ("done", "failed")


def _restore_event(job_id: str, status: str, percent: int, message: str, **extra) -> None:
    event = {
        "seq": 0, "job_id": job_id, "status": status,
        "percent": max(0, min(100, int(percent))), "message": message,
        "ts": _now_ms(), **extra,
    }
    with _RESTORE_JOBS_LOCK:
        job = _RESTORE_JOBS.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"]) + 1
        job["events"].append(event)
        job["status"] = status
        job["percent"] = event["percent"]


def restore_job_events(job_id: str, after: int = 0) -> tuple[list[dict], bool]:
    with _RESTORE_JOBS_LOCK:
        job = _RESTORE_JOBS.get(job_id)
        if not job:
            raise KeyError("job não encontrado")
        return [e for e in job["events"] if e["seq"] > after], job["status"] in ("done", "failed")


def _snapshot_event(job_id: str, status: str, percent: int, message: str, **extra) -> None:
    event = {
        "seq": 0, "job_id": job_id, "status": status,
        "percent": max(0, min(100, int(percent))), "message": message,
        "ts": _now_ms(), **extra,
    }
    with _SNAPSHOT_JOBS_LOCK:
        job = _SNAPSHOT_JOBS.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"]) + 1
        job["events"].append(event)
        job["status"] = status
        job["percent"] = event["percent"]


def snapshot_job_events(job_id: str, after: int = 0) -> tuple[list[dict], bool]:
    with _SNAPSHOT_JOBS_LOCK:
        job = _SNAPSHOT_JOBS.get(job_id)
        if not job:
            raise KeyError("job não encontrado")
        return [e for e in job["events"] if e["seq"] > after], job["status"] in ("done", "failed")


def _snapshot_restore_event(job_id: str, status: str, percent: int, message: str, **extra) -> None:
    event = {
        "seq": 0, "job_id": job_id, "status": status,
        "percent": max(0, min(100, int(percent))), "message": message,
        "ts": _now_ms(), **extra,
    }
    with _SNAPSHOT_RESTORE_JOBS_LOCK:
        job = _SNAPSHOT_RESTORE_JOBS.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"]) + 1
        job["events"].append(event)
        job["status"] = status
        job["percent"] = event["percent"]


def snapshot_restore_job_events(job_id: str, after: int = 0) -> tuple[list[dict], bool]:
    with _SNAPSHOT_RESTORE_JOBS_LOCK:
        job = _SNAPSHOT_RESTORE_JOBS.get(job_id)
        if not job:
            raise KeyError("job não encontrado")
        return [e for e in job["events"] if e["seq"] > after], job["status"] in ("done", "failed")


def _require_running_container(row: ProjectService, operation: str) -> None:
    """Garante que operações que executam no container tenham um alvo ativo."""
    from . import dockerclient
    state = dockerclient.container_state(container_name(row))
    if state != "running":
        raise ValueError(f"{operation} disponível somente com o container em execução")


def start_backup_job(project_id: int, service_id: int) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("backup disponível só para banco de dados")
        _require_running_container(row, "backup")
    job_id = uuid.uuid4().hex
    with _BACKUP_JOBS_LOCK:
        _BACKUP_JOBS[job_id] = {"status": "queued", "percent": 0, "events": []}
    _job_event(job_id, "queued", 0, "Backup aguardando execução")
    threading.Thread(target=_run_backup_job, args=(job_id, project_id, service_id), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


def start_restore_job(project_id: int, service_id: int, backup_id: str) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("restauração disponível só para banco de dados")
        _find_backup(_config(row), backup_id)
    job_id = uuid.uuid4().hex
    with _RESTORE_JOBS_LOCK:
        _RESTORE_JOBS[job_id] = {"status": "queued", "percent": 0, "events": []}
    _restore_event(job_id, "queued", 0, "Restauração aguardando execução")
    threading.Thread(target=_run_restore_job, args=(job_id, project_id, service_id, backup_id), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


def start_snapshot_job(project_id: int, service_id: int) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("snapshot disponível só para banco de dados")
        _require_running_container(row, "snapshot")
    job_id = uuid.uuid4().hex
    with _SNAPSHOT_JOBS_LOCK:
        _SNAPSHOT_JOBS[job_id] = {"status": "queued", "percent": 0, "events": []}
    _snapshot_event(job_id, "queued", 0, "Snapshot aguardando execução")
    threading.Thread(target=_run_snapshot_job, args=(job_id, project_id, service_id), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


def start_snapshot_restore_job(project_id: int, service_id: int, snapshot_id: str) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind != "database":
            raise ValueError("restauração de snapshot disponível só para banco de dados")
        _find_snapshot(_config(row), snapshot_id)
    job_id = uuid.uuid4().hex
    with _SNAPSHOT_RESTORE_JOBS_LOCK:
        _SNAPSHOT_RESTORE_JOBS[job_id] = {"status": "queued", "percent": 0, "events": []}
    _snapshot_restore_event(job_id, "queued", 0, "Restauração de snapshot aguardando execução")
    threading.Thread(target=_run_snapshot_restore_job, args=(job_id, project_id, service_id, snapshot_id), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


def _run_backup_job(job_id: str, project_id: int, service_id: int) -> None:
    from . import appsettings, dockerclient, s3client, s3configs
    try:
        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            settings = _backup_settings(cfg)
            cmd, ext = _dump_command(cfg, str(settings.get("database") or ""))
            service_slug = row.slug
            engine = str(cfg.get("engine") or "")
            name = container_name(row)

        _job_event(job_id, "running", 10, "Realizando dump do banco")
        started = _now_ms()
        code, out = dockerclient.exec_run(name, cmd)
        if code != 0:
            raise dockerclient.DockerError(f"dump falhou (exit {code}): {out[:300]!r}")
        original_size = len(out)

        ts = _now_ms()
        backup_id = uuid.uuid4().hex[:12]
        compress = bool(settings["compress"])
        method = str(settings["compression_method"])
        level = int(settings["compression_level"])
        base_name = _backup_file_base(
            str(settings["file_format"]),
            service_slug=service_slug,
            server_name=name,
            cfg=cfg,
            backup_id=backup_id,
            ts=ts,
        )
        source_name = f"{base_name}.{ext}"
        body = out
        if compress:
            _job_event(job_id, "compressing", 55, f"Compactando backup com {method}")
            body, compressed_ext = _backup_compress(out, source_name, method, level)
            backup_name = f"{source_name}.{compressed_ext}"
        else:
            _job_event(job_id, "running", 60, "Preparando arquivo local")
            backup_name = source_name

        encrypted = bool(settings["encryption_enabled"])
        if encrypted:
            secret = appsettings.get_str("backup_encryption_secret").strip()
            if not secret:
                raise ValueError("configure a secret de criptografia em CI/CD antes de habilitar backups criptografados")
            _job_event(job_id, "encrypting", 68, "Criptografando backup")
            body = _backup_encrypt(body, secret)
            backup_name = f"{backup_name}.enc"

        sha256 = hashlib.sha256(body).hexdigest()
        split_size_mb = int(settings["split_size_mb"])
        if split_size_mb:
            _job_event(job_id, "splitting", 72, "Dividindo arquivo de backup")
        local_paths, parts = _backup_write_local(project_id, service_id, backup_name, body, split_size_mb)
        local_path = local_paths[0] if parts == 1 else ""
        entry = {
            "id": backup_id, "name": backup_name, "ts": ts, "engine": engine,
            "database": str(settings.get("database") or ""),
            "compress": compress, "size": len(body), "compressed_size": len(body), "original_size": original_size,
            "elapsed_ms": _now_ms() - started, "sha256": sha256,
            "local_path": local_path, "local_paths": local_paths, "parts": parts, "split_size_mb": split_size_mb,
            "file_format": settings["file_format"],
            "compression_method": method if compress else "",
            "compression_level": level if compress else None,
            "encrypted": encrypted,
            "s3_available": False, "s3_key": "", "s3_config_id": None,
        }

        if settings["s3_enabled"]:
            s3_id = settings["s3_config_id"]
            if not s3_id:
                configs = s3configs.list_configs()
                s3_id = configs[0]["id"] if configs else None
            if not s3_id:
                entry["s3_error"] = "nenhum destino S3 configurado"
            else:
                _job_event(job_id, "uploading", 80, "Enviando backup para o S3")
                s3_cfg = s3configs.raw_config(int(s3_id))
                keys = _backup_s3_keys(service_slug, backup_name, parts)
                if parts == 1:
                    s3client.put_object(s3_cfg, keys[0], body, content_type="application/octet-stream")
                else:
                    for key, path in zip(keys, local_paths):
                        s3client.put_object(s3_cfg, key, Path(path).read_bytes(), content_type="application/octet-stream")
                entry.update({
                    "s3_available": True, "s3_key": keys[0] if parts == 1 else "",
                    "s3_keys": keys, "s3_config_id": int(s3_id),
                })

        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            backups = _list_of_dicts(cfg.get("backups")) + [entry]
            cfg["backups"] = _apply_backup_retention(
                backups,
                _backup_retention(cfg.get("backup_local_retention"), 50),
                _backup_retention(cfg.get("backup_s3_retention"), 50),
                fallback_s3_id=_int(cfg.get("backup_s3_id"), 0),
                s3_enabled=bool(cfg.get("backup_s3_enabled", True)),
            )
            row.config = json.dumps(cfg)
            row.updated_ts = _now_ms()
            s.commit()

        _job_event(job_id, "done", 100, "Backup concluído", backup=_backup_entry_json(entry))
    except Exception as exc:
        _job_event(job_id, "failed", 100, str(exc))


def _run_volume_tar(volume: str, dest: Path) -> None:
    if shutil.which("docker") is None:
        raise ValueError("snapshot requer o binário 'docker' instalado no backend")
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["docker", "run", "--rm", "-v", f"{volume}:/data:ro",
         "busybox", "tar", "-cf", "-", "-C", "/data", "."],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout).decode("utf-8", "replace")[:500]
        raise ValueError(err or "falha ao criar tar do volume")
    if not proc.stdout:
        raise ValueError("falha ao criar tar do volume: saída vazia")
    dest.write_bytes(proc.stdout)


def _restore_volume_tar(volume: str, source: Path) -> None:
    if shutil.which("docker") is None:
        raise ValueError("restauração de snapshot requer o binário 'docker' instalado no backend")
    proc = subprocess.run(
        ["docker", "run", "--rm", "-i", "-v", f"{volume}:/data",
         "busybox", "sh", "-c",
         "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xf - -C /data"],
        input=source.read_bytes(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout).decode("utf-8", "replace")[:500]
        raise ValueError(err or "falha ao restaurar tar no volume")


def _run_snapshot_job(job_id: str, project_id: int, service_id: int) -> None:
    from . import appsettings, s3client, s3configs
    try:
        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            settings = _snapshot_settings(cfg)
            service_slug = row.slug
            name = container_name(row)
            vol = volume_name(row)

        _snapshot_event(job_id, "running", 10, "Criando snapshot físico do volume")
        started = _now_ms()
        snapshot_id = uuid.uuid4().hex[:12]
        ts = _now_ms()
        base_name = _backup_file_base(
            str(settings["file_format"]),
            service_slug=service_slug,
            server_name=name,
            cfg=cfg,
            backup_id=snapshot_id,
            ts=ts,
        )
        with tempfile.TemporaryDirectory() as tmp:
            raw_path = Path(tmp) / f"{base_name}.tar"
            _run_volume_tar(vol, raw_path)
            body = raw_path.read_bytes()
        original_size = len(body)
        snapshot_name = f"{base_name}.tar"
        compress = bool(settings["compress"])
        method = str(settings["compression_method"])
        level = int(settings["compression_level"])
        if compress:
            _snapshot_event(job_id, "compressing", 45, f"Compactando snapshot com {method}")
            body, compressed_ext = _backup_compress(body, snapshot_name, method, level)
            snapshot_name = f"{snapshot_name}.{compressed_ext}"

        encrypted = bool(settings["encryption_enabled"]) and compress
        if encrypted:
            secret = appsettings.get_str("backup_encryption_secret").strip()
            if not secret:
                raise ValueError("configure a secret de criptografia em CI/CD antes de habilitar snapshots criptografados")
            _snapshot_event(job_id, "encrypting", 62, "Criptografando snapshot")
            body = _backup_encrypt(body, secret)
            snapshot_name = f"{snapshot_name}.enc"

        split_size_mb = int(settings["split_size_mb"]) if compress else 0
        if split_size_mb:
            _snapshot_event(job_id, "splitting", 70, "Dividindo arquivo de snapshot")
        local_paths, parts = _snapshot_write_local(project_id, service_id, snapshot_name, body, split_size_mb)
        local_path = local_paths[0] if parts == 1 else ""
        entry = {
            "id": snapshot_id, "name": snapshot_name, "ts": ts, "engine": str(cfg.get("engine") or ""),
            "compress": compress, "size": len(body), "compressed_size": len(body), "original_size": original_size,
            "elapsed_ms": _now_ms() - started, "sha256": hashlib.sha256(body).hexdigest(),
            "local_path": local_path, "local_paths": local_paths, "parts": parts, "split_size_mb": split_size_mb,
            "file_format": settings["file_format"],
            "compression_method": method if compress else "",
            "compression_level": level if compress else None,
            "encrypted": encrypted,
            "s3_available": False, "s3_key": "", "s3_config_id": None,
        }

        if settings["s3_enabled"]:
            s3_id = settings["s3_config_id"]
            if not s3_id:
                configs = s3configs.list_configs()
                s3_id = configs[0]["id"] if configs else None
            if not s3_id:
                entry["s3_error"] = "nenhum destino S3 configurado"
            else:
                _snapshot_event(job_id, "uploading", 82, "Enviando snapshot para o S3")
                s3_cfg = s3configs.raw_config(int(s3_id))
                keys = _snapshot_s3_keys(service_slug, snapshot_name, parts)
                if parts == 1:
                    s3client.put_object(s3_cfg, keys[0], body, content_type="application/octet-stream")
                else:
                    for key, path in zip(keys, local_paths):
                        s3client.put_object(s3_cfg, key, Path(path).read_bytes(), content_type="application/octet-stream")
                entry.update({
                    "s3_available": True, "s3_key": keys[0] if parts == 1 else "",
                    "s3_keys": keys, "s3_config_id": int(s3_id),
                })

        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            snapshots = _list_of_dicts(cfg.get("snapshots")) + [entry]
            cfg["snapshots"] = _apply_snapshot_retention(
                snapshots,
                _backup_retention(cfg.get("snapshot_local_retention"), 20),
                _backup_retention(cfg.get("snapshot_s3_retention"), 20),
                fallback_s3_id=_int(cfg.get("snapshot_s3_id"), 0),
                s3_enabled=bool(cfg.get("snapshot_s3_enabled", True)),
            )
            row.config = json.dumps(cfg)
            row.updated_ts = _now_ms()
            s.commit()

        _snapshot_event(job_id, "done", 100, "Snapshot concluído", snapshot=_snapshot_entry_json(entry))
    except Exception as exc:
        _snapshot_event(job_id, "failed", 100, str(exc))


def _restore_command(cfg: dict, database: str | None = None) -> list[str]:
    engine = cfg.get("engine")
    user = (cfg.get("user") or "").strip()
    pw = cfg.get("password") or ""
    selected_db = str(database).strip() if database is not None else (cfg.get("database") or user or "app").strip()
    if engine == "postgres":
        db_arg = selected_db or "postgres"
        return ["sh", "-c", f"PGPASSWORD={pw!r} psql -v ON_ERROR_STOP=1 -U {user or 'postgres'} {db_arg!r}"]
    if engine in ("mysql", "mariadb"):
        db_arg = f" {selected_db!r}" if selected_db else ""
        return ["sh", "-c",
                f"mysql_bin=$(command -v mariadb || command -v mysql) "
                f"&& \"$mysql_bin\" -u root -p{pw!r}{db_arg}"]
    if engine == "mongodb":
        return ["sh", "-c",
                f"mongorestore --archive --drop --username {user or 'root'} "
                f"--password {pw!r} --authenticationDatabase admin"]
    raise ValueError(f"restauração não suportada para o engine '{engine}'")


def _restore_backup_body(item: dict, cfg: dict, service_slug: str) -> bytes:
    from . import s3client, s3configs
    paths = _existing_paths(item)
    if paths and all(path.is_file() for path in paths):
        return b"".join(path.read_bytes() for path in paths)

    s3_id = _int(item.get("s3_config_id"), 0) or _int(cfg.get("backup_s3_id"), 0)
    keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
    if not keys and item.get("s3_key"):
        keys = [str(item.get("s3_key"))]
    if not keys:
        name = str(item.get("name") or item.get("key") or "")
        keys = _backup_s3_keys(service_slug, name, _int(item.get("parts"), 1)) if name else []
    if not s3_id or not keys:
        raise ValueError("backup sem arquivo local e sem objeto S3 disponível")
    s3_cfg = s3configs.raw_config(int(s3_id))
    return b"".join(s3client.get_object(s3_cfg, key) for key in keys)


def _restore_snapshot_body(item: dict, cfg: dict, service_slug: str) -> bytes:
    from . import s3client, s3configs
    paths = _existing_paths(item)
    if paths and all(path.is_file() for path in paths):
        return b"".join(path.read_bytes() for path in paths)
    s3_id = _int(item.get("s3_config_id"), 0) or _int(cfg.get("snapshot_s3_id"), 0)
    keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
    if not keys and item.get("s3_key"):
        keys = [str(item.get("s3_key"))]
    if not keys:
        name = str(item.get("name") or item.get("key") or "")
        keys = _snapshot_s3_keys(service_slug, name, _int(item.get("parts"), 1)) if name else []
    if not s3_id or not keys:
        raise ValueError("snapshot sem arquivo local e sem objeto S3 disponível")
    s3_cfg = s3configs.raw_config(int(s3_id))
    return b"".join(s3client.get_object(s3_cfg, key) for key in keys)


def _run_restore_job(job_id: str, project_id: int, service_id: int, backup_id: str) -> None:
    from . import appsettings, dockerclient
    try:
        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            _, _, item = _find_backup(cfg, backup_id)
            name = container_name(row)
            service_slug = row.slug
            command = _restore_command(cfg, str(item.get("database") or "") if "database" in item else None)

        _restore_event(job_id, "loading", 15, "Carregando arquivo de backup")
        body = _restore_backup_body(item, cfg, service_slug)

        if item.get("encrypted"):
            _restore_event(job_id, "decrypting", 30, "Descriptografando backup")
            secret = appsettings.get_str("backup_encryption_secret").strip()
            if not secret:
                raise ValueError("configure a secret de criptografia em CI/CD antes de restaurar backup criptografado")
            body = _backup_decrypt(body, secret)

        method = str(item.get("compression_method") or "")
        if item.get("compress", item.get("compact")) and method:
            _restore_event(job_id, "decompressing", 45, f"Descompactando backup com {method}")
            body = _backup_decompress(body, method)

        _restore_event(job_id, "restoring", 70, "Aplicando dump no banco")
        code, out = dockerclient.exec_run_input(name, command, body, timeout=1800)
        text = out.decode("utf-8", "replace").strip()
        if text:
            for line in text.splitlines()[-40:]:
                _restore_event(job_id, "restoring", 85, line)
        if code != 0:
            raise dockerclient.DockerError(f"restore falhou (exit {code}): {text[:500]}")

        _restore_event(job_id, "done", 100, "Backup restaurado com sucesso", backup_id=backup_id)
    except Exception as exc:
        _restore_event(job_id, "failed", 100, str(exc), backup_id=backup_id)


def _run_snapshot_restore_job(job_id: str, project_id: int, service_id: int, snapshot_id: str) -> None:
    from . import appsettings, provision
    try:
        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            cfg = _config(row)
            _, _, item = _find_snapshot(cfg, snapshot_id)
            service_slug = row.slug
            vol = volume_name(row)
            was_running = row.status == "running"

        _snapshot_restore_event(job_id, "loading", 12, "Carregando arquivo de snapshot")
        body = _restore_snapshot_body(item, cfg, service_slug)

        if item.get("encrypted"):
            _snapshot_restore_event(job_id, "decrypting", 25, "Descriptografando snapshot")
            secret = appsettings.get_str("backup_encryption_secret").strip()
            if not secret:
                raise ValueError("configure a secret de criptografia em CI/CD antes de restaurar snapshot criptografado")
            body = _backup_decrypt(body, secret)

        method = str(item.get("compression_method") or "")
        if item.get("compress") and method:
            _snapshot_restore_event(job_id, "decompressing", 40, f"Descompactando snapshot com {method}")
            body = _backup_decompress(body, method)

        _snapshot_restore_event(job_id, "stopping", 55, "Parando container para restaurar o volume")
        with get_session() as s:
            row = s.get(ProjectService, service_id)
            if not row or row.project_id != project_id:
                raise KeyError("serviço não encontrado")
            try:
                provision.stop(row)
                row.status = "stopped"
                row.updated_ts = _now_ms()
                s.commit()
            except Exception:
                pass

        with tempfile.TemporaryDirectory() as tmp:
            tar_path = Path(tmp) / "snapshot.tar"
            tar_path.write_bytes(body)
            _snapshot_restore_event(job_id, "restoring", 72, "Restaurando arquivos no volume")
            _restore_volume_tar(vol, tar_path)

        if was_running:
            _snapshot_restore_event(job_id, "starting", 88, "Reiniciando container")
            with get_session() as s:
                row = s.get(ProjectService, service_id)
                if not row or row.project_id != project_id:
                    raise KeyError("serviço não encontrado")
                provision.start(row)
                row.status = "running"
                row.updated_ts = _now_ms()
                s.commit()

        _snapshot_restore_event(job_id, "done", 100, "Snapshot restaurado com sucesso", snapshot_id=snapshot_id)
    except Exception as exc:
        _snapshot_restore_event(job_id, "failed", 100, str(exc), snapshot_id=snapshot_id)


def _find_backup(cfg: dict, backup_id: str) -> tuple[list[dict], int, dict]:
    backups = _list_of_dicts(cfg.get("backups"))
    for idx, item in enumerate(backups):
        if str(item.get("id") or item.get("key") or item.get("name")) == backup_id:
            return backups, idx, item
    raise KeyError("backup não encontrado")


def _find_snapshot(cfg: dict, snapshot_id: str) -> tuple[list[dict], int, dict]:
    snapshots = _list_of_dicts(cfg.get("snapshots"))
    for idx, item in enumerate(snapshots):
        if str(item.get("id") or item.get("key") or item.get("name")) == snapshot_id:
            return snapshots, idx, item
    raise KeyError("snapshot não encontrado")


def upload_backup(project_id: int, service_id: int, backup_id: str) -> dict:
    from . import s3client, s3configs
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        backups, idx, item = _find_backup(cfg, backup_id)
        paths = _existing_paths(item)
        if not paths or not all(path.is_file() for path in paths):
            raise ValueError("arquivo local do backup não encontrado")
        s3_id = _int(item.get("s3_config_id"), 0) or _int(cfg.get("backup_s3_id"), 0)
        if not s3_id:
            configs = s3configs.list_configs()
            s3_id = configs[0]["id"] if configs else 0
        if not s3_id:
            raise ValueError("nenhum destino S3 configurado")
        name = str(item.get("name") or paths[0].name)
        keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
        if not keys:
            keys = _backup_s3_keys(row.slug, name, len(paths))
        s3_cfg = s3configs.raw_config(int(s3_id))
        for key, path in zip(keys, paths):
            s3client.put_object(s3_cfg, key, path.read_bytes())
        item.update({
            "s3_available": True, "s3_key": keys[0] if len(keys) == 1 else "",
            "s3_keys": keys, "s3_config_id": int(s3_id), "s3_error": "",
        })
        backups[idx] = item
        cfg["backups"] = _apply_backup_retention(
            backups,
            _backup_retention(cfg.get("backup_local_retention"), 50),
            _backup_retention(cfg.get("backup_s3_retention"), 50),
            fallback_s3_id=_int(cfg.get("backup_s3_id"), 0),
            s3_enabled=bool(cfg.get("backup_s3_enabled", True)),
        )
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return _backup_entry_json(item)


def upload_snapshot(project_id: int, service_id: int, snapshot_id: str) -> dict:
    from . import s3client, s3configs
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        snapshots, idx, item = _find_snapshot(cfg, snapshot_id)
        paths = _existing_paths(item)
        if not paths or not all(path.is_file() for path in paths):
            raise ValueError("arquivo local do snapshot não encontrado")
        s3_id = _int(item.get("s3_config_id"), 0) or _int(cfg.get("snapshot_s3_id"), 0)
        if not s3_id:
            configs = s3configs.list_configs()
            s3_id = configs[0]["id"] if configs else 0
        if not s3_id:
            raise ValueError("nenhum destino S3 configurado")
        name = str(item.get("name") or paths[0].name)
        keys = [str(k) for k in item.get("s3_keys") or [] if str(k)]
        if not keys:
            keys = _snapshot_s3_keys(row.slug, name, len(paths))
        s3_cfg = s3configs.raw_config(int(s3_id))
        for key, path in zip(keys, paths):
            s3client.put_object(s3_cfg, key, path.read_bytes())
        item.update({
            "s3_available": True, "s3_key": keys[0] if len(keys) == 1 else "",
            "s3_keys": keys, "s3_config_id": int(s3_id), "s3_error": "",
        })
        snapshots[idx] = item
        cfg["snapshots"] = _apply_snapshot_retention(
            snapshots,
            _backup_retention(cfg.get("snapshot_local_retention"), 20),
            _backup_retention(cfg.get("snapshot_s3_retention"), 20),
            fallback_s3_id=_int(cfg.get("snapshot_s3_id"), 0),
            s3_enabled=bool(cfg.get("snapshot_s3_enabled", True)),
        )
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return _snapshot_entry_json(item)


def delete_backup(project_id: int, service_id: int, backup_id: str, *, delete_s3: bool = False) -> dict:
    from . import s3client, s3configs
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        backups, idx, item = _find_backup(cfg, backup_id)
        _delete_local_backup_files(item)
        if delete_s3 and item.get("s3_available") and (item.get("s3_key") or item.get("s3_keys")):
            _delete_s3_backup_objects(item, fallback_s3_id=_int(cfg.get("backup_s3_id"), 0))
        del backups[idx]
        cfg["backups"] = backups
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return {"deleted": backup_id}


def delete_snapshot(project_id: int, service_id: int, snapshot_id: str, *, delete_s3: bool = False) -> dict:
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        cfg = _config(row)
        snapshots, idx, item = _find_snapshot(cfg, snapshot_id)
        _delete_local_backup_files(item)
        if delete_s3 and item.get("s3_available") and (item.get("s3_key") or item.get("s3_keys")):
            _delete_s3_backup_objects(item, fallback_s3_id=_int(cfg.get("snapshot_s3_id"), 0))
        del snapshots[idx]
        cfg["snapshots"] = snapshots
        row.config = json.dumps(cfg)
        row.updated_ts = _now_ms()
        s.commit()
        return {"deleted": snapshot_id}


def _cron_part_matches(expr: str, value: int) -> bool:
    expr = (expr or "*").strip()
    if expr == "*":
        return True
    for part in expr.split(","):
        part = part.strip()
        if not part:
            continue
        if part.startswith("*/"):
            step = _int(part[2:], 0)
            if step > 0 and value % step == 0:
                return True
        elif "-" in part:
            a, b = part.split("-", 1)
            if _int(a, -1) <= value <= _int(b, -1):
                return True
        elif _int(part, -1) == value:
            return True
    return False


def _cron_due(expr: str, now: dt.datetime) -> bool:
    parts = (expr or "").split()
    if len(parts) != 5:
        return False
    minute, hour, day, month, weekday = parts
    # cron usa 0/7 para domingo; datetime.weekday usa 0 para segunda.
    cron_weekday = (now.weekday() + 1) % 7
    return (
        _cron_part_matches(minute, now.minute)
        and _cron_part_matches(hour, now.hour)
        and _cron_part_matches(day, now.day)
        and _cron_part_matches(month, now.month)
        and (_cron_part_matches(weekday, cron_weekday) or (cron_weekday == 0 and _cron_part_matches(weekday, 7)))
    )


def _scheduled_backup_tick() -> None:
    now = dt.datetime.now()
    minute_key = now.strftime("%Y%m%d%H%M")
    due: list[tuple[int, int]] = []
    snapshot_due: list[tuple[int, int]] = []
    with get_session() as s:
        rows = s.query(ProjectService).filter(ProjectService.kind == "database").all()
        for row in rows:
            cfg = _config(row)
            changed = False
            if (
                cfg.get("backup_schedule_enabled")
                and str(cfg.get("backup_schedule_last_minute") or "") != minute_key
                and _cron_due(str(cfg.get("backup_schedule_cron") or ""), now)
            ):
                cfg["backup_schedule_last_minute"] = minute_key
                due.append((row.project_id, row.id))
                changed = True
            if (
                cfg.get("snapshot_schedule_enabled")
                and str(cfg.get("snapshot_schedule_last_minute") or "") != minute_key
                and _cron_due(str(cfg.get("snapshot_schedule_cron") or ""), now)
            ):
                cfg["snapshot_schedule_last_minute"] = minute_key
                snapshot_due.append((row.project_id, row.id))
                changed = True
            if changed:
                row.config = json.dumps(cfg)
                row.updated_ts = _now_ms()
        if due or snapshot_due:
            s.commit()
    for project_id, service_id in due:
        try:
            start_backup_job(project_id, service_id)
        except Exception as exc:
            print(f"backup schedule: falha ao iniciar serviço {service_id}: {exc}", flush=True)
    for project_id, service_id in snapshot_due:
        try:
            start_snapshot_job(project_id, service_id)
        except Exception as exc:
            print(f"snapshot schedule: falha ao iniciar serviço {service_id}: {exc}", flush=True)


def start_backup_scheduler() -> None:
    global _BACKUP_SCHEDULER_STARTED
    if _BACKUP_SCHEDULER_STARTED:
        return
    _BACKUP_SCHEDULER_STARTED = True

    def loop() -> None:
        while True:
            try:
                _scheduled_backup_tick()
            except Exception as exc:
                print(f"backup schedule: {exc}", flush=True)
            time.sleep(60)

    threading.Thread(target=loop, name="backup-scheduler", daemon=True).start()


def exec_command(project_id: int, service_id: int, command: str) -> dict:
    """Roda um comando no container do serviço (terminal/console). Retorna
    `{exit_code, output}`. Reusa `dockerclient.exec_run` (`sh -c`)."""
    from . import dockerclient
    command = (command or "").strip()
    if not command:
        raise ValueError("comando vazio")
    cid = container_for(project_id, service_id)
    code, out = dockerclient.exec_run(cid, ["sh", "-c", command])
    return {"exit_code": code, "output": out.decode("utf-8", "replace")}


def run_action(project_id: int, service_id: int, verb: str, on_line=None) -> dict:
    """Executa uma ação de runtime (deploy/start/stop/restart/rebuild).

    Atualiza `status`/`container_id`. Propaga `DockerError` (o router mapeia p/
    409) marcando o serviço como `failed`.
    """
    from . import provision
    if verb not in RUNTIME_VERBS:
        raise ValueError("ação inválida")
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind == "template":
            raise ValueError("serviço template não suporta runtime")
        if verb == "start" and not _has_successful_deployment(s, row):
            raise ValueError("serviço não possui um deploy concluído com sucesso")
        try:
            if verb in ("deploy", "rebuild"):
                if verb == "rebuild" and row.kind != "database":
                    raise ValueError("rebuild disponível só para banco de dados")
                row.status = "deploying"
                s.commit()
                fn = provision.rebuild_database if verb == "rebuild" else provision.deploy
                cid = fn(row, on_line=on_line)
                row.container_id = cid
                row.status = "running"
            elif verb == "start":
                provision.start(row)
                row.status = "running"
            elif verb == "stop":
                provision.stop(row)
                row.status = "stopped"
            elif verb == "restart":
                provision.restart(row)
                row.status = "running"
        except provision.D.DockerError:
            row.status = "failed"
            row.updated_ts = _now_ms()
            s.commit()
            raise
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        return _service_json(row)


def _runtime_event(job_id: str, status: str, percent: int, message: str, **extra) -> None:
    event = {
        "seq": 0, "job_id": job_id, "status": status,
        "percent": max(0, min(100, int(percent))), "message": message,
        "ts": _now_ms(), **extra,
    }
    with _RUNTIME_JOBS_LOCK:
        job = _RUNTIME_JOBS.get(job_id)
        if not job:
            return
        event["seq"] = len(job["events"]) + 1
        job["events"].append(event)
        job["status"] = status
        job["percent"] = event["percent"]


def runtime_job_events(job_id: str, after: int = 0) -> tuple[list[dict], bool]:
    with _RUNTIME_JOBS_LOCK:
        job = _RUNTIME_JOBS.get(job_id)
        if not job:
            raise KeyError("job não encontrado")
        return [e for e in job["events"] if e["seq"] > after], job["status"] in ("done", "failed")


def start_runtime_action_job(project_id: int, service_id: int, verb: str, user: str = "") -> dict:
    if verb not in RUNTIME_VERBS:
        raise ValueError("ação inválida")
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        if row.kind == "template":
            raise ValueError("serviço template não suporta runtime")
        if verb == "start" and not _has_successful_deployment(s, row):
            raise ValueError("serviço não possui um deploy concluído com sucesso")
        if verb == "rebuild" and row.kind != "database":
            raise ValueError("rebuild disponível só para banco de dados")
    job_id = uuid.uuid4().hex
    deployment_id = None
    if verb in ("deploy", "rebuild"):
        from . import deployments
        deployment_id = deployments.create_for_action(project_id, service_id, job_id, verb, user)
    with _RUNTIME_JOBS_LOCK:
        _RUNTIME_JOBS[job_id] = {
            "status": "queued", "percent": 0, "events": [],
            "verb": verb, "deployment_id": deployment_id,
        }
    _runtime_event(job_id, "queued", 0, f"Ação '{verb}' aguardando execução", verb=verb)
    threading.Thread(
        target=_run_runtime_action_job,
        args=(job_id, project_id, service_id, verb, deployment_id),
        daemon=True,
    ).start()
    return {"job_id": job_id, "status": "queued", "verb": verb, "deployment_id": deployment_id}


def _run_runtime_action_job(
    job_id: str, project_id: int, service_id: int, verb: str, deployment_id: int | None = None
) -> None:
    try:
        if deployment_id is not None:
            from . import deployments
            deployments.mark_deploying(deployment_id)
        _runtime_event(job_id, "running", 10, f"Iniciando '{verb}'", verb=verb)
        def on_line(line: str) -> None:
            text = str(line or "").strip()
            if text:
                _runtime_event(job_id, "running", 50, text, verb=verb)
                if deployment_id is not None:
                    from . import deployments
                    deployments.record_event(deployment_id, text)
        data = run_action(project_id, service_id, verb, on_line=on_line)
        if deployment_id is not None:
            from . import deployments
            deployments.mark_deployed(deployment_id, str(data.get("container_id") or ""))
        _runtime_event(job_id, "done", 100, f"'{verb}' concluído", verb=verb, service=data)
    except Exception as exc:
        if deployment_id is not None:
            from . import deployments
            deployments.mark_failed(deployment_id, str(exc))
        _runtime_event(job_id, "failed", 100, str(exc), verb=verb)
