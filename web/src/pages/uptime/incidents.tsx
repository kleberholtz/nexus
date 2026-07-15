import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquarePlus, Pencil, Plus, Siren, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  INCIDENT_SEVERITY_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
  IncidentSeverity,
  IncidentStatus,
  Monitor,
  MonitorIncident,
  incidentSeverityLabel,
  incidentSeverityVariant,
  incidentStatusLabel,
  incidentStatusVariant,
} from "@/lib/monitor-config";
import { IncidentTimeline, IncidentUpdateDialog } from "@/components/incident-timeline";
import { PageToolbar, Pagination, Paged, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Incident = MonitorIncident & { monitor_name?: string };

function fmtAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function IncidentsPage() {
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const [data, setData] = useState<Paged<Incident> | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [dialog, setDialog] = useState<Incident | "new" | null>(null);
  const [updateFor, setUpdateFor] = useState<Incident | null>(null);
  const [toDelete, setToDelete] = useState<Incident | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const { page, setPage } = useUrlPagination(debounced);

  function toggle(id: number) {
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const [inc, mons] = await Promise.all([
        get<Paged<Incident>>(`/monitors/incidents?${pagedQuery(page, debounced)}`),
        get<Monitor[]>("/monitors"),
      ]);
      setData(inc);
      setMonitors(mons);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar incidentes");
    }
  }, [page, debounced]);
  useEffect(() => { load(); }, [load]);

  async function resolve(inc: Incident) {
    try {
      await post(`/monitors/${inc.monitor_id}/incidents/${inc.id}/updates`, { status: "resolved" });
      await load();
      toast.success("Incidente resolvido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao resolver");
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/${toDelete.monitor_id}/incidents/${toDelete.id}`);
      await load();
      toast.success("Incidente removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Siren className="h-6 w-6" /> Incidentes
          </h1>
          <p className="text-sm text-muted-foreground">
            Incidentes de todos os monitores.{data && <span> {data.total} no total.</span>}
          </p>
        </div>

        <PageToolbar onRefresh={load} search={search} onSearch={setSearch} placeholder="Pesquisar incidentes">
          {writable && (
            <Button onClick={() => setDialog("new")} disabled={monitors.length === 0}>
              <Plus className="h-4 w-4" /> Adicionar incidente
            </Button>
          )}
        </PageToolbar>

        {data === null ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search ? "Nenhum incidente corresponde à busca." : "Nenhum incidente."}
            </CardContent>
          </Card>
        ) : (
          <>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {items.map((inc) => {
                  const resolved = inc.status === "resolved";
                  const open = expanded.has(inc.id);
                  return (
                    <li key={inc.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          aria-label={open ? "Recolher" : "Expandir"}
                          onClick={() => toggle(inc.id)}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <Siren className={`mt-0.5 h-4 w-4 shrink-0 ${resolved ? "text-success" : "text-destructive"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{inc.title}</span>
                            <Badge variant={incidentSeverityVariant(inc.severity)}>{incidentSeverityLabel(inc.severity)}</Badge>
                            <Badge variant={incidentStatusVariant(inc.status)}>{incidentStatusLabel(inc.status)}</Badge>
                            {inc.monitor_name && <Badge variant="outline">{inc.monitor_name}</Badge>}
                            <span className="text-xs text-muted-foreground">{fmtAgo(inc.created_ts)}</span>
                          </div>
                          {inc.description && <p className="mt-0.5 text-sm text-muted-foreground">{inc.description}</p>}
                        </div>
                        {writable && (
                          <div className="flex shrink-0 items-center gap-1">
                            <IconBtn label="Nova atualização" onClick={() => setUpdateFor(inc)}><MessageSquarePlus className="h-4 w-4" /></IconBtn>
                            {!resolved && <Button variant="outline" size="sm" onClick={() => resolve(inc)}>Resolver</Button>}
                            <IconBtn label="Editar" onClick={() => setDialog(inc)}><Pencil className="h-4 w-4" /></IconBtn>
                            <IconBtn label="Remover" onClick={() => setToDelete(inc)}><Trash2 className="h-4 w-4 text-destructive" /></IconBtn>
                          </div>
                        )}
                      </div>
                      {open && (
                        <div className="mt-3 pl-11">
                          <IncidentTimeline updates={inc.updates} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
          </>
        )}
      </div>

      {dialog && (
        <IncidentDialog
          incident={dialog === "new" ? null : dialog}
          monitors={monitors}
          onOpenChange={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
      {updateFor && (
        <IncidentUpdateDialog
          monitorId={updateFor.monitor_id}
          incident={updateFor}
          onOpenChange={() => setUpdateFor(null)}
          onSaved={() => { setUpdateFor(null); setExpanded((c) => new Set(c).add(updateFor.id)); load(); }}
        />
      )}
      <ConfirmDelete
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remover incidente"
        description={`Remover o incidente “${toDelete?.title}”?`}
        confirmLabel="Remover"
        onConfirm={remove}
      />
    </TooltipProvider>
  );
}

function IncidentDialog({ incident, monitors, onOpenChange, onSaved }: {
  incident: Incident | null; monitors: Monitor[];
  onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const isEdit = !!incident;
  const [monitorId, setMonitorId] = useState(incident ? String(incident.monitor_id) : (monitors[0] ? String(monitors[0].id) : ""));
  const [title, setTitle] = useState(incident?.title ?? "");
  const [description, setDescription] = useState(incident?.description ?? "");
  const [status, setStatus] = useState<IncidentStatus>(incident?.status ?? "investigating");
  const [severity, setSeverity] = useState<IncidentSeverity>(incident?.severity ?? "degraded");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!monitorId) return toast.error("Selecione o monitor.");
    if (!title.trim()) return toast.error("Informe o título do incidente.");
    setBusy(true);
    try {
      if (isEdit) await put(`/monitors/${incident!.monitor_id}/incidents/${incident!.id}`, { title, description, severity });
      else await post(`/monitors/${monitorId}/incidents`, { title, description, status, severity });
      toast.success(isEdit ? "Incidente atualizado" : "Incidente criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <TooltipProvider>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar incidente" : "Novo incidente"}</DialogTitle>
            <DialogDescription>Registro manual de incidente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <LabelWithHelp help="Monitor ao qual o incidente pertence." required>Monitor</LabelWithHelp>
              <SelectWithSearch
                options={monitors.map((m) => ({ value: String(m.id), label: m.name }))}
                value={monitorId} onChange={setMonitorId} disabled={isEdit} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Resumo do incidente." required>Título</LabelWithHelp>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Instabilidade na API" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help={isEdit ? "Resumo/impacto do incidente." : "Primeira mensagem da linha do tempo."}>
                {isEdit ? "Descrição" : "Mensagem inicial"}
              </LabelWithHelp>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Impacto do incidente no serviço." required>Severidade</LabelWithHelp>
              <SelectWithSearch
                options={INCIDENT_SEVERITY_OPTIONS.map((o) => ({ value: o.value, label: `${o.label} — ${o.hint}` }))}
                value={severity} onChange={(v) => setSeverity(v as IncidentSeverity)} />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <LabelWithHelp help="Estágio inicial do incidente." required>Status</LabelWithHelp>
                <SelectWithSearch
                  options={INCIDENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  value={status} onChange={(v) => setStatus(v as IncidentStatus)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{isEdit ? "Salvar" : "Criar incidente"}</Button>
          </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
