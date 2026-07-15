// Tipos e helpers do formulário de Monitores. O backend valida tudo novamente.

export type MonitorType = "http" | "tcp" | "ping" | "dns" | "domain"
  | "postgresql" | "mysql" | "mongodb" | "redis" | "rabbitmq" | "container";
export type ConnectionMonitorType = "postgresql" | "mysql" | "mongodb" | "redis" | "rabbitmq";
export type MonitorStatus = "pending" | "up" | "down" | "degraded" | "maintenance";
export type MonitorSslStatus = "pending" | "valid" | "expiring" | "expired" | "error" | "unavailable";
export type MonitorDomainStatus = "pending" | "valid" | "expiring" | "expired" | "not_found" | "unknown" | "unavailable";

export type KeyValue = { key: string; value: string };

export type AuthType = "none" | "basic" | "bearer" | "oauth2" | "ntlm" | "mtls" | "other";

export type MonitorGroup = {
  id: number;
  name: string;
  color: string;
  monitor_count?: number;
  created_ts: number;
  updated_ts: number;
};

export type MonitorTag = {
  id: number;
  name: string;
  value: string;
  color: string;
  usage_count?: number;
  created_ts?: number;
  updated_ts?: number;
};

/** Identidade legível da tag; a unicidade é definida pelo par nome + valor. */
export function monitorTagLabel(tag: Pick<MonitorTag, "name" | "value">): string {
  return tag.value ? `${tag.name}: ${tag.value}` : tag.name;
}

// Config do monitor (campos por tipo; segredos mascarados no GET).
export type MonitorConfig = {
  // comum
  description?: string;
  // http
  url?: string;
  ssl?: { validate_expired: boolean; ignore_tls_errors: boolean };
  method?: string;
  body_encoding?: "json" | "form";
  body?: KeyValue[];
  headers?: KeyValue[];
  auth?: Record<string, unknown> & { type: AuthType };
  max_response_bytes?: number;
  accepted_codes?: string;
  keyword?: string;
  // tcp
  hostname?: string;
  port?: number;
  tls?: boolean;
  expected_tls_alert?: string;
  // ping
  packets?: number;
  packet_size?: number;
  per_ping_timeout?: number;
  // dns
  resolvers?: string[];
  record_type?: string;
  conditions?: DnsCondition[];
  // domain
  domain?: string;
  // bancos / mensageria
  connection_mode?: "fields" | "uri";
  host?: string;
  username?: string;
  password?: string;
  database?: string;
  arguments?: KeyValue[];
  uri?: string;
  connection_target?: string;
  // container
  container?: string;
  // comum: canais de notificação vinculados
  notification_channel_ids?: number[];
  // heartbeat push: tolerância adicional após o intervalo esperado
  grace_period_seconds?: number;
  proxy_mode?: "round_robin" | "all";
  proxy_ids?: number[];
  // comum: limite de tempo de resposta (ms); 0 = desligado
  latency_threshold_ms?: number;
  latency_window_seconds?: number;
  // http: o que gravar por checagem (economia de espaço)
  record_timings?: boolean;
  record_advanced?: boolean;
  record_last_only?: boolean;
};

export type Monitor = {
  id: number;
  type: MonitorType;
  name: string;
  group_id: number | null;
  group_name: string | null;
  tags: MonitorTag[];
  interval_seconds: number;
  max_retries: number;
  timeout_seconds: number;
  resend_every: number;
  active: boolean;
  status: MonitorStatus;
  last_check_ts: number;
  ssl_info?: {
    status: MonitorSslStatus;
    checked_ts: number;
    issued_ts: number;
    expires_ts: number;
    message: string;
  };
  domain_info?: {
    status: MonitorDomainStatus;
    checked_ts: number;
    registered_ts: number;
    expires_ts: number;
    message: string;
  };
  config: MonitorConfig;
  beats?: Beat[];
  created_ts: number;
  updated_ts: number;
  push_url?: string;
};

/** Detalhamento do tempo de resposta (ms). Fases não medidas vêm como null. */
export type ResponseTimings = {
  dns: number | null;
  tcp: number | null;
  tls: number | null;
  request: number | null;
  ttfb: number | null;
  download: number | null;
  total: number | null;
};

