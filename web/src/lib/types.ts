// Tipos do domínio, espelhando o `data` das respostas da API.

export type ServerSummary = {
  id: string;
  server_name: string[];
  listen: string[];
  file: string;
  removable: boolean;
  enabled: boolean;
  ssl_enabled?: boolean;
  cache_enabled?: boolean;
  cache_zone?: string | null;
  managed_by_service?: boolean;
  service_id?: number | null;
};

export type ServerDetail = {
  id: string;
  file: string;
  removable: boolean;
  enabled: boolean;
  managed_by_service?: boolean;
  service_id?: number | null;
  raw: string;
  nodes: unknown[];
};

export type CacheZoneStatus = {
  zone: string;
  route: string | null;   // rota associada (null = server inteiro)
  category: "geral" | "zona" | "rota";
  path: string;
  dedicated: boolean;
  exists: boolean;
  size_bytes: number;
  max_size: string | null;
  files: number;
};
export type ServerCacheStatus = {
  id: string;
  enabled: boolean;
  zones: CacheZoneStatus[];
  removed_entries?: number;
};

export type UpstreamSummary = {
  id: string;
  context: string;
  file: string;
  servers: string[][];
  in_use: boolean;
  used_by: string[];
  enabled: boolean;
};

export type UpstreamDetail = {
  id: string;
  context: string;
  file: string;
  enabled: boolean;
  raw: string;
  nodes: unknown[];
};

export type RtmpSummary = {
  id: string;
  name: string;
  listen: string;
  live: string;
  hls: string;
  record: string;
  key: string;
  file: string;
  enabled: boolean;
};

export type RtmpDetail = {
  id: string;
  name: string;
  listen: string;
  nodes: unknown[];
  raw: string;
};

export type StreamSummary = {
  id: string;
  listen: string[];
  file: string;
  enabled: boolean;
};

export type StreamDetail = {
  id: string;
  file: string;
  enabled: boolean;
  raw: string;
  nodes: unknown[];
};

export type SystemLive = {
  req_per_s: number | null;
  requests_total: number | null;
  connections: number | null;
  uplink_bps: number | null;
  downlink_bps: number | null;
  uplink_total: number | null;
  downlink_total: number | null;
};

export type SystemOverview = {
  host: { hostname: string; os: string; kernel: string; uptime_seconds: number | null };
  cpu: { count: number | null; usage_percent: number | null; load: number[] | null };
  memory: {
    total: number | null;
    used: number | null;
    free: number | null;
    available: number | null;
    percent: number | null;
  };
  disk: { path: string; total: number | null; used: number | null; free: number | null; percent: number | null };
  nginx: { running: boolean; pid: number | null; version: string | null; config_ok: boolean };
  live: SystemLive;
};

export type MetricPoint = {
  ts: number;
  cpu: number | null;
  mem: number | null;
  disk: number | null;
  req_per_s: number | null;
  requests_total: number | null;
  connections: number | null;
  uplink_bps: number | null;
  downlink_bps: number | null;
  uplink_total: number | null;
  downlink_total: number | null;
};

export type AuditEntry = {
  id: number;
  ts: number;
  user: string;
  action: string;
  method: string;
  path: string;
  status: number;
  detail: string | null;
};

export type SettingsData = {
  values: {
    sse_interval_seconds: number;
    metrics_retention_days: number;
    acme_email?: string;
    cloudflare_tunnel_enabled?: boolean;
    cloudflare_tunnel_token?: string;
    cloudflare_tunnel_1_enabled?: boolean;
    cloudflare_tunnel_1_token?: string;
    cloudflare_tunnel_2_enabled?: boolean;
    cloudflare_tunnel_2_token?: string;
    cloudflare_tunnel_3_enabled?: boolean;
    cloudflare_tunnel_3_token?: string;
    backup_encryption_secret?: string;
    deployment_preview_domain?: string;
    deployment_preview_ip?: string;
    deployment_preview_port?: number;
    deployment_preview_limit?: number;
    deployment_preview_https?: boolean;
    upload_max_mb?: number;
    upload_concurrency?: number;
    docker_scan_enabled?: boolean;
    docker_scan_rate_limit_seconds?: number;
    docker_scan_max_details?: number;
    docker_scan_workers?: number;
    docker_stats_interval_seconds?: number;
    session_ttl_days?: number;
    api_cors_origins?: string;
    api_tls_enabled?: boolean;
  };
  limits: Record<string, { min: number; max: number }>;
  defaults: Record<string, number | string | boolean>;
  cloudflared?: {
    installed: boolean;
    path: string;
    tunnels: {
      index: number;
      enabled: boolean;
      has_token: boolean;
      installed: boolean;
      running: boolean;
      pid: number | null;
      path: string;
      log: string;
    }[];
  };
};

