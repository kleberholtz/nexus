"""Histórico de deploys dos serviços de CI/CD.

O deploy em si continua sendo executado pelo worker de runtime de `projects.py`.
Este módulo registra o ciclo de vida e calcula a URL de preview configurada em
CI/CD > Settings > Deployment.
"""
from __future__ import annotations

import secrets
import threading
import time

from . import appsettings, dockerclient
from .db import get_session
from .db.models import (
    Project,
    ProjectApplicationDeployment,
    ProjectComposeDeployment,
    ProjectDatabaseDeployment,
    ProjectDeployment,
    ProjectDeploymentEvent,
    ProjectService,
)

STATUSES = ("queued", "deploying", "deployed", "failed", "canceled")
TYPES = ("manual", "auto", "rebuild", "rollback")
PHASE_LABELS = {
    "queued": "Queued",
    "preparing": "Preparing",
    "checkout": "Checkout",
    "setup": "Setup",
    "dependencies": "Dependencies",
    "generate": "Generate",
    "build": "Build",
    "test": "Test",
    "lint": "Lint",
    "package": "Package",
    "image_build": "Image Build",
    "push_image": "Push Image",
    "deploy": "Deploy",
    "health_check": "Health Check",
    "cleanup": "Cleanup",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled",
}
PHASE_ORDER = {phase: index for index, phase in enumerate(PHASE_LABELS)}
_VERSION = 0
_VERSION_COND = threading.Condition()


def _bump_version() -> None:
    global _VERSION
    with _VERSION_COND:
        _VERSION += 1
        _VERSION_COND.notify_all()


def version() -> int:
    with _VERSION_COND:
        return _VERSION


def wait_for_version(previous: int, timeout: float) -> int:
    with _VERSION_COND:
        if _VERSION == previous:
            _VERSION_COND.wait(timeout=max(0.1, timeout))
        return _VERSION


def _now_ms() -> int:
    return int(time.time() * 1000)


def _config(row: ProjectService) -> dict:
    from . import projects
    return projects._config(row)


def _preview_key() -> str:
    return secrets.token_hex(5)


def _preview_key_exists(s, key: str) -> bool:
    return bool(
        s.query(ProjectApplicationDeployment).filter(ProjectApplicationDeployment.preview_key == key).first()
        or s.query(ProjectComposeDeployment).filter(ProjectComposeDeployment.preview_key == key).first()
    )


def _new_preview_key(s) -> str:
    key = _preview_key()
    while _preview_key_exists(s, key):
        key = _preview_key()
    return key


def _phase_for_message(message: str) -> str:
    text = (message or "").lower()
    if any(token in text for token in (
        "cancelled", "canceled", "cancelado", "interrompido",
    )):
        return "cancelled"
    if any(token in text for token in (
        "failed", "error", "erro", "exception", "traceback", "fatal:",
    )):
        return "failed"
    if any(token in text for token in (
        "health check", "healthcheck", "checking health", "http 200",
        "tcp check", "waiting for service", "readiness", "liveness",
    )):
        return "health_check"
    if any(token in text for token in (
        "cleanup", "cleaning", "removing workspace", "removing temporary",
        "removendo workspace", "removendo arquivos temporários", "cache cleanup",
    )):
        return "cleanup"
    if any(token in text for token in (
        "docker push", "pushing", "pushed", "push image", "pushing image",
        "registry push", "the push refers to repository",
    )):
        return "push_image"
    if any(token in text for token in (
        "docker build", "image build", "building image", "buildkit", "dockerfile",
        "exporting layers", "exporting manifest", "writing image", "naming to",
    )):
        return "image_build"
    if any(token in text for token in (
        "npm run build", "yarn build", "pnpm build", "bun run build",
        "go build", "cargo build", "dotnet publish", "mvn package",
        "gradle build", "vite build", "webpack", "compiling", "compile",
        "building client", "building for production",
    )):
        return "build"
    if any(token in text for token in (
        "npm test", "yarn test", "pnpm test", "bun test", "pytest",
        "phpunit", "jest", "vitest", "go test", "cargo test", "dotnet test",
        "running tests", "executing tests",
    )):
        return "test"
    if any(token in text for token in (
        "eslint", "phpstan", "ruff", "clippy", "flake8", "pylint",
        "prettier", "lint", "static analysis", "typecheck", "tsc --noemit",
        "tsc --noEmit",
    )):
        return "lint"
    if any(token in text for token in (
        "prisma generate", "npm run generate", "yarn generate", "pnpm generate",
        "swagger", "openapi", "generating", "generated",
    )):
        return "generate"
    if any(token in text for token in (
        "npm install", "npm clean-install", "npm ci", "yarn install",
        "pnpm install", "bun install", "composer install", "go mod download",
        "cargo fetch", "pip install", "pip3 install", "poetry install",
        "installing project dependencies", "installing dependencies",
        "restoring dependencies", "added ", "audited ", "packages are looking for funding",
        "funding", "vulnerabilities",
    )):
        return "dependencies"
    if any(token in text for token in (
        "zip ", "creating zip", "archive", "jar", "war", "binary",
        "packaging", "package artifact", "empacotando",
    )):
        return "package"
    if any(token in text for token in (
        "cloning repository", "git clone", "git fetch", "fetch_head", "head is now",
        "from https://", "from git@", "checkout", "checking out", "repository",
        "branch",
    )):
        return "checkout"
    if any(token in text for token in (
        "preparing", "creating workspace", "workspace", "clonando repositório",
        "criando workspace", "using root directory", "finished cloning",
    )):
        return "preparing"
    if any(token in text for token in (
        "installing runtime", "detected the following tools", "restoring cache",
        "cache restored", "setup", "configuring environment", "wrangler configuration",
        "configuration file", "pulling fs layer", "waiting", "download complete",
        "downloading", "pulling from", "pulling", "pull ", "extracting",
        "pull complete", "verifying checksum",
    )):
        return "setup"
    if any(token in text for token in (
        "deploy", "compose", "docker compose", "swarm", "kubernetes", "kubectl",
        "container", "criando", "iniciando", "starting", "running", "execução",
        "implantando",
    )):
        return "deploy"
    if any(token in text for token in (
        "success", "finished", "completed", "conclu", "done",
    )):
        return "completed"
    return "preparing"