export type BeatMeta = {
  status?: number;
  size?: number | null;         // bytes (descomprimido; null se desconhecido)
  compressed?: number | null;   // bytes na rede (só se veio comprimido)
  content_type?: string;
  content_encoding?: string;
  http_version?: string;
  remote_ip?: string;
  tls_version?: string;
  tls_cipher?: string;
  alpn?: string;
};

export type Beat = {
  ts: number;
  status: "up" | "down";
  latency_ms: number;
  timings?: ResponseTimings | null;
  proxy?: string;
  up_ratio?: number;
  meta?: BeatMeta | null;
};

/** Alvo legível do monitor (URL / host:porta / domínio / container). */
export function monitorTarget(m: Monitor): string {
  const c = m.config || {};
  switch (m.type) {
    case "http": return c.url || "";
    case "tcp": return c.hostname ? `${c.hostname}:${c.port ?? ""}` : "";
    case "ping": return c.hostname || "";
    case "dns": return c.hostname ? `${c.hostname} (${(c.record_type || "").toUpperCase()})` : "";
    case "domain": return c.domain || "";
    case "postgresql":
    case "mysql":
    case "mongodb":
    case "redis":
    case "rabbitmq": return c.connection_target || c.host || "";
    case "container": return c.container || "";
    default: return "";
  }
}

export type Heartbeat = {
  ts: number;
  status: "up" | "down";
  latency_ms: number;
  code: string;
  message: string;
  timings?: ResponseTimings | null;
};

export type MonitorUptime = { h24: number | null; d30: number | null; y1: number | null };

export type ChartPoint = {
  ts: number;
  up: number;
  down: number;
  uptime: number | null;
  avg_latency: number | null;
  status: "up" | "down" | "partial";
  message?: string;
  timings?: ResponseTimings | null;
  proxy?: string;
};

export type MonitorChart = { range: string; start: number; end: number; points: ChartPoint[] };

// Chave do catálogo de eventos (ver EVENT_META em monitor-detail.tsx).
export type MonitorEventType = string;
export type MonitorEvent = { ts: number; type: MonitorEventType; message: string };

export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type IncidentSeverity = "operational" | "degraded" | "partial" | "major" | "maintenance";

export type IncidentUpdate = {
  id: number;
  status: IncidentStatus;
  message: string;
  created_ts: number;
};

export type MonitorIncident = {
  id: number;
  monitor_id: number;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  created_ts: number;
  updated_ts: number;
  resolved_ts: number | null;
  updates?: IncidentUpdate[];
};

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "info" | "muted";

// Ordem = fluxo do incidente (linha do tempo).
export const INCIDENT_STATUS_OPTIONS: { value: IncidentStatus; label: string; variant: BadgeVariant }[] = [
  { value: "investigating", label: "Investigando", variant: "info" },
  { value: "identified", label: "Identificado", variant: "warning" },
  { value: "monitoring", label: "Monitorando", variant: "default" },
  { value: "resolved", label: "Resolvido", variant: "success" },
];

export function incidentStatusLabel(s: string): string {
  return INCIDENT_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

export function incidentStatusVariant(s: string): BadgeVariant {
  return INCIDENT_STATUS_OPTIONS.find((o) => o.value === s)?.variant ?? "secondary";
}

export const INCIDENT_SEVERITY_OPTIONS: {
  value: IncidentSeverity; label: string; hint: string; variant: BadgeVariant;
}[] = [
  { value: "operational", label: "Operacional", hint: "Funcionando normalmente", variant: "success" },
  { value: "degraded", label: "Desempenho degradado", hint: "Lentidão", variant: "warning" },
  { value: "partial", label: "Interrupção parcial", hint: "Parte do serviço indisponível", variant: "warning" },
  { value: "major", label: "Interrupção grave", hint: "Grande indisponibilidade", variant: "destructive" },
  { value: "maintenance", label: "Manutenção", hint: "Manutenção programada", variant: "info" },
];

export function incidentSeverityLabel(s: string): string {
  return INCIDENT_SEVERITY_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

export function incidentSeverityVariant(s: string): BadgeVariant {
  return INCIDENT_SEVERITY_OPTIONS.find((o) => o.value === s)?.variant ?? "secondary";
}

export const CHART_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "1min", label: "1 minuto" },
  { value: "10min", label: "10 minutos" },
  { value: "1h", label: "1 hora" },
  { value: "3h", label: "3 horas" },
  { value: "6h", label: "6 horas" },
  { value: "12h", label: "12 horas" },
  { value: "24h", label: "24 horas" },
  { value: "1w", label: "1 semana" },
  { value: "1m", label: "1 mês" },
];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// Máximo de proxies no modo "all" (cada checagem dispara 1 req por proxy). Espelha
// MAX_ALL_PROXIES do backend (api/monitors.py).
export const MAX_ALL_PROXIES = 8;
export type MonitorTypeGroup = "Geral" | "Database" | "DNS";

