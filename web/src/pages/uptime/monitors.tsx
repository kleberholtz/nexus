import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  CheckCircle2,
  CircleDashed,
  FolderPlus,
  Globe2,
  GripVertical,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  ShieldX,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { del, get, post, put, streamUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCollapsed } from "@/lib/use-collapsed";
import {
  Monitor,
  MonitorDomainStatus,
  MonitorGroup,
  MonitorSslStatus,
  MonitorStatus,
  monitorTarget,
} from "@/lib/monitor-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { PageToolbar, Pagination, Paged, UptimeListRow, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverPopover } from "@/components/ui/hover-popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { MonitorFormDialog } from "@/components/monitor-form-dialog";
import { ResponseTimingsBars, hasTimings } from "@/components/uptime/detail-timings";
import { GroupDialog } from "@/components/monitor-group-dialog";
import { MonitorTagBadge } from "@/components/monitor-tag-badge";

const NO_GROUP = "__none__";

function StatusPill({ status }: { status: MonitorStatus }) {
  if (status === "maintenance")
    return <Badge variant="info" className="gap-1"><Wrench className="h-3 w-3" /> Manutenção</Badge>;
  if (status === "up")
    return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Saudável</Badge>;
  if (status === "degraded")
    return <Badge variant="warning" className="gap-1"><AlertTriangle className="h-3 w-3" /> Desempenho degradado</Badge>;
  if (status === "down")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Indisponível</Badge>;
  return <Badge variant="secondary" className="gap-1"><CircleDashed className="h-3 w-3" /> Pendente</Badge>;
}

type Beat = NonNullable<Monitor["beats"]>[number];
type SslState = MonitorSslStatus | "paused";

function sslCheckEnabled(m: Monitor): boolean {
  if (m.type === "tcp") return m.config.tls === true;
  return m.type === "http"
    && (m.config.url || "").toLowerCase().startsWith("https://")
    && m.config.ssl?.validate_expired !== false;
}

function sslState(m: Monitor): SslState {
  if (!m.active) return "paused";
  return m.ssl_info?.status || "pending";
}

const SSL_STATE_META: Record<SslState, { label: string; className: string; icon: typeof ShieldCheck }> = {
  valid: { label: "SSL válido", className: "text-success", icon: ShieldCheck },
  expiring: { label: "Certificado expira em breve", className: "text-amber-500", icon: ShieldAlert },
  expired: { label: "Certificado expirado", className: "text-destructive", icon: ShieldX },
  error: { label: "Falha na verificação SSL", className: "text-destructive", icon: ShieldX },
  unavailable: { label: "SSL não verificado", className: "text-amber-500", icon: ShieldAlert },
  pending: { label: "Aguardando verificação", className: "text-muted-foreground", icon: ShieldQuestion },
  paused: { label: "Verificação pausada", className: "text-muted-foreground", icon: ShieldOff },
};

const DAY_MS = 86_400_000;

function expirationLabel(expiresTs: number, now: number): string {
  if (!expiresTs) return "—";
  const date = new Date(expiresTs).toLocaleDateString("pt-BR");
  const remaining = expiresTs - now;
  if (remaining > 0) {
    const days = Math.ceil(remaining / DAY_MS);
    return `${date} · ${days} dia${days === 1 ? "" : "s"} restante${days === 1 ? "" : "s"}`;
  }
  const days = Math.max(1, Math.ceil(Math.abs(remaining) / DAY_MS));
  return `${date} · expirou há ${days} dia${days === 1 ? "" : "s"}`;
}

function validityDuration(issuedTs: number, expiresTs: number): string {
  if (!issuedTs || !expiresTs || expiresTs <= issuedTs) return "—";
  const days = Math.round((expiresTs - issuedTs) / DAY_MS);
  return `${days} dia${days === 1 ? "" : "s"}`;
}

