// Monta a config nginx de um server block a partir do formulário amigável.

export type HeaderEntry = {
  name: string;
  value: string;
};

export type CacheRoute = {
  path: string;        // prefixo de URL a cachear (ex.: /api)
  dedicated: boolean;  // zona própria (proxy_cache_path) desta rota
};

export type LocationRule = {
  path: string;
  handler: "proxy" | "static" | "json";
  proxyPass: string;
  proxyHostHeader: string;
  root: string;
  index: string;
  jsonStatus: string;
  jsonBody: string;
};

export type ServerForm = {
  // Rede
  serverName: string;
  listen: string;
  ipv6: boolean;
  serverRoot: string;
  charset: string;
  serverIndex: string;
  autoindex: boolean;
  autoindexExactSize: boolean;
  autoindexLocaltime: boolean;
  autoindexFormat: string;
  // SSL
  ssl: boolean;
  certMode: "select" | "path";
  certName: string; // certificado selecionado (página de Certificados)
  certPath: string;
  keyPath: string;
  http2: boolean;
  http3: boolean;
  tlsAdvanced: boolean;
  sslProtocols: string;
  sslCiphers: string;
  sslPreferServerCiphers: boolean;
  sslSessionCache: string;
  sslSessionTimeout: string;
  ocspStapling: boolean;
  // Conteúdo
  handler: "proxy" | "static" | "json" | "php" | "none";
  proxyMode: "upstream" | "custom";
  proxyUpstream: string; // nome do upstream selecionado
  proxyPass: string;     // destino custom
  root: string;
  index: string;
  websocket: boolean;
  extraLocations: LocationRule[];
  phpTryFiles: string;
  phpInclude: string;
  phpFastcgiPass: string;
  phpScriptFilename: string;
  // Resposta JSON (handler = "json"): return <status> '<body>' + default_type
  jsonStatus: string;
  jsonBody: string;
  // Compressão
  gzip: boolean;
  gzipLevel: string;
  brotli: boolean;
  brotliLevel: string;
  zstd: boolean;
  zstdLevel: string;
  // Limites e timeouts
  clientMaxBodySize: string;
  clientBodyBufferSize: string;
  clientBodyTimeout: string;
  clientHeaderTimeout: string;
  bandwidthLimitEnabled: boolean;
  bandwidthLimitRate: string;
  bandwidthLimitAfter: string;
  // Headers
  securityHeaderFrameOptions: boolean;
  securityHeaderContentTypeOptions: boolean;
  securityHeaderXssProtection: boolean;
  securityHeaderReferrerPolicy: boolean;
  hsts: boolean;
  hstsMaxAge: string;
  hstsIncludeSubDomains: boolean;
  hstsPreload: boolean;
  hstsAlways: boolean;
  cors: boolean;
  corsOrigin: string;
  corsMethods: string;
  corsHeaders: string;
  corsCredentials: boolean;
  corsMaxAge: string;
  corsExposeHeaders: string;
  hideServer: boolean;
  cspEnabled: boolean;
  cspValue: string;
  permissionsPolicyEnabled: boolean;
  permissionsPolicyValue: string;
  coopEnabled: boolean;
  coopValue: string;
  coepEnabled: boolean;
  coepValue: string;
  corpEnabled: boolean;
  corpValue: string;
  cacheControlEnabled: boolean;
  cacheControlValue: string;
  varyEnabled: boolean;
  varyValue: string;
  xRobotsTagEnabled: boolean;
  xRobotsTagValue: string;
  clearSiteDataEnabled: boolean;
  clearSiteDataValue: string;
  contentDispositionEnabled: boolean;
  contentDispositionValue: string;
  crossDomainPoliciesEnabled: boolean;
  crossDomainPoliciesValue: string;
  dnsPrefetchControlEnabled: boolean;
  dnsPrefetchControlValue: string;
  customHeaders: HeaderEntry[]; // um add_header por item
  proxyHostHeader: string; // valor de proxy_set_header Host (proxy); padrão $host
  extraProxyHeaders: HeaderEntry[]; // um proxy_set_header por item (proxy)
  // Cache do navegador (arquivos estáticos)
  browserCache: boolean;
  browserCacheExpires: string;
  // Cache reverso (proxy_cache). Por padrão usa a zona compartilhada
  // "nexus_cache" (definida no http{} do nginx.conf); com `cacheDedicated`
  // o server ganha uma zona própria via proxy_cache_path (contexto http,
  // escrito ao lado do server{} no mesmo arquivo).
  cacheEnabled: boolean;
  cacheValid: string;
  cacheKey: string;
  cacheMinUses: string;
  cacheLock: boolean;
  cacheBypass: boolean;
  // Rotas a cachear (vazio = cacheia o server inteiro). Cada rota vira uma
  // entrada num `map $uri $<zonevar>` (contexto http) que escolhe a zona por
  // URI (proxy_cache aceita variável): "" = sem cache, "nexus_cache" =
  // compartilhada, "<slug>_cache" = zona dedicada da rota (proxy_cache_path
  // próprio, limpável separadamente). `dedicated` liga a zona própria da rota.
  cacheRoutes: CacheRoute[];
  // Zona de cache dedicada (proxy_cache_path próprio deste server)
  cacheDedicated: boolean;
  cachePath: string;      // vazio ⇒ derivado (/var/cache/nginx/<zona>)
  cacheZone: string;      // vazio ⇒ derivado (<server_name>_cache)
  cacheZoneSize: string;  // keys_zone (memória p/ chaves)
  cacheMaxSize: string;
  cacheInactive: string;
  cacheLevels: string;
  cacheUseTempPath: boolean;
  // Rate limit (limit_req). A zona (limit_req_zone) fica no contexto http,
  // escrita ao lado do server{} no mesmo arquivo (como o proxy_cache_path).
  rateLimitEnabled: boolean;
  rateLimitKey: string;      // chave da zona (ex.: $binary_remote_addr)
  rateLimitRate: string;     // taxa base (ex.: 10r/s)
  rateLimitBurst: string;    // rajada tolerada (ex.: 20)
  rateLimitNodelay: boolean; // processa a rajada sem enfileirar (sem atraso)
  rateLimitZoneSize: string; // memória da zona (ex.: 10m)
  // Access control
  accessControlEnabled: boolean;
  allowCidrs: string[];
  denyCidrs: string[];
  basicAuthEnabled: boolean;
  basicAuthRealm: string;
  basicAuthUserFile: string;
  // WAF simples
  wafEnabled: boolean;
  wafBlockedMethods: string;
  wafBlockedUserAgents: string[];
  wafBlockedPaths: string[];
  // Logs
  logMode: "default" | "custom" | "off";
  logPath: string;
  logFormat: string;
  // error_log por server (default = herda o global do nginx.conf)
  errorLogMode: "default" | "custom" | "off";
  errorLogPath: string;
  errorLogLevel: string;
};