export const MONITOR_TYPES: { value: MonitorType; label: string; group: MonitorTypeGroup }[] = [
  { value: "http", label: "HTTP(s)", group: "Geral" },
  { value: "tcp", label: "TCP", group: "Geral" },
  { value: "ping", label: "Ping", group: "Geral" },
  { value: "container", label: "Container", group: "Geral" },
  { value: "postgresql", label: "PostgreSQL", group: "Database" },
  { value: "mysql", label: "MySQL / MariaDB", group: "Database" },
  { value: "mongodb", label: "MongoDB", group: "Database" },
  { value: "redis", label: "Redis", group: "Database" },
  { value: "rabbitmq", label: "RabbitMQ", group: "Database" },
  { value: "dns", label: "DNS", group: "DNS" },
  { value: "domain", label: "Domínio", group: "DNS" },
];

export const CONNECTION_MONITOR_TYPES: ConnectionMonitorType[] = [
  "postgresql", "mysql", "mongodb", "redis", "rabbitmq",
];
export const CONNECTION_DEFAULT_PORTS: Record<ConnectionMonitorType, number> = {
  postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379, rabbitmq: 5672,
};
export const CONNECTION_URI_SCHEMES: Record<ConnectionMonitorType, string[]> = {
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql", "mariadb"],
  mongodb: ["mongodb", "mongodb+srv"],
  redis: ["redis", "rediss"],
  rabbitmq: ["amqp", "amqps"],
};
export function isConnectionMonitorType(type: MonitorType): type is ConnectionMonitorType {
  return CONNECTION_MONITOR_TYPES.includes(type as ConnectionMonitorType);
}

// Tipos que usam/exibem o campo de timeout (os demais usam o padrão do backend).
export const TIMEOUT_TYPES: MonitorType[] = ["http", "ping", ...CONNECTION_MONITOR_TYPES];

export const TCP_TLS_ALERTS = [
  "certificate_required", "bad_certificate", "certificate_unknown", "unknown_ca",
  "access_denied", "handshake_failure", "certificate_expired", "certificate_revoked",
];

export const DNS_RECORD_TYPES = ["a", "aaaa", "caa", "cname", "mx", "ns", "ptr", "soa", "srv", "txt"];

export const DNS_OPERATORS: { value: string; label: string }[] = [
  { value: "equal", label: "igual" },
  { value: "not_equal", label: "diferente" },
  { value: "contains", label: "contém" },
  { value: "not_contains", label: "não contém" },
  { value: "starts_with", label: "começa com" },
  { value: "not_starts_with", label: "não começa com" },
  { value: "ends_with", label: "termina com" },
  { value: "not_ends_with", label: "não termina com" },
];

export type DnsCondition = { operator: string; value: string };

export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 86400;
export const DOMAIN_INTERVAL_SECONDS = 86400;
export const RESEND_MIN = 1;
export const RESEND_MAX = 1000;
export const LATENCY_WINDOW_OPTIONS = [60, 300, 600, 900, 1800, 3600] as const;