/** Estado da inspeção SSL/TLS diária (ou forçada por “Checar agora”). */
function SslStatusPopover({ m, now }: { m: Monitor; now: number }) {
  if (!sslCheckEnabled(m)) return null;

  const info = m.ssl_info;
  const state = sslState(m);
  const meta = SSL_STATE_META[state];
  const Icon = meta.icon;
  const ignoreTlsErrors = m.type === "http" && m.config.ssl?.ignore_tls_errors === true;
  const expectedAlert = m.type === "tcp" ? m.config.expected_tls_alert : "";
  const trigger = (
    <button type="button" aria-label={`Status SSL: ${meta.label}`}
      onClick={(event) => event.stopPropagation()}
      className={`rounded-md p-1.5 transition-colors hover:bg-muted ${meta.className}`}>
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <HoverPopover trigger={trigger} width={340}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2.5">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.className}`} />
          <div>
            <div className="font-medium">Status SSL/TLS</div>
            <div className={`text-xs font-medium ${meta.className}`}>{meta.label}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Última verificação</span>
          <span className="text-right text-foreground">{info?.checked_ts ? fmtAgo(info.checked_ts, now) : "—"}</span>
          <span>Expiração</span>
          <span className="text-right text-foreground">{expirationLabel(info?.expires_ts || 0, now)}</span>
          <span>Duração total</span>
          <span className="text-right text-foreground">{validityDuration(info?.issued_ts || 0, info?.expires_ts || 0)}</span>
          {m.type === "http" ? (
            <>
              <span>Erros TLS</span>
              <span className={`text-right ${ignoreTlsErrors ? "text-amber-500" : "text-foreground"}`}>
                {ignoreTlsErrors ? "Ignorados" : "Validados"}
              </span>
            </>
          ) : (
            <>
              <span>Handshake TLS</span><span className="text-right text-foreground">Ativo</span>
              {expectedAlert && (
                <><span>Alerta esperado</span><span className="text-right text-foreground">{expectedAlert}</span></>
              )}
            </>
          )}
        </div>
        {info?.message && state !== "valid" && (
          <p className="break-words rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
            {info.message}
          </p>
        )}
      </div>
    </HoverPopover>
  );
}

type DomainState = MonitorDomainStatus | "paused";

const DOMAIN_STATE_META: Record<DomainState, { label: string; className: string }> = {
  valid: { label: "Domínio válido", className: "text-success" },
  expiring: { label: "Domínio expira em breve", className: "text-amber-500" },
  expired: { label: "Domínio expirado", className: "text-destructive" },
  not_found: { label: "Domínio não encontrado", className: "text-destructive" },
  unknown: { label: "Expiração não informada", className: "text-muted-foreground" },
  unavailable: { label: "Domínio não verificado", className: "text-amber-500" },
  pending: { label: "Aguardando verificação", className: "text-muted-foreground" },
  paused: { label: "Verificação pausada", className: "text-muted-foreground" },
};

/** Estado da consulta RDAP diária (ou forçada por “Checar agora”). */
function DomainStatusPopover({ m, now }: { m: Monitor; now: number }) {
  const domain = m.type === "domain" ? m.config.domain : "";
  if (!domain) return null;

  const info = m.domain_info;
  const state: DomainState = !m.active ? "paused" : info?.status || "pending";
  const meta = DOMAIN_STATE_META[state];
  const trigger = (
    <button type="button" aria-label={`Status do domínio: ${meta.label}`}
      onClick={(event) => event.stopPropagation()}
      className={`rounded-md p-1.5 transition-colors hover:bg-muted ${meta.className}`}>
      <Globe2 className="h-4 w-4" />
    </button>
  );

  return (
    <HoverPopover trigger={trigger} width={340}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2.5">
          <Globe2 className={`mt-0.5 h-5 w-5 shrink-0 ${meta.className}`} />
          <div className="min-w-0">
            <div className="font-medium">Status do domínio</div>
            <div className={`text-xs font-medium ${meta.className}`}>{meta.label}</div>
            <div className="truncate text-xs text-muted-foreground">{domain}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Última verificação</span>
          <span className="text-right text-foreground">{info?.checked_ts ? fmtAgo(info.checked_ts, now) : "—"}</span>
          <span>Expiração</span>
          <span className="text-right text-foreground">{expirationLabel(info?.expires_ts || 0, now)}</span>
          <span>Duração total</span>
          <span className="text-right text-foreground">
            {validityDuration(info?.registered_ts || 0, info?.expires_ts || 0)}
          </span>
        </div>
        {info?.message && state !== "valid" && (
          <p className="break-words rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
            {info.message}
          </p>
        )}
      </div>
    </HoverPopover>
  );
}