export const emptyServerForm: ServerForm = {
  serverName: "",
  listen: "80",
  ipv6: false,
  serverRoot: "",
  charset: "utf-8",
  serverIndex: "",
  autoindex: false,
  autoindexExactSize: true,
  autoindexLocaltime: false,
  autoindexFormat: "html",
  ssl: false,
  certMode: "select",
  certName: "",
  certPath: "",
  keyPath: "",
  http2: false,
  http3: false,
  tlsAdvanced: false,
  sslProtocols: "TLSv1.2 TLSv1.3",
  sslCiphers: "",
  sslPreferServerCiphers: false,
  sslSessionCache: "shared:SSL:10m",
  sslSessionTimeout: "10m",
  ocspStapling: false,
  handler: "proxy",
  proxyMode: "upstream",
  proxyUpstream: "",
  proxyPass: "",
  root: "",
  index: "index.html",
  websocket: false,
  extraLocations: [],
  phpTryFiles: "$uri $uri/ /index.php?$query_string",
  phpInclude: "fastcgi_params",
  phpFastcgiPass: "",
  phpScriptFilename: "$document_root$fastcgi_script_name",
  jsonStatus: "200",
  jsonBody: '{"status":"ok"}',
  gzip: false,
  gzipLevel: "5",
  brotli: false,
  brotliLevel: "5",
  zstd: false,
  zstdLevel: "3",
  clientMaxBodySize: "",
  clientBodyBufferSize: "",
  clientBodyTimeout: "",
  clientHeaderTimeout: "",
  bandwidthLimitEnabled: false,
  bandwidthLimitRate: "1m",
  bandwidthLimitAfter: "",
  securityHeaderFrameOptions: false,
  securityHeaderContentTypeOptions: false,
  securityHeaderXssProtection: false,
  securityHeaderReferrerPolicy: false,
  hsts: false,
  hstsMaxAge: "31536000",
  hstsIncludeSubDomains: true,
  hstsPreload: false,
  hstsAlways: true,
  cors: false,
  corsOrigin: "*",
  corsMethods: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  corsHeaders: "*",
  corsCredentials: true,
  corsMaxAge: "",
  corsExposeHeaders: "",
  hideServer: false,
  cspEnabled: false,
  cspValue: "default-src 'self'; frame-ancestors 'self'; object-src 'none'",
  permissionsPolicyEnabled: false,
  permissionsPolicyValue: "camera=(), microphone=(), geolocation=()",
  coopEnabled: false,
  coopValue: "same-origin",
  coepEnabled: false,
  coepValue: "require-corp",
  corpEnabled: false,
  corpValue: "same-origin",
  cacheControlEnabled: false,
  cacheControlValue: "no-store",
  varyEnabled: false,
  varyValue: "Accept-Encoding",
  xRobotsTagEnabled: false,
  xRobotsTagValue: "noindex, nofollow",
  clearSiteDataEnabled: false,
  clearSiteDataValue: '"cache", "cookies", "storage"',
  contentDispositionEnabled: false,
  contentDispositionValue: "inline",
  crossDomainPoliciesEnabled: false,
  crossDomainPoliciesValue: "none",
  dnsPrefetchControlEnabled: false,
  dnsPrefetchControlValue: "off",
  customHeaders: [],
  proxyHostHeader: "$host",
  extraProxyHeaders: [],
  browserCache: false,
  browserCacheExpires: "7d",
  cacheEnabled: false,
  cacheValid: "200 301 302 10m",
  cacheKey: "",
  cacheMinUses: "1",
  cacheLock: false,
  cacheBypass: false,
  cacheRoutes: [],
  cacheDedicated: false,
  cachePath: "",
  cacheZone: "",
  cacheZoneSize: "10m",
  cacheMaxSize: "1g",
  cacheInactive: "60m",
  cacheLevels: "1:2",
  cacheUseTempPath: false,
  rateLimitEnabled: false,
  rateLimitKey: "$binary_remote_addr",
  rateLimitRate: "10r/s",
  rateLimitBurst: "20",
  rateLimitNodelay: true,
  rateLimitZoneSize: "10m",
  accessControlEnabled: false,
  allowCidrs: [],
  denyCidrs: [],
  basicAuthEnabled: false,
  basicAuthRealm: "Restricted",
  basicAuthUserFile: "/etc/nginx/.htpasswd",
  wafEnabled: false,
  wafBlockedMethods: "",
  wafBlockedUserAgents: [],
  wafBlockedPaths: [],
  logMode: "default",
  logPath: "/var/log/nginx/access.log",
  logFormat: "nexus",
  errorLogMode: "default",
  errorLogPath: "/var/log/nexus/nginx.log",
  errorLogLevel: "error",
};

const SIZE = /^\d+[kKmMgG]?$/;
const TIME = /^\d+(ms|s|m|h|d)?$/;
const EXPIRES = /^(-?\d+(ms|s|m|h|d|w|M|y)?|max|off|epoch)$/;
const CACHE_VALID = /^([A-Za-z0-9]+\s+)+\d+(ms|s|m|h|d)$/;
const CACHE_ZONE = /^[A-Za-z0-9_]+$/;
const CACHE_LEVELS = /^[12](:[12]){0,2}$/;
const RATE = /^\d+r\/[sm]$/;

/** Slug do 1º server_name (base p/ nomes de zona derivados). */
function serverSlug(f: ServerForm): string {
  const first = f.serverName.trim().split(/\s+/)[0] ?? "";
  return first.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "server";
}

/** Nome da zona de rate limit (limit_req_zone), derivado do server_name. */
export function rateZoneName(f: ServerForm): string {
  return `${serverSlug(f)}_rl`;
}

/** Regra: porta 443 ⇒ SSL obrigatório. */
export function sslRequired(f: ServerForm): boolean {
  return f.listen.trim() === "443";
}

/** Nome da zona de cache dedicada (derivado do server_name se não informado). */
export function cacheZoneName(f: ServerForm): string {
  if (f.cacheZone.trim()) return f.cacheZone.trim();
  const first = f.serverName.trim().split(/\s+/)[0] ?? "";
  const slug = first.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return `${slug || "server"}_cache`;
}

/** Caminho do proxy_cache_path dedicado (derivado da zona se não informado). */
export function cachePathFor(f: ServerForm): string {
  return f.cachePath.trim() || `/var/cache/nginx/zones/${cacheZoneName(f)}`;
}

/** Nome da variável do `map $uri` que escolhe a zona por rota (único por server). */
export function cacheZoneVar(f: ServerForm): string {
  return `nexus_cachezone_${serverSlug(f)}`;
}

/** Rotas de cache efetivas (path aparado, sem vazios). */
export function cacheRoutesOf(f: ServerForm): CacheRoute[] {
  return (f.cacheRoutes ?? [])
    .map((r) => ({ path: r.path.trim(), dedicated: !!r.dedicated }))
    .filter((r) => r.path);
}

/** Nome da zona dedicada de uma rota (derivado de server + path). */
export function routeZoneName(f: ServerForm, path: string): string {
  const slug = path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return `${serverSlug(f)}_${slug || "root"}_cache`;
}

/** Zona efetiva de uma rota: dedicada (própria) ou a compartilhada. */
export function routeZone(f: ServerForm, r: CacheRoute): string {
  return r.dedicated ? routeZoneName(f, r.path) : "nexus_cache";
}