// Formulário achatado que o dialog manipula.
export type MonitorForm = {
  type: MonitorType;
  name: string;
  groupId: string;              // "" = sem grupo
  intervalSeconds: string;
  maxRetries: string;
  timeoutSeconds: string;
  latencyDetectionEnabled: boolean;
  latencyThresholdMs: string;
  latencyWindowSeconds: string;
  recordTimings: boolean;
  recordAdvanced: boolean;
  recordLastOnly: boolean;
  resendEnabled: boolean;
  resendEvery: string;
  notificationsEnabled: boolean;
  domainName: string;
  connectionMode: "fields" | "uri";
  connectionHost: string;
  connectionPort: string;
  connectionUsername: string;
  connectionPassword: string;
  connectionDatabase: string;
  connectionArguments: KeyValue[];
  connectionUri: string;
  // http
  url: string;
  validateExpired: boolean;
  ignoreTlsErrors: boolean;
  method: string;
  bodyEncoding: "json" | "form";
  body: KeyValue[];
  headers: KeyValue[];
  authEnabled: boolean;
  authType: AuthType;
  // auth fields (todos guardados num único objeto plano)
  basicUsername: string;
  basicPassword: string;
  bearerToken: string;
  oauthMethod: "header" | "body";
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  oauthAudience: string;
  ntlmUsername: string;
  ntlmPassword: string;
  ntlmDomain: string;
  ntlmWorkstation: string;
  mtlsCert: string;
  mtlsKey: string;
  mtlsCa: string;
  otherHeader: string;
  otherParam: string;
  maxResponseBytes: string;
  acceptedCodes: string;
  keywordEnabled: boolean;
  keyword: string;
  // tcp
  tcpHostname: string;
  tcpPort: string;
  tcpTls: boolean;
  tcpExpectedAlert: string;     // "" = nenhum
  // ping
  pingHostname: string;
  packets: string;
  packetSize: string;
  perPingTimeout: string;
  // dns
  dnsHostname: string;
  resolvers: string[];
  dnsPort: string;
  recordType: string;
  conditions: DnsCondition[];
  // container
  containerName: string;
  // comum
  notificationChannelIds: number[];
  proxyIds: number[];
  description: string;
  tagIds: number[];
};

export function emptyMonitorForm(): MonitorForm {
  return {
    type: "http",
    name: "",
    groupId: "",
    intervalSeconds: "60",
    maxRetries: "0",
    timeoutSeconds: "48",
    latencyDetectionEnabled: false,
    latencyThresholdMs: "1000",
    latencyWindowSeconds: "60",
    recordTimings: true,
    recordAdvanced: false,
    recordLastOnly: false,
    resendEnabled: false,
    resendEvery: "3",
    notificationsEnabled: false,
    domainName: "",
    connectionMode: "fields",
    connectionHost: "",
    connectionPort: "5432",
    connectionUsername: "",
    connectionPassword: "",
    connectionDatabase: "",
    connectionArguments: [],
    connectionUri: "",
    url: "https://",
    validateExpired: true,
    ignoreTlsErrors: false,
    method: "GET",
    bodyEncoding: "json",
    body: [],
    headers: [],
    authEnabled: false,
    authType: "basic",
    basicUsername: "",
    basicPassword: "",
    bearerToken: "",
    oauthMethod: "header",
    oauthTokenUrl: "",
    oauthClientId: "",
    oauthClientSecret: "",
    oauthScope: "",
    oauthAudience: "",
    ntlmUsername: "",
    ntlmPassword: "",
    ntlmDomain: "",
    ntlmWorkstation: "",
    mtlsCert: "",
    mtlsKey: "",
    mtlsCa: "",
    otherHeader: "",
    otherParam: "",
    maxResponseBytes: "0",
    acceptedCodes: "200-299",
    keywordEnabled: false,
    keyword: "",
    tcpHostname: "",
    tcpPort: "",
    tcpTls: false,
    tcpExpectedAlert: "",
    pingHostname: "",
    packets: "3",
    packetSize: "56",
    perPingTimeout: "2",
    dnsHostname: "",
    resolvers: ["1.1.1.1"],
    dnsPort: "53",
    recordType: "a",
    conditions: [],
    containerName: "",
    notificationChannelIds: [],
    proxyIds: [],
    description: "",
    tagIds: [],
  };
}

