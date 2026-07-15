"""Modelos SQLAlchemy: métricas, auditoria e configurações da aplicação."""
from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, Float, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Metric(Base):
    """Uma amostra periódica de métricas da máquina/nginx."""
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True)  # epoch em milissegundos

    cpu_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    mem_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    mem_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    mem_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    disk_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_used: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    disk_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    req_per_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    requests_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # contador acumulado
    connections: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uplink_bps: Mapped[float | None] = mapped_column(Float, nullable=True)     # bytes/s enviados
    downlink_bps: Mapped[float | None] = mapped_column(Float, nullable=True)   # bytes/s recebidos
    uplink_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)    # bytes enviados (acum.)
    downlink_total: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # bytes recebidos (acum.)

    nginx_running: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditLog(Base):
    """Registro de auditoria: tudo que modifica o sistema."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True)  # epoch em milissegundos
    user: Mapped[str] = mapped_column(String(120), index=True, default="")
    action: Mapped[str] = mapped_column(String(160))          # ex.: "server.update"
    method: Mapped[str] = mapped_column(String(10), default="")
    path: Mapped[str] = mapped_column(String(400), default="")
    status: Mapped[int] = mapped_column(Integer, default=0)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)


class AppSetting(Base):
    """Par chave/valor para configurações persistentes (intervalo SSE, retenção)."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(String(400))