export type Certificate = {
  name: string;
  common_name: string;
  domains: string[];
  type: "self-signed" | "letsencrypt" | "ca-signed";
  issuer: string;
  not_before: string;
  not_after: string;
  days_left: number;
  expired: boolean;
  has_key: boolean;
  cert_path: string;
  key_path: string;
  auto_renew: boolean;
  in_use: boolean;
  used_by: string[];
};

export type Ca = {
  name: string;
  common_name: string;
  org: string;
  not_before: string;
  not_after: string;
  days_left: number;
  expired: boolean;
  has_key: boolean;
  cert_pem: string | null;
  in_use: boolean;
  used_by: string[];
};

export type AccessLogEntry = { raw: string; parsed: Record<string, unknown> | null };
export type ErrorLogEntry = { raw: string; parsed: Record<string, unknown> | null };

// --- Usuários / papéis (RBAC) ----------------------------------------------
export type Identity = {
  username: string;
  name: string;
  email: string;
  role: string;
  isMaster: boolean;
  permissions: string[];
};

export type PanelUser = {
  id: number | null;
  username: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  created_ts: number;
  updated_ts: number;
  master: boolean;
  editable: boolean;
};

export type Profile = {
  username: string;
  name: string;
  email: string;
  role: string;
  is_master: boolean;
  editable: boolean;
};

export type RoleInfo = {
  name: string;
  label: string;
  assignable: boolean;
  permissions: string[];
  builtin: boolean;
  in_use: number;
  editable: boolean;
};

/** Item do catálogo de permissões (uma linha da matriz recurso × ação). */
export type PermissionCatalogItem = {
  resource: string;
  label: string;
  read: string; // "servers:read"
  write: string; // "servers:write"
};

export type RolesResponse = {
  roles: RoleInfo[];
  permissions: PermissionCatalogItem[];
};

export type LatencyStats = {
  avg: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  count: number;
};

export type UpstreamStat = {
  addr: string;
  requests: number;
  failures: number;
  avg_latency: number | null;
  p95_latency: number | null;
};

export type HostMetric = {
  host: string;
  requests: number;
  errors: number;
  error_rate: number;
  bytes: number;
  avg_latency: number | null;
  p95_latency: number | null;
  p99_latency: number | null;
  cache_hit_ratio: number | null;
};

export type IpMetric = {
  ip: string;
  requests: number;
  errors: number;
  bytes: number;
};

export type SlowRequest = {
  host: string;
  path: string;
  method: string;
  status: number;
  request_time: number;
  upstream: string;
};

export type LogMetrics = {
  generated_ts: number;
  window_seconds: number;
  sample_size: number;
  traffic: {
    rps: number;
    rpm: number;
    rph: number;
    throughput_out_bps: number;
    throughput_in_bps: number;
    bytes_out: number;
    bytes_in: number;
  };
  status: Record<string, number>;
  status_codes: Record<string, number>;
  methods: Record<string, number>;
  latency: { request: LatencyStats; ttfb: LatencyStats; upstream: LatencyStats };
  cache: Record<string, number>;
  cache_summary: { total: number; hits: number; misses: number; hit_ratio: number | null };
  upstreams: UpstreamStat[];
  hosts: HostMetric[];
  top_ips: IpMetric[];
  top_error_ips: IpMetric[];
  protocols: Record<string, number>;
  top_endpoints: { path: string; count: number; avg_latency: number | null; bytes: number }[];
  slowest_endpoints: { path: string; avg_latency: number | null; count: number }[];
  error_endpoints: { path: string; errors: number; count: number }[];
  slow_requests: {
    thresholds: { gt_1s: number; gt_5s: number; gt_30s: number };
    items: SlowRequest[];
  };
  countries: { country: string; requests: number; bytes: number; avg_latency: number | null }[];
  browsers: Record<string, number>;
  os: Record<string, number>;
  compression: {
    counts: Record<string, number>;
    bytes: Record<string, number>;
    saved_bytes_est: number;
    series: { ts: number; gzip: number; brotli: number; zstd: number; none: number }[];
  };
};

export type DnsField = { key: string; label: string; secret?: boolean; multiline?: boolean };
export type DnsProviderType = { type: string; label: string; fields: DnsField[] };
export type DnsProvider = {
  id: number;
  type: string;
  label: string;
  config: Record<string, string>;
  created_ts: number;
};
export type S3Field = { key: string; label: string; secret: boolean };
export type S3Config = {
  id: number;
  label: string;
  config: Record<string, string>;
  created_ts: number;
};
export type AiProviderType = {
  type: string;
  label: string;
  default_url: string;
  api_key_required: boolean;
  model_placeholder: string;
};
export type AiProvider = {
  id: number;
  type: string;
  name: string;
  api_url: string;
  api_key: string;
  has_api_key: boolean;
  model: string;
  enabled: boolean;
  created_ts: number;
  updated_ts: number;
};
export type AiProviderTestResult = {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
};

export type DnsZone = { id: string; name: string };
export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  proxiable?: boolean;
};