/** Exibe até três tags no monitor e agrupa o excedente em um popover. */
function MonitorTags({ tags }: { tags: Monitor["tags"] }) {
  if (tags.length === 0) return null;

  const visible = tags.slice(0, 3);
  const remaining = tags.length - visible.length;

  return (
    <div className="flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {visible.map((tag) => <MonitorTagBadge key={tag.id} tag={tag} />)}
      {remaining > 0 && (
        <HoverPopover
          width={280}
          trigger={
            <Badge
              variant="outline"
              className="cursor-default px-2 py-0.5 tabular-nums"
              aria-label={`Mais ${remaining} tag${remaining === 1 ? "" : "s"}`}
            >
              +{remaining}
            </Badge>
          }
        >
          <div className="space-y-2">
            <div className="text-sm font-medium">Todas as tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => <MonitorTagBadge key={tag.id} tag={tag} showValue />)}
            </div>
          </div>
        </HoverPopover>
      )}
    </div>
  );
}

/** Barra de heartbeats (estilo uptime) + popover com detalhes ao passar o mouse. */
function HeartbeatBar({ m, now }: { m: Monitor; now: number }) {
  const beats = (m.beats ?? []) as Beat[];
  const MAX = 90;
  const slice = beats.slice(-MAX);
  const pad = Math.max(0, MAX - slice.length);
  const status = m.status;
  const active = m.active;
  const label = !active ? "PAUSADO" : status === "maintenance" ? "MANUTENÇÃO"
    : status === "up" ? "OK" : status === "degraded" ? "DEGRADADO"
    : status === "down" ? "DOWN" : "PENDENTE";
  const dotCls = !active ? "text-muted-foreground"
    : status === "maintenance" ? "text-info"
    : status === "up" ? "text-success" : status === "degraded" ? "text-warning"
    : status === "down" ? "text-destructive" : "text-amber-500";

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const threshold = m.config?.latency_threshold_ms || 0;
  const beatDegraded = (b: Beat) => b.status === "up" && threshold > 0 && b.latency_ms > threshold;
  const beatRatio = (b: Beat) => (b.status === "up" ? Math.max(0, Math.min(1, b.up_ratio ?? 1)) : 0);
  const beatPartial = (b: Beat) => b.status === "up" && (b.up_ratio ?? 1) < 1;  // proxy parcial

  const okCount = slice.filter((b) => b.status === "up" && !beatDegraded(b) && !beatPartial(b)).length;
  const degradedCount = slice.filter(beatDegraded).length;
  const partialCount = slice.filter((b) => beatPartial(b) && !beatDegraded(b)).length;
  const downCount = slice.filter((b) => b.status === "down").length;
  const lats = slice.filter((b) => b.status === "up").map((b) => b.latency_ms);
  const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  // Disponibilidade ponderada: proxy parcial (3/4) conta como 0.75.
  const pct = slice.length
    ? Math.round((slice.reduce((s, b) => s + beatRatio(b), 0) / slice.length) * 100)
    : null;
  const lastTimings = [...beats].reverse().map((b) => b.timings).find(hasTimings);

  function beatCls(b: Beat, i: number): string {
    if (active && status === "pending" && i === slice.length - 1) return "bg-amber-500";
    if (b.status === "down") return "bg-destructive";
    if (beatDegraded(b) || beatPartial(b)) return "bg-warning";
    return "bg-success";
  }

  const trigger = (
    <div className="flex cursor-default items-center gap-3 rounded-md bg-muted/40 px-2.5 py-1.5">
      <div className="flex items-end gap-[2px]" onMouseLeave={() => setHoverIdx(null)}>
        {Array.from({ length: pad }).map((_, i) => (
          <span key={`p${i}`} className="h-5 w-[3px] rounded-sm bg-muted-foreground/25" />
        ))}
        {slice.map((b, i) => (
          <span key={i}
            onMouseEnter={() => setHoverIdx(i)}
            className={`h-5 w-[3px] rounded-sm ${beatCls(b, i)} ${
              i === hoverIdx ? "outline outline-1 outline-offset-1 outline-foreground/60" : ""}`} />
        ))}
      </div>
      <span className={`flex items-center gap-1 text-xs font-medium ${dotCls}`}>
        <span className="text-[10px] leading-none">●</span> {label}
      </span>
    </div>
  );

  const hovered = hoverIdx != null ? slice[hoverIdx] : null;

  return (
    <HoverPopover trigger={trigger} width={300}>
      {hovered ? (
        <BeatDetail beat={hovered} now={now} degraded={beatDegraded(hovered)} partial={beatPartial(hovered)} />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">Heartbeats</span>
            <span className={`text-xs font-medium ${dotCls}`}>● {label}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Últimas checagens</span><span className="text-right text-foreground">{slice.length}</span>
            <span>Disponibilidade</span><span className="text-right text-foreground">{pct === null ? "—" : `${pct}%`}</span>
            <span>Sucessos · degradados{partialCount ? " · parciais" : ""} · falhas</span>
            <span className="text-right">
              <span className="text-success">{okCount}</span> · <span className="text-warning">{degradedCount}</span>
              {partialCount > 0 && <> · <span className="text-warning">{partialCount}</span></>} · <span className="text-destructive">{downCount}</span>
            </span>
            <span>Latência média</span><span className="text-right text-foreground">{avg === null ? "—" : `${avg} ms`}</span>
            <span>Intervalo</span><span className="text-right text-foreground">
              {m.type === "domain" ? "a cada 24h" : `a cada ${m.interval_seconds}s`}
            </span>
            <span>Última checagem</span><span className="text-right text-foreground">{active ? fmtAgo(m.last_check_ts, now) : "pausado"}</span>
          </div>
          {lastTimings && (
            <div className="border-t pt-2">
              <ResponseTimingsBars timings={lastTimings} />
            </div>
          )}
          <p className="pt-0.5 text-[11px] text-muted-foreground">Passe o mouse sobre um ponto para ver a checagem.</p>
        </div>
      )}
    </HoverPopover>
  );
}

