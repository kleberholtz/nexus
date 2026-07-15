import { useEffect, useState } from "react";
import { Cpu, Gauge, HelpCircle, Loader2, Network, RefreshCw, Save, Wand2 } from "lucide-react";
import { get, post, put } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { validateInt } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";

type TuneInfo = {
  detected: { cpus: number; mem_bytes: number; soft_nofile: number; hard_nofile: number };
  computed: { worker_processes: number; worker_rlimit_nofile: number; worker_connections: number };
  current: { worker_processes: number | null; worker_rlimit_nofile: number | null; worker_connections: number | null };
  mem_fraction: number;
};

type NginxConfig = {
  file: string;
  main: { raw: string; nodes: unknown[] };
  events: { present: boolean; raw: string; nodes: unknown[] };
  http: { present: boolean; raw: string; nodes: unknown[] };
};

type ConfigScope = "main" | "events" | "http";
type ConfigEntry = {
  id: string;
  type: "directive" | "comment";
  name: string;
  args: string[];
  text?: string;
};

type ConfigForm = Record<ConfigScope, ConfigEntry[]>;

type Node = { type?: string; name?: string; args?: string[] };

const BOOL_VALUES = new Set(["on", "off"]);

const HELP: Record<string, string> = {
  user: "Usuário do sistema usado pelos workers do nginx.",
  include: "Inclui outro arquivo de configuração neste contexto.",
  pid: "Arquivo onde o processo master grava o PID.",
  timer_resolution: "Reduz chamadas de relógio agrupando atualizações de tempo.",
  error_log: "Destino e nível mínimo do log de erro.",
  worker_processes: "Quantidade de processos worker. Normalmente vem do tuning automático.",
  worker_rlimit_nofile: "Limite de file descriptors por worker. Normalmente vem do tuning automático.",
  worker_connections: "Máximo de conexões simultâneas por worker.",
  use: "Método de eventos usado pelo nginx neste sistema.",
  multi_accept: "Permite que um worker aceite várias conexões por vez.",
  accept_mutex: "Serializa accepts entre workers em alguns cenários.",
  charset: "Charset padrão das respostas.",
  sendfile: "Usa sendfile do kernel para servir arquivos.",
  tcp_nopush: "Otimiza envio de headers e arquivos com sendfile.",
  tcp_nodelay: "Reduz latência em respostas pequenas.",
  log_not_found: "Controla logs para arquivos não encontrados.",
  client_body_buffer_size: "Buffer em memória para corpo da requisição.",
  client_header_buffer_size: "Buffer para cabeçalhos de requisição.",
  large_client_header_buffers: "Número e tamanho dos buffers para cabeçalhos grandes.",
  client_max_body_size: "Tamanho máximo aceito no corpo da requisição.",
  server_names_hash_bucket_size: "Bucket size da hash de server_names.",
  types_hash_bucket_size: "Bucket size da hash de MIME types.",
  types_hash_max_size: "Tamanho máximo da hash de MIME types.",
  variables_hash_bucket_size: "Bucket size da hash de variáveis.",
  variables_hash_max_size: "Tamanho máximo da hash de variáveis.",
  default_type: "Content-Type padrão quando não há MIME type detectado.",
  log_format: "Formato de log nomeado usado por access_log.",
  access_log: "Destino, formato e condição dos logs de acesso.",
  open_file_cache: "Cache de metadados/descritores de arquivos abertos.",
  open_file_cache_valid: "Intervalo de validação do cache de arquivos.",
  open_file_cache_min_uses: "Usos mínimos para manter item no cache.",
  open_file_cache_errors: "Inclui erros de lookup no cache de arquivos.",
  proxy_cache_path: "Define diretório e zona compartilhada para proxy_cache.",
  ssl_session_timeout: "Tempo de vida da sessão SSL.",
  ssl_session_cache: "Cache compartilhado de sessões SSL.",
  ssl_session_tickets: "Ativa tickets TLS.",
  ssl_protocols: "Protocolos TLS permitidos.",
  ssl_ciphers: "Suites de cifra TLS permitidas.",
  ssl_prefer_server_ciphers: "Prefere a ordem de ciphers do servidor.",
  ssl_early_data: "Permite TLS 1.3 early data.",
  ssl_dhparam: "Arquivo de parâmetros DH.",
  resolver: "Servidores DNS usados pelo nginx.",
  resolver_timeout: "Timeout das consultas DNS.",
  reset_timedout_connection: "Fecha conexões de clientes inativos com RST.",
  client_body_timeout: "Timeout entre leituras do corpo da requisição.",
  client_header_timeout: "Timeout para receber cabeçalhos.",
  send_timeout: "Timeout entre operações de envio ao cliente.",
  keepalive_timeout: "Tempo máximo de keep-alive ocioso.",
  keepalive_requests: "Requisições máximas em uma conexão keep-alive.",
  keepalive_time: "Tempo total máximo de vida da conexão keep-alive.",
  server_tokens: "Mostra ou oculta versão do nginx.",
  etag: "Ativa/desativa ETag automático.",
  more_set_headers: "Define ou sobrescreve headers de resposta com headers-more.",
};