export type DeployStatus = "queued" | "deploying" | "deployed" | "failed" | "canceled";
export type DeployType = "manual" | "auto" | "rebuild" | "rollback";
export type DeploymentItem = {
  id: number;
  project_id: number;
  project_name: string;
  service_id: number;
  service_name: string;
  service_slug: string;
  service_kind: string;
  status: DeployStatus;
  type: DeployType;
  preview_url: string;
  preview_key: string;
  has_preview: boolean;
  server_name: string;
  source_branch: string;
  source_commit: string;
  source_commit_desc: string;
  container_id: string;
  container_running: boolean;
  error: string | null;
  user: string;
  active: boolean;
  created_ts: number;
  started_ts: number;
  finished_ts: number;
  duration_ms: number;
};
export type DeploymentEvent = {
  id: number;
  deployment_id: number;
  ts: number;
  phase: string;
  phase_label: string;
  level: "info" | "success" | "error";
  message: string;
};
export type DeploymentPhase = {
  phase: string;
  label: string;
  started_ts: number;
  finished_ts: number;
  duration_ms: number;
};
export type DeploymentHistory = {
  deployment: DeploymentItem;
  events: DeploymentEvent[];
  phases: DeploymentPhase[];
};

export type GitProviderKind = "github" | "gitlab" | "gitea" | "bitbucket";
export type GitProvider = {
  id: number;
  name: string;
  type: GitProviderKind;
  auth_mode: "app" | "token";
  label: string;
  base_url: string;
  provider_url: string;
  app_id: string;
  app_secret: string;
  github_app_slug: string;
  github_client_id: string;
  github_private_key: string;
  token: string;  // Bitbucket mascarado ("********") ou ""
  has_token: boolean;
  callback_path: string;
  webhook_path: string;
  webhook_secret: string;
  created_ts: number;
};
export type WebhookInfo = { url: string; secret: string; kind: GitProviderKind };
export type GitHubAccount = {
  id: number;
  account: { id: number; login: string; type: string };
  selected: boolean;
};
export type GitHubRepository = {
  full_name: string;
  name: string;
  owner: string;
  clone_url: string;
  default_branch: string;
};
export type GitHubBranch = { name: string };

// --- Projetos / Serviços (grupo CI/CD) ---
export type ServiceKind = "application" | "database" | "compose" | "template";
export type DbEngine = "postgres" | "mysql" | "mariadb" | "mongodb" | "redis" | "cassandra";
export type ServiceStatus = "created" | "running" | "stopped" | "failed" | "deploying";

export type ServiceConfig = Record<string, unknown>;
export type ProjectService = {
  id: number;
  project_id: number;
  kind: ServiceKind;
  name: string;
  slug: string;
  description: string;
  status: ServiceStatus;
  config: ServiceConfig;   // segredos (ex.: senha de banco) vêm mascarados
  container_id: string;
  has_successful_deployment: boolean;
  created_ts: number;
  updated_ts: number;
};

export type DbCredentials = {
  engine: DbEngine;
  user: string;
  password: string;        // valor REAL (bloco de credenciais)
  database: string;
  internal_host: string;
  internal_port: number;
  connection_url: string;
  expose: boolean;
  external_port: number;
};
export type ServiceDetail = ProjectService & {
  container_name: string;
  credentials?: DbCredentials;   // só para kind === "database"
};

export type AppProvider = "github" | "gitlab" | "bitbucket" | "gitea" | "docker" | "git" | "spa";
export type BuildType = "dockerfile" | "static";
export type Project = {
  id: number;
  name: string;
  description: string;
  tags: string[];
  created_ts: number;
  updated_ts: number;
  service_count?: number;
  service_kind_counts?: Partial<Record<ServiceKind, number>>;
  services?: ProjectService[];
};

export type TemplateItem = {
  id: string;
  name: string;
  description: string;
  version: string;
  logo: string;
  links?: Record<string, string>;
  tags: string[];
};
export type TemplatesPage = { items: TemplateItem[]; total: number; limit: number; offset: number };

// --- Docker / Configurações CI/CD ---
export type DockerContainer = {
  id: string;
  name: string;
  state: string;    // running | exited | ...
  status: string;   // "Up 3 hours" etc
  image: string;
  ip?: string;               // IP na rede (default ou 1ª rede)
  ports?: ContainerPort[];   // portas publicadas/expostas
  restart_policy?: string;   // unless-stopped | always | no | on-failure
  auto_remove?: boolean;
  created?: number;          // epoch (s)
};
export type ContainerPort = { text: string; proto: string; published: boolean };
export type ContainerStats = { cpu: number; mem: number; mem_limit: number; mem_pct: number };
export type SshKey = {
  id: number;
  name: string;
  private_key: string;   // sempre mascarado ("********") nas respostas
  public_key: string;
  created_ts: number;
};
export type DockerRegistry = {
  id: number;
  name: string;
  url: string;
  username: string;
  password: string;      // sempre mascarado ("********") nas respostas
  created_ts: number;
};