export function parseMonitorForm(m: Monitor): MonitorForm {
  const f = emptyMonitorForm();
  const c = m.config || {};
  const a = (c.auth || { type: "none" }) as Record<string, string> & { type: AuthType };
  return {
    ...f,
    type: m.type,
    name: m.name,
    groupId: m.group_id ? String(m.group_id) : "",
    intervalSeconds: String(m.interval_seconds),
    maxRetries: String(m.max_retries),
    timeoutSeconds: String(m.timeout_seconds),
    latencyDetectionEnabled: Number(c.latency_threshold_ms ?? 0) > 0,
    latencyThresholdMs: String(Number(c.latency_threshold_ms ?? 0) > 0 ? c.latency_threshold_ms : 1000),
    latencyWindowSeconds: String(c.latency_window_seconds ?? 60),
    recordTimings: c.record_timings !== false,
    recordAdvanced: c.record_advanced === true,
    recordLastOnly: c.record_last_only === true,
    resendEnabled: m.resend_every > 0,
    resendEvery: String(m.resend_every > 0 ? m.resend_every : 3),
    notificationsEnabled: (c.notification_channel_ids || []).length > 0,
    domainName: m.type === "domain" ? c.domain || "" : "",
    connectionMode: c.connection_mode || "fields",
    connectionHost: c.host || "",
    connectionPort: String(c.port ?? (isConnectionMonitorType(m.type) ? CONNECTION_DEFAULT_PORTS[m.type] : 5432)),
    connectionUsername: c.username || "",
    connectionPassword: c.password || "",
    connectionDatabase: c.database || "",
    connectionArguments: (c.arguments || []).map((item) => ({ ...item })),
    connectionUri: c.uri || "",
    // http
    url: c.url || "https://",
    validateExpired: c.ssl?.validate_expired ?? true,
    ignoreTlsErrors: c.ssl?.ignore_tls_errors ?? false,
    method: c.method || "GET",
    bodyEncoding: c.body_encoding || "json",
    body: (c.body || []).map((p) => ({ ...p })),
    headers: (c.headers || []).map((p) => ({ ...p })),
    authEnabled: a.type !== "none",
    authType: a.type === "none" ? "basic" : a.type,
    basicUsername: a.username || "",
    basicPassword: a.password || "",
    bearerToken: a.token || "",
    oauthMethod: (a.method as "header" | "body") || "header",
    oauthTokenUrl: a.token_url || "",
    oauthClientId: a.client_id || "",
    oauthClientSecret: a.client_secret || "",
    oauthScope: a.scope || "",
    oauthAudience: a.audience || "",
    ntlmUsername: a.username || "",
    ntlmPassword: a.password || "",
    ntlmDomain: a.domain || "",
    ntlmWorkstation: a.workstation || "",
    mtlsCert: a.cert || "",
    mtlsKey: a.key || "",
    mtlsCa: a.ca || "",
    otherHeader: a.header || "",
    otherParam: a.param || "",
    maxResponseBytes: String(c.max_response_bytes ?? 0),
    acceptedCodes: c.accepted_codes || "200-299",
    keywordEnabled: !!c.keyword,
    keyword: c.keyword || "",
    // tcp
    tcpHostname: m.type === "tcp" ? c.hostname || "" : "",
    tcpPort: c.port != null ? String(c.port) : "",
    tcpTls: c.tls ?? false,
    tcpExpectedAlert: c.expected_tls_alert || "",
    // ping
    pingHostname: m.type === "ping" ? c.hostname || "" : "",
    packets: String(c.packets ?? 3),
    packetSize: String(c.packet_size ?? 56),
    perPingTimeout: String(c.per_ping_timeout ?? 2),
    // dns
    dnsHostname: m.type === "dns" ? c.hostname || "" : "",
    resolvers: (c.resolvers && c.resolvers.length ? c.resolvers : ["1.1.1.1"]).slice(),
    dnsPort: String(c.port ?? 53),
    recordType: c.record_type || "a",
    conditions: (c.conditions || []).map((x) => ({ ...x })),
    // container
    containerName: c.container || "",
    notificationChannelIds: (c.notification_channel_ids || []).map(Number),
    proxyIds: (c.proxy_ids || []).map(Number),
    description: c.description || "",
    tagIds: (m.tags || []).map((tag) => tag.id),
  };
}

function cleanPairs(pairs: KeyValue[]): KeyValue[] {
  return pairs.filter((p) => p.key.trim()).map((p) => ({ key: p.key.trim(), value: p.value }));
}