class DnsProviderRow(Base):
    """Provedor DNS configurado (Cloudflare/Route53/Google/Azure)."""
    __tablename__ = "dns_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(40))          # cloudflare/route53/google/azure
    label: Mapped[str] = mapped_column(String(120), default="")
    config: Mapped[str] = mapped_column(Text)              # JSON com credenciais
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class S3ConfigRow(Base):
    """Configuração S3 (bucket destino p/ upload de logs). Pode haver várias."""
    __tablename__ = "s3_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    config: Mapped[str] = mapped_column(Text)              # JSON (endpoint/bucket/keys)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class AiProviderRow(Base):
    """Provedor de IA configurado para consumo pelos recursos do painel."""
    __tablename__ = "ai_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    api_url: Mapped[str] = mapped_column(String(1000), default="")
    api_key: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class Role(Base):
    """Papel editável (permissões controladas no painel). `master` é implícito."""
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    permissions: Mapped[str] = mapped_column(Text, default="[]")  # JSON: lista de "recurso:ação"
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)   # semente: não deletável
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class User(Base):
    """Usuário do painel (além do master do .env). Papel via `role` (ver rbac.py)."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))   # argon2id ($argon2id$...)
    name: Mapped[str] = mapped_column(String(120), default="")   # nome de exibição
    email: Mapped[str] = mapped_column(String(254), default="")
    role: Mapped[str] = mapped_column(String(40), default="viewer")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class UserSession(Base):
    """Sessão emitida no login (token opaco). Guarda só o hash do token."""
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # sha256 hex
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_ts: Mapped[int] = mapped_column(BigInteger, index=True, default=0)


class DeployApp(Base):
    """Aplicação deployável: static (upload), git (clone) ou docker (clone + build)."""
    __tablename__ = "deploy_apps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))              # rótulo de exibição
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)  # usado no path
    type: Mapped[str] = mapped_column(String(20), default="static")  # static|git|docker
    root: Mapped[str] = mapped_column(String(400))              # ex.: /var/www/apps/<slug>
    keep_releases: Mapped[int] = mapped_column(Integer, default=5)
    server_name: Mapped[str] = mapped_column(String(255), default="")  # referência informativa
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)

    # git/docker: origem do conteúdo (clone) + webhook que dispara o deploy.
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    git_url: Mapped[str] = mapped_column(String(500), default="")
    branch_filter: Mapped[str] = mapped_column(String(255), default="")  # glob(s) separados por vírgula
    webhook_kind: Mapped[str] = mapped_column(String(20), default="")   # github|gitlab|gitea
    webhook_secret: Mapped[str] = mapped_column(String(64), default="")

    # docker: parâmetros do build (clone + docker build -t <slug>:<ref>).
    dockerfile_path: Mapped[str] = mapped_column(String(255), default="Dockerfile")
    build_context: Mapped[str] = mapped_column(String(255), default=".")
    build_args: Mapped[str] = mapped_column(Text, default="{}")  # JSON


class Deploy(Base):
    """Um deploy (histórico + fila: status=queued é consumido pelo worker)."""
    __tablename__ = "deploys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    app_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)  # queued|running|success|failed|canceled
    source: Mapped[str] = mapped_column(String(20), default="upload")  # upload|git|rollback
    ref: Mapped[str] = mapped_column(String(200), default="")   # commit/tag/branch ou rótulo
    image: Mapped[str] = mapped_column(String(200), default="")  # fase docker
    release_dir: Mapped[str] = mapped_column(String(400), default="")
    logs_path: Mapped[str] = mapped_column(String(400), default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    user: Mapped[str] = mapped_column(String(120), default="")  # quem disparou
    created_ts: Mapped[int] = mapped_column(BigInteger, index=True, default=0)
    started_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    finished_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class ImageScan(Base):
    """Scan de vulnerabilidades de uma imagem (fila + histórico de análises).

    O scanner (trivy) só roda 1x por vez: `status=queued` é consumido por um
    worker único em thread. Guarda o resultado (total + contagem por severidade)
    e as datas de solicitação (`created_ts`) e conclusão (`finished_ts`)."""
    __tablename__ = "image_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_id: Mapped[str] = mapped_column(String(80), index=True)   # sha256:...
    image_ref: Mapped[str] = mapped_column(String(255), default="")  # tag/nome p/ exibição
    status: Mapped[str] = mapped_column(String(16), index=True, default="queued")  # queued|running|success|failed|canceled
    phase: Mapped[str] = mapped_column(String(40), default="")       # rótulo da fase atual
    total: Mapped[int] = mapped_column(Integer, default=0)
    severities: Mapped[str] = mapped_column(Text, default="")        # JSON {CRITICAL:..,...}
    details: Mapped[str] = mapped_column(Text, default="")           # JSON [{id,pkg,severity,...}]
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    user: Mapped[str] = mapped_column(String(120), default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, index=True, default=0)  # created_at
    started_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    finished_ts: Mapped[int] = mapped_column(BigInteger, default=0)             # finished_at


class ProjectDeployment(Base):
    """Histórico de deploys disparados pelos serviços do grupo CI/CD."""
    __tablename__ = "project_deployments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    service_id: Mapped[int] = mapped_column(Integer, index=True)
    service_kind: Mapped[str] = mapped_column(String(20), index=True, default="")
    job_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    status: Mapped[str] = mapped_column(String(16), index=True, default="queued")
    type: Mapped[str] = mapped_column(String(16), default="manual")  # manual|auto|rebuild|rollback
    container_id: Mapped[str] = mapped_column(String(80), default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    user: Mapped[str] = mapped_column(String(120), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_ts: Mapped[int] = mapped_column(BigInteger, index=True, default=0)
    started_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    finished_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class ProjectApplicationDeployment(Base):
    """Detalhes de deployment para serviços application."""
    __tablename__ = "project_application_deployments"

    deployment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    preview_key: Mapped[str] = mapped_column(String(40), unique=True, index=True, default="")
    preview_url: Mapped[str] = mapped_column(String(500), default="")
    server_name: Mapped[str] = mapped_column(String(255), default="")
    source_branch: Mapped[str] = mapped_column(String(200), default="")
    source_commit: Mapped[str] = mapped_column(String(80), default="")
    source_commit_desc: Mapped[str] = mapped_column(String(500), default="")


class ProjectComposeDeployment(Base):
    """Detalhes de deployment para serviços compose."""
    __tablename__ = "project_compose_deployments"

    deployment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    preview_key: Mapped[str] = mapped_column(String(40), unique=True, index=True, default="")
    preview_url: Mapped[str] = mapped_column(String(500), default="")
    server_name: Mapped[str] = mapped_column(String(255), default="")


class ProjectDatabaseDeployment(Base):
    """Detalhes de deployment para serviços database."""
    __tablename__ = "project_database_deployments"

    deployment_id: Mapped[int] = mapped_column(Integer, primary_key=True)


class ProjectDeploymentEvent(Base):
    """Linha/evento do pipeline de um deployment, com fase para sumarizar tempos."""
    __tablename__ = "project_deployment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    deployment_id: Mapped[int] = mapped_column(Integer, index=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True, default=0)
    phase: Mapped[str] = mapped_column(String(40), default="setup")
    level: Mapped[str] = mapped_column(String(16), default="info")  # info|success|error
    message: Mapped[str] = mapped_column(Text, default="")


class GitProviderRow(Base):
    """Provedor Git configurado: App OAuth ou token Bitbucket."""
    __tablename__ = "git_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(20))          # github|gitlab|gitea|bitbucket
    name: Mapped[str] = mapped_column(String(80), default="", index=True)
    label: Mapped[str] = mapped_column(String(120), default="")
    base_url: Mapped[str] = mapped_column(String(255), default="")  # provider_url
    app_id: Mapped[str] = mapped_column(String(255), default="")
    app_secret: Mapped[str] = mapped_column(String(255), default="")
    github_app_slug: Mapped[str] = mapped_column(String(120), default="")
    github_client_id: Mapped[str] = mapped_column(String(255), default="")
    github_private_key: Mapped[str | None] = mapped_column(Text, nullable=True, default="")
    token: Mapped[str] = mapped_column(String(255), default="")     # OAuth access token ou Bitbucket token
    webhook_secret: Mapped[str] = mapped_column(String(64), default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class CertMeta(Base):
    """Metadados de emissão de um certificado (habilita auto-renovação)."""
    __tablename__ = "cert_meta"

    name: Mapped[str] = mapped_column(String(180), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))          # self-signed | letsencrypt
    domains: Mapped[str] = mapped_column(Text, default="[]")   # JSON
    ips: Mapped[str] = mapped_column(Text, default="[]")       # JSON (self-signed)
    days: Mapped[int] = mapped_column(Integer, default=825)    # validade (self-signed)
    rsa: Mapped[bool] = mapped_column(Boolean, default=False)
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # LE
    staging: Mapped[bool] = mapped_column(Boolean, default=True)             # LE
    ca_name: Mapped[str | None] = mapped_column(String(180), nullable=True)  # ca-signed
    auto_renew: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class Project(Base):
    """Projeto (CI/CD): agrupa serviços (aplicação/banco/compose/template)."""
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")      # JSON: lista de strings
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class ProjectService(Base):
    """Serviço dentro de um projeto. `config` guarda os campos por `kind` (JSON).

    Segredos (ex.: senha de banco) são mascarados nas respostas (ver projects.py).
    """
    __tablename__ = "project_services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(20))             # application|database|compose|template
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(80), index=True, default="")  # nome estável (container/volume)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="created")  # created|running|stopped|failed
    config: Mapped[str] = mapped_column(Text, default="{}")   # JSON: campos por kind
    container_id: Mapped[str] = mapped_column(String(80), default="")  # provisionamento (fase 2)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class SshKey(Base):
    """Par de chave SSH (CI/CD) p/ autenticar clone git. private_key mascarada."""
    __tablename__ = "ssh_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    private_key: Mapped[str] = mapped_column(Text, default="")   # mascarada nas respostas
    public_key: Mapped[str] = mapped_column(Text, default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class DockerRegistry(Base):
    """Credencial de registry Docker (CI/CD) p/ imagens privadas. password mascarada."""
    __tablename__ = "docker_registries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(255), default="")     # ex.: registry-1.docker.io
    username: Mapped[str] = mapped_column(String(120), default="")
    password: Mapped[str] = mapped_column(Text, default="")       # mascarada nas respostas
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorGroup(Base):
    """Grupo de monitores (healthcheck)."""
    __tablename__ = "monitor_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(20), default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorTag(Base):
    """Tag reutilizável por monitores ativos e heartbeats push."""
    __tablename__ = "monitor_tags"
    __table_args__ = (
        Index("ix_monitor_tags_name_value", "name", "value", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    value: Mapped[str] = mapped_column(String(200), default="")
    color: Mapped[str] = mapped_column(String(7), default="#64748b")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorTagLink(Base):
    """Vínculo N:N entre o catálogo de tags e monitores/heartbeats."""
    __tablename__ = "monitor_tag_links"

    monitor_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tag_id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)


class Monitor(Base):
    """Monitor (healthcheck). `config` guarda os campos por `type` (JSON).

    Segredos (senhas/tokens de autenticação, chave mTLS) são mascarados nas
    respostas (ver api/monitors.py). `status` é atualizado pelo motor de
    execução (api/monitorworker.py): pending|up|down|degraded (degraded =
    no ar mas com latência sustentada acima do limite).
    """
    __tablename__ = "monitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    type: Mapped[str] = mapped_column(String(20))            # http|tcp|ping|dns|container
    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[str] = mapped_column(Text, default="{}")  # JSON: campos por type
    interval_seconds: Mapped[int] = mapped_column(Integer, default=60)
    max_retries: Mapped[int] = mapped_column(Integer, default=0)
    timeout_seconds: Mapped[float] = mapped_column(Float, default=48)
    resend_every: Mapped[int] = mapped_column(Integer, default=0)  # 0 = não reenviar
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending|up|down|degraded|maintenance
    last_check_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    ssl_status: Mapped[str] = mapped_column(String(20), default="")
    ssl_checked_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    ssl_issued_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    ssl_expires_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    ssl_message: Mapped[str] = mapped_column(Text, default="")
    domain_status: Mapped[str] = mapped_column(String(20), default="")
    domain_checked_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    domain_registered_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    domain_expires_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    domain_message: Mapped[str] = mapped_column(Text, default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorHeartbeat(Base):
    """Uma checagem do monitor (histórico), gravada pelo motor de execução."""
    __tablename__ = "monitor_heartbeats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitor_id: Mapped[int] = mapped_column(Integer, index=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(12), default="down")  # up|down
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    code: Mapped[str] = mapped_column(String(40), default="")   # ex.: HTTP status
    message: Mapped[str] = mapped_column(Text, default="")
    # Detalhamento do tempo de resposta (JSON): dns/tcp/tls/request/ttfb/download/total (ms).
    timings: Mapped[str] = mapped_column(Text, default="")
    # Proxy usado nesta checagem (rótulo protocol://server:porta), se houver.
    proxy: Mapped[str] = mapped_column(Text, default="")
    # Fração de disponibilidade desta checagem (0..1). 1 = ok total; no modo
    # proxy `all`, = proxies_ok / total (ex.: 3/4 = 0.75, ainda `up`).
    up_ratio: Mapped[float] = mapped_column(Float, default=1.0)
    # Metadados da resposta/conexão HTTP (JSON): size/compressed/content_type/
    # http_version/remote_ip/tls_version/tls_cipher/alpn.
    meta: Mapped[str] = mapped_column(Text, default="")


class MonitorProxy(Base):
    """Proxy de saída vinculado a um monitor HTTP."""
    __tablename__ = "monitor_proxies"
    # o trio (protocolo, servidor, porta) é único.
    __table_args__ = (Index("ix_monitor_proxies_endpoint", "protocol", "server", "port", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    protocol: Mapped[str] = mapped_column(String(20))
    server: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer)
    username: Mapped[str] = mapped_column(String(200), default="")
    password: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorStat(Base):
    """Agregação horária das checagens de um monitor (uptime de longo prazo)."""
    __tablename__ = "monitor_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitor_id: Mapped[int] = mapped_column(Integer, index=True)
    bucket_ts: Mapped[int] = mapped_column(BigInteger, default=0)  # início da hora (ms)
    # Float p/ suportar disponibilidade fracionária (modo proxy `all` parcial).
    up: Mapped[float] = mapped_column(Float, default=0.0)
    down: Mapped[float] = mapped_column(Float, default=0.0)
    ping_sum: Mapped[int] = mapped_column(BigInteger, default=0)
    ping_count: Mapped[int] = mapped_column(Integer, default=0)


class MonitorEvent(Base):
    """Evento de um monitor (transição de estado / ativação / manutenção)."""
    __tablename__ = "monitor_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitor_id: Mapped[int] = mapped_column(Integer, index=True)
    ts: Mapped[int] = mapped_column(BigInteger, default=0)
    type: Mapped[str] = mapped_column(String(20), default="")   # healthy|unhealthy|activated|deactivated|maintenance
    message: Mapped[str] = mapped_column(Text, default="")


class MonitorIncident(Base):
    """Incidente (criado manualmente) associado a um monitor."""
    __tablename__ = "monitor_incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitor_id: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="investigating")  # identified|investigating|monitoring|resolved
    # impacto do incidente: operational|degraded|partial|major|maintenance
    severity: Mapped[str] = mapped_column(String(20), default="degraded")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    resolved_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class MonitorIncidentUpdate(Base):
    """Atualização (post) na linha do tempo de um incidente."""
    __tablename__ = "monitor_incident_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str] = mapped_column(String(20), default="investigating")
    message: Mapped[str] = mapped_column(Text, default="")
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class StatusPage(Base):
    """Página pública de status (Uptime).

    Renderizada como HTML público em `GET /status/{slug}` (sem auth). Só expõe
    dados não sensíveis dos monitores selecionados (nome/status/uptime/histórico
    up-down) — nunca o target/config/auth. Pode gerar um server block nginx
    próprio (proxy_pass p/ a rota pública) quando `domain` é definido.
    """
    __tablename__ = "status_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    logo_url: Mapped[str] = mapped_column(Text, default="")      # URL ou data: URI
    banner: Mapped[str] = mapped_column(Text, default="")        # aviso no topo (texto)
    accent_color: Mapped[str] = mapped_column(String(20), default="")  # ex.: #2563eb
    custom_css: Mapped[str] = mapped_column(Text, default="")
    custom_js: Mapped[str] = mapped_column(Text, default="")
    monitor_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON: ids selecionados
    show_incidents: Mapped[bool] = mapped_column(Boolean, default=True)
    show_maintenance: Mapped[bool] = mapped_column(Boolean, default=True)
    published: Mapped[bool] = mapped_column(Boolean, default=True)
    domain: Mapped[str] = mapped_column(String(255), default="")  # server_name do nginx
    cert_name: Mapped[str] = mapped_column(String(255), default="")
    server_file: Mapped[str] = mapped_column(String(255), default="")  # conf gerada
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class NotificationChannel(Base):
    """Canal de notificação (webhook/telegram/discord/email/slack/teams).

    Campos específicos por tipo ficam no JSON `config`; segredos (tokens/senhas/
    URLs de webhook) são mascarados nas respostas (ver api/notifications.py).
    """
    __tablename__ = "notification_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(20))            # webhook|telegram|discord|email|slack|teams
    config: Mapped[str] = mapped_column(Text, default="{}")  # JSON: campos por type
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)


class Maintenance(Base):
    """Janela de manutenção agendada dos monitores selecionados.

    Enquanto uma manutenção está ativa, o motor (api/monitorworker.py) **não
    checa** os monitores afetados (evita falsos down/notificações). Os campos
    específicos de cada `strategy` ficam no JSON `config` (ver api/maintenances.py):
    - manual: sem janela (ativo enquanto `active`)
    - single: {start, end} (datetime "YYYY-MM-DD HH:MM" no fuso `timezone`)
    - recurring_interval: {interval_days, time_start, time_end, effective_*}
    - recurring_weekday: {weekdays[], time_start, time_end, effective_*}
    - recurring_dayofmonth: {days_of_month[], time_start, time_end, effective_*}
    - cron: {cron, duration_minutes, effective_*}
    `effective_start`/`effective_end` (opcionais) valem só p/ recorrentes/cron.
    """
    __tablename__ = "maintenances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    monitor_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON: ids afetados
    strategy: Mapped[str] = mapped_column(String(30), default="single")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    config: Mapped[str] = mapped_column(Text, default="{}")       # JSON: campos por strategy
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_ts: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_ts: Mapped[int] = mapped_column(BigInteger, default=0)
