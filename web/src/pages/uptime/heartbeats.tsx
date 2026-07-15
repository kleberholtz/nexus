import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  CircleDashed,
  ChevronDown,
  Clock,
  Copy,
  FolderPlus,
  GripVertical,
  HeartPulse,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { del, get, getApiBase, post, put, streamUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCollapsed } from "@/lib/use-collapsed";
import { Monitor, MonitorGroup, MonitorStatus, MonitorTag, monitorTagLabel } from "@/lib/monitor-config";
import { NotificationChannel, typeLabel as channelTypeLabel } from "@/lib/notification-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxMultiple } from "@/components/ui/combobox";
import { MonitorTagBadge } from "@/components/monitor-tag-badge";
import { HoverPopover } from "@/components/ui/hover-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { GroupDialog } from "@/components/monitor-group-dialog";
import { SwitchBlock } from "@/components/switch-block";
import { PageToolbar, Pagination, Paged, UptimeListRow, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIN_INTERVAL = 15;
const DEFAULT_GRACE_PERIOD = 5;
const MAX_GRACE_PERIOD = 86400;
const NO_GROUP = "__none__";

type PushMonitor = Monitor & { push_url?: string };

function fmtAgo(ts: number, now: number): string {
  if (!ts) return "sem beats ainda";
  const ms = Math.max(0, now - ts);
  const s = Math.floor(ms / 1000);
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`;
  return `há ${Math.floor(s / 86400)}d`;
}

function StatusDot({ status, active, lastBeat }: { status: MonitorStatus; active: boolean; lastBeat: number }) {
  if (!active) return <Badge variant="secondary" className="gap-1"><CircleDashed className="h-3 w-3" /> Pausado</Badge>;
  if (status === "maintenance") return <Badge variant="info" className="gap-1"><Wrench className="h-3 w-3" /> Manutenção</Badge>;
  if (status === "up") return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Saudável</Badge>;
  if (status === "down") return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Indisponível</Badge>;
  // Pendente: sem nenhum beat ainda vs. aguardando o próximo.
  const label = lastBeat ? "Pendente" : "Aguardando 1º beat";
  return <Badge variant="secondary" className="gap-1"><CircleDashed className="h-3 w-3" /> {label}</Badge>;
}

/** Exibe até três tags e agrupa as restantes em um popover. */
function HeartbeatTags({ tags }: { tags: MonitorTag[] }) {
  if (tags.length === 0) return null;
  const visible = tags.slice(0, 3);
  const remaining = tags.length - visible.length;

  return (
    <div className="flex min-w-0 items-center gap-1">
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

function IconBtn({ label, onClick, disabled, className, children }: {
  label: string; onClick: () => void; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={className}
          aria-label={label} onClick={onClick} disabled={disabled}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function copyUrl(path: string) {
  const full = `${getApiBase()}${path}`;
  navigator.clipboard?.writeText(full).then(
    () => toast.success("URL copiada"),
    () => toast.error("Falha ao copiar"),
  );
}

export function HeartbeatsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const [monitors, setMonitors] = useState<PushMonitor[] | null>(null);
  const [groups, setGroups] = useState<MonitorGroup[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [draggedMonitorId, setDraggedMonitorId] = useState<number | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PushMonitor | "new" | null>(null);
  const [toDelete, setToDelete] = useState<PushMonitor | null>(null);
  const [groupDialog, setGroupDialog] = useState<MonitorGroup | "new" | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<MonitorGroup | null>(null);
  const [meta, setMeta] = useState<Omit<Paged<PushMonitor>, "items"> | null>(null);
  const debounced = useDebounced(search);
  const { page, setPage } = useUrlPagination(debounced);
  const { collapsed, toggle } = useCollapsed("heartbeats.collapsedGroups");
  const esRef = useRef<EventSource | null>(null);
  const loadRef = useRef<() => void>(() => {});

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Dados por GET paginado; o SSE só sinaliza mudança e dispara o refetch.
  const load = useCallback(async () => {
    try {
      const res = await get<Paged<PushMonitor>>(`/monitors?${pagedQuery(page, debounced, { push: "1" })}`);
      setMonitors(res.items);
      setMeta({ page: res.page, pages: res.pages, total: res.total });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar heartbeats");
    }
  }, [page, debounced]);
  loadRef.current = load;

  function connect() {
    esRef.current?.close();
    const es = new EventSource(streamUrl("/monitors/stream?push=1"));
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener("version", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 400);
    });
    esRef.current = es;
  }
  async function loadGroups() {
    try { setGroups(await get<MonitorGroup[]>("/monitors/groups")); } catch { /* opcional */ }
  }
  useEffect(() => { loadGroups(); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { connect(); return () => esRef.current?.close(); }, []);

  const filtered = monitors ?? [];

  // Agrupa por grupo (+ seção "Sem grupo"), como na página de monitores.
  const grouped = useMemo(() => {
    const byGroup = new Map<string, PushMonitor[]>();
    for (const m of filtered) {
      const key = m.group_id ? String(m.group_id) : NO_GROUP;
      (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(m);
    }
    const sections: { id: string; name: string; items: PushMonitor[] }[] = [];
    for (const g of groups) {
      const items = byGroup.get(String(g.id)) ?? [];
      sections.push({ id: String(g.id), name: g.name, items });
    }
    const ungrouped = byGroup.get(NO_GROUP) ?? [];
    sections.push({ id: NO_GROUP, name: "Sem grupo", items: ungrouped });
    return sections;
  }, [filtered, groups]);

  function clearDragState() {
    setDraggedMonitorId(null);
    setDragOverGroup(null);
  }

  async function moveHeartbeatToGroup(monitorId: number, sectionId: string) {
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
      toast.success(`Heartbeat movido para “${targetName}”`);
      await loadGroups();
    } catch (error) {
      setMonitors((current) => current?.map((item) => item.id === monitorId
        ? { ...item, group_id: previousGroupId, group_name: previousGroupName }
        : item) ?? current);
      toast.error(error instanceof Error ? error.message : "Falha ao mover heartbeat");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(m: PushMonitor) {
    setBusy(m.id);
    try {
      await post(`/monitors/${m.id}/${m.active ? "disable" : "enable"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/${toDelete.id}`);
      await load();
      toast.success("Heartbeat removido");
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
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HeartPulse className="h-6 w-6" /> Heartbeats
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitores por push — o serviço envia um beat ao webhook em vez de ser consultado.
          </p>
        </div>

        <PageToolbar onRefresh={() => { loadGroups(); load(); }} search={search} onSearch={setSearch} placeholder="Pesquisar heartbeats">
          {writable && (
            <>
              <Button variant="outline" onClick={() => setGroupDialog("new")}>
                <FolderPlus className="h-4 w-4" /> Novo grupo
              </Button>
              <Button onClick={() => setDialog("new")}>
                <Plus className="h-4 w-4" /> Criar Heartbeat
              </Button>
            </>
          )}
        </PageToolbar>

        {monitors === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : filtered.length === 0 && groups.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search ? "Nenhum heartbeat encontrado." : "Nenhum heartbeat ainda."}
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
                    void moveHeartbeatToGroup(monitorId, section.id);
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
                        <IconBtn label="Editar grupo" onClick={() => setGroupDialog(group)}><Pencil className="h-4 w-4" /></IconBtn>
                        <IconBtn label="Remover grupo" onClick={() => setGroupToDelete(group)}><Trash2 className="h-4 w-4 text-destructive" /></IconBtn>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${collapsed.has(section.id) ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
                  <div className={collapsed.has(section.id) ? "overflow-hidden" : "overflow-visible"}>
                <CardContent className="space-y-2 pt-0">
                  {section.items.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">Nenhum heartbeat neste grupo.</p>
                  ) : section.items.map((m) => (
                    <UptimeListRow key={m.id}
                      onClick={() => navigate(`/heartbeats/${m.id}`)}
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
                      <StatusDot status={m.status} active={m.active} lastBeat={m.last_check_ts} />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium leading-5">{m.name}</span>
                        {m.push_url ? (
                          <div className="mt-0.5 flex min-w-0 items-center gap-1"
                            onClick={(event) => event.stopPropagation()}>
                            <code className="min-w-0 truncate rounded bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {m.push_url}
                            </code>
                            <IconBtn label="Copiar URL" className="h-5 w-5" onClick={() => copyUrl(m.push_url!)}>
                              <Copy className="h-3.5 w-3.5" />
                            </IconBtn>
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">Webhook indisponível</p>
                        )}
                      </div>
                      <div className="max-w-64 shrink-0">
                        <HeartbeatTags tags={m.tags} />
                      </div>
                      <div className="min-w-24 shrink-0 text-right text-xs text-muted-foreground">
                        <div className="flex items-center justify-end gap-1 text-sm text-foreground/80">
                          <Clock className="h-4 w-4" /> {m.interval_seconds}s
                        </div>
                        <div title="Tempo desde o último beat">
                          {m.active ? fmtAgo(m.last_check_ts, now) : "pausado"}
                        </div>
                      </div>
                      {writable && (
                        <div onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações de ${m.name}`}
                                title="Ações" disabled={busy === m.id}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => setDialog(m)}>
                                <Pencil className="h-4 w-4 text-muted-foreground" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => toggleActive(m)}>
                                {m.active
                                  ? <Pause className="h-4 w-4 text-muted-foreground" />
                                  : <Play className="h-4 w-4 text-muted-foreground" />}
                                {m.active ? "Pausar" : "Retomar"}
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

      {dialog && (
        <HeartbeatDialog
          editing={dialog === "new" ? null : dialog}
          groups={groups}
          onOpenChange={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
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
        title="Remover heartbeat"
        description={`Remover o heartbeat “${toDelete?.name}”?`}
        confirmLabel="Remover"
        onConfirm={remove}
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

function HeartbeatDialog({ editing, groups, onOpenChange, onSaved }: {
  editing: PushMonitor | null; groups: MonitorGroup[];
  onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const isEdit = !!editing;
  const cfg = editing?.config ?? {};
  const [name, setName] = useState(editing?.name ?? "");
  const [groupId, setGroupId] = useState(editing?.group_id ? String(editing.group_id) : "");
  const [interval, setInterval] = useState(String(editing?.interval_seconds ?? 60));
  const [gracePeriod, setGracePeriod] = useState(String(cfg.grace_period_seconds ?? DEFAULT_GRACE_PERIOD));
  const [description, setDescription] = useState(cfg.description ?? "");
  const [tagIds, setTagIds] = useState<number[]>((editing?.tags ?? []).map((tag) => tag.id));
  const [tags, setTags] = useState<MonitorTag[]>([]);
  const [channelIds, setChannelIds] = useState<number[]>((cfg.notification_channel_ids ?? []).map(Number));
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    (cfg.notification_channel_ids ?? []).length > 0,
  );
  const [resendEnabled, setResendEnabled] = useState((editing?.resend_every ?? 0) > 0);
  const [resendEvery, setResendEvery] = useState(String(
    editing?.resend_every && editing.resend_every > 0 ? editing.resend_every : 3,
  ));
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<NotificationChannel[]>("/monitors/notifications").then(setChannels).catch(() => { /* opcional */ });
    get<MonitorTag[]>("/monitors/tags").then(setTags).catch(() => setTags([]));
  }, []);

  const toggleChannel = (cid: number) =>
    setChannelIds((cur) => (cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid]));

  async function submit() {
    if (!name.trim()) return toast.error("Informe o nome.");
    const iv = Number(interval);
    if (!Number.isFinite(iv) || iv < MIN_INTERVAL) return toast.error(`O intervalo mínimo é ${MIN_INTERVAL}s.`);
    const grace = Number(gracePeriod);
    if (!Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_PERIOD)
      return toast.error(`O grace period deve ficar entre 0 e ${MAX_GRACE_PERIOD}s.`);
    const resend = Number(resendEvery);
    if (notificationsEnabled && resendEnabled && (!Number.isInteger(resend) || resend < 1 || resend > 1000))
      return toast.error("O reenvio deve ficar entre 1 e 1000 falhas consecutivas.");
    setBusy(true);
    try {
      const body = {
        type: "push", name: name.trim(),
        group_id: groupId ? Number(groupId) : null,
        tag_ids: tagIds,
        interval_seconds: iv,
        resend_enabled: notificationsEnabled && resendEnabled,
        resend_every: notificationsEnabled && resendEnabled ? resend : 0,
        config: {
          description: description.trim(),
          grace_period_seconds: grace,
          notification_channel_ids: notificationsEnabled ? channelIds : [],
        },
      };
      if (isEdit) await put(`/monitors/${editing!.id}`, body);
      else await post("/monitors", body);
      toast.success(isEdit ? "Heartbeat atualizado" : "Heartbeat criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <TooltipProvider>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar heartbeat" : "Novo heartbeat"}</DialogTitle>
            <DialogDescription>
              Um webhook é gerado automaticamente. O serviço deve chamá-lo dentro do intervalo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isEdit && editing?.push_url && (
              <div className="space-y-1.5">
                <LabelWithHelp help="Endpoint que o serviço deve chamar (GET ou POST) a cada beat.">URL do webhook</LabelWithHelp>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{editing.push_url}</code>
                  <Button variant="outline" size="icon" onClick={() => copyUrl(editing.push_url!)}><Copy className="h-4 w-4" /></Button>
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <LabelWithHelp help="Nome do heartbeat." required>Nome</LabelWithHelp>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cron diário" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Grupo (opcional).">Grupo</LabelWithHelp>
                <SelectWithSearch
                  options={[{ value: "", label: "— sem grupo —" }, ...groups.map((g) => ({ value: String(g.id), label: g.name }))]}
                  value={groupId} onChange={setGroupId} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="hb-interval" help={`Intervalo esperado entre beats. Mínimo ${MIN_INTERVAL}s.`} required>
                  Intervalo (s)
                </LabelWithHelp>
                <Input id="hb-interval" inputMode="numeric" value={interval}
                  onChange={(e) => setInterval(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="hb-grace" help="Tempo adicional após o intervalo antes de considerar o heartbeat indisponível." required>
                  Grace period (s)
                </LabelWithHelp>
                <Input id="hb-grace" inputMode="numeric" value={gracePeriod}
                  onChange={(e) => setGracePeriod(e.target.value)} />
              </div>
            </div>

            <SwitchBlock title="Notificações" on={notificationsEnabled} onToggle={setNotificationsEnabled}>
              <>
                {channels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum canal configurado. Crie em <span className="font-medium">Uptime → Notificações</span>.
                  </p>
                ) : (
                  <>
                    {channels.map((channel) => (
                      <label key={channel.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={channelIds.includes(channel.id)}
                          onCheckedChange={() => toggleChannel(channel.id)} />
                        <span className="flex-1 truncate">{channel.name}</span>
                        <Badge variant="outline">{channelTypeLabel(channel.type)}</Badge>
                        {!channel.enabled && <Badge variant="secondary">off</Badge>}
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      O heartbeat notifica apenas os canais marcados.
                    </p>
                  </>
                )}
                <SwitchBlock title="Reenviar se continuar indisponível"
                  on={resendEnabled} onToggle={setResendEnabled}>
                  <div className="space-y-1.5">
                    <LabelWithHelp htmlFor="hb-resend"
                      help="Reenvia a notificação após N falhas consecutivas (1 a 1000).">
                      Reenviar após quantas falhas consecutivas
                    </LabelWithHelp>
                    <Input id="hb-resend" inputMode="numeric" value={resendEvery}
                      onChange={(event) => setResendEvery(event.target.value)} className="w-40" />
                  </div>
                </SwitchBlock>
              </>
            </SwitchBlock>

            <div className="space-y-1.5">
              <LabelWithHelp help="Anotação livre.">Descrição</LabelWithHelp>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Tags cadastradas em Uptime → Tags.">Tags</LabelWithHelp>
              <ComboboxMultiple
                options={tags.map((tag) => String(tag.id))}
                value={tagIds.map(String)}
                onValueChange={(value) => setTagIds(value.map(Number))}
                labelByValue={Object.fromEntries(tags.map((tag) => [String(tag.id), monitorTagLabel(tag)]))}
                colorByValue={Object.fromEntries(tags.map((tag) => [String(tag.id), tag.color]))}
                placeholder="Selecione as tags"
                emptyMessage="Nenhuma tag cadastrada."
                showClear
                contentSide="top"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{isEdit ? "Salvar" : "Criar heartbeat"}</Button>
          </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
