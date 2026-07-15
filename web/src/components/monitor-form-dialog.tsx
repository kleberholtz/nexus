import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { get, post, put } from "@/lib/api";
import {
  CONNECTION_DEFAULT_PORTS,
  DNS_OPERATORS,
  DNS_RECORD_TYPES,
  DnsCondition,
  HTTP_METHODS,
  KeyValue,
  LATENCY_WINDOW_OPTIONS,
  MAX_ALL_PROXIES,
  MONITOR_TYPES,
  Monitor,
  MonitorForm,
  MonitorGroup,
  MonitorTag,
  MonitorType,
  TCP_TLS_ALERTS,
  TIMEOUT_TYPES,
  buildMonitorBody,
  emptyMonitorForm,
  isHttps,
  isConnectionMonitorType,
  monitorTagLabel,
  parseMonitorForm,
  timeoutCap,
  validateMonitorForm,
} from "@/lib/monitor-config";
import { NotificationChannel, typeLabel as channelTypeLabel } from "@/lib/notification-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxMultiple } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch, SelectWithSearchOption } from "@/components/ui/select-with-search";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { SwitchBlock } from "@/components/switch-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  editing: Monitor | null;      // null = criar
  groups: MonitorGroup[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
};

// Opções estáticas dos selects.
const opt = (v: string, l = v): SelectWithSearchOption => ({ value: v, label: l });
const TYPE_OPTS = MONITOR_TYPES.map((t) => ({ value: t.value, label: t.label, group: t.group }));
const METHOD_OPTS = HTTP_METHODS.map((m) => opt(m));
const BODY_ENC_OPTS = [opt("json", "JSON"), opt("form", "x-www-form-urlencoded")];
const AUTH_OPTS = [
  opt("basic", "Básica (usuário/senha)"), opt("bearer", "Bearer token"),
  opt("oauth2", "OAuth2"), opt("ntlm", "NTLM"), opt("mtls", "mTLS"), opt("other", "Outro"),
];
const OAUTH_METHOD_OPTS = [opt("header", "Cabeçalho (Basic Auth)"), opt("body", "Dados de formulário")];
const TCP_ALERT_OPTS = [opt("", "— nenhum (handshake deve funcionar) —"), ...TCP_TLS_ALERTS.map((a) => opt(a))];
const RECORD_OPTS = DNS_RECORD_TYPES.map((r) => opt(r, r.toUpperCase()));
const DNS_OP_OPTS = DNS_OPERATORS.map((o) => opt(o.value, o.label));
const LATENCY_WINDOW_LABELS: Record<number, string> = {
  60: "1 min (padrão)",
  300: "5 min",
  600: "10 min",
  900: "15 min",
  1800: "30 min",
  3600: "1 h",
};
const LATENCY_WINDOW_OPTS = LATENCY_WINDOW_OPTIONS.map((seconds) =>
  opt(String(seconds), LATENCY_WINDOW_LABELS[seconds]));
const CONNECTION_URI_PLACEHOLDERS: Partial<Record<MonitorType, string>> = {
  postgresql: "postgresql://usuario:senha@host:5432/database",
  mysql: "mysql://usuario:senha@host:3306/database",
  mongodb: "mongodb://usuario:senha@host:27017/database?authSource=admin",
  redis: "redis://usuario:senha@host:6379/0",
  rabbitmq: "amqp://usuario:senha@host:5672/vhost",
};
const CONNECTION_ARGUMENT_EXAMPLES: Partial<Record<MonitorType, string>> = {
  postgresql: "Ex.: sslmode=require, application_name=holtz-nexus-monitor.",
  mysql: "Ex.: charset=utf8mb4, ssl={\"ca\":\"/caminho/ca.pem\"}.",
  mongodb: "Ex.: authSource=admin, replicaSet=rs0, tls=true.",
  redis: "Ex.: protocol=3, ssl=true.",
  rabbitmq: "Ex.: heartbeat=30, connection_attempts=3.",
};

// ---------- sub-componentes ----------