def build_preview_url(key: str) -> str:
    scheme = "https" if appsettings.get_bool("deployment_preview_https") else "http"
    domain = appsettings.get_str("deployment_preview_domain").strip()
    ip = appsettings.get_str("deployment_preview_ip").strip() or "127.0.0.1"
    port = appsettings.get_int("deployment_preview_port")
    port_part = f":{port}" if port else ""
    if domain:
        host = domain[2:] if domain.startswith("*.") else domain
        return f"{scheme}://{key}.{host}{port_part}"
    return f"{scheme}://{ip}{port_part}/deployments/{key}"


def _preview_enabled(row: ProjectService) -> bool:
    cfg = _config(row)
    return row.kind == "compose" or (row.kind == "application" and cfg.get("build_type") == "static")


def _source_from_service(row: ProjectService) -> dict:
    cfg = _config(row)
    return {
        "branch": str(cfg.get("branch") or "").strip(),
        "commit": str(cfg.get("commit") or cfg.get("commit_sha") or "").strip(),
        "commit_desc": str(
            cfg.get("commit_desc") or cfg.get("commit_message") or cfg.get("commit_subject") or ""
        ).strip(),
        "server_name": str(cfg.get("nginx_server_name") or "").strip(),
    }


def create_for_action(project_id: int, service_id: int, job_id: str, verb: str, user: str) -> int | None:
    if verb not in ("deploy", "rebuild"):
        return None
    dep_type = "rebuild" if verb == "rebuild" else "manual"
    with get_session() as s:
        row = s.get(ProjectService, service_id)
        if not row or row.project_id != project_id:
            raise KeyError("serviço não encontrado")
        now = _now_ms()
        dep = ProjectDeployment(
            project_id=project_id,
            service_id=service_id,
            service_kind=row.kind,
            job_id=job_id,
            status="queued",
            type=dep_type,
            user=user or "",
            created_ts=now,
        )
        s.add(dep)
        s.flush()
        deployment_id = int(dep.id)
        if row.kind == "application":
            source = _source_from_service(row)
            key = _new_preview_key(s)
            s.add(ProjectApplicationDeployment(
                deployment_id=deployment_id,
                preview_key=key,
                preview_url=build_preview_url(key) if _preview_enabled(row) else "",
                server_name=source["server_name"],
                source_branch=source["branch"],
                source_commit=source["commit"],
                source_commit_desc=source["commit_desc"],
            ))
        elif row.kind == "compose":
            key = _new_preview_key(s)
            s.add(ProjectComposeDeployment(
                deployment_id=deployment_id,
                preview_key=key,
                preview_url=build_preview_url(key),
                server_name="",
            ))
        elif row.kind == "database":
            s.add(ProjectDatabaseDeployment(deployment_id=deployment_id))
        s.commit()
    record_event(deployment_id, "Deployment queued", phase="queued")
    return deployment_id