export function validateServerForm(f: ServerForm): string | null {
  const names = f.serverName.trim().split(/\s+/).filter(Boolean);
  if (!names.length) return "server_name é obrigatório";
  for (const n of names) {
    if (!/^(\*\.)?[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?$|^_$/.test(n))
      return `server_name inválido: ${n}`;
  }
  const port = Number(f.listen.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return "listen (porta) deve ser 1–65535";

  const needSsl = f.ssl || sslRequired(f);
  if (needSsl) {
    if (f.certMode === "select" && !f.certName.trim())
      return "SSL habilitado: selecione um certificado";
    if (f.certMode === "path") {
      if (!f.certPath.trim()) return "SSL habilitado: informe o certificado";
      if (!f.keyPath.trim()) return "SSL habilitado: informe a chave do certificado";
    }
  }
  if (f.http3 && !needSsl) return "HTTP/3 requer SSL";
  if (f.tlsAdvanced && needSsl) {
    if (!f.sslProtocols.trim()) return "SSL/TLS: informe ssl_protocols";
    if (f.sslSessionTimeout.trim() && !TIME.test(f.sslSessionTimeout.trim()))
      return "SSL/TLS: ssl_session_timeout inválido (ex.: 10m)";
  }
  if (f.handler === "proxy") {
    if (f.proxyMode === "upstream" && !f.proxyUpstream.trim())
      return "Proxy: selecione um upstream";
    if (f.proxyMode === "custom" && !f.proxyPass.trim())
      return "Proxy: informe o destino (proxy_pass)";
  }
  if (f.handler === "static" && !f.root.trim())
    return "Estático: informe o diretório root";
  if (f.handler === "php") {
    if (!f.phpTryFiles.trim()) return "PHP/FastCGI: informe try_files";
    if (!f.phpInclude.trim()) return "PHP/FastCGI: informe include";
    if (!f.phpFastcgiPass.trim()) return "PHP/FastCGI: informe fastcgi_pass";
    if (!f.phpScriptFilename.trim()) return "PHP/FastCGI: informe SCRIPT_FILENAME";
  }
  if (f.handler === "json") {
    const st = Number(f.jsonStatus.trim());
    if (!Number.isInteger(st) || st < 100 || st > 599)
      return "JSON: status HTTP deve ser 100–599";
    if (!f.jsonBody.trim()) return "JSON: informe o corpo da resposta";
    try {
      JSON.parse(f.jsonBody.trim());
    } catch {
      return "JSON: corpo não é um JSON válido";
    }
  }
  for (const loc of f.extraLocations) {
    if (!loc.path.trim().startsWith("/")) return "Locations: path deve começar com /";
    if (loc.handler === "proxy" && !loc.proxyPass.trim()) return `Location ${loc.path}: informe proxy_pass`;
    if (loc.handler === "static" && !loc.root.trim()) return `Location ${loc.path}: informe root`;
    if (loc.handler === "json") {
      const st = Number(loc.jsonStatus.trim());
      if (!Number.isInteger(st) || st < 100 || st > 599)
        return `Location ${loc.path}: status HTTP deve ser 100–599`;
      try {
        JSON.parse(loc.jsonBody.trim());
      } catch {
        return `Location ${loc.path}: corpo não é um JSON válido`;
      }
    }
  }

  if (f.clientMaxBodySize.trim() && !SIZE.test(f.clientMaxBodySize.trim()))
    return "client_max_body_size inválido (ex.: 500M)";
  if (f.clientBodyBufferSize.trim() && !SIZE.test(f.clientBodyBufferSize.trim()))
    return "client_body_buffer_size inválido (ex.: 128k)";
  if (f.clientBodyTimeout.trim() && !TIME.test(f.clientBodyTimeout.trim()))
    return "client_body_timeout inválido (ex.: 60s)";
  if (f.clientHeaderTimeout.trim() && !TIME.test(f.clientHeaderTimeout.trim()))
    return "client_header_timeout inválido (ex.: 15s)";
  if (f.bandwidthLimitEnabled) {
    if (!SIZE.test(f.bandwidthLimitRate.trim()))
      return "Limite de banda: limit_rate inválido (ex.: 1m, 512k)";
    if (f.bandwidthLimitAfter.trim() && !SIZE.test(f.bandwidthLimitAfter.trim()))
      return "Limite de banda: limit_rate_after inválido (ex.: 10m)";
  }
  if ([f.gzip, f.brotli, f.zstd].filter(Boolean).length > 1)
    return "Compressão: habilite apenas um algoritmo por vez";
  if (f.gzip && !/^(?:[1-9])$/.test(f.gzipLevel.trim()))
    return "gzip: nível de compressão deve ser de 1 a 9";
  if (f.brotli && !/^(?:[1-9]|1[01])$/.test(f.brotliLevel.trim()))
    return "brotli: nível de compressão deve ser de 1 a 11";
  if (f.zstd && !/^(?:[1-9]|1[0-9]|2[0-2])$/.test(f.zstdLevel.trim()))
    return "zstd: nível de compressão deve ser de 1 a 22";
  if (f.hsts) {
    const maxAge = Number(f.hstsMaxAge.trim());
    if (!Number.isInteger(maxAge) || maxAge < 0)
      return "HSTS: max-age deve ser um inteiro maior ou igual a 0";
  }

  if (f.logMode === "custom" && !f.logPath.trim()) return "Logs: informe o caminho do access_log";
  if (f.errorLogMode === "custom" && !f.errorLogPath.trim())
    return "Logs: informe o caminho do error_log";

  if (f.rateLimitEnabled) {
    if (!RATE.test(f.rateLimitRate.trim())) return "Rate limit: taxa inválida (ex.: 10r/s)";
    if (f.rateLimitBurst.trim() && !/^\d+$/.test(f.rateLimitBurst.trim()))
      return "Rate limit: burst deve ser inteiro";
    if (!SIZE.test(f.rateLimitZoneSize.trim() || "10m"))
      return "Rate limit: tamanho da zona inválido (ex.: 10m)";
    if (!f.rateLimitKey.trim()) return "Rate limit: informe a chave da zona";
  }
  if (f.accessControlEnabled) {
    const cidr = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[A-Fa-f0-9:]+(\/\d{1,3})?$|^all$/;
    for (const item of [...f.allowCidrs, ...f.denyCidrs].map((v) => v.trim()).filter(Boolean)) {
      if (!cidr.test(item)) return `Access control: IP/CIDR inválido (${item})`;
    }
    if (f.basicAuthEnabled && !f.basicAuthUserFile.trim())
      return "Access control: informe auth_basic_user_file";
  }

  for (const h of f.customHeaders) {
    if ((h.name.trim() && !h.value.trim()) || (!h.name.trim() && h.value.trim()))
      return "Headers customizados: preencha nome e valor, ou remova a linha";
  }
  for (const h of f.extraProxyHeaders) {
    if ((h.name.trim() && !h.value.trim()) || (!h.name.trim() && h.value.trim()))
      return "proxy_set_header extras: preencha nome e valor, ou remova a linha";
  }

  if (f.cors) {
    if (!f.corsOrigin.trim()) return "CORS: informe a origem (ou * para qualquer)";
    if (!f.corsMethods.trim()) return "CORS: informe os métodos permitidos";
    if (!f.corsHeaders.trim()) return "CORS: informe os headers permitidos";
    if (f.corsMaxAge.trim() && !/^\d+$/.test(f.corsMaxAge.trim()))
      return "CORS: Max-Age deve ser um número em segundos";
  }
  const requiredHeaders: Array<[boolean, string, string]> = [
    [f.cspEnabled, f.cspValue, "Content-Security-Policy"],
    [f.permissionsPolicyEnabled, f.permissionsPolicyValue, "Permissions-Policy"],
    [f.coopEnabled, f.coopValue, "Cross-Origin-Opener-Policy"],
    [f.coepEnabled, f.coepValue, "Cross-Origin-Embedder-Policy"],
    [f.corpEnabled, f.corpValue, "Cross-Origin-Resource-Policy"],
    [f.cacheControlEnabled, f.cacheControlValue, "Cache-Control"],
    [f.varyEnabled, f.varyValue, "Vary"],
    [f.xRobotsTagEnabled, f.xRobotsTagValue, "X-Robots-Tag"],
    [f.clearSiteDataEnabled, f.clearSiteDataValue, "Clear-Site-Data"],
    [f.contentDispositionEnabled, f.contentDispositionValue, "Content-Disposition"],
    [f.crossDomainPoliciesEnabled, f.crossDomainPoliciesValue, "X-Permitted-Cross-Domain-Policies"],
    [f.dnsPrefetchControlEnabled, f.dnsPrefetchControlValue, "X-DNS-Prefetch-Control"],
  ];
  for (const [enabled, value, label] of requiredHeaders) {
    if (enabled && !value.trim()) return `${label}: informe o valor do header`;
  }
  if (f.browserCache && f.browserCacheExpires.trim() && !EXPIRES.test(f.browserCacheExpires.trim()))
    return "Cache do navegador: expires inválido (ex.: 7d, max, off)";
  if (f.cacheEnabled && f.handler === "proxy") {
    if (f.cacheValid.trim() && !CACHE_VALID.test(f.cacheValid.trim()))
      return "Cache: proxy_cache_valid inválido (ex.: 200 301 302 10m)";
    if (f.cacheMinUses.trim() && !/^\d+$/.test(f.cacheMinUses.trim()))
      return "Cache: proxy_cache_min_uses deve ser inteiro";
    for (const r of cacheRoutesOf(f)) {
      if (/\s/.test(r.path)) return `Cache: rota inválida (sem espaços): ${r.path}`;
      if (!r.path.startsWith("/")) return `Cache: rota deve começar com '/': ${r.path}`;
    }
    if (f.cacheDedicated) {
      if (f.cacheZone.trim() && !CACHE_ZONE.test(f.cacheZone.trim()))
        return "Cache: nome da zona inválido (só letras, números e _)";
      if (f.cachePath.trim() && !f.cachePath.trim().startsWith("/"))
        return "Cache: caminho (cache_path) deve ser absoluto";
      if (!CACHE_LEVELS.test(f.cacheLevels.trim() || "1:2"))
        return "Cache: levels inválido (ex.: 1:2)";
      if (!SIZE.test(f.cacheZoneSize.trim() || "10m"))
        return "Cache: tamanho da keys_zone inválido (ex.: 10m)";
      if (!SIZE.test(f.cacheMaxSize.trim() || "1g"))
        return "Cache: max_size inválido (ex.: 1g)";
      if (!TIME.test(f.cacheInactive.trim() || "60m"))
        return "Cache: inactive inválido (ex.: 60m)";
    }
  }
  return null;
}

function headerLines(headers: HeaderEntry[]): string[] {
  return headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name && h.value)
    .map((h) => `add_header ${h.name} ${h.value};`);
}

function quoteHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '""';
  if (trimmed.startsWith("$")) return trimmed;
  const unquoted = trimmed.replace(/^"|"$/g, "");
  return `"${unquoted.replace(/"/g, '\\"')}"`;
}