function buildAuth(f: MonitorForm): Record<string, unknown> {
  if (!f.authEnabled) return { type: "none" };
  switch (f.authType) {
    case "basic":
      return { type: "basic", username: f.basicUsername, password: f.basicPassword };
    case "bearer":
      return { type: "bearer", token: f.bearerToken };
    case "oauth2":
      return {
        type: "oauth2", method: f.oauthMethod, token_url: f.oauthTokenUrl,
        client_id: f.oauthClientId, client_secret: f.oauthClientSecret,
        scope: f.oauthScope, audience: f.oauthAudience,
      };
    case "ntlm":
      return {
        type: "ntlm", username: f.ntlmUsername, password: f.ntlmPassword,
        domain: f.ntlmDomain, workstation: f.ntlmWorkstation,
      };
    case "mtls":
      return { type: "mtls", cert: f.mtlsCert, key: f.mtlsKey, ca: f.mtlsCa };
    case "other":
      return { type: "other", header: f.otherHeader, param: f.otherParam };
    default:
      return { type: "none" };
  }
}

function buildConfig(f: MonitorForm): Record<string, unknown> {
  const common = {
    description: f.description.trim(),
    notification_channel_ids: f.notificationsEnabled ? f.notificationChannelIds : [],
    proxy_ids: f.proxyIds,
    latency_threshold_ms: f.latencyDetectionEnabled ? Number(f.latencyThresholdMs) || 0 : 0,
    latency_window_seconds: Number(f.latencyWindowSeconds) || 60,
  };
  switch (f.type) {
    case "tcp":
      return {
        ...common,
        hostname: f.tcpHostname.trim(),
        port: Number(f.tcpPort) || 0,
        tls: f.tcpTls,
        expected_tls_alert: f.tcpTls ? f.tcpExpectedAlert : "",
      };
    case "ping":
      return {
        ...common,
        hostname: f.pingHostname.trim(),
        packets: Number(f.packets) || 3,
        packet_size: Number(f.packetSize) || 56,
        per_ping_timeout: Number(f.perPingTimeout) || 2,
      };
    case "dns":
      return {
        ...common,
        hostname: f.dnsHostname.trim(),
        resolvers: f.resolvers.map((r) => r.trim()).filter(Boolean),
        port: Number(f.dnsPort) || 53,
        record_type: f.recordType,
        conditions: f.conditions
          .filter((c) => c.operator)
          .map((c) => ({ operator: c.operator, value: c.value })),
      };
    case "domain":
      return { ...common, domain: f.domainName.trim() };
    case "postgresql":
    case "mysql":
    case "mongodb":
    case "redis":
    case "rabbitmq":
      return f.connectionMode === "uri"
        ? { ...common, connection_mode: "uri", uri: f.connectionUri.trim() }
        : {
            ...common,
            connection_mode: "fields",
            host: f.connectionHost.trim(),
            port: Number(f.connectionPort) || CONNECTION_DEFAULT_PORTS[f.type],
            username: f.connectionUsername.trim(),
            password: f.connectionPassword,
            database: f.connectionDatabase.trim(),
            arguments: cleanPairs(f.connectionArguments),
          };
    case "container":
      return { ...common, container: f.containerName.trim() };
    default: // http
      return {
        ...common,
        url: f.url.trim(),
        ssl: { validate_expired: f.validateExpired, ignore_tls_errors: f.ignoreTlsErrors },
        method: f.method,
        body_encoding: f.bodyEncoding,
        body: cleanPairs(f.body),
        headers: cleanPairs(f.headers),
        auth: buildAuth(f),
        max_response_bytes: Number(f.maxResponseBytes) || 0,
        accepted_codes: f.acceptedCodes.trim() || "200-299",
        keyword: f.keywordEnabled ? f.keyword : "",
        record_timings: f.recordTimings,
        record_advanced: f.recordAdvanced,
        record_last_only: f.recordLastOnly,
      };
  }
}

export function buildMonitorBody(f: MonitorForm): Record<string, unknown> {
  return {
    type: f.type,
    name: f.name.trim(),
    group_id: f.groupId ? Number(f.groupId) : null,
    tag_ids: f.tagIds,
    interval_seconds: f.type === "domain" ? DOMAIN_INTERVAL_SECONDS : Number(f.intervalSeconds) || 60,
    max_retries: f.type === "domain" ? 0 : Number(f.maxRetries) || 0,
    timeout_seconds: f.type === "domain" ? 10 : Number(f.timeoutSeconds) || 1,
    resend_enabled: f.resendEnabled,
    resend_every: f.resendEnabled ? Number(f.resendEvery) || 0 : 0,
    active: true,
    config: buildConfig(f),
  };
}

export function isHttps(url: string): boolean {
  return url.trim().toLowerCase().startsWith("https://");
}