const SECTION_LABELS: Record<ConfigScope, string> = {
  main: "Gerais",
  events: "Events",
  http: "HTTP",
};

const SECTION_HELP: Record<ConfigScope, string> = {
  main: "Diretivas do contexto principal do nginx.conf, fora de events/http/stream.",
  events: "Diretivas do bloco events, responsáveis por conexão e modelo de eventos.",
  http: "Diretivas diretas do bloco http. Sub-blocos como server, map e upstream são preservados.",
};

function Help({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Ajuda"
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ htmlFor, children, help }: { htmlFor?: string; children: React.ReactNode; help?: string }) {
  return <LabelWithHelp htmlFor={htmlFor} help={help}>{children}</LabelWithHelp>;
}

function NginxTuneCard() {
  const [info, setInfo] = useState<TuneInfo | null>(null);
  const [wp, setWp] = useState("");
  const [wc, setWc] = useState("");
  const [wr, setWr] = useState("");
  const [saving, setSaving] = useState(false);

  function fill(t: TuneInfo, from: "current" | "computed") {
    const src = from === "current" ? t.current : t.computed;
    setWp(String(src.worker_processes ?? t.computed.worker_processes));
    setWc(String(src.worker_connections ?? t.computed.worker_connections));
    setWr(String(src.worker_rlimit_nofile ?? t.computed.worker_rlimit_nofile));
  }

  function load() {
    get<TuneInfo>("/nginx/tune")
      .then((t) => { setInfo(t); fill(t, "current"); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar tune"));
  }
  useEffect(load, []);

  async function apply() {
    const err =
      validateInt(wp, { min: 1, max: 1024, label: "worker_processes" }) ||
      validateInt(wc, { min: 1024, max: 65535, label: "worker_connections" }) ||
      validateInt(wr, { min: 1, max: 100000000, label: "worker_rlimit_nofile" });
    if (err) return toast.error(err);
    setSaving(true);
    try {
      await post("/nginx/tune", {
        worker_processes: Number(wp),
        worker_connections: Number(wc),
        worker_rlimit_nofile: Number(wr),
      });
      toast.success("Tuning aplicado — recarregue/reinicie o nginx");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" /> Tuning (workers)
        </CardTitle>
        <CardDescription>
          worker_processes / worker_connections / worker_rlimit_nofile — calculados pelos recursos
          da máquina (mesma lógica do boot). Aplicar exige recarregar (connections) ou reiniciar
          (processes/rlimit) o nginx.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!info ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Detected icon={Cpu} label="CPUs" value={String(info.detected.cpus)} />
              <Detected label="Memória" value={formatBytes(info.detected.mem_bytes)} />
              <Detected label="fds (hard)" value={String(info.detected.hard_nofile)} />
              <Detected label="Sugerido (conn)" value={String(info.computed.worker_connections)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="tw-p" help="Quantidade de processos worker do nginx. Use auto na maioria dos hosts; o tuning calcula um valor explícito a partir das CPUs.">
                  worker_processes
                </LabelWithHelp>
                <Input id="tw-p" type="number" value={wp} onChange={(e) => setWp(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="tw-c" help="Número máximo de conexões simultâneas por worker. Impacta diretamente a capacidade total de conexões.">
                  worker_connections
                </LabelWithHelp>
                <Input id="tw-c" type="number" value={wc} onChange={(e) => setWc(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="tw-r" help="Limite de file descriptors disponível para cada worker. Deve ser compatível com o limite do sistema.">
                  worker_rlimit_nofile
                </LabelWithHelp>
                <Input id="tw-r" type="number" value={wr} onChange={(e) => setWr(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => info && fill(info, "computed")}>
                <Wand2 className="h-4 w-4" /> Usar sugeridos
              </Button>
              <Button size="sm" onClick={apply} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Aplicar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Detected({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />} {label}
      </div>
      <div className="font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function entriesFrom(nodes: unknown[], scope: ConfigScope): ConfigEntry[] {
  return (nodes as Node[])
    .filter((n) => n.type === "directive" || n.type === "comment")
    .map((n, index) => n.type === "comment" ? ({
      id: `${scope}-${index}-comment`,
      type: "comment" as const,
      name: "",
      args: [],
      text: (n as Node & { text?: string }).text ?? "",
    }) : ({
      id: `${scope}-${index}-${n.name}`,
      type: "directive" as const,
      name: n.name ?? "",
      args: [...(n.args ?? [])],
    }));
}

function nodesFrom(entries: ConfigEntry[]) {
  return entries
    .map((e) => e.type === "comment"
      ? { type: "comment", text: e.text ?? "" }
      : { type: "directive", name: e.name.trim(), args: e.args.map((a) => a.trim()).filter(Boolean) })
    .filter((node) => node.type === "comment" || node.name);
}

function oneArg(e: ConfigEntry): string {
  return e.args.join(" ");
}

function setEntry(scope: ConfigScope, id: string, args: string[], setForm: React.Dispatch<React.SetStateAction<ConfigForm>>) {
  setForm((cur) => ({
    ...cur,
    [scope]: cur[scope].map((entry) => (entry.id === id ? { ...entry, args } : entry)),
  }));
}

function groupFor(scope: ConfigScope, name: string): string {
  if (scope === "main") {
    if (["worker_processes", "worker_rlimit_nofile", "user", "pid", "timer_resolution"].includes(name)) return "Processo";
    if (["error_log"].includes(name)) return "Logs";
    return "Outros";
  }
  if (scope === "events") {
    if (["worker_connections", "use", "multi_accept", "accept_mutex"].includes(name)) return "Conexões";
    return "Outros";
  }
  if (["sendfile", "sendfile_max_chunk", "tcp_nopush", "tcp_nodelay", "charset", "default_type", "log_not_found"].includes(name)) return "Performance";
  if (["client_body_buffer_size", "client_header_buffer_size", "large_client_header_buffers", "client_max_body_size"].includes(name)) return "Buffers e limites";
  if (name.includes("_hash_")) return "Hashes";
  if (["access_log", "error_log", "log_format"].includes(name)) return "Logs";
  if (name.startsWith("open_file_cache") || name === "proxy_cache_path") return "Cache";
  if (name.startsWith("ssl_") || name === "resolver" || name === "resolver_timeout") return "SSL e DNS";
  if (["client_body_timeout", "client_header_timeout", "send_timeout", "keepalive_timeout", "keepalive_requests", "keepalive_time", "reset_timedout_connection"].includes(name)) return "Timeouts";
  if (["server_tokens", "etag", "more_set_headers"].includes(name)) return "Segurança";
  if (name === "include") return "Includes";
  return "Outros";
}

function ConfigSection({
  scope,
  entries,
  setForm,
}: {
  scope: ConfigScope;
  entries: ConfigEntry[];
  setForm: React.Dispatch<React.SetStateAction<ConfigForm>>;
}) {
  const visible = entries.filter((entry) => entry.type === "directive");
  const groups = visible.reduce<Record<string, ConfigEntry[]>>((acc, entry) => {
    const group = groupFor(scope, entry.name);
    acc[group] = [...(acc[group] ?? []), entry];
    return acc;
  }, {});
  const order = scope === "main"
    ? ["Processo", "Logs", "Outros"]
    : scope === "events"
      ? ["Conexões", "Outros"]
      : ["Performance", "Buffers e limites", "Hashes", "Logs", "Cache", "SSL e DNS", "Timeouts", "Segurança", "Includes", "Outros"];

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold">{SECTION_LABELS[scope]}</p>
        <Help text={SECTION_HELP[scope]} />
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma diretiva direta neste contexto.</p>
      ) : (
        order.filter((group) => groups[group]?.length).map((group) => (
          <div key={`${scope}-${group}`} className="space-y-3 rounded-md border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups[group].map((entry) => (
                <DirectiveField
                  key={entry.id}
                  scope={scope}
                  entry={entry}
                  onChange={(args) => setEntry(scope, entry.id, args, setForm)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function DirectiveField({
  scope,
  entry,
  onChange,
}: {
  scope: ConfigScope;
  entry: ConfigEntry;
  onChange: (args: string[]) => void;
}) {
  const value = oneArg(entry);
  const help = HELP[entry.name] ?? `Diretiva ${entry.name} no contexto ${scope}.`;
  const isSwitch = entry.args.length === 1 && BOOL_VALUES.has(entry.args[0]);
  const id = `ng-${scope}-${entry.id}`;

  if (isSwitch) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
        <FieldLabel help={help}>{entry.name}</FieldLabel>
        <Switch checked={entry.args[0] === "on"} onCheckedChange={(checked) => onChange([checked ? "on" : "off"])} />
      </div>
    );
  }

  return (
    <div className={entry.name === "log_format" || entry.name === "ssl_ciphers" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <FieldLabel htmlFor={id} help={help}>{entry.name}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value.split(/\s+/) : [])}
        spellCheck={false}
        className="font-mono text-xs"
      />
    </div>
  );
}

function NginxGlobalCard() {
  const [cfg, setCfg] = useState<NginxConfig | null>(null);
  const [form, setForm] = useState<ConfigForm>({ main: [], events: [], http: [] });
  const [saving, setSaving] = useState(false);

  function load() {
    get<NginxConfig>("/nginx/config")
      .then((d) => {
        setCfg(d);
        setForm({
          main: entriesFrom(d.main.nodes, "main"),
          events: entriesFrom(d.events.nodes, "events"),
          http: entriesFrom(d.http?.nodes ?? [], "http"),
        });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar config"));
  }
  useEffect(load, []);

  async function save() {
    setSaving(true);
    try {
      await put("/nginx/config", {
        main: nodesFrom(form.main),
        events: nodesFrom(form.events),
        http: nodesFrom(form.http),
      });
      toast.success("Configuração global salva");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Opções globais do nginx.conf</CardTitle>
        <CardDescription>
          Diretivas diretas dos contextos <code>main</code>, <code>events</code> e <code>http</code>.
          Sub-blocos como <code>server</code>, <code>map</code>, <code>stream</code> e <code>rtmp</code> são preservados.
          Salvar valida com <code>nginx -t</code> e desfaz se der erro.
          {cfg && <span className="ml-1 font-mono text-xs">{cfg.file}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!cfg ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <ConfigSection scope="main" entries={form.main} setForm={setForm} />
            <ConfigSection scope="events" entries={form.events} setForm={setForm} />
            <ConfigSection scope="http" entries={form.http} setForm={setForm} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={saving}>
                <RefreshCw className="h-4 w-4" /> Recarregar
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NginxIpv6Card() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    get<{ values: Record<string, unknown> }>("/settings")
      .then((s) => setEnabled(!!s.values.ipv6_enabled))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"));
  }
  useEffect(load, []);

  async function save(next: boolean) {
    setSaving(true);
    try {
      await put("/settings", { ipv6_enabled: next });
      setEnabled(next);
      toast.success("Configuração de IPv6 salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-primary" /> IPv6
        </CardTitle>
        <CardDescription>
          Controla se o nginx tenta abrir sockets <code>listen [::]...</code>. Algumas
          máquinas/redes ainda não suportam IPv6 — nesse caso o nginx falha ao subir
          (<code>socket() [::]... failed: Address family not supported</code>). Desativado por
          padrão; ao mudar, todas as confs (servers/streams) são reconciliadas na hora
          (comentando ou restaurando os <code>listen [::]...</code>, sem perder a config).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {enabled === null ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <label className="flex items-center gap-2">
            <Checkbox checked={enabled} disabled={saving}
              onCheckedChange={(c) => save(!!c)} />
            <span className="text-sm font-medium">Habilitar IPv6 (listen [::])</span>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </label>
        )}
      </CardContent>
    </Card>
  );
}

export function NginxSettings() {
  return (
    <div className="space-y-6">
      <NginxTuneCard />
      <NginxIpv6Card />
      <NginxGlobalCard />
    </div>
  );
}