function cleanHeaderValue(args: string[]): string {
  return args.join(" ").replace(/^"|"$/g, "");
}

function proxyHeaderLines(headers: HeaderEntry[]): string[] {
  return headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name && h.value)
    .map((h) => `proxy_set_header ${h.name} ${h.value};`);
}

type Node = { type?: string; name?: string; args?: string[]; children?: Node[] };

function compactStrings(values: string[]): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
}

function isPhpFastcgiLocation(n: Node): boolean {
  return n.type === "block" && n.name === "location" && (n.args ?? []).join(" ").trim() === "~ \\.php$";
}

function parsePhpFastcgiLocation(n: Node, f: ServerForm): boolean {
  if (!isPhpFastcgiLocation(n)) return false;
  let hasFastcgi = false;
  for (const c of n.children ?? []) {
    if (c.type !== "directive" || !c.name) return false;
    const a = c.args ?? [];
    if (c.name === "include") {
      f.phpInclude = a.join(" ") || "fastcgi_params";
    } else if (c.name === "fastcgi_pass") {
      f.phpFastcgiPass = a.join(" ");
      hasFastcgi = true;
    } else if (c.name === "fastcgi_param" && a[0] === "SCRIPT_FILENAME") {
      f.phpScriptFilename = a.slice(1).join(" ") || "$document_root$fastcgi_script_name";
    } else {
      return false;
    }
  }
  return hasFastcgi;
}

function parseLocationRule(n: Node): LocationRule | null {
  const path = (n.args ?? []).join(" ").trim();
  if (!path || path === "/") return null;
  const rule: LocationRule = {
    path,
    handler: "proxy",
    proxyPass: "",
    proxyHostHeader: "$host",
    root: "",
    index: "index.html",
    jsonStatus: "200",
    jsonBody: '{"status":"ok"}',
  };
  let saw = false;
  let jsonType = false;
  let ret: { status: string; body: string } | null = null;
  for (const c of n.children ?? []) {
    if (c.type !== "directive" || !c.name) continue;
    const a = c.args ?? [];
    if (c.name === "proxy_pass") {
      rule.handler = "proxy";
      rule.proxyPass = a.join(" ");
      saw = true;
    } else if (c.name === "proxy_set_header" && a[0] === "Host") {
      rule.proxyHostHeader = a.slice(1).join(" ") || "$host";
    } else if (c.name === "root") {
      rule.handler = "static";
      rule.root = a[0] ?? "";
      saw = true;
    } else if (c.name === "index") {
      rule.index = a[0] ?? "";
    } else if (c.name === "default_type") {
      jsonType = a[0] === "application/json";
    } else if (c.name === "return") {
      ret = { status: a[0] ?? "200", body: a.slice(1).join(" ") };
      saw = true;
    }
  }
  if (ret && jsonType) {
    rule.handler = "json";
    rule.jsonStatus = ret.status;
    rule.jsonBody = ret.body;
  }
  return saw ? rule : null;
}

