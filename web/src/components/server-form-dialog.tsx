import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Code2, HelpCircle, Loader2, Plus, Search, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NginxRawEditor } from "@/components/project/nginx-raw-editor";
import { get } from "@/lib/api";
import { Certificate, UpstreamSummary } from "@/lib/types";
import {
  CacheRoute,
  HeaderEntry,
  LocationRule,
  ServerForm,
  buildServerConfig,
  cachePathFor,
  cacheZoneName,
  emptyServerForm,
  parseServerForm,
  rateZoneName,
  sslRequired,
  validateServerForm,
} from "@/lib/server-config";
import { validateConfig } from "@/lib/validate";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (raw: string) => Promise<void>;
  /** Presente = popula o formulário a partir de uma config existente
   * (edição ou duplicação). */
  initial?: { raw: string; nodes: unknown[] } | null;
  /** Força o modo (título/botão). Padrão: edição quando há `initial`.
   * Duplicar passa `false` para pré-preencher mas criar um novo server. */
  isEdit?: boolean;
  /** Restringe campos que pertencem ao serviço controlador. */
  serviceManaged?: boolean;
};

/** Ícone de ajuda com tooltip explicando uma diretiva/campo. */
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

function FieldLabel({
  htmlFor,
  children,
  help,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  help?: string;
}) {
  return <LabelWithHelp htmlFor={htmlFor} help={help}>{children}</LabelWithHelp>;
}

function Check({
  checked,
  onChange,
  label,
  disabled,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  help?: string;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(!!v)} />
      <span className="min-w-0 break-words">{label}</span>
      {help && <Help text={help} />}
    </label>
  );
}

function ManagedLock({ locked, children, className = "block" }: {
  locked: boolean; children: ReactNode; className?: string;
}) {
  if (!locked) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className={className}>{children}</span></TooltipTrigger>
      <TooltipContent>Controlado por um serviço</TooltipContent>
    </Tooltip>
  );
}