/** Teto do timeout (80% do intervalo, com 1 casa decimal). */
export function timeoutCap(intervalSeconds: string): number {
  const iv = Number(intervalSeconds) || 1;
  return Math.max(0.1, Math.round(iv * 0.8 * 10) / 10);
}

export function validateMonitorForm(f: MonitorForm): string | null {
  if (!f.name.trim()) return "Informe o rótulo do monitor.";
  switch (f.type) {
    case "http": {
      const url = f.url.trim().toLowerCase();
      if (!(url.startsWith("http://") || url.startsWith("https://")))
        return "A URL deve começar com http:// ou https://.";
      break;
    }
    case "tcp":
      if (!f.tcpHostname.trim()) return "Informe o hostname.";
      if (!(Number(f.tcpPort) >= 1 && Number(f.tcpPort) <= 65535)) return "Porta inválida (1–65535).";
      break;
    case "ping":
      if (!f.pingHostname.trim()) return "Informe o hostname.";
      if (!(Number(f.packets) >= 1 && Number(f.packets) <= 10)) return "Máximo de pacotes: 1 a 10.";
      break;
    case "dns":
      if (!f.dnsHostname.trim()) return "Informe o hostname.";
      if (f.resolvers.filter((r) => r.trim()).length === 0) return "Informe ao menos um servidor de resolução.";
      break;
    case "domain": {
      const domain = f.domainName.trim().replace(/\.$/, "");
      if (!domain.includes(".") || domain.includes("://") || /[/?#@]/.test(domain))
        return "Informe apenas o domínio registrável, como exemplo.com.";
      break;
    }
    case "postgresql":
    case "mysql":
    case "mongodb":
    case "redis":
    case "rabbitmq":
      if (f.connectionMode === "uri") {
        const uri = f.connectionUri.trim();
        if (!uri) return "Informe a URI de conexão.";
        if (uri !== "********") {
          const scheme = uri.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase() || "";
          if (!CONNECTION_URI_SCHEMES[f.type].includes(scheme))
            return `A URI deve usar: ${CONNECTION_URI_SCHEMES[f.type].join(", ")}.`;
        }
      } else {
        if (!f.connectionHost.trim()) return "Informe o host da conexão.";
        if (!(Number(f.connectionPort) >= 1 && Number(f.connectionPort) <= 65535))
          return "Porta inválida (1–65535).";
        if (f.type === "redis" && f.connectionDatabase
          && (!Number.isInteger(Number(f.connectionDatabase)) || Number(f.connectionDatabase) < 0))
          return "O database do Redis deve ser um número inteiro não negativo.";
      }
      break;
    case "container":
      if (!f.containerName.trim()) return "Informe o container.";
      break;
  }
  if (f.type !== "domain") {
    const interval = Number(f.intervalSeconds);
    if (!Number.isFinite(interval) || interval < INTERVAL_MIN || interval > INTERVAL_MAX)
      return `O intervalo deve estar entre ${INTERVAL_MIN}s e ${INTERVAL_MAX}s (1 dia).`;
    const retries = Number(f.maxRetries);
    if (!Number.isFinite(retries) || retries < 0 || retries > 1000)
      return "As falhas devem estar entre 0 e 1000.";
  }
  if (TIMEOUT_TYPES.includes(f.type)) {
    const timeout = Number(f.timeoutSeconds);
    const cap = timeoutCap(f.intervalSeconds);
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > cap)
      return `O timeout deve ser no máximo 80% do intervalo (≤ ${cap}s).`;
  }
  if (f.latencyDetectionEnabled && f.type !== "domain" && f.type !== "container") {
    const threshold = Number(f.latencyThresholdMs);
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 600000)
      return "O limite de resposta deve estar entre 1 e 600000 ms.";
    if (!LATENCY_WINDOW_OPTIONS.includes(Number(f.latencyWindowSeconds) as typeof LATENCY_WINDOW_OPTIONS[number]))
      return "Selecione um intervalo válido para identificar lentidão.";
  }
  if (f.resendEnabled) {
    const r = Number(f.resendEvery);
    if (!Number.isFinite(r) || r < RESEND_MIN || r > RESEND_MAX)
      return `Reenviar notificação: valor entre ${RESEND_MIN} e ${RESEND_MAX}.`;
  }
  return null;
}