/** Lista de proxies do beat (um por linha; multi-proxy mostra o tempo de cada). */
function ProxyLines({ value }: { value: string }) {
  const lines = value.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const multi = lines.length > 1;
  return (
    <div className="border-t pt-1.5 text-xs">
      <span className="text-muted-foreground">{multi ? "Proxies" : "Proxy"}</span>
      <div className="mt-0.5 space-y-0.5 font-mono text-foreground">
        {lines.map((line, i) => <div key={i} className="truncate" title={line}>{line}</div>)}
      </div>
    </div>
  );
}

/** Detalhe de uma checagem individual (heartbeat) ao passar o mouse. */
function BeatDetail({ beat, now, degraded, partial }: {
  beat: Beat; now: number; degraded: boolean; partial: boolean;
}) {
  const ratio = Math.max(0, Math.min(1, beat.up_ratio ?? 1));
  const s = beat.status === "down"
    ? { label: "Falha", cls: "text-destructive" }
    : partial ? { label: "Proxy parcial", cls: "text-warning" }
    : degraded ? { label: "Degradado", cls: "text-warning" }
    : { label: "OK", cls: "text-success" };
  const timings = beat.timings;
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">Checagem</span>
        <span className={`text-xs font-medium ${s.cls}`}>● {s.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Horário</span><span className="text-right text-foreground">{new Date(beat.ts).toLocaleString()}</span>
        <span>Quando</span><span className="text-right text-foreground">{fmtAgo(beat.ts, now)}</span>
        <span>Latência</span><span className="text-right text-foreground">{beat.latency_ms} ms</span>
        {partial && (
          <>
            <span>Disponibilidade</span>
            <span className="text-right text-warning">{Math.round(ratio * 100)}%</span>
          </>
        )}
      </div>
      {beat.proxy && <ProxyLines value={beat.proxy} />}
      {hasTimings(timings) && (
        <div className="border-t pt-2">
          <ResponseTimingsBars timings={timings} />
        </div>
      )}
    </div>
  );
}