def record_event(
    deployment_id: int | None,
    message: str,
    *,
    phase: str | None = None,
    level: str = "info",
) -> None:
    if deployment_id is None:
        return
    text = str(message or "").rstrip()
    if not text:
        return
    now = _now_ms()
    event_phase = phase if phase in PHASE_LABELS else _phase_for_message(text)
    with get_session() as s:
        if not s.get(ProjectDeployment, deployment_id):
            return
        last = (s.query(ProjectDeploymentEvent)
                .filter(ProjectDeploymentEvent.deployment_id == deployment_id)
                .order_by(ProjectDeploymentEvent.id.desc())
                .first())
        if last and last.phase == event_phase and last.level == level and last.message == text:
            return
        s.add(ProjectDeploymentEvent(
            deployment_id=deployment_id,
            ts=now,
            phase=event_phase,
            level=level,
            message=text,
        ))
        s.commit()
    _bump_version()


def mark_deploying(deployment_id: int | None) -> None:
    if deployment_id is None:
        return
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep or dep.status == "canceled":
            return
        dep.status = "deploying"
        dep.started_ts = dep.started_ts or _now_ms()
        s.commit()
    record_event(deployment_id, "Deployment started", phase="preparing")


def mark_deployed(deployment_id: int | None, container_id: str = "") -> None:
    if deployment_id is None:
        return
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep or dep.status == "canceled":
            return
        now = _now_ms()
        s.query(ProjectDeployment).filter(
            ProjectDeployment.service_id == dep.service_id,
            ProjectDeployment.active.is_(True),
        ).update({"active": False}, synchronize_session=False)
        dep.status = "deployed"
        dep.container_id = container_id or dep.container_id
        dep.started_ts = dep.started_ts or now
        dep.finished_ts = now
        dep.error = None
        dep.active = True
        s.commit()
    record_event(deployment_id, "Deployment finished", phase="completed", level="success")


def mark_failed(deployment_id: int | None, error: str) -> None:
    if deployment_id is None:
        return
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep or dep.status == "canceled":
            return
        now = _now_ms()
        dep.status = "failed"
        dep.started_ts = dep.started_ts or now
        dep.finished_ts = now
        dep.error = error
        dep.active = False
        s.commit()
    record_event(deployment_id, error, phase="failed", level="error")


def _container_name(service: ProjectService | None) -> str:
    if service is None:
        return ""
    from . import projects
    return projects.container_name(service)


def _container_running(dep: ProjectDeployment, service: ProjectService | None) -> bool:
    if service is None:
        return False
    if not dockerclient.available():
        return False
    try:
        if service.kind == "compose":
            containers = dockerclient.list_containers(
                all_=True,
                filters={"label": [f"com.docker.compose.project={_container_name(service)}"]},
            )
            return any(c.get("state") == "running" for c in containers)
        cid = dep.container_id or _container_name(service)
        info = dockerclient.inspect_container(cid)
        return bool(info and ((info.get("State") or {}).get("Status") == "running"))
    except dockerclient.DockerError:
        return False


def _effective_active(dep: ProjectDeployment, service: ProjectService | None) -> bool:
    return bool(dep.active and _container_running(dep, service))


def _event_json(event: ProjectDeploymentEvent) -> dict:
    return {
        "id": event.id,
        "deployment_id": event.deployment_id,
        "ts": event.ts,
        "phase": event.phase,
        "phase_label": PHASE_LABELS.get(event.phase, event.phase),
        "level": event.level,
        "message": event.message,
    }


def _phase_summary(events: list[ProjectDeploymentEvent], dep: ProjectDeployment | None = None) -> list[dict]:
    if not events:
        return []
    spans: list[dict] = []
    current = events[0].phase or "setup"
    start = events[0].ts
    last_ts = events[0].ts
    for event in events[1:]:
        phase = event.phase or "setup"
        if phase != current:
            spans.append({
                "phase": current,
                "label": PHASE_LABELS.get(current, current),
                "started_ts": start,
                "finished_ts": last_ts,
                "duration_ms": max(0, last_ts - start),
            })
            current = phase
            start = event.ts
        last_ts = event.ts
    end = dep.finished_ts if dep and dep.finished_ts else last_ts
    spans.append({
        "phase": current,
        "label": PHASE_LABELS.get(current, current),
        "started_ts": start,
        "finished_ts": end,
        "duration_ms": max(0, end - start),
    })

    merged: dict[str, dict] = {}
    for span in spans:
        phase = span["phase"]
        item = merged.setdefault(phase, {
            "phase": phase,
            "label": span["label"],
            "started_ts": span["started_ts"],
            "finished_ts": span["finished_ts"],
            "duration_ms": 0,
        })
        item["started_ts"] = min(int(item["started_ts"]), int(span["started_ts"]))
        item["finished_ts"] = max(int(item["finished_ts"]), int(span["finished_ts"]))
        item["duration_ms"] += int(span["duration_ms"])
    return sorted(merged.values(), key=lambda item: PHASE_ORDER.get(str(item["phase"]), 99))