function emitLocation(out: string[], loc: LocationRule): void {
  const l = (s: string) => out.push(`    ${s}`);
  out.push(`  location ${loc.path.trim()} {`);
  if (loc.handler === "proxy") {
    l(`proxy_pass ${loc.proxyPass.trim()};`);
    l(`proxy_set_header Host ${loc.proxyHostHeader?.trim() || "$host"};`);
    l("proxy_set_header X-Real-IP $remote_addr;");
    l("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    l("proxy_set_header X-Forwarded-Proto $scheme;");
  } else if (loc.handler === "static") {
    l(`root ${loc.root.trim()};`);
    l(`index ${loc.index.trim() || "index.html"};`);
    l("try_files $uri $uri/ =404;");
  } else {
    l("default_type application/json;");
    l(`return ${loc.jsonStatus.trim() || "200"} '${loc.jsonBody.trim() || '{"status":"ok"}'}';`);
  }
  out.push("  }");
}

const KNOWN_PROXY_HEADERS = new Set(["Host", "X-Real-IP", "X-Forwarded-For", "X-Forwarded-Proto"]);
const KNOWN_TOP = new Set([
  "listen", "server_name", "ssl_certificate", "ssl_certificate_key", "http2", "http3",
  "root", "charset", "index", "autoindex", "autoindex_exact_size", "autoindex_localtime", "autoindex_format",
  "ssl_protocols", "ssl_ciphers", "ssl_prefer_server_ciphers", "ssl_session_cache",
  "ssl_session_timeout", "ssl_stapling", "ssl_stapling_verify",
  "add_header", "client_max_body_size", "client_body_buffer_size", "client_body_timeout",
  "client_header_timeout", "gzip", "gzip_comp_level", "brotli", "brotli_comp_level",
  "zstd", "zstd_comp_level", "access_log", "error_log",
  "more_clear_headers", "limit_req", "limit_rate", "limit_rate_after", "allow", "deny",
  "auth_basic", "auth_basic_user_file", "if",
]);

/** Preenche os campos de rate limit a partir de um `limit_req_zone`. */
function parseRateZone(args: string[], f: ServerForm): void {
  f.rateLimitEnabled = true;
  if (args[0] && !args[0].includes("=")) f.rateLimitKey = args[0];
  for (const tok of args) {
    const [k, v] = tok.split("=", 2);
    if (k === "zone") {
      const [, size] = (v ?? "").split(":", 2);
      if (size) f.rateLimitZoneSize = size;
    } else if (k === "rate") f.rateLimitRate = v ?? "";
  }
}

/** Preenche os campos da zona dedicada a partir de um `proxy_cache_path`. */
function parseCachePath(args: string[], f: ServerForm): void {
  f.cacheDedicated = true;
  f.cacheUseTempPath = true; // default nginx; só vira false se vier use_temp_path=off
  if (args[0] && !args[0].includes("=")) f.cachePath = args[0];
  for (const tok of args) {
    const [k, v] = tok.split("=", 2);
    if (k === "levels") f.cacheLevels = v ?? "";
    else if (k === "keys_zone") {
      const [zone, size] = (v ?? "").split(":", 2);
      if (zone) f.cacheZone = zone;
      if (size) f.cacheZoneSize = size;
    } else if (k === "max_size") f.cacheMaxSize = v ?? "";
    else if (k === "inactive") f.cacheInactive = v ?? "";
    else if (k === "use_temp_path") f.cacheUseTempPath = v !== "off";
  }
}

/** Zona (keys_zone) de um `proxy_cache_path`. */
function cachePathZone(args: string[]): string {
  for (const tok of args) {
    const [k, v] = tok.split("=", 2);
    if (k === "keys_zone") return (v ?? "").split(":", 2)[0];
  }
  return "";
}

/** É o nosso map de zona por rota (`map $uri $nexus_cachezone_* { ... }`)? */
function isCacheZoneMap(node: Node): boolean {
  return node.type === "block" && node.name === "map"
    && (node.args?.[1] ?? "").startsWith("$nexus_cachezone_");
}

/** Lê as rotas do `map $uri $nexus_cachezone_*` (entradas `~^<rota> <zona>;`).
 * Devolve o conjunto de zonas dedicadas (para pular os proxy_cache_path delas). */
function parseCacheZoneMap(node: Node, f: ServerForm): Set<string> {
  const dedicatedZones = new Set<string>();
  for (const child of node.children ?? []) {
    if (child.type !== "directive" || !child.name?.startsWith("~^")) continue;
    const zone = (child.args ?? [])[0] ?? "";
    if (!zone || zone === '""' || zone === "default") continue;
    const dedicated = zone !== "nexus_cache";
    f.cacheRoutes.push({ path: child.name.slice(2), dedicated });
    if (dedicated) dedicatedZones.add(zone);
  }
  return dedicatedZones;
}

/** Parseia os nós de um server block em ServerForm. `faithful=false` quando há
 * diretivas/blocos que o formulário não representa 1:1 (abre em modo raw). */
export function parseServerForm(nodes: unknown[]): { form: ServerForm; faithful: boolean } {
  const f: ServerForm = {
    ...emptyServerForm,
    index: "",
    customHeaders: [],
    extraProxyHeaders: [],
    extraLocations: [],
    cacheRoutes: [],
    allowCidrs: [],
    denyCidrs: [],
    wafBlockedUserAgents: [],
    wafBlockedPaths: [],
  };
  let faithful = true;
  const customHeaders: HeaderEntry[] = [];

  // O corpo pode vir como o ARQUIVO inteiro (server{} + irmãos de contexto
  // http, ex.: proxy_cache_path) ou já como os filhos do server (compat).
  const all = nodes as Node[];
  const serverBlock = all.find((n) => n.type === "block" && n.name === "server");
  const items = serverBlock ? (serverBlock.children ?? []) : all;
  if (serverBlock) {
    // 1ª passada: o map de zona por rota (define quais zonas são de rota).
    const zoneMap = all.find((s) => s !== serverBlock && isCacheZoneMap(s));
    const routeZones = zoneMap ? parseCacheZoneMap(zoneMap, f) : new Set<string>();
    for (const s of all) {
      if (s === serverBlock || s === zoneMap || s.type === "comment") continue;
      if (s.type === "directive" && s.name === "proxy_cache_path") {
        // zonas de rota têm params fixos (derivados) — reconhecidas, não parseadas
        if (!routeZones.has(cachePathZone(s.args ?? []))) parseCachePath(s.args ?? [], f);
      } else if (s.type === "directive" && s.name === "limit_req_zone") parseRateZone(s.args ?? [], f);
      else faithful = false; // irmão http-level que o form não representa
    }
  }

  const listens = items.filter((n) => n.type === "directive" && n.name === "listen");
  const location = items.find((n) => n.type === "block" && n.name === "location");
  const phpLocation = items.find(isPhpFastcgiLocation);

  for (const n of items) {
    if (n.type === "comment") continue; // comentários são cosméticos (ignorados)
    if (n.type === "block") {
      if (n === phpLocation) continue;
      if (n.name === "location" && (n.args ?? []).join(" ") !== "/") {
        const loc = parseLocationRule(n);
        if (loc) f.extraLocations.push(loc);
        else faithful = false;
      } else if (!(n.name === "location" && (n.args ?? []).join(" ") === "/")) faithful = false;
      continue; // location tratado abaixo
    }
    if (n.type !== "directive" || !n.name) { faithful = false; continue; }
    const a = n.args ?? [];
    if (!KNOWN_TOP.has(n.name)) { faithful = false; continue; }
    switch (n.name) {
      case "listen": break; // tratado depois
      case "server_name": f.serverName = a.join(" "); break;
      case "root": f.serverRoot = a[0] ?? ""; break;
      case "charset": f.charset = a.join(" "); break;
      case "index": f.serverIndex = a.join(" "); break;
      case "autoindex": f.autoindex = a[0] === "on"; break;
      case "autoindex_exact_size": f.autoindexExactSize = a[0] !== "off"; break;
      case "autoindex_localtime": f.autoindexLocaltime = a[0] === "on"; break;
      case "autoindex_format": f.autoindexFormat = a[0] ?? "html"; break;
      case "ssl_certificate": f.ssl = true; f.certMode = "path"; f.certPath = a[0] ?? ""; break;
      case "ssl_certificate_key": f.keyPath = a[0] ?? ""; break;
      case "http2": f.http2 = a[0] === "on"; break;
      case "http3": f.http3 = a[0] === "on"; break;
      case "ssl_protocols": f.tlsAdvanced = true; f.sslProtocols = a.join(" "); break;
      case "ssl_ciphers": f.tlsAdvanced = true; f.sslCiphers = a.join(" "); break;
      case "ssl_prefer_server_ciphers": f.tlsAdvanced = true; f.sslPreferServerCiphers = a[0] === "on"; break;
      case "ssl_session_cache": f.tlsAdvanced = true; f.sslSessionCache = a.join(" "); break;
      case "ssl_session_timeout": f.tlsAdvanced = true; f.sslSessionTimeout = a[0] ?? ""; break;
      case "ssl_stapling": f.tlsAdvanced = true; f.ocspStapling = a[0] === "on"; break;
      case "ssl_stapling_verify": break;
      case "gzip": f.gzip = a[0] === "on"; break;
      case "gzip_comp_level": f.gzip = true; f.gzipLevel = a[0] ?? "5"; break;
      case "brotli": f.brotli = a[0] === "on"; break;
      case "brotli_comp_level": f.brotli = true; f.brotliLevel = a[0] ?? "5"; break;
      case "zstd": f.zstd = a[0] === "on"; break;
      case "zstd_comp_level": f.zstd = true; f.zstdLevel = a[0] ?? "3"; break;
      case "client_max_body_size": f.clientMaxBodySize = a[0] ?? ""; break;
      case "client_body_buffer_size": f.clientBodyBufferSize = a[0] ?? ""; break;
      case "client_body_timeout": f.clientBodyTimeout = a[0] ?? ""; break;
      case "client_header_timeout": f.clientHeaderTimeout = a[0] ?? ""; break;
      case "limit_rate":
        f.bandwidthLimitEnabled = true;
        f.bandwidthLimitRate = a[0] ?? "";
        break;
      case "limit_rate_after":
        f.bandwidthLimitEnabled = true;
        f.bandwidthLimitAfter = a[0] ?? "";
        break;
      case "allow":
        f.accessControlEnabled = true;
        f.allowCidrs.push(a[0] ?? "");
        break;
      case "deny":
        f.accessControlEnabled = true;
        f.denyCidrs.push(a[0] ?? "");
        break;
      case "auth_basic":
        f.accessControlEnabled = true;
        f.basicAuthEnabled = a[0] !== "off";
        f.basicAuthRealm = a.join(" ").replace(/^"|"$/g, "") || "Restricted";
        break;
      case "auth_basic_user_file":
        f.accessControlEnabled = true;
        f.basicAuthEnabled = true;
        f.basicAuthUserFile = a[0] ?? "";
        break;
      case "if":
        f.wafEnabled = true;
        faithful = false;
        break;
      case "add_header":
        if (a[0] === "Alt-Svc") break; // gerado junto do http3
        if (a[0] === "Strict-Transport-Security") {
          const value = (a[1] ?? "").replace(/^"|"$/g, "");
          const maxAge = value.match(/max-age=(\d+)/i);
          f.hsts = true;
          if (maxAge) f.hstsMaxAge = maxAge[1];
          f.hstsIncludeSubDomains = /(?:^|;\s*)includeSubDomains(?:;|$)/i.test(value);
          f.hstsPreload = /(?:^|;\s*)preload(?:;|$)/i.test(value);
          f.hstsAlways = a.includes("always");
          break;
        }
        if (a[0] === "Access-Control-Allow-Origin") { f.cors = true; f.corsOrigin = cleanHeaderValue(a.slice(1)) || "*"; break; }
        if (a[0] === "Access-Control-Allow-Methods") { f.cors = true; f.corsMethods = cleanHeaderValue(a.slice(1)); break; }
        if (a[0] === "Access-Control-Allow-Headers") { f.cors = true; f.corsHeaders = cleanHeaderValue(a.slice(1)); break; }
        if (a[0] === "Access-Control-Allow-Credentials") { f.cors = true; f.corsCredentials = cleanHeaderValue(a.slice(1)) !== "false"; break; }
        if (a[0] === "Access-Control-Max-Age") { f.cors = true; f.corsMaxAge = cleanHeaderValue(a.slice(1)); break; }
        if (a[0] === "Access-Control-Expose-Headers") { f.cors = true; f.corsExposeHeaders = cleanHeaderValue(a.slice(1)); break; }
        if (a[0] === "X-Frame-Options") f.securityHeaderFrameOptions = true;
        else if (a[0] === "X-Content-Type-Options") f.securityHeaderContentTypeOptions = true;
        else if (a[0] === "X-XSS-Protection") f.securityHeaderXssProtection = true;
        else if (a[0] === "Referrer-Policy") f.securityHeaderReferrerPolicy = true;
        else if (a[0] === "Content-Security-Policy") { f.cspEnabled = true; f.cspValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Permissions-Policy") { f.permissionsPolicyEnabled = true; f.permissionsPolicyValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Cross-Origin-Opener-Policy") { f.coopEnabled = true; f.coopValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Cross-Origin-Embedder-Policy") { f.coepEnabled = true; f.coepValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Cross-Origin-Resource-Policy") { f.corpEnabled = true; f.corpValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Cache-Control") { f.cacheControlEnabled = true; f.cacheControlValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Vary") { f.varyEnabled = true; f.varyValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "X-Robots-Tag") { f.xRobotsTagEnabled = true; f.xRobotsTagValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Clear-Site-Data") { f.clearSiteDataEnabled = true; f.clearSiteDataValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "Content-Disposition") { f.contentDispositionEnabled = true; f.contentDispositionValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "X-Permitted-Cross-Domain-Policies") { f.crossDomainPoliciesEnabled = true; f.crossDomainPoliciesValue = cleanHeaderValue(a.slice(1)); }
        else if (a[0] === "X-DNS-Prefetch-Control") { f.dnsPrefetchControlEnabled = true; f.dnsPrefetchControlValue = cleanHeaderValue(a.slice(1)); }
        else customHeaders.push({ name: a[0] ?? "", value: a.slice(1).join(" ") });
        break;
      case "more_clear_headers":
        if (a[0] === "Server") f.hideServer = true;
        else faithful = false;
        break;
      case "access_log":
        if ((a[0] ?? "") === "off") f.logMode = "off";
        else { f.logMode = "custom"; f.logPath = a[0] ?? ""; f.logFormat = a[1] ?? "nexus"; }
        break;
      case "error_log":
        if (a[0] === "/dev/null") f.errorLogMode = "off";
        else { f.errorLogMode = "custom"; f.errorLogPath = a[0] ?? ""; f.errorLogLevel = a[1] ?? "error"; }
        break;
      case "limit_req":
        f.rateLimitEnabled = true;
        f.rateLimitNodelay = a.includes("nodelay");
        for (const tok of a) {
          const [k, v] = tok.split("=", 2);
          if (k === "burst") f.rateLimitBurst = v ?? "";
        }
        break;
    }
  }

  // listen → porta, ssl, ipv6, http3 (flags conhecidas: ssl/quic/reuseport)
  for (const l of listens) {
    const a = l.args ?? [];
    const addr = a[0] ?? "";
    if (addr.startsWith("[::]")) f.ipv6 = true;
    for (const flag of a.slice(1)) {
      if (flag === "ssl") f.ssl = true;
      else if (flag === "quic") f.http3 = true;
      else if (flag === "reuseport") { /* ok */ }
      else faithful = false; // flag não representada (default_server, backlog=…)
    }
    if (!addr.includes("quic")) {
      const port = addr.replace(/^\[::\]:/, "");
      if (/^\d+$/.test(port)) f.listen = port;
    }
  }

  // location / → handler + proxy/static/return
  const extraProxyHeaders: HeaderEntry[] = [];
  if (location) {
    let sawContent = false;
    let jsonType = false;
    let ret: { status: string; body: string } | null = null;
    for (const c of location.children ?? []) {
      if (c.type === "comment") continue;
      if (c.type !== "directive" || !c.name) { faithful = false; continue; }
      const a = c.args ?? [];
      switch (c.name) {
        case "proxy_pass":
          f.handler = "proxy"; f.proxyMode = "custom"; f.proxyPass = a.join(" "); sawContent = true;
          break;
        case "proxy_set_header":
          if (a[0] === "Upgrade" || a[0] === "Connection") f.websocket = true;
          else if (a[0] === "Host") f.proxyHostHeader = a.slice(1).join(" ") || "$host";
          else if (!KNOWN_PROXY_HEADERS.has(a[0]))
            extraProxyHeaders.push({ name: a[0] ?? "", value: a.slice(1).join(" ") });
          break;
        case "proxy_http_version": f.websocket = f.websocket || a[0] === "1.1"; break;
        case "root": f.handler = "static"; f.root = a[0] ?? ""; sawContent = true; break;
        case "index": f.index = a[0] ?? ""; break;
        case "try_files":
          if (a.join(" ") === "$uri $uri/ /index.php?$query_string") {
            f.handler = "php";
            f.phpTryFiles = a.join(" ");
            sawContent = true;
          }
          break;
        case "default_type": jsonType = a[0] === "application/json"; break;
        case "return": ret = { status: a[0] ?? "200", body: a.slice(1).join(" ") }; sawContent = true; break;
        case "expires": f.browserCache = true; f.browserCacheExpires = a[0] ?? ""; break;
        case "add_header":
          if (a[0] === "Cache-Control" || a[0] === "X-Cache-Status") break; // gerados junto do cache
          faithful = false;
          break;
        case "proxy_cache":
          f.cacheEnabled = true;
          // $var ⇒ cache por rota (a zona vem do map $uri, tratado nos irmãos);
          // zona literal != nexus_cache ⇒ dedicada do server inteiro.
          if (a[0]?.startsWith("$")) { /* rotas: nada a setar aqui */ }
          else if (a[0] && a[0] !== "nexus_cache") { f.cacheDedicated = true; f.cacheZone = f.cacheZone || a[0]; }
          break;
        case "proxy_cache_valid": f.cacheValid = a.join(" "); break;
        case "proxy_cache_key": f.cacheKey = a.join(" "); break;
        case "proxy_cache_use_stale": break; // fixo, gerado junto do cache
        case "proxy_cache_min_uses": f.cacheMinUses = a[0] ?? ""; break;
        case "proxy_cache_lock": f.cacheLock = a[0] === "on"; break;
        case "proxy_cache_bypass":
          // o gate por rota ($nexus_nocache_*) vem do map; aqui só o bypass manual
          f.cacheBypass = a.some((x) => x === "$http_cache_control" || x === "$arg_nocache");
          break;
        case "proxy_no_cache": break; // gerado junto do bypass
        default: faithful = false;
      }
    }
    if (ret) {
      if (jsonType) { f.handler = "json"; f.jsonStatus = ret.status; f.jsonBody = ret.body; }
      else { f.handler = "none"; }
    }
    if (f.handler === "php" && (!phpLocation || !parsePhpFastcgiLocation(phpLocation, f))) {
      faithful = false;
    }
    if (!sawContent) faithful = false;
  } else {
    faithful = false; // sem location / o form não representa o server
  }
  f.extraProxyHeaders = extraProxyHeaders;

  if (!f.index) f.index = "index.html";
  f.customHeaders = customHeaders;
  return { form: f, faithful };
}

export function buildServerConfig(f: ServerForm): string {
  const needSsl = f.ssl || sslRequired(f);
  const port = f.listen.trim();
  const sslFlag = needSsl ? " ssl" : "";
  const out: string[] = [];
  const push = (s = "") => out.push(s ? `  ${s}` : "");

  // Zona de cache: dedicada (proxy_cache_path próprio, contexto http, escrito
  // ao lado do server{}) ou a compartilhada "nexus_cache" do nginx.conf.
  const cacheOn = f.cacheEnabled && f.handler === "proxy";
  const cacheRoutes = cacheOn ? cacheRoutesOf(f) : [];
  const routed = cacheRoutes.length > 0;
  // Sem rotas: zona única do server (compartilhada ou dedicada). Com rotas: a
  // zona é escolhida por um map $uri (proxy_cache aceita variável).
  const cacheVar = routed ? cacheZoneVar(f) : "";
  const cacheZone = !cacheOn ? "" : routed ? `$${cacheVar}` : (f.cacheDedicated ? cacheZoneName(f) : "nexus_cache");
  const pre: string[] = [];
  const levels = f.cacheLevels.trim() || "1:2";
  const size = f.cacheZoneSize.trim() || "10m";
  const max = f.cacheMaxSize.trim() || "1g";
  const inactive = f.cacheInactive.trim() || "60m";
  const temp = f.cacheUseTempPath ? "" : " use_temp_path=off";
  if (cacheOn && !routed && f.cacheDedicated) {
    pre.push("# Cache: zona dedicada deste server (contexto http)");
    pre.push(`proxy_cache_path ${cachePathFor(f)} levels=${levels} keys_zone=${cacheZoneName(f)}:${size} max_size=${max} inactive=${inactive}${temp};`);
    pre.push("");
  }
  if (routed) {
    // Uma zona dedicada (proxy_cache_path próprio) por rota marcada como tal,
    // em /var/cache/nginx/routes/<zona> (a limpeza da zona compartilhada ignora
    // as subpastas zones/ e routes/, então cada rota é limpável isoladamente).
    cacheRoutes.filter((r) => r.dedicated).forEach((r) => {
      const z = routeZoneName(f, r.path);
      pre.push(`# Cache: zona dedicada da rota ${r.path} (contexto http)`);
      pre.push(`proxy_cache_path /var/cache/nginx/routes/${z} levels=${levels} keys_zone=${z}:${size} max_size=${max} inactive=${inactive}${temp};`);
    });
    // map $uri → zona: "" = sem cache, senão a zona (compartilhada/dedicada).
    pre.push("# Cache: escolhe a zona por rota (contexto http)");
    pre.push(`map $uri $${cacheVar} {`);
    pre.push('    default "";');
    cacheRoutes.forEach((r) => pre.push(`    ~^${r.path} ${routeZone(f, r)};`));
    pre.push("}");
    pre.push("");
  }
  const rateZone = f.rateLimitEnabled ? rateZoneName(f) : "";
  if (f.rateLimitEnabled) {
    const size = f.rateLimitZoneSize.trim() || "10m";
    const rate = f.rateLimitRate.trim() || "10r/s";
    pre.push("# Rate limit: zona deste server (contexto http)");
    pre.push(`limit_req_zone ${f.rateLimitKey.trim() || "$binary_remote_addr"} zone=${rateZone}:${size} rate=${rate};`);
    pre.push("");
  }

  out.push("server {");

  // --- Rede ---
  push("# Rede");
  push(`listen ${port}${sslFlag};`);
  if (f.ipv6) push(`listen [::]:${port}${sslFlag};`);
  if (needSsl && f.http3) {
    push(`listen ${port} quic reuseport;`);
    if (f.ipv6) push(`listen [::]:${port} quic reuseport;`);
  }
  push(`server_name ${f.serverName.trim()};`);
  if (f.charset.trim()) push(`charset ${f.charset.trim()};`);
  if (f.serverRoot.trim()) push(`root ${f.serverRoot.trim()};`);
  if (f.serverIndex.trim()) push(`index ${f.serverIndex.trim()};`);
  if (f.autoindex) {
    push("autoindex on;");
    push(`autoindex_exact_size ${f.autoindexExactSize ? "on" : "off"};`);
    push(`autoindex_localtime ${f.autoindexLocaltime ? "on" : "off"};`);
    push(`autoindex_format ${f.autoindexFormat.trim() || "html"};`);
  }

  // --- SSL/TLS ---
  if (needSsl) {
    push();
    push("# SSL/TLS");
    push(`ssl_certificate ${f.certPath.trim()};`);
    push(`ssl_certificate_key ${f.keyPath.trim()};`);
    if (f.http2) push("http2 on;");
    if (f.http3) {
      push("http3 on;");
      push(`add_header Alt-Svc 'h3=":${port}"; ma=86400';`);
    }
    if (f.tlsAdvanced) {
      push(`ssl_protocols ${f.sslProtocols.trim() || "TLSv1.2 TLSv1.3"};`);
      if (f.sslCiphers.trim()) push(`ssl_ciphers ${f.sslCiphers.trim()};`);
      if (f.sslPreferServerCiphers) push("ssl_prefer_server_ciphers on;");
      if (f.sslSessionCache.trim()) push(`ssl_session_cache ${f.sslSessionCache.trim()};`);
      if (f.sslSessionTimeout.trim()) push(`ssl_session_timeout ${f.sslSessionTimeout.trim()};`);
      if (f.ocspStapling) {
        push("ssl_stapling on;");
        push("ssl_stapling_verify on;");
      }
    }
  }

  // --- Limites e timeouts ---
  const limits: string[] = [];
  if (f.clientMaxBodySize.trim()) limits.push(`client_max_body_size ${f.clientMaxBodySize.trim()};`);
  if (f.clientBodyBufferSize.trim()) limits.push(`client_body_buffer_size ${f.clientBodyBufferSize.trim()};`);
  if (f.clientBodyTimeout.trim()) limits.push(`client_body_timeout ${f.clientBodyTimeout.trim()};`);
  if (f.clientHeaderTimeout.trim()) limits.push(`client_header_timeout ${f.clientHeaderTimeout.trim()};`);
  if (f.bandwidthLimitEnabled) {
    if (f.bandwidthLimitAfter.trim()) limits.push(`limit_rate_after ${f.bandwidthLimitAfter.trim()};`);
    limits.push(`limit_rate ${f.bandwidthLimitRate.trim() || "1m"};`);
  }
  if (limits.length) {
    push();
    push("# Limites e timeouts");
    limits.forEach((l) => push(l));
  }

  // --- Compressão ---
  if (f.gzip || f.brotli || f.zstd) {
    push();
    push("# Compressão");
    if (f.gzip) {
      push("gzip on;");
      push(`gzip_comp_level ${f.gzipLevel.trim() || "5"};`);
    }
    if (f.brotli) {
      push("brotli on;");
      push(`brotli_comp_level ${f.brotliLevel.trim() || "5"};`);
    }
    if (f.zstd) {
      push("zstd on;");
      push(`zstd_comp_level ${f.zstdLevel.trim() || "3"};`);
    }
  }

  // --- Headers ---
  const headers: string[] = [];
  if (f.securityHeaderFrameOptions) {
    headers.push('add_header X-Frame-Options "SAMEORIGIN";');
  }
  if (f.securityHeaderContentTypeOptions) {
    headers.push('add_header X-Content-Type-Options "nosniff";');
  }
  if (f.securityHeaderXssProtection) {
    headers.push('add_header X-XSS-Protection "1; mode=block";');
  }
  if (f.securityHeaderReferrerPolicy) {
    headers.push('add_header Referrer-Policy "no-referrer-when-downgrade";');
  }
  if (f.hsts && needSsl) {
    const directives = [`max-age=${f.hstsMaxAge.trim() || "31536000"}`];
    if (f.hstsIncludeSubDomains) directives.push("includeSubDomains");
    if (f.hstsPreload) directives.push("preload");
    headers.push(`add_header Strict-Transport-Security "${directives.join("; ")}"${f.hstsAlways ? " always" : ""};`);
  }
  if (f.cors) {
    const origin = f.corsOrigin.trim() || "*";
    headers.push(`add_header Access-Control-Allow-Origin ${quoteHeaderValue(origin)} always;`);
    headers.push(`add_header Access-Control-Allow-Methods ${quoteHeaderValue(f.corsMethods.trim() || "GET, POST, PUT, PATCH, DELETE, OPTIONS")} always;`);
    headers.push(`add_header Access-Control-Allow-Headers ${quoteHeaderValue(f.corsHeaders.trim() || "*")} always;`);
    headers.push(`add_header Access-Control-Allow-Credentials "${f.corsCredentials ? "true" : "false"}" always;`);
    if (f.corsMaxAge.trim()) headers.push(`add_header Access-Control-Max-Age ${quoteHeaderValue(f.corsMaxAge)} always;`);
    if (f.corsExposeHeaders.trim()) headers.push(`add_header Access-Control-Expose-Headers ${quoteHeaderValue(f.corsExposeHeaders)} always;`);
  }
  if (f.cspEnabled) headers.push(`add_header Content-Security-Policy ${quoteHeaderValue(f.cspValue)} always;`);
  if (f.permissionsPolicyEnabled) headers.push(`add_header Permissions-Policy ${quoteHeaderValue(f.permissionsPolicyValue)} always;`);
  if (f.coopEnabled) headers.push(`add_header Cross-Origin-Opener-Policy ${quoteHeaderValue(f.coopValue)} always;`);
  if (f.coepEnabled) headers.push(`add_header Cross-Origin-Embedder-Policy ${quoteHeaderValue(f.coepValue)} always;`);
  if (f.corpEnabled) headers.push(`add_header Cross-Origin-Resource-Policy ${quoteHeaderValue(f.corpValue)} always;`);
  if (f.cacheControlEnabled) headers.push(`add_header Cache-Control ${quoteHeaderValue(f.cacheControlValue)} always;`);
  if (f.varyEnabled) headers.push(`add_header Vary ${quoteHeaderValue(f.varyValue)} always;`);
  if (f.xRobotsTagEnabled) headers.push(`add_header X-Robots-Tag ${quoteHeaderValue(f.xRobotsTagValue)} always;`);
  if (f.clearSiteDataEnabled) headers.push(`add_header Clear-Site-Data ${quoteHeaderValue(f.clearSiteDataValue)} always;`);
  if (f.contentDispositionEnabled) headers.push(`add_header Content-Disposition ${quoteHeaderValue(f.contentDispositionValue)} always;`);
  if (f.crossDomainPoliciesEnabled) headers.push(`add_header X-Permitted-Cross-Domain-Policies ${quoteHeaderValue(f.crossDomainPoliciesValue)} always;`);
  if (f.dnsPrefetchControlEnabled) headers.push(`add_header X-DNS-Prefetch-Control ${quoteHeaderValue(f.dnsPrefetchControlValue)} always;`);
  headers.push(...headerLines(f.customHeaders));
  if (f.hideServer) headers.push("more_clear_headers Server;");
  if (headers.length) {
    push();
    push("# Headers");
    headers.forEach((h) => push(h));
  }

  // --- Rate limit ---
  if (f.rateLimitEnabled) {
    push();
    push("# Rate limit");
    const burst = f.rateLimitBurst.trim();
    const nodelay = f.rateLimitNodelay ? " nodelay" : "";
    push(`limit_req zone=${rateZone}${burst ? ` burst=${burst}` : ""}${nodelay};`);
  }

  // --- Access control ---
  const allows = compactStrings(f.allowCidrs);
  const denies = compactStrings(f.denyCidrs);
  if (f.accessControlEnabled && (allows.length || denies.length || f.basicAuthEnabled)) {
    push();
    push("# Access control");
    allows.forEach((item) => push(`allow ${item};`));
    denies.forEach((item) => push(`deny ${item};`));
    if (f.basicAuthEnabled) {
      push(`auth_basic "${f.basicAuthRealm.trim() || "Restricted"}";`);
      push(`auth_basic_user_file ${f.basicAuthUserFile.trim() || "/etc/nginx/.htpasswd"};`);
    }
  }

  // --- WAF simples ---
  if (f.wafEnabled) {
    const methods = f.wafBlockedMethods.trim();
    const uas = compactStrings(f.wafBlockedUserAgents);
    const paths = compactStrings(f.wafBlockedPaths);
    if (methods || uas.length || paths.length) {
      push();
      push("# WAF simples");
      if (methods) push(`if ($request_method !~ ^(${methods.split(/\s+/).join("|")})$) { return 405; }`);
      uas.forEach((ua) => push(`if ($http_user_agent ~* "${ua}") { return 403; }`));
      paths.forEach((pathPattern) => push(`if ($request_uri ~* "${pathPattern}") { return 403; }`));
    }
  }

  // --- Logs ---
  push();
  push("# Logs");
  if (f.logMode === "off") push("access_log off;");
  else if (f.logMode === "custom")
    push(`access_log ${f.logPath.trim()} ${f.logFormat.trim() || "nexus"};`);
  else push(`access_log /var/log/nginx/access.log ${f.logFormat.trim() || "nexus"};`);
  // error_log: default herda o global; "off" desativa via /dev/null (o
  // literal `error_log off` gravaria num arquivo chamado "off").
  if (f.errorLogMode === "off") push("error_log /dev/null crit;");
  else if (f.errorLogMode === "custom")
    push(`error_log ${f.errorLogPath.trim()} ${f.errorLogLevel.trim() || "error"};`);

  // --- Conteúdo ---
  push();
  push("# Conteúdo");
  out.push("  location / {");
  const l = (s: string) => out.push(`    ${s}`);
  if (f.handler === "proxy") {
    const target = f.proxyMode === "upstream"
      ? `http://${f.proxyUpstream.trim()}`
      : f.proxyPass.trim();
    l(`proxy_pass ${target};`);
    l(`proxy_set_header Host ${f.proxyHostHeader.trim() || "$host"};`);
    l("proxy_set_header X-Real-IP $remote_addr;");
    l("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;");
    l("proxy_set_header X-Forwarded-Proto $scheme;");
    if (f.websocket) {
      l("proxy_http_version 1.1;");
      l("proxy_set_header Upgrade $http_upgrade;");
      l('proxy_set_header Connection "upgrade";');
    }
    proxyHeaderLines(f.extraProxyHeaders).forEach((h) => l(h));
    if (f.cacheEnabled) {
      if (routed) l(`# cache só nas rotas: ${cacheRoutes.map((r) => r.path).join(", ")} (zona por $uri)`);
      l(`proxy_cache ${cacheZone};`);
      l(`proxy_cache_valid ${f.cacheValid.trim() || "200 301 302 10m"};`);
      if (f.cacheKey.trim()) l(`proxy_cache_key ${f.cacheKey.trim()};`);
      l("proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;");
      l(`proxy_cache_min_uses ${f.cacheMinUses.trim() || "1"};`);
      if (f.cacheLock) l("proxy_cache_lock on;");
      if (f.cacheBypass) {
        l("proxy_cache_bypass $http_cache_control $arg_nocache;");
        l("proxy_no_cache $http_cache_control $arg_nocache;");
      }
      l("add_header X-Cache-Status $upstream_cache_status always;");
    }
  } else if (f.handler === "static") {
    l(`root ${f.root.trim()};`);
    l(`index ${f.index.trim() || "index.html"};`);
    if (f.browserCache) {
      l(`expires ${f.browserCacheExpires.trim() || "7d"};`);
      l('add_header Cache-Control "public, immutable";');
    }
    l("try_files $uri $uri/ =404;");
  } else if (f.handler === "php") {
    l(`try_files ${f.phpTryFiles.trim() || "$uri $uri/ /index.php?$query_string"};`);
  } else if (f.handler === "json") {
    l("default_type application/json;");
    l(`return ${f.jsonStatus.trim() || "200"} '${f.jsonBody.trim() || '{"status":"ok"}'}';`);
  } else {
    l("return 200 'ok';");
  }
  out.push("  }");
  if (f.handler === "php") {
    out.push("");
    out.push("  location ~ \\.php$ {");
    l(`include ${f.phpInclude.trim() || "fastcgi_params"};`);
    l(`fastcgi_pass ${f.phpFastcgiPass.trim()};`);
    l(`fastcgi_param SCRIPT_FILENAME ${f.phpScriptFilename.trim() || "$document_root$fastcgi_script_name"};`);
    out.push("  }");
  }
  f.extraLocations.forEach((loc) => {
    out.push("");
    emitLocation(out, loc);
  });
  out.push("}");
  return (pre.length ? pre.join("\n") + "\n" : "") + out.join("\n") + "\n";
}