function IconAction({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function fmtAgo(ts: number, now: number): string {
  if (!ts) return "—";
  const ms = Math.max(0, now - ts);
  if (ms < 1000) return `${ms}ms atrás`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

export function MonitorsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const writable = can("monitors", "write");

  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [groups, setGroups] = useState<MonitorGroup[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [draggedMonitorId, setDraggedMonitorId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [toDelete, setToDelete] = useState<Monitor | null>(null);

  const [groupDialog, setGroupDialog] = useState<MonitorGroup | "new" | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<MonitorGroup | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [meta, setMeta] = useState<Omit<Paged<Monitor>, "items"> | null>(null);
  const debounced = useDebounced(query);
  const { page, setPage } = useUrlPagination(`${debounced}|${groupFilter}`);
  const { collapsed, toggle } = useCollapsed("monitors.collapsedGroups");

  // Relógio que "tica" p/ o "X atrás" ficar vivo (há monitores de 1s).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const esRef = useRef<EventSource | null>(null);
  const loadRef = useRef<() => void>(() => {});

  async function loadGroups() {
    try {
      setGroups(await get<MonitorGroup[]>("/monitors/groups"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar grupos");
    }
  }

  // Dados por GET paginado; o SSE só sinaliza mudança e dispara o refetch.
  const load = useCallback(async () => {
    const gp: Record<string, string> = groupFilter === NO_GROUP ? { no_group: "1" } : groupFilter ? { group_id: groupFilter } : {};
    try {
      const res = await get<Paged<Monitor>>(`/monitors?${pagedQuery(page, debounced, { push: "0", ...gp })}`);
      setMonitors(res.items);
      setMeta({ page: res.page, pages: res.pages, total: res.total });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar monitores");
    }
  }, [page, debounced, groupFilter]);
  loadRef.current = load;

  function connect() {
    esRef.current?.close();
    const es = new EventSource(streamUrl("/monitors/stream?push=0"));
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener("version", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 400);
    });
    es.onerror = () => { /* EventSource reconecta sozinho */ };
    esRef.current = es;
  }

  useEffect(() => { loadGroups(); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { connect(); return () => esRef.current?.close(); }, []);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, Monitor[]>();
    for (const m of monitors ?? []) {
      const key = m.group_id ? String(m.group_id) : NO_GROUP;
      (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(m);
    }
    const hideEmpty = !!(query.trim() || groupFilter || (meta?.pages ?? 1) > 1);
    const sections: { id: string; name: string; items: Monitor[] }[] = [];
    for (const g of groups) {
      const id = String(g.id);
      if (groupFilter && groupFilter !== id) continue;
      const items = byGroup.get(id) ?? [];
      if (hideEmpty && items.length === 0) continue;
      sections.push({ id, name: g.name, items });
    }
    if (!groupFilter || groupFilter === NO_GROUP) {
      const items = byGroup.get(NO_GROUP) ?? [];
      if (!hideEmpty || items.length > 0)
        sections.push({ id: NO_GROUP, name: "Sem grupo", items });
    }
    return sections;
  }, [monitors, groups, query, groupFilter, meta]);

  function clearDragState() {
    setDraggedMonitorId(null);
    setDragOverGroup(null);
  }

  async function moveMonitorToGroup(monitorId: number, sectionId: string) {
    const monitor = monitors?.find((item) => item.id === monitorId);
    if (!monitor) return clearDragState();
    const targetGroupId = sectionId === NO_GROUP ? null : Number(sectionId);
    if (monitor.group_id === targetGroupId) return clearDragState();

    const previousGroupId = monitor.group_id;
    const previousGroupName = monitor.group_name;
    const targetName = targetGroupId === null
      ? "Sem grupo"
      : groups.find((group) => group.id === targetGroupId)?.name ?? "outro grupo";

    setBusy(monitorId);
    setMonitors((current) => current?.map((item) => item.id === monitorId
      ? { ...item, group_id: targetGroupId, group_name: targetGroupId === null ? null : targetName }
      : item) ?? current);
    clearDragState();
    try {
      await put(`/monitors/${monitorId}/group`, { group_id: targetGroupId });
      toast.success(`Monitor movido para “${targetName}”`);
      await loadGroups();
    } catch (error) {
      setMonitors((current) => current?.map((item) => item.id === monitorId
        ? { ...item, group_id: previousGroupId, group_name: previousGroupName }
        : item) ?? current);
      toast.error(error instanceof Error ? error.message : "Falha ao mover monitor");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(m: Monitor) {
    setBusy(m.id);
    try {
      await post(`/monitors/${m.id}/${m.active ? "disable" : "enable"}`);
      // otimista: SSE atualiza logo em seguida
      setMonitors((cur) => cur?.map((x) => (x.id === m.id ? { ...x, active: !x.active } : x)) ?? cur);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar");
    } finally {
      setBusy(null);
    }
  }

  async function checkNow(m: Monitor) {
    setBusy(m.id);
    try {
      await post(`/monitors/${m.id}/check`);
      toast.success("Checagem executada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao checar");
    } finally {
      setBusy(null);
    }
  }

  async function removeMonitor() {
    if (!toDelete) return;
    try {
      await del(`/monitors/${toDelete.id}`);
      toast.success("Monitor removido");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  async function removeGroup() {
    if (!groupToDelete) return;
    try {
      await del(`/monitors/groups/${groupToDelete.id}`);
      toast.success("Grupo removido");
      await loadGroups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover grupo");
    } finally {
      setGroupToDelete(null);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* título + configuração de notificações (à direita do título) */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Activity className="h-6 w-6" /> Monitores
            </h1>
            <p className="text-sm text-muted-foreground">Healthchecks agrupados, com status ao vivo.</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/notifications")}>
            <Bell className="h-4 w-4" /> Notificações
          </Button>
        </div>

        <PageToolbar onRefresh={() => { loadGroups(); load(); }} search={query} onSearch={setQuery} placeholder="Pesquisar monitores">
          <div className="w-44">
            <SelectWithSearch value={groupFilter} onChange={setGroupFilter}
              options={[{ value: "", label: "Todos os grupos" }, ...groups.map((group) => ({ value: String(group.id), label: group.name })), { value: NO_GROUP, label: "Sem grupo" }]}
              placeholder="Filtrar por grupos" searchPlaceholder="Pesquisar grupo" />
          </div>
          {writable && (
            <>
              <Button variant="outline" onClick={() => setGroupDialog("new")}>
                <FolderPlus className="h-4 w-4" /> Novo grupo
              </Button>
              <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" /> Novo monitor
              </Button>
            </>
          )}
        </PageToolbar>

        {monitors === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : monitors.length === 0 && groups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nenhum monitor ainda. {writable && "Clique em “Novo monitor” para começar."}
            </CardContent>
          </Card>
        ) : (
          <>
          {grouped.map((section) => {
            const group = groups.find((g) => String(g.id) === section.id);
            const isDropTarget = draggedMonitorId !== null && dragOverGroup === section.id;
            return (
              <Card
                key={section.id}
                onDragEnter={(event) => {
                  if (draggedMonitorId === null) return;
                  event.preventDefault();
                  setDragOverGroup(section.id);
                }}
                onDragOver={(event) => {
                  if (draggedMonitorId === null) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverGroup !== section.id) setDragOverGroup(section.id);
                }}
                onDragLeave={(event) => {
                  const nextTarget = event.relatedTarget as Node | null;
                  if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                  setDragOverGroup((current) => current === section.id ? null : current);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const monitorId = Number(event.dataTransfer.getData("text/monitor-id") || draggedMonitorId);
                  if (Number.isInteger(monitorId) && monitorId > 0)
                    void moveMonitorToGroup(monitorId, section.id);
                  else clearDragState();
                }}
                className={`transition-[border-color,box-shadow] ${isDropTarget ? "border-primary ring-2 ring-primary/20" : ""}`}
              >
                <CardHeader className={`flex min-h-14 flex-row items-center justify-between py-2 transition-colors ${isDropTarget ? "bg-primary/5" : ""}`}>
                  <button type="button" onClick={() => toggle(section.id)}
                    className="flex min-h-9 items-center gap-1.5 text-left" aria-label="Ocultar/mostrar grupo">
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed.has(section.id) ? "-rotate-90" : ""}`} />
                    <CardTitle className="text-base">
                      {section.name}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">({section.items.length})</span>
                    </CardTitle>
                  </button>
                  <div className="flex items-center gap-2">
                    {isDropTarget && <span className="text-xs font-medium text-primary">Solte aqui</span>}
                    {writable && group && (
                      <div className="flex items-center gap-1">
                        <IconAction label="Editar grupo" onClick={() => setGroupDialog(group)}>
                          <Pencil className="h-4 w-4" />
                        </IconAction>
                        <IconAction label="Remover grupo" onClick={() => setGroupToDelete(group)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </IconAction>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${collapsed.has(section.id) ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
                  <div className={collapsed.has(section.id) ? "overflow-hidden" : "overflow-visible"}>
                <CardContent className="space-y-2 pt-0">
                  {section.items.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">Nenhum monitor neste grupo.</p>
                  ) : section.items.map((m) => (
                    <UptimeListRow key={m.id}
                      onClick={() => navigate(`/monitors/${m.id}`)}
                      dragging={draggedMonitorId === m.id}>
                      {writable && (
                        <button
                          type="button"
                          draggable={busy === null}
                          onClick={(event) => event.stopPropagation()}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/monitor-id", String(m.id));
                            event.dataTransfer.setData("text/plain", String(m.id));
                            const row = event.currentTarget.closest("[data-monitor-row]");
                            if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 20, 20);
                            setDraggedMonitorId(m.id);
                          }}
                          onDragEnd={clearDragState}
                          className="-ml-1 cursor-grab rounded-md p-1 text-muted-foreground/60 outline-none transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Arrastar ${m.name} para outro grupo`}
                          title="Arraste para trocar de grupo"
                          disabled={busy !== null}
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                      )}
                      <StatusPill status={m.active ? m.status : "pending"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium leading-5">{m.name}</span>
                          <Badge variant="outline" className="uppercase">{m.type}</Badge>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{monitorTarget(m)}</p>
                      </div>
                      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 sm:flex">
                        <HeartbeatBar m={m} now={now} />
                        <SslStatusPopover m={m} now={now} />
                        <DomainStatusPopover m={m} now={now} />
                        <MonitorTags tags={m.tags} />
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>{m.type === "domain" ? "a cada 24h" : `a cada ${m.interval_seconds}s`}</div>
                        <div>{m.active ? fmtAgo(m.last_check_ts, now) : "pausado"}</div>
                      </div>
                      {writable && (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações de ${m.name}`}
                                title="Ações" disabled={busy === m.id}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => { setEditing(m); setFormOpen(true); }}>
                                <Pencil className="h-4 w-4 text-muted-foreground" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => checkNow(m)}>
                                <Play className="h-4 w-4 text-muted-foreground" /> Checar agora
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => toggleActive(m)}>
                                {m.active
                                  ? <Pause className="h-4 w-4 text-muted-foreground" />
                                  : <Play className="h-4 w-4 text-muted-foreground" />}
                                {m.active ? "Pausar" : "Ativar"}
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onSelect={() => setToDelete(m)}>
                                <Trash2 className="h-4 w-4" /> Remover
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </UptimeListRow>
                  ))}
                </CardContent>
                  </div>
                </div>
              </Card>
            );
          })}
          {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} onPage={setPage} />}
          </>
        )}
      </div>

      {formOpen && (
        <MonitorFormDialog
          editing={editing}
          groups={groups}
          onOpenChange={setFormOpen}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      {groupDialog && (
        <GroupDialog
          group={groupDialog === "new" ? null : groupDialog}
          onOpenChange={() => setGroupDialog(null)}
          onSaved={() => { setGroupDialog(null); loadGroups(); }}
        />
      )}


      <ConfirmDelete
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remover monitor"
        description={`Remover o monitor “${toDelete?.name}”? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={removeMonitor}
      />
      <ConfirmDelete
        open={!!groupToDelete}
        onOpenChange={(o) => !o && setGroupToDelete(null)}
        title="Remover grupo"
        description={`Remover o grupo “${groupToDelete?.name}”? Os monitores dele ficam sem grupo.`}
        confirmLabel="Remover"
        onConfirm={removeGroup}
      />
    </TooltipProvider>
  );
}