def _detail_for(s, dep: ProjectDeployment):
    kind = dep.service_kind or ""
    if kind == "application":
        return s.get(ProjectApplicationDeployment, dep.id)
    if kind == "compose":
        return s.get(ProjectComposeDeployment, dep.id)
    if kind == "database":
        return s.get(ProjectDatabaseDeployment, dep.id)
    return None


def _detail_fields(detail) -> dict:
    return {
        "preview_url": getattr(detail, "preview_url", "") if detail else "",
        "preview_key": getattr(detail, "preview_key", "") if detail else "",
        "server_name": getattr(detail, "server_name", "") if detail else "",
        "source_branch": getattr(detail, "source_branch", "") if detail else "",
        "source_commit": getattr(detail, "source_commit", "") if detail else "",
        "source_commit_desc": getattr(detail, "source_commit_desc", "") if detail else "",
    }


def deployment_json(
    dep: ProjectDeployment,
    project: Project | None,
    service: ProjectService | None,
    detail=None,
) -> dict:
    duration = 0
    if dep.started_ts:
        end = dep.finished_ts or (_now_ms() if dep.status == "deploying" else dep.started_ts)
        duration = max(0, end - dep.started_ts)
    detail_data = _detail_fields(detail)
    has_preview = bool(detail_data["preview_url"])
    running = _container_running(dep, service)
    return {
        "id": dep.id,
        "project_id": dep.project_id,
        "project_name": project.name if project else "",
        "service_id": dep.service_id,
        "service_name": service.name if service else "",
        "service_slug": service.slug if service else "",
        "service_kind": dep.service_kind or (service.kind if service else ""),
        "status": dep.status,
        "type": dep.type,
        "preview_url": detail_data["preview_url"] if has_preview else "",
        "preview_key": detail_data["preview_key"],
        "has_preview": has_preview,
        "server_name": detail_data["server_name"],
        "source_branch": detail_data["source_branch"],
        "source_commit": detail_data["source_commit"],
        "source_commit_desc": detail_data["source_commit_desc"],
        "container_id": dep.container_id,
        "container_running": running,
        "error": dep.error,
        "user": dep.user,
        "active": bool(dep.active and running),
        "created_ts": dep.created_ts,
        "started_ts": dep.started_ts,
        "finished_ts": dep.finished_ts,
        "duration_ms": duration,
    }


def list_deployments(
    project_id: int | None = None,
    service_id: int | None = None,
    status: str | None = None,
    limit: int = 0,
    offset: int = 0,
) -> dict:
    with get_session() as s:
        q = s.query(ProjectDeployment)
        if project_id is not None:
            q = q.filter(ProjectDeployment.project_id == project_id)
        if service_id is not None:
            q = q.filter(ProjectDeployment.service_id == service_id)
        if status:
            q = q.filter(ProjectDeployment.status == status)
        total = q.count()
        configured_limit = appsettings.get_int("deployment_preview_limit")
        effective_limit = limit or configured_limit
        q = q.order_by(ProjectDeployment.id.desc()).offset(offset)
        if effective_limit > 0:
            q = q.limit(effective_limit)
        rows = q.all()
        project_ids = {r.project_id for r in rows}
        service_ids = {r.service_id for r in rows}
        projects = {p.id: p for p in s.query(Project).filter(Project.id.in_(project_ids)).all()} if project_ids else {}
        services = {v.id: v for v in s.query(ProjectService).filter(ProjectService.id.in_(service_ids)).all()} if service_ids else {}
        details = {r.id: _detail_for(s, r) for r in rows}
        return {
            "items": [
                deployment_json(r, projects.get(r.project_id), services.get(r.service_id), details.get(r.id))
                for r in rows
            ],
            "total": total,
            "limit": effective_limit,
            "offset": offset,
        }


def delete(deployment_id: int) -> None:
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep:
            raise KeyError("deployment não encontrado")
        detail = _detail_for(s, dep)
        if detail is not None:
            s.delete(detail)
        s.query(ProjectDeploymentEvent).filter(
            ProjectDeploymentEvent.deployment_id == deployment_id,
        ).delete(synchronize_session=False)
        s.delete(dep)
        s.commit()
    _bump_version()