function HeaderRows({
  id,
  entries,
  onChange,
  examples,
  addLabel,
}: {
  id: string;
  entries: HeaderEntry[];
  onChange: (entries: HeaderEntry[]) => void;
  examples: HeaderEntry[];
  addLabel: string;
}) {
  const rows =
    entries.length >= examples.length
      ? entries
      : [...entries, ...Array.from({ length: examples.length - entries.length }, () => ({ name: "", value: "" }))];

  function update(index: number, key: keyof HeaderEntry, value: string) {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const example = examples[index % examples.length];
        return (
          <div key={`${id}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
            <Input
              id={`${id}-name-${index}`}
              value={row.name}
              placeholder={example.name}
              onChange={(e) => update(index, "name", e.target.value)}
              spellCheck={false}
            />
            <Input
              id={`${id}-value-${index}`}
              value={row.value}
              placeholder={example.value}
              onChange={(e) => update(index, "value", e.target.value)}
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Remover header"
              onClick={() => remove(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { name: "", value: "" }])}>
        <Plus className="h-4 w-4" />
        {addLabel}
      </Button>
    </div>
  );
}

function StringRows({
  id,
  values,
  onChange,
  placeholder,
  addLabel,
}: {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  const rows = values.length ? values : [""];
  function update(index: number, value: string) {
    onChange(rows.map((row, i) => (i === index ? value : row)));
  }
  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }
  return (
    <div className="space-y-2">
      {rows.map((value, index) => (
        <div key={`${id}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            id={`${id}-${index}`}
            value={value}
            placeholder={placeholder}
            onChange={(e) => update(index, e.target.value)}
            spellCheck={false}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Remover" onClick={() => remove(index)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, ""])}>
        <Plus className="h-4 w-4" />
        {addLabel}
      </Button>
    </div>
  );
}

function CacheRouteRows({
  routes,
  onChange,
}: {
  routes: CacheRoute[];
  onChange: (routes: CacheRoute[]) => void;
}) {
  const rows = routes.length ? routes : [{ path: "", dedicated: false }];
  function update(index: number, patch: Partial<CacheRoute>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  return (
    <div className="space-y-2">
      {rows.map((r, index) => (
        <div key={`cache-route-${index}`} className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-40 flex-1"
            value={r.path}
            placeholder="/api"
            onChange={(e) => update(index, { path: e.target.value })}
            spellCheck={false}
          />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
            <Checkbox checked={r.dedicated} onCheckedChange={(v) => update(index, { dedicated: !!v })} />
            zona dedicada
          </label>
          <Button type="button" variant="outline" size="icon" aria-label="Remover"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm"
        onClick={() => onChange([...rows, { path: "", dedicated: false }])}>
        <Plus className="h-4 w-4" /> Adicionar rota
      </Button>
    </div>
  );
}

function LocationRows({
  locations,
  onChange,
}: {
  locations: LocationRule[];
  onChange: (locations: LocationRule[]) => void;
}) {
  function add() {
    onChange([
      ...locations,
      {
        path: "/api",
        handler: "proxy",
        proxyPass: "http://127.0.0.1:8080",
        proxyHostHeader: "$host",
        root: "",
        index: "index.html",
        jsonStatus: "200",
        jsonBody: '{"status":"ok"}',
      },
    ]);
  }
  function update(index: number, patch: Partial<LocationRule>) {
    onChange(locations.map((loc, i) => (i === index ? { ...loc, ...patch } : loc)));
  }
  function remove(index: number) {
    onChange(locations.filter((_, i) => i !== index));
  }
  return (
    <div className="space-y-3">
      {locations.map((loc, index) => (
        <div key={index} className="space-y-3 rounded-md border bg-muted/10 p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
            <Input value={loc.path} placeholder="/api"
              onChange={(e) => update(index, { path: e.target.value })} spellCheck={false} />
            <Select value={loc.handler} onChange={(e) => update(index, { handler: e.target.value as LocationRule["handler"] })}>
              <option value="proxy">Proxy</option>
              <option value="static">Estático</option>
              <option value="json">JSON</option>
            </Select>
            <Button type="button" variant="outline" size="icon" aria-label="Remover location" onClick={() => remove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {loc.handler === "proxy" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel help="Destino deste location. Gera proxy_pass.">proxy_pass</FieldLabel>
                <Input value={loc.proxyPass} placeholder="http://127.0.0.1:8080"
                  onChange={(e) => update(index, { proxyPass: e.target.value })} spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel help="Host enviado ao backend neste location. Gera proxy_set_header Host.">Host do proxy</FieldLabel>
                <Input value={loc.proxyHostHeader ?? "$host"} placeholder="$host"
                  onChange={(e) => update(index, { proxyHostHeader: e.target.value })} spellCheck={false} />
              </div>
            </div>
          )}
          {loc.handler === "static" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={loc.root} placeholder="/var/www/app"
                onChange={(e) => update(index, { root: e.target.value })} spellCheck={false} />
              <Input value={loc.index} placeholder="index.html"
                onChange={(e) => update(index, { index: e.target.value })} spellCheck={false} />
            </div>
          )}
          {loc.handler === "json" && (
            <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
              <Input value={loc.jsonStatus} placeholder="200" inputMode="numeric"
                onChange={(e) => update(index, { jsonStatus: e.target.value })} />
              <Input value={loc.jsonBody} placeholder='{"status":"ok"}'
                onChange={(e) => update(index, { jsonBody: e.target.value })} spellCheck={false} />
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4" />
        Adicionar location
      </Button>
    </div>
  );
}

function UpstreamPicker({
  upstreams,
  value,
  onChange,
}: {
  upstreams: UpstreamSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = upstreams.find((u) => u.id === value);
  const visibleValue = open ? query : selected?.id ?? value;
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return upstreams.slice(0, 30);
    return upstreams.filter((u) => u.id.toLowerCase().includes(term)).slice(0, 30);
  }, [query, upstreams]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={visibleValue}
          placeholder="Buscar upstream..."
          className="pl-8"
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          spellCheck={false}
        />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background p-1 shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Nenhum upstream encontrado</div>
          ) : (
            filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="truncate font-medium">{u.id}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {u.servers.length} server{u.servers.length === 1 ? "" : "s"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HeaderValueBlock({
  title,
  help,
  enabled,
  value,
  onEnabled,
  onValue,
  placeholder,
  multiline,
}: {
  title: string;
  help: string;
  enabled: boolean;
  value: string;
  onEnabled: (value: boolean) => void;
  onValue: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <Group
      title={title}
      help={help}
      action={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">Habilitar</span>
          <Switch checked={enabled} onCheckedChange={onEnabled} aria-label={`Habilitar ${title}`} />
        </label>
      }
    >
      {enabled && (
        <div className="space-y-1.5">
          <FieldLabel help={`Valor enviado no header ${title}.`}>Valor</FieldLabel>
          {multiline ? (
            <Textarea
              value={value}
              placeholder={placeholder}
              onChange={(e) => onValue(e.target.value)}
              spellCheck={false}
              className="min-h-[86px] font-mono text-xs"
            />
          ) : (
            <Input value={value} placeholder={placeholder} onChange={(e) => onValue(e.target.value)} spellCheck={false} />
          )}
        </div>
      )}
    </Group>
  );
}

/** Bloco de agrupamento dentro de uma aba (título opcional + ajuda). */
function Group({
  title,
  help,
  action,
  children,
}: {
  title?: string;
  help?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {title ? (
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
              {help && <Help text={help} />}
            </div>
          ) : (
            <span />
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

const TABS = [
  { id: "geral", label: "Geral" },
  { id: "ssl", label: "SSL/TLS" },
  { id: "conteudo", label: "Conteúdo" },
  { id: "headers", label: "Headers" },
  { id: "cache", label: "Cache" },
  { id: "limites", label: "Limites" },
  { id: "waf", label: "WAF" },
] as const;

const SERVER_INDEX_PRESETS = [
  "index.html",
  "index.htm",
  "index.php",
  "index.html index.htm",
  "index.php index.html",
];
const CHARSET_PRESETS = ["utf-8", "iso-8859-1", "windows-1252", "us-ascii"];
const AUTOINDEX_FORMAT_OPTIONS = ["html", "xml", "json", "jsonp"];

export function ServerFormDialog({ open, onOpenChange, onSubmit, initial, isEdit: isEditProp, serviceManaged = false }: Props) {
  const isEdit = isEditProp ?? !!initial;
  const [form, setForm] = useState<ServerForm>(emptyServerForm);
  const [tab, setTab] = useState<string>("geral");
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamSummary[]>([]);
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setTab("geral");
    if (initial) {
      const { form: parsed, faithful } = parseServerForm(initial.nodes);
      setForm(parsed);
      setRaw(initial.raw);
      setRawMode(serviceManaged ? false : !faithful);
      // Config com diretivas que o form não mostra → avisa (use o raw p/ não perder).
      setWarn(!faithful);
    } else {
      setForm(emptyServerForm);
      setRaw("");
      setRawMode(false);
      setWarn(false);
    }
    get<Certificate[]>("/certificates").then(setCerts).catch(() => setCerts([]));
    get<UpstreamSummary[]>("/upstreams").then(setUpstreams).catch(() => setUpstreams([]));
  }, [open, initial]);

  const needSsl = useMemo(() => form.ssl || sslRequired(form), [form]);
  const set = <K extends keyof ServerForm>(k: K, v: ServerForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function setCompression(kind: "gzip" | "brotli" | "zstd", enabled: boolean) {
    setForm((f) => ({
      ...f,
      gzip: kind === "gzip" ? enabled : false,
      brotli: kind === "brotli" ? enabled : false,
      zstd: kind === "zstd" ? enabled : false,
    }));
  }

  // Ao escolher um certificado do dropdown, preenche cert/key paths.
  function selectCert(name: string) {
    const c = certs.find((x) => x.name === name);
    setForm((f) => ({
      ...f,
      certName: name,
      certPath: c ? c.cert_path : f.certPath,
      keyPath: c ? c.key_path : f.keyPath,
    }));
  }

  function toggleRaw() {
    if (!rawMode) {
      if (initial && warn) {
        setRaw(initial.raw);
      } else {
        const err = validateServerForm(form);
        if (err) return setError(err);
        setRaw(buildServerConfig(form));
      }
    }
    setError(null);
    setRawMode((v) => !v);
  }

  async function submit() {
    let config: string;
    if (rawMode) {
      const err = validateConfig(raw, "Configuração");
      if (err) return setError(err);
      config = raw;
    } else {
      const err = validateServerForm(form);
      if (err) return setError(err);
      config = buildServerConfig(form);
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(config);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,1180px)] max-w-none p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar server" : "Novo server"}</DialogTitle>
          <DialogDescription>
            Monte o server pelas abas do formulário ou edite direto em modo avançado (raw).
          </DialogDescription>
        </DialogHeader>

        {warn && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            Esta config tem diretivas que o formulário não mostra. Use o <b>modo raw</b> para
            editá-las sem perdê-las.
          </p>
        )}

        {rawMode ? (
          <NginxRawEditor
            value={raw}
            onChange={setRaw}
            minHeight={420}
          />
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              {TABS.map((t) => (
                <ManagedLock key={t.id} locked={serviceManaged && (t.id === "ssl" || t.id === "conteudo")} className="inline-flex">
                  <TabsTrigger value={t.id} disabled={serviceManaged && (t.id === "ssl" || t.id === "conteudo")}>{t.label}</TabsTrigger>
                </ManagedLock>
              ))}
            </TabsList>

            <div className="max-h-[64vh] overflow-y-auto pr-1">
              {/* --- GERAL: Rede --- */}
              <TabsContent value="geral" className="space-y-4">
                <Group title="Rede" help="Endereço e porta em que o server responde (diretivas listen e server_name).">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-name" help="Hostnames atendidos por este server. Separe múltiplos por espaço; use _ para o server padrão (catch-all).">
                        server_name *
                      </FieldLabel>
                      <ManagedLock locked={serviceManaged}><Input id="sf-name" value={form.serverName} disabled={serviceManaged} placeholder="exemplo.com www.exemplo.com"
                        onChange={(e) => set("serverName", e.target.value)} spellCheck={false} /></ManagedLock>
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-listen" help="Porta TCP escutada. 443 liga SSL automaticamente; 80 é HTTP simples.">
                        listen (porta) *
                      </FieldLabel>
                      <ManagedLock locked={serviceManaged}><Input id="sf-listen" value={form.listen} disabled={serviceManaged} inputMode="numeric"
                        onChange={(e) => set("listen", e.target.value)} /></ManagedLock>
                    </div>
                  </div>
                  <ManagedLock locked={serviceManaged} className="inline-flex"><Check checked={form.ipv6} onChange={(v) => set("ipv6", v)} label="Escutar IPv6" disabled={serviceManaged}
                    help="Adiciona listen [::]:porta. O interruptor global de IPv6 (Configurações › Nginx) prevalece sobre este campo." /></ManagedLock>
                </Group>

                <Group
                  title="Charset"
                  help="Diretiva charset no nível do server. Escolha um valor comum ou use Custom."
                  action={
                    <Switch
                      checked={!!form.charset.trim()}
                      onCheckedChange={(v) => set("charset", v ? (form.charset.trim() || "utf-8") : "")}
                      aria-label="Habilitar charset"
                    />
                  }
                >
                  {!!form.charset.trim() && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-charset-mode" help="Selecione um charset comum ou use um valor customizado.">
                          Valor
                        </FieldLabel>
                        <SelectWithSearch
                          value={CHARSET_PRESETS.includes(form.charset.trim().toLowerCase()) ? form.charset.trim().toLowerCase() : "custom"}
                          options={[
                            ...CHARSET_PRESETS.map((value) => ({ value, label: value })),
                            { value: "custom", label: "Custom" },
                          ]}
                          onChange={(value) => {
                            if (value === "custom") {
                              set("charset", form.charset.trim() && !CHARSET_PRESETS.includes(form.charset.trim().toLowerCase()) ? form.charset : "utf-16");
                            } else {
                              set("charset", value);
                            }
                          }}
                          searchPlaceholder="Pesquisar charset"
                          emptyMessage="Nenhum charset encontrado."
                        />
                      </div>
                      {!CHARSET_PRESETS.includes(form.charset.trim().toLowerCase()) && (
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-charset-custom" help="Valor gerado como charset <valor>;.">
                            custom
                          </FieldLabel>
                          <Input id="sf-charset-custom" value={form.charset} placeholder="utf-8"
                            onChange={(e) => set("charset", e.target.value)} spellCheck={false} />
                        </div>
                      )}
                    </div>
                  )}
                </Group>

                <Group
                  title="Root"
                  help="Diretiva root no nível do server. Opcional; locations podem herdar este caminho."
                  action={
                    <ManagedLock locked={serviceManaged} className="inline-flex"><Switch
                      checked={!!form.serverRoot.trim()}
                      disabled={serviceManaged}
                      onCheckedChange={(v) => set("serverRoot", v ? (form.serverRoot.trim() || "/var/www/site") : "")}
                      aria-label="Habilitar root"
                    /></ManagedLock>
                  }
                >
                  {!!form.serverRoot.trim() && (
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-server-root" help="Caminho base de arquivos para este server.">
                        root
                      </FieldLabel>
                      <ManagedLock locked={serviceManaged}><Input id="sf-server-root" value={form.serverRoot} disabled={serviceManaged} placeholder="/var/www/site"
                        onChange={(e) => set("serverRoot", e.target.value)} spellCheck={false} /></ManagedLock>
                    </div>
                  )}
                </Group>

                <Group
                  title="Index"
                  help="Diretiva index no nível do server. Escolha valores comuns ou use Custom para informar a lista manualmente."
                  action={
                    <Switch
                      checked={!!form.serverIndex.trim()}
                      onCheckedChange={(v) => set("serverIndex", v ? (form.serverIndex.trim() || "index.html") : "")}
                      aria-label="Habilitar index"
                    />
                  }
                >
                  <div className="space-y-4">
                    {!!form.serverIndex.trim() && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-server-index-mode" help="Selecione um preset comum ou use um valor customizado.">
                            Valor
                          </FieldLabel>
                          <SelectWithSearch
                            value={SERVER_INDEX_PRESETS.includes(form.serverIndex.trim()) ? form.serverIndex.trim() : "custom"}
                            options={[
                              ...SERVER_INDEX_PRESETS.map((value) => ({ value, label: value })),
                              { value: "custom", label: "Custom" },
                            ]}
                            onChange={(value) => {
                              if (value === "custom") {
                                set("serverIndex", form.serverIndex.trim() && !SERVER_INDEX_PRESETS.includes(form.serverIndex.trim()) ? form.serverIndex : "index.html index.htm index.php");
                              } else {
                                set("serverIndex", value);
                              }
                            }}
                            searchPlaceholder="Pesquisar index"
                            emptyMessage="Nenhum valor encontrado."
                          />
                        </div>
                        {!SERVER_INDEX_PRESETS.includes(form.serverIndex.trim()) && (
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-server-index-custom" help="Lista de arquivos padrão, separados por espaço.">
                              custom
                            </FieldLabel>
                            <Input id="sf-server-index-custom" value={form.serverIndex} placeholder="index.html index.htm"
                              onChange={(e) => set("serverIndex", e.target.value)} spellCheck={false} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </Group>

                <Group
                  title="Autoindex"
                  help="Lista automaticamente o conteúdo de diretórios quando não houver arquivo index correspondente."
                  action={
                    <ManagedLock locked={serviceManaged} className="inline-flex"><Switch checked={form.autoindex} disabled={serviceManaged} onCheckedChange={(v) => set("autoindex", v)} aria-label="Habilitar autoindex" /></ManagedLock>
                  }
                >
                  {form.autoindex && (
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-autoindex-format" help="Formato da listagem gerada pelo autoindex.">
                          Formato
                        </FieldLabel>
                        <ManagedLock locked={serviceManaged}><SelectWithSearch
                          value={form.autoindexFormat}
                          disabled={serviceManaged}
                          options={AUTOINDEX_FORMAT_OPTIONS.map((value) => ({ value, label: value }))}
                          onChange={(value) => set("autoindexFormat", value)}
                          searchPlaceholder="Pesquisar formato"
                          emptyMessage="Nenhum formato encontrado."
                        /></ManagedLock>
                      </div>
                      <ManagedLock locked={serviceManaged} className="inline-flex"><Check
                        checked={form.autoindexExactSize}
                        disabled={serviceManaged}
                        onChange={(v) => set("autoindexExactSize", v)}
                        label="Exact size"
                        help="Gera tamanhos exatos em bytes. Desligado usa valores arredondados em KB, MB ou GB."
                      /></ManagedLock>
                      <ManagedLock locked={serviceManaged} className="inline-flex"><Check
                        checked={form.autoindexLocaltime}
                        disabled={serviceManaged}
                        onChange={(v) => set("autoindexLocaltime", v)}
                        label="Localtime"
                        help="Mostra horários no timezone local em vez de UTC."
                      /></ManagedLock>
                    </div>
                  )}
                </Group>

                <Group title="Compressão" help="Algoritmo usado para reduzir o tamanho das respostas. Apenas um tipo pode ficar ativo por vez; níveis maiores comprimem mais, mas consomem mais CPU.">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <Group
                      title="gzip"
                      help="Compressão gzip das respostas."
                      action={
                        <Switch checked={form.gzip} onCheckedChange={(v) => setCompression("gzip", v)} aria-label="Habilitar gzip" />
                      }
                    >
                      {form.gzip && (
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-gzip-level" help="Nível de compressão gzip, de 1 a 9.">
                            gzip_comp_level
                          </FieldLabel>
                          <Input id="sf-gzip-level" value={form.gzipLevel} inputMode="numeric" placeholder="5"
                            onChange={(e) => set("gzipLevel", e.target.value)} />
                        </div>
                      )}
                    </Group>

                    <Group
                      title="brotli"
                      help="Compressão brotli, com boa taxa para texto."
                      action={
                        <Switch checked={form.brotli} onCheckedChange={(v) => setCompression("brotli", v)} aria-label="Habilitar brotli" />
                      }
                    >
                      {form.brotli && (
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-brotli-level" help="Nível de compressão brotli, de 1 a 11.">
                            brotli_comp_level
                          </FieldLabel>
                          <Input id="sf-brotli-level" value={form.brotliLevel} inputMode="numeric" placeholder="5"
                            onChange={(e) => set("brotliLevel", e.target.value)} />
                        </div>
                      )}
                    </Group>

                    <Group
                      title="zstd"
                      help="Compressão zstd, rápida e eficiente."
                      action={
                        <Switch checked={form.zstd} onCheckedChange={(v) => setCompression("zstd", v)} aria-label="Habilitar zstd" />
                      }
                    >
                      {form.zstd && (
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-zstd-level" help="Nível de compressão zstd, de 1 a 22.">
                            zstd_comp_level
                          </FieldLabel>
                          <Input id="sf-zstd-level" value={form.zstdLevel} inputMode="numeric" placeholder="3"
                            onChange={(e) => set("zstdLevel", e.target.value)} />
                        </div>
                      )}
                    </Group>
                  </div>
                </Group>

                <Group
                  title="Access log"
                  help="Registro de acesso. O formato padrão 'nexus' é JSON, consumido pelas páginas de Logs/Métricas."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.logMode !== "off"}
                        onCheckedChange={(v) => set("logMode", v ? "default" : "off")}
                        aria-label="Habilitar access log"
                      />
                    </label>
                  }
                >
                  {form.logMode !== "off" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-log-mode" help="'Padrão' usa /var/log/nginx/access.log com formato nexus; 'Personalizado' permite caminho e formato.">
                          Modo
                        </FieldLabel>
                        <SelectWithSearch
                          value={form.logMode}
                          options={[
                            { value: "default", label: "Padrão (nexus)" },
                            { value: "custom", label: "Personalizado" },
                          ]}
                          onChange={(value) => set("logMode", value as ServerForm["logMode"])}
                          searchPlaceholder="Pesquisar modo"
                          emptyMessage="Nenhum modo encontrado."
                        />
                      </div>
                      {form.logMode === "custom" && (
                        <>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-logpath" help="Caminho do arquivo de access log.">Caminho</FieldLabel>
                            <Input id="sf-logpath" value={form.logPath} spellCheck={false}
                              onChange={(e) => set("logPath", e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-logfmt" help="Nome do log_format usado. 'nexus' é o formato JSON do projeto.">Formato</FieldLabel>
                            <Input id="sf-logfmt" value={form.logFormat} spellCheck={false}
                              onChange={(e) => set("logFormat", e.target.value)} />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Gera <code>access_log off;</code>.
                    </p>
                  )}
                </Group>

                <Group
                  title="Error log"
                  help="Registro de erros deste server. O modo padrão herda o error_log global do nginx.conf."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.errorLogMode !== "off"}
                        onCheckedChange={(v) => set("errorLogMode", v ? "default" : "off")}
                        aria-label="Habilitar error log"
                      />
                    </label>
                  }
                >
                  {form.errorLogMode !== "off" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-errlog-mode" help="'Herdar global' não emite error_log; 'Personalizado' aponta arquivo e nível.">
                          Modo
                        </FieldLabel>
                        <SelectWithSearch
                          value={form.errorLogMode}
                          options={[
                            { value: "default", label: "Herdar global" },
                            { value: "custom", label: "Personalizado" },
                          ]}
                          onChange={(value) => set("errorLogMode", value as ServerForm["errorLogMode"])}
                          searchPlaceholder="Pesquisar modo"
                          emptyMessage="Nenhum modo encontrado."
                        />
                      </div>
                      {form.errorLogMode === "custom" && (
                        <>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-errpath" help="Caminho do arquivo de error log.">Caminho</FieldLabel>
                            <Input id="sf-errpath" value={form.errorLogPath} spellCheck={false}
                              placeholder="/var/log/nexus/nginx.log"
                              onChange={(e) => set("errorLogPath", e.target.value)} />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-errlevel" help="Nível mínimo registrado: debug, info, notice, warn, error, crit, alert, emerg.">
                              Nível
                            </FieldLabel>
                            <Select id="sf-errlevel" value={form.errorLogLevel}
                              onChange={(e) => set("errorLogLevel", e.target.value)}>
                              {["debug", "info", "notice", "warn", "error", "crit", "alert", "emerg"].map((lv) => (
                                <option key={lv} value={lv}>{lv}</option>
                              ))}
                            </Select>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Gera <code>error_log /dev/null crit;</code>.
                    </p>
                  )}
                </Group>
              </TabsContent>

              {/* --- SSL/TLS --- */}
              <TabsContent value="ssl" className="space-y-4">
                <Group
                  title="SSL/TLS"
                  help="Terminação TLS: certificado, chave e protocolos HTTP/2 e HTTP/3. Na porta 443 o SSL é obrigatório."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {sslRequired(form) ? "Obrigatório" : "Habilitar"}
                      </span>
                      <Switch
                        checked={needSsl}
                        disabled={sslRequired(form)}
                        onCheckedChange={(v) => set("ssl", v)}
                        aria-label="Habilitar SSL/TLS"
                      />
                    </label>
                  }
                >
                  {needSsl ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5 sm:max-w-[280px]">
                        <FieldLabel help="'Certificado gerado' usa um cert da página Certificados; 'Informar caminho' aponta arquivos crt/key manualmente.">
                          Origem do certificado
                        </FieldLabel>
                        <SelectWithSearch
                          value={form.certMode}
                          options={[
                            { value: "select", label: "Certificado gerado" },
                            { value: "path", label: "Informar caminho" },
                          ]}
                          onChange={(value) => set("certMode", value as ServerForm["certMode"])}
                          searchPlaceholder="Pesquisar origem"
                          emptyMessage="Nenhuma origem encontrada."
                        />
                      </div>
                      {form.certMode === "select" ? (
                        <div className="space-y-1.5">
                          <FieldLabel help="Certificados emitidos/gerenciados na página Certificados. Preenche ssl_certificate e ssl_certificate_key.">
                            Certificado
                          </FieldLabel>
                          <SelectWithSearch
                            value={form.certName}
                            options={[
                              { value: "", label: "selecione..." },
                              ...certs.map((c) => ({
                                value: c.name,
                                label: `${c.name} (${c.domains.join(", ") || c.type})`,
                                searchText: `${c.common_name} ${c.domains.join(" ")} ${c.type}`,
                              })),
                            ]}
                            onChange={selectCert}
                            placeholder="selecione..."
                            searchPlaceholder="Pesquisar certificado"
                            emptyMessage="Nenhum certificado encontrado."
                          />
                          {certs.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Nenhum certificado - gere um na página Certificados ou informe o caminho.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-cert" help="Caminho absoluto do certificado (fullchain).">
                              ssl_certificate *
                            </FieldLabel>
                            <Input id="sf-cert" value={form.certPath} placeholder="/etc/certs/exemplo.com.crt"
                              onChange={(e) => set("certPath", e.target.value)} spellCheck={false} />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-key" help="Caminho absoluto da chave privada.">
                              ssl_certificate_key *
                            </FieldLabel>
                            <Input id="sf-key" value={form.keyPath} placeholder="/etc/certs/exemplo.com.key"
                              onChange={(e) => set("keyPath", e.target.value)} spellCheck={false} />
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-6">
                        <Check checked={form.http2} onChange={(v) => set("http2", v)} label="HTTP/2"
                          help="Ativa http2 on; multiplexação de requisições sobre a mesma conexão TLS." />
                        <Check checked={form.http3} onChange={(v) => set("http3", v)} label="HTTP/3 (QUIC)"
                          help="Ativa http3 on; e um listen quic. Requer SSL; adiciona o header Alt-Svc." />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Habilite SSL/TLS para configurar certificado e protocolos.</p>
                  )}
                </Group>

                <Group
                  title="Segurança TLS avançada"
                  help="Diretivas avançadas de hardening TLS. Só são geradas quando SSL/TLS está ativo."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.tlsAdvanced}
                        disabled={!needSsl}
                        onCheckedChange={(v) => set("tlsAdvanced", v)}
                        aria-label="Habilitar segurança TLS avançada"
                      />
                    </label>
                  }
                >
                  {form.tlsAdvanced && needSsl && (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-ssl-protocols" help="Protocolos TLS permitidos. Recomendado: TLSv1.2 TLSv1.3.">
                            ssl_protocols
                          </FieldLabel>
                          <Input id="sf-ssl-protocols" value={form.sslProtocols}
                            onChange={(e) => set("sslProtocols", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-ssl-ciphers" help="Lista de ciphers. Vazio usa o padrão do nginx/OpenSSL.">
                            ssl_ciphers
                          </FieldLabel>
                          <Input id="sf-ssl-ciphers" value={form.sslCiphers} placeholder="HIGH:!aNULL:!MD5"
                            onChange={(e) => set("sslCiphers", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-ssl-cache" help="Cache de sessão TLS. Ex.: shared:SSL:10m.">
                            ssl_session_cache
                          </FieldLabel>
                          <Input id="sf-ssl-cache" value={form.sslSessionCache}
                            onChange={(e) => set("sslSessionCache", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-ssl-timeout" help="Tempo de validade da sessão TLS. Ex.: 10m.">
                            ssl_session_timeout
                          </FieldLabel>
                          <Input id="sf-ssl-timeout" value={form.sslSessionTimeout}
                            onChange={(e) => set("sslSessionTimeout", e.target.value)} spellCheck={false} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-6">
                        <Check checked={form.sslPreferServerCiphers}
                          onChange={(v) => set("sslPreferServerCiphers", v)}
                          label="ssl_prefer_server_ciphers"
                          help="Prioriza a ordem de ciphers do servidor." />
                        <Check checked={form.ocspStapling}
                          onChange={(v) => set("ocspStapling", v)}
                          label="OCSP stapling"
                          help="Gera ssl_stapling on e ssl_stapling_verify on." />
                      </div>
                    </div>
                  )}
                </Group>
              </TabsContent>

              {/* --- CONTEÚDO --- */}
              <TabsContent value="conteudo" className="space-y-4">
                <Group title="Tipo de conteúdo" help="O que o location / principal entrega.">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                    <div className="space-y-1.5">
                    <FieldLabel htmlFor="sf-handler" help="Define o location / gerado: proxy_pass, root+try_files, resposta JSON ou return 200.">
                      Tipo
                    </FieldLabel>
                    <SelectWithSearch
                      value={form.handler}
                      options={[
                        { value: "proxy", label: "Proxy reverso (proxy_pass)" },
                        { value: "static", label: "Arquivos estáticos (root)" },
                        { value: "php", label: "PHP / FastCGI" },
                        { value: "json", label: "Resposta JSON (return)" },
                        { value: "none", label: "Vazio (retorna 200)" },
                      ]}
                      onChange={(value) => set("handler", value as ServerForm["handler"])}
                      searchPlaceholder="Pesquisar tipo"
                      emptyMessage="Nenhum tipo encontrado."
                    />
                  </div>
                    <p className="self-end text-xs text-muted-foreground">
                      As opções abaixo mudam conforme o tipo escolhido.
                    </p>
                  </div>
                </Group>

                {form.handler === "proxy" && (
                  <Group title="Proxy reverso" help="Destino e headers enviados ao backend no location /.">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel help="'Upstream' aponta para um bloco upstream (página Upstreams); 'Custom' informa uma URL de destino diretamente.">
                          Destino do proxy
                        </FieldLabel>
                        <SelectWithSearch
                          value={form.proxyMode}
                          options={[
                            { value: "upstream", label: "Upstream" },
                            { value: "custom", label: "Custom (URL)" },
                          ]}
                          onChange={(value) => set("proxyMode", value as ServerForm["proxyMode"])}
                          searchPlaceholder="Pesquisar destino"
                          emptyMessage="Nenhum destino encontrado."
                        />
                      </div>

                      {form.proxyMode === "upstream" ? (
                        <div className="space-y-1.5">
                          <FieldLabel help="Pesquise pelo nome do upstream. Gera proxy_pass http://<upstream>.">
                            Upstream *
                          </FieldLabel>
                          <UpstreamPicker
                            upstreams={upstreams}
                            value={form.proxyUpstream}
                            onChange={(value) => set("proxyUpstream", value)}
                          />
                          {upstreams.length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              Nenhum upstream — crie um na página Upstreams ou use Custom.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-proxy" help="URL de destino do proxy_pass (protocolo + host + porta).">
                            Destino (proxy_pass) *
                          </FieldLabel>
                          <Input id="sf-proxy" value={form.proxyPass} placeholder="http://127.0.0.1:8080"
                            onChange={(e) => set("proxyPass", e.target.value)} spellCheck={false} />
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-proxy-host" help="Valor de proxy_set_header Host enviado ao backend no location /. Padrão $host; use $proxy_host para o host do upstream ou um valor fixo.">
                          Host do proxy
                        </FieldLabel>
                        <Input id="sf-proxy-host" value={form.proxyHostHeader} placeholder="$host"
                          onChange={(e) => set("proxyHostHeader", e.target.value)} spellCheck={false} />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-6">
                      <Check checked={form.websocket} onChange={(v) => set("websocket", v)} label="WebSocket"
                        help="Adiciona proxy_http_version 1.1 e os headers Upgrade/Connection para túneis WebSocket." />
                    </div>

                    {form.proxyMode === "upstream" && form.proxyUpstream && (
                      <p className="text-xs text-muted-foreground">
                        proxy_pass <code>http://{form.proxyUpstream}</code>
                      </p>
                    )}
                  </Group>
                )}

                {form.handler === "static" && (
                  <Group title="Arquivos estáticos" help="Serve arquivos diretamente do filesystem com root, index e try_files.">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-root" help="Diretório servido (diretiva root).">root *</FieldLabel>
                        <Input id="sf-root" value={form.root} placeholder="/var/www/site"
                          onChange={(e) => set("root", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-index" help="Arquivo padrão servido quando a URL aponta para um diretório.">index</FieldLabel>
                        <Input id="sf-index" value={form.index}
                          onChange={(e) => set("index", e.target.value)} spellCheck={false} />
                      </div>
                    </div>
                  </Group>
                )}

                {form.handler === "php" && (
                  <Group title="PHP / FastCGI" help="Gera location / com try_files para index.php e um location ~ \\.php$ com fastcgi_pass.">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5 sm:col-span-2">
                        <FieldLabel htmlFor="sf-php-try-files" help="Fallback usado no location /. Padrão comum para Laravel e apps PHP front-controller.">
                          try_files *
                        </FieldLabel>
                        <Input id="sf-php-try-files" value={form.phpTryFiles} placeholder="$uri $uri/ /index.php?$query_string"
                          onChange={(e) => set("phpTryFiles", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-php-include" help="Arquivo de parâmetros FastCGI incluído no bloco PHP.">
                          include *
                        </FieldLabel>
                        <Input id="sf-php-include" value={form.phpInclude} placeholder="fastcgi_params"
                          onChange={(e) => set("phpInclude", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-php-pass" help="Destino FastCGI, por exemplo host:porta ou upstream.">
                          fastcgi_pass *
                        </FieldLabel>
                        <Input id="sf-php-pass" value={form.phpFastcgiPass} placeholder="10.0.0.8:7003"
                          onChange={(e) => set("phpFastcgiPass", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <FieldLabel htmlFor="sf-php-script" help="Valor do fastcgi_param SCRIPT_FILENAME.">
                          SCRIPT_FILENAME *
                        </FieldLabel>
                        <Input id="sf-php-script" value={form.phpScriptFilename} placeholder="$document_root$fastcgi_script_name"
                          onChange={(e) => set("phpScriptFilename", e.target.value)} spellCheck={false} />
                      </div>
                    </div>
                  </Group>
                )}

                {form.handler === "json" && (
                  <Group title="Resposta JSON" help="Retorna um corpo JSON direto pelo nginx.">
                    <div className="space-y-3">
                      <div className="space-y-1.5 sm:max-w-[160px]">
                        <FieldLabel htmlFor="sf-json-status" help="Código HTTP retornado (100–599). Ex.: 200.">
                          Status HTTP
                        </FieldLabel>
                        <Input id="sf-json-status" value={form.jsonStatus} inputMode="numeric" placeholder="200"
                          onChange={(e) => set("jsonStatus", e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-json-body" help="Corpo JSON retornado. Gera default_type application/json; return <status> '<corpo>';">
                          Corpo (JSON)
                        </FieldLabel>
                        <Textarea id="sf-json-body" value={form.jsonBody}
                          onChange={(e) => set("jsonBody", e.target.value)} spellCheck={false}
                          className="min-h-[80px] font-mono text-xs"
                          placeholder='{"status":"ok"}' />
                      </div>
                    </div>
                  </Group>
                )}

                {form.handler === "none" && (
                  <Group title="Resposta simples" help="Resposta fixa para health checks ou endpoints simples.">
                    <p className="text-xs text-muted-foreground">
                      Gera <code>return 200 'ok';</code> — útil para health checks simples.
                    </p>
                  </Group>
                )}

                <Group title="Regras por location" help="Adicione locations extras além do location / principal. Cada regra gera um bloco location próprio.">
                  <LocationRows
                    locations={form.extraLocations}
                    onChange={(locations) => set("extraLocations", locations)}
                  />
                </Group>
              </TabsContent>

              {/* --- HEADERS --- */}
              <TabsContent value="headers" className="space-y-4">
                <Group title="Headers de segurança" help="Escolha quais headers de hardening serão enviados nas respostas.">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Check
                      checked={form.securityHeaderFrameOptions}
                      onChange={(v) => set("securityHeaderFrameOptions", v)}
                      label="X-Frame-Options"
                      help='Gera X-Frame-Options "SAMEORIGIN"; ajuda a reduzir clickjacking.'
                    />
                    <Check
                      checked={form.securityHeaderContentTypeOptions}
                      onChange={(v) => set("securityHeaderContentTypeOptions", v)}
                      label="X-Content-Type-Options"
                      help='Gera X-Content-Type-Options "nosniff"; evita MIME sniffing em navegadores.'
                    />
                    <Check
                      checked={form.securityHeaderXssProtection}
                      onChange={(v) => set("securityHeaderXssProtection", v)}
                      label="X-XSS-Protection"
                      help='Gera X-XSS-Protection "1; mode=block"; compatibilidade com navegadores legados.'
                    />
                    <Check
                      checked={form.securityHeaderReferrerPolicy}
                      onChange={(v) => set("securityHeaderReferrerPolicy", v)}
                      label="Referrer-Policy"
                      help='Gera Referrer-Policy "no-referrer-when-downgrade"; controla envio do Referer.'
                    />
                  </div>
                </Group>

                <Group
                  title="CORS"
                  help="Cabeçalhos Access-Control-Allow-* para requisições cross-origin."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.cors}
                        onCheckedChange={(v) => set("cors", v)}
                        aria-label="Habilitar CORS"
                      />
                    </label>
                  }
                >
                  {form.cors && (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cors-origin" help="Origem permitida. Use * para qualquer origem.">
                            Access-Control-Allow-Origin
                          </FieldLabel>
                          <Input id="sf-cors-origin" value={form.corsOrigin} placeholder="*"
                            onChange={(e) => set("corsOrigin", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cors-methods" help="Métodos HTTP permitidos pelo navegador.">
                            Access-Control-Allow-Methods
                          </FieldLabel>
                          <Input id="sf-cors-methods" value={form.corsMethods}
                            placeholder="GET, POST, PUT, PATCH, DELETE, OPTIONS"
                            onChange={(e) => set("corsMethods", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cors-headers" help="Headers que o navegador pode enviar em requests cross-origin.">
                            Access-Control-Allow-Headers
                          </FieldLabel>
                          <Input id="sf-cors-headers" value={form.corsHeaders} placeholder="*"
                            onChange={(e) => set("corsHeaders", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cors-expose" help="Headers que o navegador pode expor ao JavaScript. Vazio não gera o header.">
                            Access-Control-Expose-Headers
                          </FieldLabel>
                          <Input id="sf-cors-expose" value={form.corsExposeHeaders} placeholder="X-Request-Id, X-Cache-Status"
                            onChange={(e) => set("corsExposeHeaders", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cors-max-age" help="Tempo em segundos para cachear o preflight OPTIONS. Vazio não gera o header.">
                            Access-Control-Max-Age
                          </FieldLabel>
                          <Input id="sf-cors-max-age" value={form.corsMaxAge} placeholder="86400"
                            inputMode="numeric" onChange={(e) => set("corsMaxAge", e.target.value)} />
                        </div>
                      </div>
                      <Check checked={form.corsCredentials}
                        onChange={(v) => set("corsCredentials", v)}
                        label="Access-Control-Allow-Credentials"
                        help="Permite cookies/credenciais em requests cross-origin. Evite usar com origem *." />
                    </div>
                  )}
                </Group>

                <Group
                  title="HSTS"
                  help="Strict-Transport-Security: força HTTPS no navegador. Só faz sentido com SSL."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">
                        {!needSsl ? "Requer SSL" : "Habilitar"}
                      </span>
                      <Switch
                        checked={form.hsts}
                        disabled={!needSsl}
                        onCheckedChange={(v) => set("hsts", v)}
                        aria-label="Habilitar HSTS"
                      />
                    </label>
                  }
                >
                  {form.hsts && needSsl && (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-hsts-max-age" help="Tempo, em segundos, que o navegador deve lembrar que o domínio só aceita HTTPS. 31536000 equivale a 1 ano.">
                            max-age
                          </FieldLabel>
                          <Input id="sf-hsts-max-age" value={form.hstsMaxAge} placeholder="31536000"
                            inputMode="numeric" disabled={!form.hsts || !needSsl}
                            onChange={(e) => set("hstsMaxAge", e.target.value)} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-6">
                        <Check checked={form.hstsIncludeSubDomains}
                          disabled={!form.hsts || !needSsl}
                          onChange={(v) => set("hstsIncludeSubDomains", v)}
                          label="includeSubDomains"
                          help="Aplica HSTS também aos subdomínios." />
                        <Check checked={form.hstsPreload}
                          disabled={!form.hsts || !needSsl}
                          onChange={(v) => set("hstsPreload", v)}
                          label="preload"
                          help="Adiciona o token preload para submissão à lista de preload dos navegadores." />
                        <Check checked={form.hstsAlways}
                          disabled={!form.hsts || !needSsl}
                          onChange={(v) => set("hstsAlways", v)}
                          label="always"
                          help="Faz o nginx enviar o header também em respostas de erro suportadas." />
                      </div>
                    </div>
                  )}
                </Group>

                <Group
                  title="Server Header"
                  help="Controla a exposição do header Server nas respostas."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Ocultar</span>
                      <Switch
                        checked={form.hideServer}
                        onCheckedChange={(v) => set("hideServer", v)}
                        aria-label="Ocultar header Server"
                      />
                    </label>
                  }
                >
                  {form.hideServer && (
                    <p className="text-xs text-muted-foreground">
                      Gera <code>more_clear_headers Server;</code>.
                    </p>
                  )}
                </Group>

                <Group title="Headers avançados" help="Políticas avançadas de navegador, isolamento cross-origin e controles legados/específicos.">
                  <div className="space-y-4">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <HeaderValueBlock
                        title="Content-Security-Policy"
                        help="Política de segurança de conteúdo para limitar scripts, estilos, frames, imagens e outros recursos."
                        enabled={form.cspEnabled}
                        value={form.cspValue}
                        onEnabled={(v) => set("cspEnabled", v)}
                        onValue={(v) => set("cspValue", v)}
                        placeholder="default-src 'self'; frame-ancestors 'self'; object-src 'none'"
                        multiline
                      />

                      <HeaderValueBlock
                        title="Permissions-Policy"
                        help="Controla APIs do navegador, como câmera, microfone e geolocalização."
                        enabled={form.permissionsPolicyEnabled}
                        value={form.permissionsPolicyValue}
                        onEnabled={(v) => set("permissionsPolicyEnabled", v)}
                        onValue={(v) => set("permissionsPolicyValue", v)}
                        placeholder="camera=(), microphone=(), geolocation=()"
                      />
                    </div>

                    <Group title="Isolamento cross-origin" help="Headers COOP, COEP e CORP para isolamento entre origens e recursos incorporados.">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <HeaderValueBlock
                          title="COOP"
                          help="Cross-Origin-Opener-Policy. Isola a janela/documento de outras origens."
                          enabled={form.coopEnabled}
                          value={form.coopValue}
                          onEnabled={(v) => set("coopEnabled", v)}
                          onValue={(v) => set("coopValue", v)}
                          placeholder="same-origin"
                        />
                        <HeaderValueBlock
                          title="COEP"
                          help="Cross-Origin-Embedder-Policy. Exige recursos incorporados compatíveis com CORS/CORP."
                          enabled={form.coepEnabled}
                          value={form.coepValue}
                          onEnabled={(v) => set("coepEnabled", v)}
                          onValue={(v) => set("coepValue", v)}
                          placeholder="require-corp"
                        />
                        <HeaderValueBlock
                          title="CORP"
                          help="Cross-Origin-Resource-Policy. Define quem pode carregar recursos desta origem."
                          enabled={form.corpEnabled}
                          value={form.corpValue}
                          onEnabled={(v) => set("corpEnabled", v)}
                          onValue={(v) => set("corpValue", v)}
                          placeholder="same-origin"
                        />
                      </div>
                    </Group>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <HeaderValueBlock
                        title="Content-Disposition"
                        help="Controla se o conteúdo abre inline ou como download/anexo."
                        enabled={form.contentDispositionEnabled}
                        value={form.contentDispositionValue}
                        onEnabled={(v) => set("contentDispositionEnabled", v)}
                        onValue={(v) => set("contentDispositionValue", v)}
                        placeholder='inline ou attachment; filename="arquivo.pdf"'
                      />
                      <HeaderValueBlock
                        title="X-Permitted-Cross-Domain-Policies"
                        help="Header legado de hardening para políticas cross-domain de clientes antigos."
                        enabled={form.crossDomainPoliciesEnabled}
                        value={form.crossDomainPoliciesValue}
                        onEnabled={(v) => set("crossDomainPoliciesEnabled", v)}
                        onValue={(v) => set("crossDomainPoliciesValue", v)}
                        placeholder="none"
                      />
                      <HeaderValueBlock
                        title="X-DNS-Prefetch-Control"
                        help="Controla DNS prefetch feito pelo navegador."
                        enabled={form.dnsPrefetchControlEnabled}
                        value={form.dnsPrefetchControlValue}
                        onEnabled={(v) => set("dnsPrefetchControlEnabled", v)}
                        onValue={(v) => set("dnsPrefetchControlValue", v)}
                        placeholder="off"
                      />
                    </div>
                  </div>
                </Group>

                <div className="grid gap-4 lg:grid-cols-2">
                  <HeaderValueBlock
                    title="Cache-Control"
                    help="Controle de cache HTTP para respostas dinâmicas ou gerais."
                    enabled={form.cacheControlEnabled}
                    value={form.cacheControlValue}
                    onEnabled={(v) => set("cacheControlEnabled", v)}
                    onValue={(v) => set("cacheControlValue", v)}
                    placeholder="no-store"
                  />
                  <HeaderValueBlock
                    title="Vary"
                    help="Informa quais headers da requisição mudam a variante da resposta em caches."
                    enabled={form.varyEnabled}
                    value={form.varyValue}
                    onEnabled={(v) => set("varyEnabled", v)}
                    onValue={(v) => set("varyValue", v)}
                    placeholder="Accept-Encoding"
                  />
                  <HeaderValueBlock
                    title="X-Robots-Tag"
                    help="Controla indexação por buscadores via header HTTP."
                    enabled={form.xRobotsTagEnabled}
                    value={form.xRobotsTagValue}
                    onEnabled={(v) => set("xRobotsTagEnabled", v)}
                    onValue={(v) => set("xRobotsTagValue", v)}
                    placeholder="noindex, nofollow"
                  />
                  <HeaderValueBlock
                    title="Clear-Site-Data"
                    help="Instrui o navegador a limpar cache, cookies, storage ou execution contexts."
                    enabled={form.clearSiteDataEnabled}
                    value={form.clearSiteDataValue}
                    onEnabled={(v) => set("clearSiteDataEnabled", v)}
                    onValue={(v) => set("clearSiteDataValue", v)}
                    placeholder='"cache", "cookies", "storage"'
                  />
                </div>

                {form.handler === "static" && (
                  <Group title="Cache do navegador" help="expires + Cache-Control para arquivos estáticos.">
                    <Check checked={form.browserCache} onChange={(v) => set("browserCache", v)}
                      label="Habilitar cache do navegador"
                      help="Define expires e Cache-Control: public, immutable nos assets." />
                    {form.browserCache && (
                      <div className="space-y-1.5 sm:max-w-[220px]">
                        <FieldLabel htmlFor="sf-expires" help="Validade do cache no navegador (ex.: 7d, max, off).">
                          expires
                        </FieldLabel>
                        <Input id="sf-expires" value={form.browserCacheExpires} placeholder="7d"
                          onChange={(e) => set("browserCacheExpires", e.target.value)} />
                      </div>
                    )}
                  </Group>
                )}

                <Group title="Headers customizados" help="Cabeçalhos de resposta extras. Gera uma diretiva add_header para cada linha preenchida.">
                  <div className="space-y-1.5">
                    <HeaderRows
                      id="sf-headers"
                      entries={form.customHeaders}
                      onChange={(entries) => set("customHeaders", entries)}
                      examples={[
                        { name: "X-Content-Type-Options", value: '"nosniff"' },
                        { name: "Content-Type", value: '"application/json"' },
                      ]}
                      addLabel="Adicionar header"
                    />
                  </div>
                </Group>

                {form.handler === "proxy" && (
                  <Group title="Headers extras do proxy" help="Headers extras enviados ao backend. Gera proxy_set_header para cada linha preenchida. Host/X-Real-IP/X-Forwarded-* já são incluídos.">
                    <div className="space-y-1.5">
                      <HeaderRows
                        id="sf-proxy-headers"
                        entries={form.extraProxyHeaders}
                        onChange={(entries) => set("extraProxyHeaders", entries)}
                        examples={[
                          { name: "X-Request-Id", value: "$request_id" },
                          { name: "X-Forwarded-Host", value: "$host" },
                        ]}
                        addLabel="Adicionar proxy_set_header"
                      />
                    </div>
                  </Group>
                )}
              </TabsContent>

              {/* --- CACHE (proxy_cache) --- */}
              <TabsContent value="cache" className="space-y-4">
                {form.handler !== "proxy" ? (
                  <p className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
                    O cache reverso (proxy_cache) só se aplica ao tipo <b>Proxy reverso</b>.
                  </p>
                ) : (
                  <Group
                    title="Cache reverso"
                    help="Guarda respostas do backend para servir mais rápido. Quando habilitado, gera proxy_cache no location."
                    action={
                      <label className="flex items-center gap-2 text-sm">
                        <span className="text-xs text-muted-foreground">Habilitar</span>
                        <Switch
                          checked={form.cacheEnabled}
                          onCheckedChange={(v) => set("cacheEnabled", v)}
                          aria-label="Habilitar cache reverso"
                        />
                      </label>
                    }
                  >
                    {form.cacheEnabled && (
                      <div className="space-y-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-cache-valid" help="Por quanto tempo cada código é considerado válido no cache.">
                              proxy_cache_valid
                            </FieldLabel>
                            <Input id="sf-cache-valid" value={form.cacheValid} placeholder="200 301 302 10m"
                              onChange={(e) => set("cacheValid", e.target.value)} spellCheck={false} />
                          </div>
                          <div className="space-y-1.5">
                            <FieldLabel htmlFor="sf-cache-minuses" help="Nº de requisições antes de uma resposta ser cacheada.">
                              proxy_cache_min_uses
                            </FieldLabel>
                            <Input id="sf-cache-minuses" value={form.cacheMinUses} placeholder="1"
                              inputMode="numeric" onChange={(e) => set("cacheMinUses", e.target.value)} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-cache-key" help="Chave de cache (opcional). Padrão do nginx: $scheme$proxy_host$request_uri.">
                            proxy_cache_key (opcional)
                          </FieldLabel>
                          <Input id="sf-cache-key" value={form.cacheKey} placeholder="$scheme$host$request_uri"
                            onChange={(e) => set("cacheKey", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="flex flex-wrap gap-6">
                          <Check checked={form.cacheLock} onChange={(v) => set("cacheLock", v)}
                            label="proxy_cache_lock"
                            help="Evita várias requisições simultâneas ao backend pela mesma chave (só uma preenche o cache)." />
                          <Check checked={form.cacheBypass} onChange={(v) => set("cacheBypass", v)}
                            label="Bypass via Cache-Control/?nocache"
                            help="Permite pular o cache com o header Cache-Control ou o parâmetro ?nocache." />
                        </div>

                        <div className="space-y-2 rounded-md border p-3">
                          <FieldLabel help="Deixe vazio para cachear o server inteiro. Informe rotas (prefixos de URL, ex.: /api ou /static/) para cachear SÓ essas rotas — o restante passa direto ao backend. Marque 'zona dedicada' para dar à rota um cache próprio (limpável separadamente no painel de cache).">
                            Rotas a cachear (opcional)
                          </FieldLabel>
                          <p className="text-xs text-muted-foreground">
                            Vazio = cache global do server. Com rotas, só as URLs que começam por elas são cacheadas.
                            Uma <b>zona dedicada</b> por rota tem cache próprio (pode ser limpo separadamente).
                          </p>
                          <CacheRouteRows routes={form.cacheRoutes}
                            onChange={(routes) => set("cacheRoutes", routes)} />
                        </div>

                        <Group
                          title="Zona dedicada"
                          help="Zona própria deste server em vez da compartilhada nexus_cache. Quando habilitada, gera proxy_cache_path."
                          action={
                            <label className="flex items-center gap-2 text-sm">
                              <span className="text-xs text-muted-foreground">Habilitar</span>
                              <Switch
                                checked={form.cacheDedicated}
                                onCheckedChange={(v) => set("cacheDedicated", v)}
                                aria-label="Habilitar zona dedicada"
                              />
                            </label>
                          }
                        >
                          {!form.cacheDedicated && (
                            <p className="text-xs text-muted-foreground">
                              Usando a zona compartilhada <code>nexus_cache</code> (definida no nginx.conf).
                              Habilite para este server ter sua própria zona e definir o cache_path.
                            </p>
                          )}
                          {form.cacheDedicated && (
                            <div className="space-y-3">
                              <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <FieldLabel htmlFor="sf-cache-zone" help="Nome da zona de cache (keys_zone). Derivado do server_name se vazio.">
                                    keys_zone (nome)
                                  </FieldLabel>
                                  <Input id="sf-cache-zone" value={form.cacheZone}
                                    placeholder={cacheZoneName(form)} spellCheck={false}
                                    onChange={(e) => set("cacheZone", e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                  <FieldLabel htmlFor="sf-cache-zonesize" help="Memória reservada para as chaves da zona (ex.: 10m).">
                                    keys_zone (tamanho)
                                  </FieldLabel>
                                  <Input id="sf-cache-zonesize" value={form.cacheZoneSize} placeholder="10m"
                                    onChange={(e) => set("cacheZoneSize", e.target.value)} />
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <FieldLabel htmlFor="sf-cache-path" help="Diretório em disco do cache (absoluto). Derivado da zona se vazio.">
                                  cache_path (diretório)
                                </FieldLabel>
                                <Input id="sf-cache-path" value={form.cachePath}
                                  placeholder={cachePathFor(form)} spellCheck={false}
                                  onChange={(e) => set("cachePath", e.target.value)} />
                              </div>
                              <div className="grid gap-4 sm:grid-cols-3">
                                <div className="space-y-1.5">
                                  <FieldLabel htmlFor="sf-cache-levels" help="Níveis de subdiretórios do cache (ex.: 1:2).">levels</FieldLabel>
                                  <Input id="sf-cache-levels" value={form.cacheLevels} placeholder="1:2"
                                    onChange={(e) => set("cacheLevels", e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                  <FieldLabel htmlFor="sf-cache-max" help="Tamanho máximo do cache em disco (ex.: 1g).">max_size</FieldLabel>
                                  <Input id="sf-cache-max" value={form.cacheMaxSize} placeholder="1g"
                                    onChange={(e) => set("cacheMaxSize", e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                  <FieldLabel htmlFor="sf-cache-inactive" help="Remove do cache o que não é acessado neste período (ex.: 60m).">inactive</FieldLabel>
                                  <Input id="sf-cache-inactive" value={form.cacheInactive} placeholder="60m"
                                    onChange={(e) => set("cacheInactive", e.target.value)} />
                                </div>
                              </div>
                              <Check checked={form.cacheUseTempPath} onChange={(v) => set("cacheUseTempPath", v)}
                                label="use_temp_path"
                                help="Grava em diretório temporário antes de mover para o cache. Desligado costuma ser mais eficiente." />
                            </div>
                          )}
                        </Group>
                      </div>
                    )}
                  </Group>
                )}
              </TabsContent>

              {/* --- LIMITES --- */}
              <TabsContent value="limites" className="space-y-4">
                <Group title="Limites e timeouts" help="Tamanhos de corpo/buffer e timeouts de leitura do cliente. Vazio herda o padrão do nginx.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-body" help="Tamanho máximo do corpo da requisição (ex.: 500M). 0 desativa o limite.">
                        client_max_body_size
                      </FieldLabel>
                      <Input id="sf-body" value={form.clientMaxBodySize} placeholder="500M"
                        onChange={(e) => set("clientMaxBodySize", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-buf" help="Buffer em memória para o corpo antes de gravar em disco.">
                        client_body_buffer_size
                      </FieldLabel>
                      <Input id="sf-buf" value={form.clientBodyBufferSize} placeholder="128k"
                        onChange={(e) => set("clientBodyBufferSize", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-bt" help="Timeout entre leituras do corpo da requisição (ex.: 60s).">
                        client_body_timeout
                      </FieldLabel>
                      <Input id="sf-bt" value={form.clientBodyTimeout} placeholder="60s"
                        onChange={(e) => set("clientBodyTimeout", e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="sf-ht" help="Timeout para receber o cabeçalho completo da requisição (ex.: 15s).">
                        client_header_timeout
                      </FieldLabel>
                      <Input id="sf-ht" value={form.clientHeaderTimeout} placeholder="15s"
                        onChange={(e) => set("clientHeaderTimeout", e.target.value)} />
                    </div>
                  </div>
                </Group>

                <Group
                  title="Limite de requisições"
                  help="Limita a taxa de requisições por cliente. Quando habilitado, cria limit_req_zone no contexto http e aplica limit_req neste server."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.rateLimitEnabled}
                        onCheckedChange={(v) => set("rateLimitEnabled", v)}
                        aria-label="Habilitar limite de requisições"
                      />
                    </label>
                  }
                >
                  {form.rateLimitEnabled && (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-rl-rate" help="Taxa média permitida. Ex.: 10r/s (10 req/segundo) ou 60r/m.">
                            Taxa (rate) *
                          </FieldLabel>
                          <Input id="sf-rl-rate" value={form.rateLimitRate} placeholder="10r/s"
                            onChange={(e) => set("rateLimitRate", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-rl-burst" help="Rajada tolerada acima da taxa antes de recusar (excedente enfileirado ou processado com nodelay).">
                            burst
                          </FieldLabel>
                          <Input id="sf-rl-burst" value={form.rateLimitBurst} placeholder="20" inputMode="numeric"
                            onChange={(e) => set("rateLimitBurst", e.target.value)} />
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-rl-key" help="Chave que identifica o cliente. Padrão: $binary_remote_addr (por IP).">
                            Chave da zona
                          </FieldLabel>
                          <Input id="sf-rl-key" value={form.rateLimitKey} placeholder="$binary_remote_addr"
                            onChange={(e) => set("rateLimitKey", e.target.value)} spellCheck={false} />
                        </div>
                        <div className="space-y-1.5">
                          <FieldLabel htmlFor="sf-rl-size" help="Memória da zona de estado (ex.: 10m ≈ 160 mil IPs).">
                            Tamanho da zona
                          </FieldLabel>
                          <Input id="sf-rl-size" value={form.rateLimitZoneSize} placeholder="10m"
                            onChange={(e) => set("rateLimitZoneSize", e.target.value)} />
                        </div>
                      </div>
                      <Check checked={form.rateLimitNodelay} onChange={(v) => set("rateLimitNodelay", v)}
                        label="nodelay"
                        help="Processa a rajada imediatamente (sem enfileirar/atrasar). Desligado espaça as requisições da rajada." />
                      <p className="text-xs text-muted-foreground">
                        Zona gerada: <code>{rateZoneName(form)}</code>
                      </p>
                    </div>
                  )}
                </Group>

                <Group
                  title="Limite de banda"
                  help="Controla a velocidade de envio da resposta para o cliente com limit_rate e, opcionalmente, aplica o limite só depois de certo volume enviado."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.bandwidthLimitEnabled}
                        onCheckedChange={(v) => set("bandwidthLimitEnabled", v)}
                        aria-label="Habilitar limite de banda"
                      />
                    </label>
                  }
                >
                  {form.bandwidthLimitEnabled && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-limit-rate" help="Velocidade máxima de envio por conexão. Ex.: 512k, 1m, 10m. Gera limit_rate.">
                          limit_rate *
                        </FieldLabel>
                        <Input id="sf-limit-rate" value={form.bandwidthLimitRate} placeholder="1m"
                          onChange={(e) => set("bandwidthLimitRate", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-limit-rate-after" help="Volume enviado antes de aplicar o limite. Ex.: 10m. Vazio aplica desde o início.">
                          limit_rate_after
                        </FieldLabel>
                        <Input id="sf-limit-rate-after" value={form.bandwidthLimitAfter} placeholder="10m"
                          onChange={(e) => set("bandwidthLimitAfter", e.target.value)} spellCheck={false} />
                      </div>
                    </div>
                  )}
                </Group>
              </TabsContent>

              {/* --- WAF --- */}
              <TabsContent value="waf" className="space-y-4">
                <Group
                  title="Access control"
                  help="Controle de acesso por IP/CIDR e autenticação básica. Gera allow, deny, auth_basic e auth_basic_user_file."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.accessControlEnabled}
                        onCheckedChange={(v) => set("accessControlEnabled", v)}
                        aria-label="Habilitar access control"
                      />
                    </label>
                  }
                >
                  {form.accessControlEnabled && (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel help="IPs ou CIDRs permitidos. Ex.: 10.0.0.0/8, 192.168.0.10.">allow</FieldLabel>
                          <StringRows id="sf-allow" values={form.allowCidrs}
                            onChange={(values) => set("allowCidrs", values)}
                            placeholder="10.0.0.0/8" addLabel="Adicionar allow" />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel help="IPs ou CIDRs bloqueados. Use all para bloquear o restante após allow.">deny</FieldLabel>
                          <StringRows id="sf-deny" values={form.denyCidrs}
                            onChange={(values) => set("denyCidrs", values)}
                            placeholder="all" addLabel="Adicionar deny" />
                        </div>
                      </div>
                      <Group
                        title="Basic auth"
                        help="Protege este server com autenticação básica do nginx."
                        action={
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-xs text-muted-foreground">Habilitar</span>
                            <Switch
                              checked={form.basicAuthEnabled}
                              onCheckedChange={(v) => set("basicAuthEnabled", v)}
                              aria-label="Habilitar basic auth"
                            />
                          </label>
                        }
                      >
                        {form.basicAuthEnabled && (
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <FieldLabel htmlFor="sf-auth-realm" help="Texto mostrado no prompt de autenticação.">
                                auth_basic
                              </FieldLabel>
                              <Input id="sf-auth-realm" value={form.basicAuthRealm}
                                onChange={(e) => set("basicAuthRealm", e.target.value)} spellCheck={false} />
                            </div>
                            <div className="space-y-1.5">
                              <FieldLabel htmlFor="sf-auth-file" help="Arquivo htpasswd dentro do container.">
                                auth_basic_user_file
                              </FieldLabel>
                              <Input id="sf-auth-file" value={form.basicAuthUserFile}
                                onChange={(e) => set("basicAuthUserFile", e.target.value)} spellCheck={false} />
                            </div>
                          </div>
                        )}
                      </Group>
                    </div>
                  )}
                </Group>
                <Group
                  title="WAF simples"
                  help="Regras leves no nível do server para bloquear métodos, user agents e paths por regex."
                  action={
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground">Habilitar</span>
                      <Switch
                        checked={form.wafEnabled}
                        onCheckedChange={(v) => set("wafEnabled", v)}
                        aria-label="Habilitar WAF"
                      />
                    </label>
                  }
                >
                  {form.wafEnabled && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <FieldLabel htmlFor="sf-waf-methods" help="Métodos HTTP permitidos, separados por espaço. Ex.: GET POST OPTIONS. Métodos fora da lista retornam 405.">
                          Métodos permitidos
                        </FieldLabel>
                        <Input id="sf-waf-methods" value={form.wafBlockedMethods} placeholder="GET POST OPTIONS"
                          onChange={(e) => set("wafBlockedMethods", e.target.value)} spellCheck={false} />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabel help="Regex case-insensitive aplicada em $http_user_agent. Ex.: scanner|sqlmap|nikto.">
                            User agents bloqueados
                          </FieldLabel>
                          <StringRows id="sf-waf-ua" values={form.wafBlockedUserAgents}
                            onChange={(values) => set("wafBlockedUserAgents", values)}
                            placeholder="scanner|sqlmap|nikto" addLabel="Adicionar user agent" />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel help="Regex case-insensitive aplicada em $request_uri. Ex.: /\\.env|/wp-admin.">
                            Paths bloqueados
                          </FieldLabel>
                          <StringRows id="sf-waf-path" values={form.wafBlockedPaths}
                            onChange={(values) => set("wafBlockedPaths", values)}
                            placeholder="/\\.env|/wp-admin" addLabel="Adicionar path" />
                        </div>
                      </div>
                    </div>
                  )}
                </Group>
              </TabsContent>

            </div>
          </Tabs>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={toggleRaw} disabled={submitting || serviceManaged}>
            <Code2 className="h-4 w-4" />
            {rawMode ? "Voltar ao formulário" : "Modo avançado (raw)"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar server"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
