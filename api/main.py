"""App FastAPI de gerenciamento do nginx.

Autenticação por Bearer token (env API_TOKEN). Servida por HTTPS na 3001 com
certificado self-signed (ver api/server.py).

Todas as respostas — sucesso ou erro — seguem o envelope padrão de
`api.envelope`: {success, data, messages}.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import appsettings, certrenew, cloudflared, logrotate, metrics, monitorworker, projects as project_store, roles, trivyscan
from .audit import audit_middleware
from .authz import authz_middleware
from .config import store as S
from .db import ensure_db
from .envelope import envelope, json_response, message
from .roles import RoleError
from .monitors import MonitorError
from .notifications import NotificationError
from .routers import (ai, audit, certificates, cicd, deployments, docker,
                      dns, logs, maintenances, monitors, nginx, projects, rtmp, s3, servers, session,
                      settings, statuspages, streams, system, upstreams, users, ws)
from .users import UserError


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_db()                 # aplica migrations
    roles.ensure_defaults()     # semeia os papéis internos (admin/operator/viewer)
    try:
        cloudflared.apply_from_settings()  # persiste o túnel no boot quando habilitado
    except Exception as exc:
        print(f"cloudflared: falha ao aplicar configuração no boot: {exc}", flush=True)
    metrics.start_collector()   # inicia a coleta de métricas em background
    certrenew.start()           # renovação automática de certificados
    logrotate.start()           # rotação de logs (por tamanho) + upload S3
    project_store.start_backup_scheduler()
    project_store.start_service_status_monitor()
    trivyscan.start()           # worker único de scan de vulnerabilidades (fila)
    monitorworker.start()       # motor de execução dos monitores (healthcheck)
    yield


app = FastAPI(
    title="Holtz Nexus API",
    version="1.1.0",
    description="Gerenciamento do nginx e serviços relacionados (monitoramento, CI/CD, deploys, etc.)",
    lifespan=lifespan,
)

# Ordem dos middlewares (o registrado por último fica mais externo): registramos
# authz e auditoria primeiro e o CORS por último, para que o CORS seja o mais
# externo e adicione os headers CORS mesmo nas respostas 401/403 do authz (senão
# o browser não consegue ler a mensagem de erro na conexão direta/cross-origin).
# Fluxo efetivo: CORS → auditoria → authz → rota.
#
# Middleware de autorização (RBAC): resolve a identidade e checa permissão.
app.middleware("http")(authz_middleware)
# Middleware de auditoria: grava toda mutação (POST/PUT/DELETE/PATCH).
app.middleware("http")(audit_middleware)

# CORS para o frontend. Em dev, o Vite faz proxy (mesma origem); esta config
# permite também consumir a API de outra origem. As origens vêm das configurações
# (Configurações → API, chave `api_cors_origins`; default herda de API_CORS_ORIGINS).
# O middleware é montado no boot, então mudanças valem no **restart** da API.
try:
    _origins_raw = appsettings.get_str("api_cors_origins")
except Exception:  # noqa: BLE001 — DB indisponível no import: cai pro env
    _origins_raw = os.environ.get("API_CORS_ORIGINS", "*")
_origins = [o.strip() for o in (_origins_raw or "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router)
app.include_router(system.router)
app.include_router(nginx.router)
app.include_router(servers.router)
app.include_router(upstreams.router)
app.include_router(streams.router)
app.include_router(rtmp.router)
app.include_router(cicd.router)
app.include_router(cicd.git_router)
app.include_router(deployments.router)
app.include_router(projects.webhook_router)
app.include_router(projects.router)
app.include_router(docker.router)
app.include_router(statuspages.router)     # /monitors/status-pages (antes de monitors p/ vencer /monitors/{id})
app.include_router(maintenances.router)    # /monitors/maintenances (idem: antes de monitors)
app.include_router(monitors.router)
app.include_router(monitors.push_router)  # webhook público de heartbeat (push)
app.include_router(statuspages.public_router)  # /status/{slug} público (sem auth)
app.include_router(ws.router)  # WebSocket (terminal TTY) — sem middleware HTTP
app.include_router(audit.router)
app.include_router(settings.router)
app.include_router(ai.router)
app.include_router(certificates.router)
app.include_router(dns.router)
app.include_router(logs.router)
app.include_router(s3.router)
app.include_router(users.router)


# --------------------------------------------------------------------------- #
# Exception handlers — todo erro sai no envelope padrão
# --------------------------------------------------------------------------- #
@app.exception_handler(StarletteHTTPException)
async def _http_exc(_request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return json_response(success=False, status_code=exc.status_code,
                         messages=[message(detail, "error")])


@app.exception_handler(RequestValidationError)
async def _validation_exc(_request: Request, exc: RequestValidationError):
    msgs = [message(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}", "error")
            for e in exc.errors()]
    return json_response(success=False, status_code=422, messages=msgs)


@app.exception_handler(S.NotFound)
async def _not_found(_request: Request, exc: S.NotFound):
    return json_response(success=False, status_code=404,
                         messages=[message(str(exc), "error")])


@app.exception_handler(S.ConfigError)
async def _config_error(_request: Request, exc: S.ConfigError):
    return json_response(success=False, status_code=409,
                         messages=[message(str(exc), "error")])


@app.exception_handler(UserError)
async def _user_error(_request: Request, exc: UserError):
    return json_response(success=False, status_code=exc.status,
                         messages=[message(str(exc), "error")])


@app.exception_handler(RoleError)
async def _role_error(_request: Request, exc: RoleError):
    return json_response(success=False, status_code=exc.status,
                         messages=[message(str(exc), "error")])


@app.exception_handler(MonitorError)
async def _monitor_error(_request: Request, exc: MonitorError):
    return json_response(success=False, status_code=exc.status,
                         messages=[message(str(exc), "error")])


@app.exception_handler(NotificationError)
async def _notification_error(_request: Request, exc: NotificationError):
    return json_response(success=False, status_code=exc.status,
                         messages=[message(str(exc), "error")])


@app.exception_handler(Exception)
async def _unhandled(_request: Request, exc: Exception):
    return json_response(success=False, status_code=500,
                         messages=[message(f"erro interno: {exc}", "error")])


@app.get("/health", tags=["meta"])
def health():
    return envelope(data={"status": "ok"})