def _delete_rows(s, rows: list[ProjectDeployment]) -> int:
    if not rows:
        return 0
    ids = [int(dep.id) for dep in rows]
    for dep in rows:
        detail = _detail_for(s, dep)
        if detail is not None:
            s.delete(detail)
    s.query(ProjectDeploymentEvent).filter(
        ProjectDeploymentEvent.deployment_id.in_(ids),
    ).delete(synchronize_session=False)
    s.query(ProjectDeployment).filter(
        ProjectDeployment.id.in_(ids),
    ).delete(synchronize_session=False)
    return len(ids)


def delete_for_service(project_id: int, service_id: int) -> int:
    with get_session() as s:
        count = delete_for_service_in_session(s, project_id, service_id)
        s.commit()
    if count:
        _bump_version()
    return count


def delete_for_project(project_id: int) -> int:
    with get_session() as s:
        count = delete_for_project_in_session(s, project_id)
        s.commit()
    if count:
        _bump_version()
    return count


def delete_for_service_in_session(s, project_id: int, service_id: int) -> int:
    rows = (s.query(ProjectDeployment)
            .filter(
                ProjectDeployment.project_id == project_id,
                ProjectDeployment.service_id == service_id,
            )
            .all())
    return _delete_rows(s, rows)


def delete_for_project_in_session(s, project_id: int) -> int:
    rows = (s.query(ProjectDeployment)
            .filter(ProjectDeployment.project_id == project_id)
            .all())
    return _delete_rows(s, rows)


def notify_changed() -> None:
    _bump_version()


def rollback(deployment_id: int, user: str = "") -> dict:
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep:
            raise KeyError("deployment não encontrado")
        if dep.status != "deployed":
            raise ValueError("rollback disponível apenas para deployments concluídos")
        if dep.type == "rollback":
            raise ValueError("não é possível aplicar rollback sobre um rollback")
        service = s.get(ProjectService, dep.service_id)
        if _effective_active(dep, service):
            raise ValueError("rollback não disponível para o deployment atual")
        detail = _detail_for(s, dep)
        now = _now_ms()
        s.query(ProjectDeployment).filter(
            ProjectDeployment.service_id == dep.service_id,
            ProjectDeployment.active.is_(True),
        ).update({"active": False}, synchronize_session=False)
        marker = ProjectDeployment(
            project_id=dep.project_id,
            service_id=dep.service_id,
            service_kind=dep.service_kind,
            job_id="",
            status="deployed",
            type="rollback",
            container_id=dep.container_id,
            user=user or "",
            active=True,
            created_ts=now,
            started_ts=now,
            finished_ts=now,
        )
        s.add(marker)
        s.flush()
        s.commit()
        marker_id = int(marker.id)
        if isinstance(detail, ProjectApplicationDeployment):
            key = _new_preview_key(s)
            s.add(ProjectApplicationDeployment(
                deployment_id=marker_id,
                preview_key=key,
                preview_url=build_preview_url(key) if detail.preview_url else "",
                server_name=detail.server_name,
                source_branch=detail.source_branch,
                source_commit=detail.source_commit,
                source_commit_desc=f"rollback para deployment #{dep.id}",
            ))
        elif isinstance(detail, ProjectComposeDeployment):
            key = _new_preview_key(s)
            s.add(ProjectComposeDeployment(
                deployment_id=marker_id,
                preview_key=key,
                preview_url=build_preview_url(key) if detail.preview_url else "",
                server_name=detail.server_name,
            ))
        elif dep.service_kind == "database":
            s.add(ProjectDatabaseDeployment(deployment_id=marker_id))
        s.commit()
        marker_detail = _detail_for(s, marker)
        project = s.get(Project, dep.project_id)
    record_event(marker_id, f"Rollback to deployment #{deployment_id}", phase="completed", level="success")
    return deployment_json(marker, project, service, marker_detail)


def history(deployment_id: int) -> dict:
    with get_session() as s:
        dep = s.get(ProjectDeployment, deployment_id)
        if not dep:
            raise KeyError("deployment não encontrado")
        events = (s.query(ProjectDeploymentEvent)
                  .filter(ProjectDeploymentEvent.deployment_id == deployment_id)
                  .filter(ProjectDeploymentEvent.phase.in_(PHASE_LABELS.keys()))
                  .order_by(ProjectDeploymentEvent.id.asc())
                  .all())
        project = s.get(Project, dep.project_id)
        service = s.get(ProjectService, dep.service_id)
        detail = _detail_for(s, dep)
        return {
            "deployment": deployment_json(dep, project, service, detail),
            "events": [_event_json(event) for event in events],
            "phases": _phase_summary(events, dep),
        }