function Block({ title, children, action }: {
  title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function KeyValueList({ label, help, pairs, onChange }: {
  label: string; help: string; pairs: KeyValue[]; onChange: (p: KeyValue[]) => void;
}) {
  const set = (i: number, patch: Partial<KeyValue>) =>
    onChange(pairs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <LabelWithHelp help={help}>{label}</LabelWithHelp>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...pairs, { key: "", value: "" }])}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </div>
      {pairs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item.</p>}
      {pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input placeholder="key" value={p.key} spellCheck={false} className="flex-1"
            onChange={(e) => set(i, { key: e.target.value })} />
          <Input placeholder="value" value={p.value} spellCheck={false} className="flex-1"
            onChange={(e) => set(i, { value: e.target.value })} />
          <Button type="button" variant="ghost" size="icon"
            onClick={() => onChange(pairs.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------- dialog ----------

export function MonitorFormDialog({ editing, groups, onOpenChange, onSaved }: Props) {
  const isEdit = !!editing;
  const [form, setForm] = useState<MonitorForm>(emptyMonitorForm);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [proxies, setProxies] = useState<Array<{ id: number; server: string; port: number; protocol: string; enabled: boolean }>>([]);
  const [proxyMode, setProxyMode] = useState<"round_robin" | "all">("round_robin");
  const [useProxy, setUseProxy] = useState(false);
  const [tags, setTags] = useState<MonitorTag[]>([]);

  useEffect(() => {
    get<NotificationChannel[]>("/monitors/notifications")
      .then(setChannels)
      .catch(() => { /* opcional; sem canais o bloco fica vazio */ });
  }, []);
  useEffect(() => { get<typeof proxies>("/monitors/proxies").then(setProxies).catch(() => setProxies([])); }, []);
  useEffect(() => {
    get<MonitorTag[]>("/monitors/tags").then(setTags).catch(() => setTags([]));
  }, []);

  useEffect(() => {
    if (!editing) {
      setForm(emptyMonitorForm());
      setProxyMode("round_robin");
      setUseProxy(false);
      return;
    }
    setLoading(true);
    get<Monitor>(`/monitors/${editing.id}`)
      .then((m) => {
        setForm(parseMonitorForm(m));
        setProxyMode((m.config.proxy_mode ?? "round_robin") as "round_robin" | "all");
        setUseProxy((m.config.proxy_ids ?? []).length > 0);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [editing]);

  const set = <K extends keyof MonitorForm>(k: K, v: MonitorForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setMonitorType = (type: MonitorType) =>
    setForm((f) => ({
      ...f,
      type,
      ...(isConnectionMonitorType(type)
        ? { connectionPort: String(CONNECTION_DEFAULT_PORTS[type]), timeoutSeconds: "10" }
        : {}),
    }));

  // Timeout auto-clamp: nunca maior que 80% do intervalo (suporta 0.8).
  useEffect(() => {
    const cap = timeoutCap(form.intervalSeconds);
    if (Number(form.timeoutSeconds) > cap) set("timeoutSeconds", String(cap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.intervalSeconds]);

  const setTimeoutClamped = (v: string) => {
    const cap = timeoutCap(form.intervalSeconds);
    set("timeoutSeconds", Number(v) > cap ? String(cap) : v);
  };

  async function submit() {
    const err = validateMonitorForm(form);
    if (err) return toast.error(err);
    if (form.type === "http" && proxyMode === "all" && form.proxyIds.length > MAX_ALL_PROXIES) {
      return toast.error(`No modo "usar todos em conjunto" são permitidos no máximo ${MAX_ALL_PROXIES} proxies.`);
    }
    const body = buildMonitorBody(form);
    if (form.type === "http") (body.config as Record<string, unknown>).proxy_mode = proxyMode;
    setBusy(true);
    try {
      if (isEdit) {
        await put<Monitor>(`/monitors/${editing!.id}`, body);
        toast.success("Monitor atualizado");
      } else {
        await post<Monitor>("/monitors", body);
        toast.success("Monitor criado");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  const https = form.type === "http" && isHttps(form.url);
  const connectionMonitor = isConnectionMonitorType(form.type);
  const showTimeout = TIMEOUT_TYPES.includes(form.type);
  const cap = timeoutCap(form.intervalSeconds);
  const typeLabel = MONITOR_TYPES.find((t) => t.value === form.type)?.label ?? form.type;
  const groupOpts = [opt("", "— sem grupo —"), ...groups.map((g) => opt(String(g.id), g.name))];

  const setResolver = (i: number, v: string) =>
    set("resolvers", form.resolvers.map((r, idx) => (idx === i ? v : r)));
  const setCondition = (i: number, patch: Partial<DnsCondition>) =>
    set("conditions", form.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const toggleChannel = (cid: number) =>
    set("notificationChannelIds", form.notificationChannelIds.includes(cid)
      ? form.notificationChannelIds.filter((x) => x !== cid)
      : [...form.notificationChannelIds, cid]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <TooltipProvider>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Editar monitor (${typeLabel})` : "Novo monitor"}</DialogTitle>
            <DialogDescription>
              {form.type === "domain"
                ? "Consulta a validade do domínio a cada 24h ou manualmente."
                : connectionMonitor
                  ? "Abre uma conexão real e executa a verificação nativa do serviço."
                : "Healthcheck — checa o alvo no intervalo e marca o serviço como saudável/indisponível."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Carregando…</div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <LabelWithHelp help="Tipo de verificação. Não muda depois de criado." required>Tipo</LabelWithHelp>
                  <SelectWithSearch options={TYPE_OPTS} value={form.type} disabled={isEdit}
                    onChange={(v) => setMonitorType(v as MonitorType)} />
                </div>
                <div className="space-y-1.5">
                  <LabelWithHelp help="Agrupa monitores relacionados. Opcional.">Grupo</LabelWithHelp>
                  <SelectWithSearch options={groupOpts} value={form.groupId} onChange={(v) => set("groupId", v)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="mon-name" help="Nome amigável exibido nas listagens." required>Rótulo</LabelWithHelp>
                <Input id="mon-name" value={form.name} onChange={(e) => set("name", e.target.value)}
                  placeholder="Meu serviço" spellCheck={false} />
              </div>

              {form.type === "http" && (
                  <div className="space-y-1.5">
                    <LabelWithHelp htmlFor="mon-url" help="URL a monitorar. Deve começar com http:// ou https://." required>URL</LabelWithHelp>
                    <Input id="mon-url" value={form.url} onChange={(e) => set("url", e.target.value)}
                      placeholder="https://exemplo.com/health" spellCheck={false} />
                  </div>
                )}

              {form.type === "tcp" && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <LabelWithHelp help="Host a conectar (sem esquema)." required>Hostname</LabelWithHelp>
                      <Input value={form.tcpHostname} onChange={(e) => set("tcpHostname", e.target.value)}
                        placeholder="exemplo.com" spellCheck={false} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Porta TCP (1–65535)." required>Porta</LabelWithHelp>
                      <Input inputMode="numeric" value={form.tcpPort} onChange={(e) => set("tcpPort", e.target.value)}
                        placeholder="443" />
                    </div>
                  </div>
                )}

              {form.type === "ping" && (
                  <div className="space-y-1.5">
                    <LabelWithHelp help="Host a pingar (ICMP echo)." required>Hostname</LabelWithHelp>
                    <Input value={form.pingHostname} onChange={(e) => set("pingHostname", e.target.value)}
                      placeholder="exemplo.com" spellCheck={false} />
                  </div>
                )}

              {form.type === "dns" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Nome a resolver." required>Hostname</LabelWithHelp>
                      <Input value={form.dnsHostname} onChange={(e) => set("dnsHostname", e.target.value)}
                        placeholder="exemplo.com" spellCheck={false} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Porta do servidor DNS (padrão 53).">Porta</LabelWithHelp>
                      <Input inputMode="numeric" value={form.dnsPort} onChange={(e) => set("dnsPort", e.target.value)}
                        placeholder="53" />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Tipo de registro DNS a consultar.">Tipo de registro</LabelWithHelp>
                      <SelectWithSearch options={RECORD_OPTS} value={form.recordType} onChange={(v) => set("recordType", v)} />
                    </div>
                  </div>
                  <Block title="Servidores de resolução" action={
                    <Button type="button" variant="outline" size="sm" disabled={form.resolvers.length >= 8}
                      onClick={() => set("resolvers", [...form.resolvers, ""])}>
                      <Plus className="h-4 w-4" /> Adicionar
                    </Button>
                  }>
                    {form.resolvers.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input value={r} spellCheck={false} className="flex-1" placeholder="1.1.1.1"
                          onChange={(e) => setResolver(i, e.target.value)} />
                        <Button type="button" variant="ghost" size="icon" disabled={form.resolvers.length <= 1}
                          onClick={() => set("resolvers", form.resolvers.filter((_, idx) => idx !== i))}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Até 8 servidores (padrão 1.1.1.1).</p>
                  </Block>
                  <Block title="Condições" action={
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => set("conditions", [...form.conditions, { operator: "equal", value: "" }])}>
                      <Plus className="h-4 w-4" /> Adicionar
                    </Button>
                  }>
                    {form.conditions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sem condições: saudável se o registro resolver. Com condições, todas devem passar.
                      </p>
                    )}
                    {form.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-44 shrink-0">
                          <SelectWithSearch options={DNS_OP_OPTS} value={c.operator}
                            onChange={(v) => setCondition(i, { operator: v })} />
                        </div>
                        <Input value={c.value} spellCheck={false} className="flex-1" placeholder="valor"
                          onChange={(e) => setCondition(i, { value: e.target.value })} />
                        <Button type="button" variant="ghost" size="icon"
                          onClick={() => set("conditions", form.conditions.filter((_, idx) => idx !== i))}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </Block>
                </>
                )}

              {form.type === "container" && (
                  <div className="space-y-1.5">
                    <LabelWithHelp help="Nome ou ID do container Docker. Saudável se estiver rodando (ou com healthcheck “healthy”)." required>Container</LabelWithHelp>
                    <Input value={form.containerName} onChange={(e) => set("containerName", e.target.value)}
                      placeholder="nome ou ID do container" spellCheck={false} />
                  </div>
                )}

              {form.type === "domain" && (
                  <div className="space-y-1.5">
                    <LabelWithHelp htmlFor="mon-domain"
                      help="Domínio registrado consultado via RDAP. Informe o domínio raiz, sem protocolo, caminho ou subdomínio."
                      required>
                      Domínio registrável
                    </LabelWithHelp>
                    <Input id="mon-domain" value={form.domainName}
                      onChange={(e) => set("domainName", e.target.value)}
                      placeholder="exemplo.com" spellCheck={false} />
                    <p className="text-xs text-muted-foreground">
                      A validade é consultada via RDAP a cada 24h e ao usar “Checar agora”.
                    </p>
                  </div>
                )}

              {connectionMonitor && (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Button type="button" size="sm"
                        variant={form.connectionMode === "fields" ? "default" : "outline"}
                        onClick={() => set("connectionMode", "fields")}>
                        Campos separados
                      </Button>
                      <Button type="button" size="sm"
                        variant={form.connectionMode === "uri" ? "default" : "outline"}
                        onClick={() => set("connectionMode", "uri")}>
                        URI de conexão
                      </Button>
                    </div>
                    {form.connectionMode === "uri" ? (
                      <div className="space-y-1.5">
                        <LabelWithHelp htmlFor="mon-connection-uri"
                          help="URI completa, incluindo credenciais e parâmetros. Depois de salva, será mascarada por segurança."
                          required>
                          URI de conexão
                        </LabelWithHelp>
                        <Input id="mon-connection-uri" value={form.connectionUri}
                          onChange={(e) => set("connectionUri", e.target.value)}
                          placeholder={CONNECTION_URI_PLACEHOLDERS[form.type]} spellCheck={false} />
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                          <div className="space-y-1.5">
                            <LabelWithHelp htmlFor="mon-connection-host" help="Hostname ou endereço IP acessível pelo container." required>Host</LabelWithHelp>
                            <Input id="mon-connection-host" value={form.connectionHost}
                              onChange={(e) => set("connectionHost", e.target.value)}
                              placeholder="db.exemplo.com" spellCheck={false} />
                          </div>
                          <div className="space-y-1.5">
                            <LabelWithHelp htmlFor="mon-connection-port" help="Porta TCP do serviço." required>Porta</LabelWithHelp>
                            <Input id="mon-connection-port" inputMode="numeric" value={form.connectionPort}
                              onChange={(e) => set("connectionPort", e.target.value)} />
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <LabelWithHelp htmlFor="mon-connection-user" help="Usuário de autenticação. Opcional quando o serviço permite conexão sem usuário.">Usuário</LabelWithHelp>
                            <Input id="mon-connection-user" value={form.connectionUsername}
                              onChange={(e) => set("connectionUsername", e.target.value)}
                              autoComplete="off" spellCheck={false} />
                          </div>
                          <div className="space-y-1.5">
                            <LabelWithHelp htmlFor="mon-connection-password" help="Senha de autenticação. Vazio ao editar mantém a senha atual.">Senha</LabelWithHelp>
                            <Input id="mon-connection-password" type="password"
                              value={form.connectionPassword}
                              onChange={(e) => set("connectionPassword", e.target.value)}
                              autoComplete="new-password" />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp htmlFor="mon-connection-database"
                            help={form.type === "rabbitmq"
                              ? "Virtual host do RabbitMQ. Vazio usa /."
                              : form.type === "redis"
                                ? "Índice numérico do database Redis. Vazio usa 0."
                                : "Database usado para validar a conexão. Opcional."}>
                            {form.type === "rabbitmq" ? "Virtual host" : "Database"}
                          </LabelWithHelp>
                          <Input id="mon-connection-database" value={form.connectionDatabase}
                            inputMode={form.type === "redis" ? "numeric" : undefined}
                            onChange={(e) => set("connectionDatabase", e.target.value)}
                            placeholder={form.type === "rabbitmq" ? "/" : form.type === "redis" ? "0" : "opcional"}
                            spellCheck={false} />
                        </div>
                        <KeyValueList label="Argumentos do driver"
                          help={`Argumentos opcionais do cliente Python. Valores aceitam texto, número, booleano ou JSON. Credenciais devem usar os campos acima. ${CONNECTION_ARGUMENT_EXAMPLES[form.type] || ""}`}
                          pairs={form.connectionArguments}
                          onChange={(value) => set("connectionArguments", value)} />
                      </div>
                    )}
                  </div>
                )}

              {form.type !== "domain" && (
                <div className={`grid gap-4 ${showTimeout ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                  <div className="space-y-1.5">
                    <LabelWithHelp htmlFor="mon-interval" help="Frequência da checagem (1s a 86400s = 1 dia)." required>Intervalo (s)</LabelWithHelp>
                    <Input id="mon-interval" inputMode="numeric" value={form.intervalSeconds}
                      onChange={(e) => set("intervalSeconds", e.target.value)} />
                  </div>
                  {showTimeout && (
                    <div className="space-y-1.5">
                      <LabelWithHelp htmlFor="mon-timeout"
                        help={`Tempo máximo de resposta. No máximo 80% do intervalo (≤ ${cap}s). Aceita frações (ex.: 0.8).`}
                        required>
                        Timeout (s)
                      </LabelWithHelp>
                      <Input id="mon-timeout" inputMode="decimal" value={form.timeoutSeconds}
                        onChange={(e) => setTimeoutClamped(e.target.value)} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <LabelWithHelp htmlFor="mon-retries" help="Falhas consecutivas antes de marcar como indisponível.">Novas tentativas</LabelWithHelp>
                    <Input id="mon-retries" inputMode="numeric" value={form.maxRetries}
                      onChange={(e) => set("maxRetries", e.target.value)} />
                  </div>
                </div>
              )}

              {form.type === "ping" && (
                <Block title="Pacotes ICMP">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Quantos pacotes enviar por checagem (1 a 10).">Máximo de pacotes</LabelWithHelp>
                      <Input inputMode="numeric" value={form.packets} onChange={(e) => set("packets", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Tamanho do payload ICMP em bytes (padrão 56).">Tamanho do pacote</LabelWithHelp>
                      <Input inputMode="numeric" value={form.packetSize} onChange={(e) => set("packetSize", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Tempo máximo de espera de resposta por pacote (segundos).">Tempo limite por ping (s)</LabelWithHelp>
                      <Input inputMode="decimal" value={form.perPingTimeout} onChange={(e) => set("perPingTimeout", e.target.value)} />
                    </div>
                  </div>
                </Block>
              )}

              {form.type !== "domain" && form.type !== "container" && (
                <SwitchBlock title="Identificar lentidão"
                  on={form.latencyDetectionEnabled}
                  onToggle={(v) => set("latencyDetectionEnabled", v)}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <LabelWithHelp htmlFor="mon-latency"
                        help="Marca o monitor como degradado quando a média permanece acima deste limite.">
                        Limite de resposta (ms)
                      </LabelWithHelp>
                      <Input id="mon-latency" inputMode="numeric" value={form.latencyThresholdMs}
                        onChange={(e) => set("latencyThresholdMs", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Janela usada para calcular a média do tempo de resposta.">
                        Intervalo
                      </LabelWithHelp>
                      <SelectWithSearch options={LATENCY_WINDOW_OPTS} value={form.latencyWindowSeconds}
                        onChange={(v) => set("latencyWindowSeconds", v)} />
                    </div>
                  </div>
                </SwitchBlock>
              )}

              <SwitchBlock title="Notificações"
                on={form.notificationsEnabled} onToggle={(v) => set("notificationsEnabled", v)}>
                <>
                  {channels.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum canal configurado. Crie em <span className="font-medium">Monitores → Notificações</span>.
                    </p>
                  ) : (
                    <>
                      {channels.map((ch) => (
                        <label key={ch.id} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={form.notificationChannelIds.includes(ch.id)}
                            onCheckedChange={() => toggleChannel(ch.id)} />
                          <span className="flex-1 truncate">{ch.name}</span>
                          <Badge variant="outline">{channelTypeLabel(ch.type)}</Badge>
                          {!ch.enabled && <Badge variant="secondary">off</Badge>}
                        </label>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        O monitor notifica apenas os canais marcados.
                      </p>
                    </>
                  )}
                  <SwitchBlock title="Reenviar notificação se continuar indisponível"
                    on={form.resendEnabled} onToggle={(v) => set("resendEnabled", v)}>
                    <div className="space-y-1.5">
                      <LabelWithHelp htmlFor="mon-resend" help="Reenvia a cada N falhas consecutivas (1 a 1000).">A cada quantas falhas consecutivas</LabelWithHelp>
                      <Input id="mon-resend" inputMode="numeric" value={form.resendEvery}
                        onChange={(e) => set("resendEvery", e.target.value)} className="w-40" />
                    </div>
                  </SwitchBlock>
                </>
              </SwitchBlock>

              {/* ===================== HTTP ===================== */}
              {form.type === "http" && (
                <>
                  {https && (
                    <>
                      <SwitchBlock title="Validar certificado expirado"
                        on={form.validateExpired} onToggle={(v) => set("validateExpired", v)} />
                      <SwitchBlock title="Ignorar erros TLS/SSL"
                        on={form.ignoreTlsErrors} onToggle={(v) => set("ignoreTlsErrors", v)} />
                    </>
                  )}
                  <SwitchBlock title="Usar proxy neste monitor"
                    on={useProxy}
                    onToggle={(v) => { setUseProxy(v); if (!v) set("proxyIds", []); }}>
                    <p className="text-xs text-muted-foreground">Roteia os heartbeats por um ou mais proxies.</p>
                    {(() => {
                      const active = proxies.filter((proxy) => proxy.enabled);
                      if (active.length === 0) {
                        return <p className="text-xs text-muted-foreground">Nenhum proxy ativo. Cadastre em <span className="font-medium">Uptime → Proxies</span>.</p>;
                      }
                      const allMode = proxyMode === "all";
                      const atCap = allMode && form.proxyIds.length >= MAX_ALL_PROXIES;
                      const allSelected = active.every((p) => form.proxyIds.includes(p.id));
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{form.proxyIds.length} de {active.length} selecionado(s)</span>
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                className="font-medium text-primary hover:underline"
                                onClick={() => set("proxyIds",
                                  [...active].sort(() => Math.random() - 0.5)
                                    .slice(0, Math.min(MAX_ALL_PROXIES, active.length))
                                    .map((p) => p.id))}
                              >
                                Aleatórios
                              </button>
                              <button
                                type="button"
                                className="font-medium text-primary hover:underline"
                                onClick={() => set("proxyIds", allSelected
                                  ? []
                                  : active.map((p) => p.id).slice(0, allMode ? MAX_ALL_PROXIES : active.length))}
                              >
                                {allSelected ? "Limpar" : "Selecionar todos"}
                              </button>
                            </div>
                          </div>
                          <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                            {active.map((proxy) => {
                              const checked = form.proxyIds.includes(proxy.id);
                              const disabled = !checked && atCap;
                              return (
                                <label key={proxy.id}
                                  className={`flex items-center gap-3 px-3 py-2 text-sm ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted"}`}>
                                  <Checkbox
                                    checked={checked}
                                    disabled={disabled}
                                    onCheckedChange={() => set("proxyIds", checked ? form.proxyIds.filter((id) => id !== proxy.id) : [...form.proxyIds, proxy.id])}
                                  />
                                  <Badge variant="muted" className="shrink-0">{proxy.protocol.toUpperCase()}</Badge>
                                  <span className="flex-1 truncate">{proxy.server}:{proxy.port}</span>
                                </label>
                              );
                            })}
                          </div>
                          {form.proxyIds.length > 1 && (
                            <div className="space-y-1.5 border-t pt-3">
                              <LabelWithHelp help="Define como os proxies selecionados participam dos heartbeats.">Modo</LabelWithHelp>
                              <select
                                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                value={proxyMode}
                                onChange={(event) => setProxyMode(event.target.value as "round_robin" | "all")}
                              >
                                <option value="round_robin">Load balance (round-robin)</option>
                                <option value="all">Usar todos em conjunto</option>
                              </select>
                              {allMode && (
                                <p className={`text-xs ${form.proxyIds.length > MAX_ALL_PROXIES ? "text-destructive" : "text-muted-foreground"}`}>
                                  No modo "usar todos em conjunto" são permitidos no máximo {MAX_ALL_PROXIES} proxies.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </SwitchBlock>
                </>
              )}

              {/* ===================== TCP ===================== */}
              {form.type === "tcp" && (
                <SwitchBlock title="SSL/TLS" on={form.tcpTls} onToggle={(v) => set("tcpTls", v)}>
                  <div className="space-y-1.5">
                    <LabelWithHelp help="Se definido, o monitor fica saudável quando o servidor responde com esse alerta TLS (ex.: exige certificado do cliente).">Alerta TLS esperado</LabelWithHelp>
                    <SelectWithSearch options={TCP_ALERT_OPTS} value={form.tcpExpectedAlert}
                      onChange={(v) => set("tcpExpectedAlert", v)} />
                  </div>
                </SwitchBlock>
              )}

              {/* ===================== HTTP: opções avançadas ===================== */}
              {form.type === "http" && (
                <>
                  <Block title="Opções HTTP">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <LabelWithHelp help="Método HTTP da requisição.">Método</LabelWithHelp>
                        <SelectWithSearch options={METHOD_OPTS} value={form.method} onChange={(v) => set("method", v)} />
                      </div>
                      <div className="space-y-1.5">
                        <LabelWithHelp help="Como o corpo é codificado ao enviar.">Codificação do corpo</LabelWithHelp>
                        <SelectWithSearch options={BODY_ENC_OPTS} value={form.bodyEncoding}
                          onChange={(v) => set("bodyEncoding", v as "json" | "form")} />
                      </div>
                    </div>
                    <KeyValueList label="Corpo" help="Pares chave/valor enviados no corpo da requisição." pairs={form.body} onChange={(p) => set("body", p)} />
                    <KeyValueList label="Cabeçalhos" help="Cabeçalhos HTTP adicionais." pairs={form.headers} onChange={(p) => set("headers", p)} />

                    <SwitchBlock title="Autenticação" on={form.authEnabled} onToggle={(v) => set("authEnabled", v)}>
                    <div className="space-y-1.5">
                      <LabelWithHelp help="Esquema de autenticação enviado na checagem.">Tipo</LabelWithHelp>
                      <SelectWithSearch options={AUTH_OPTS} value={form.authType}
                        onChange={(v) => set("authType", v as MonitorForm["authType"])} />
                    </div>

                    {form.authType === "basic" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Usuário do Basic Auth.">Usuário</LabelWithHelp>
                          <Input value={form.basicUsername} onChange={(e) => set("basicUsername", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Senha do Basic Auth. Fica mascarada após salvar.">Senha</LabelWithHelp>
                          <Input type="password" value={form.basicPassword} onChange={(e) => set("basicPassword", e.target.value)} />
                        </div>
                      </div>
                    )}

                    {form.authType === "bearer" && (
                      <div className="space-y-1.5">
                        <LabelWithHelp help="Token enviado como Authorization: Bearer.">Token</LabelWithHelp>
                        <Input value={form.bearerToken} onChange={(e) => set("bearerToken", e.target.value)} spellCheck={false} />
                      </div>
                    )}

                    {form.authType === "oauth2" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Onde enviar as credenciais do cliente ao pedir o token.">Método de autenticação</LabelWithHelp>
                          <SelectWithSearch options={OAUTH_METHOD_OPTS} value={form.oauthMethod}
                            onChange={(v) => set("oauthMethod", v as "header" | "body")} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Endpoint que emite o access_token (client_credentials).">URL do token OAuth</LabelWithHelp>
                          <Input value={form.oauthTokenUrl} onChange={(e) => set("oauthTokenUrl", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="client_id da aplicação OAuth.">ID do cliente</LabelWithHelp>
                          <Input value={form.oauthClientId} onChange={(e) => set("oauthClientId", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="client_secret. Fica mascarado após salvar.">Segredo do cliente</LabelWithHelp>
                          <Input type="password" value={form.oauthClientSecret} onChange={(e) => set("oauthClientSecret", e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Escopos solicitados (opcional).">Escopo OAuth (opcional)</LabelWithHelp>
                          <Input value={form.oauthScope} onChange={(e) => set("oauthScope", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Audience/público do token (opcional).">Público OAuth (opcional)</LabelWithHelp>
                          <Input value={form.oauthAudience} onChange={(e) => set("oauthAudience", e.target.value)} spellCheck={false} />
                        </div>
                      </div>
                    )}

                    {form.authType === "ntlm" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Usuário NTLM.">Usuário</LabelWithHelp>
                          <Input value={form.ntlmUsername} onChange={(e) => set("ntlmUsername", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Senha NTLM. Fica mascarada após salvar.">Senha</LabelWithHelp>
                          <Input type="password" value={form.ntlmPassword} onChange={(e) => set("ntlmPassword", e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Domínio NTLM.">Domínio</LabelWithHelp>
                          <Input value={form.ntlmDomain} onChange={(e) => set("ntlmDomain", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Estação de trabalho NTLM.">Estação de trabalho</LabelWithHelp>
                          <Input value={form.ntlmWorkstation} onChange={(e) => set("ntlmWorkstation", e.target.value)} spellCheck={false} />
                        </div>
                      </div>
                    )}

                    {form.authType === "mtls" && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Certificado do cliente em formato PEM.">Certificado (PEM)</LabelWithHelp>
                          <Textarea rows={3} value={form.mtlsCert} onChange={(e) => set("mtlsCert", e.target.value)}
                            spellCheck={false} className="font-mono text-xs" />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Chave privada em PEM. Fica mascarada após salvar.">Chave (PEM)</LabelWithHelp>
                          <Textarea rows={3} value={form.mtlsKey} onChange={(e) => set("mtlsKey", e.target.value)}
                            spellCheck={false} className="font-mono text-xs" />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="CA para validar o servidor (opcional).">CA (PEM, opcional)</LabelWithHelp>
                          <Textarea rows={3} value={form.mtlsCa} onChange={(e) => set("mtlsCa", e.target.value)}
                            spellCheck={false} className="font-mono text-xs" />
                        </div>
                      </div>
                    )}

                    {form.authType === "other" && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Cabeçalho customizado no formato Nome: valor.">Header</LabelWithHelp>
                          <Input value={form.otherHeader} onChange={(e) => set("otherHeader", e.target.value)}
                            placeholder="X-Auth: valor" spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <LabelWithHelp help="Parâmetro adicional de autenticação.">Param</LabelWithHelp>
                          <Input value={form.otherParam} onChange={(e) => set("otherParam", e.target.value)} spellCheck={false} />
                        </div>
                      </div>
                    )}
                    </SwitchBlock>

                    <SwitchBlock title="Search Keyword" on={form.keywordEnabled} onToggle={(v) => set("keywordEnabled", v)}>
                      <div className="space-y-1.5">
                        <LabelWithHelp htmlFor="mon-keyword" help="Pesquisa a palavra-chave em HTML simples ou resposta JSON e diferencia maiúsculas de minúsculas." required>Palavra-chave</LabelWithHelp>
                        <Input id="mon-keyword" value={form.keyword} onChange={(e) => set("keyword", e.target.value)}
                          spellCheck={false} />
                      </div>
                    </SwitchBlock>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <LabelWithHelp htmlFor="mon-maxbytes" help="Limita quantos bytes do corpo são lidos. 0 = sem limite.">Comprimento máx. da resposta (bytes)</LabelWithHelp>
                      <Input id="mon-maxbytes" inputMode="numeric" value={form.maxResponseBytes}
                        onChange={(e) => set("maxResponseBytes", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <LabelWithHelp htmlFor="mon-codes" help="Faixas/códigos aceitos como sucesso. Ex.: 200-299, 301, 302.">Códigos HTTP aceitáveis</LabelWithHelp>
                      <Input id="mon-codes" value={form.acceptedCodes} onChange={(e) => set("acceptedCodes", e.target.value)}
                        placeholder="200-299" spellCheck={false} />
                    </div>
                  </div>
                  </Block>

                  <Block title="Detalhes por checagem">
                    <p className="text-xs text-muted-foreground">
                      Estes detalhes são gravados <b>a cada heartbeat</b> e, em monitores frequentes,
                      crescem rápido no banco. Ative só o que for usar — ou registre apenas o último.
                    </p>
                    <label className="flex items-start gap-3">
                      <Checkbox checked={form.recordTimings} onCheckedChange={(v) => set("recordTimings", v === true)} className="mt-0.5" />
                      <span className="text-sm">Incluir timings
                        <span className="block text-xs text-muted-foreground">Detalhamento do tempo de resposta (DNS, TCP, TLS, TTFB, download) — alimenta o gráfico, o waterfall e os percentis p95/p99.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3">
                      <Checkbox checked={form.recordAdvanced} onCheckedChange={(v) => set("recordAdvanced", v === true)} className="mt-0.5" />
                      <span className="text-sm">Incluir informações avançadas
                        <span className="block text-xs text-muted-foreground">Tamanho da resposta (e comprimido), tipo de conteúdo, IP, versão HTTP e TLS (versão/cipher/ALPN) por checagem. É o dado mais pesado de armazenar.</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3">
                      <Checkbox checked={form.recordLastOnly} onCheckedChange={(v) => set("recordLastOnly", v === true)} className="mt-0.5" />
                      <span className="text-sm">Registrar apenas o último registro
                        <span className="block text-xs text-muted-foreground">Mantém timings/informações avançadas só na última checagem (sobrescreve a cada heartbeat), economizando espaço — o histórico fica sem esse detalhamento.</span>
                      </span>
                    </label>
                  </Block>
                </>
              )}

              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="mon-desc" help="Anotação livre sobre o monitor.">Descrição</LabelWithHelp>
                <Textarea id="mon-desc" rows={2} value={form.description}
                  onChange={(e) => set("description", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Tags cadastradas em Uptime → Tags.">Tags</LabelWithHelp>
                <ComboboxMultiple
                  options={tags.map((tag) => String(tag.id))}
                  value={form.tagIds.map(String)}
                  onValueChange={(value) => set("tagIds", value.map(Number))}
                  labelByValue={Object.fromEntries(tags.map((tag) => [String(tag.id), monitorTagLabel(tag)]))}
                  colorByValue={Object.fromEntries(tags.map((tag) => [String(tag.id), tag.color]))}
                  placeholder="Selecione as tags"
                  emptyMessage="Nenhuma tag cadastrada."
                  showClear
                  contentSide="top"
                />
              </div>

            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy || loading}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar monitor"}
            </Button>
          </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
