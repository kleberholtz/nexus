import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Pencil,
  Plus,
  Siren,
  Trash2,
} from "lucide-react";
import { del, post, put } from "@/lib/api";
import {
  INCIDENT_SEVERITY_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
  IncidentSeverity,
  IncidentStatus,
  MonitorIncident,
  incidentSeverityLabel,
  incidentSeverityVariant,
  incidentStatusLabel,
  incidentStatusVariant,
} from "@/lib/monitor-config";
import { ConfirmDelete } from "@/components/confirm-delete";
import { IncidentTimeline, IncidentUpdateDialog } from "@/components/incident-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";

type DetailIncidentsProps = {
  monitorId: string;
  incidents: MonitorIncident[];
  writable: boolean;
  onChanged: () => void | Promise<void>;
};

export function DetailIncidents({ monitorId, incidents, writable, onChanged }: DetailIncidentsProps) {
  const [dialog, setDialog] = useState<MonitorIncident | "new" | null>(null);
  const [update, setUpdate] = useState<MonitorIncident | null>(null);
  const [toDelete, setToDelete] = useState<MonitorIncident | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(incidentId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      next.has(incidentId) ? next.delete(incidentId) : next.add(incidentId);
      return next;
    });
  }

  async function resolve(incident: MonitorIncident) {
    try {
      await post(`/monitors/${monitorId}/incidents/${incident.id}/updates`, { status: "resolved" });
      await onChanged();
      toast.success("Incidente resolvido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao resolver");
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/${monitorId}/incidents/${toDelete.id}`);
      await onChanged();
      toast.success("Incidente removido");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Siren className="h-4 w-4" /> Incidentes</CardTitle>
          {writable && (
            <Button size="sm" onClick={() => setDialog("new")}>
              <Plus className="h-4 w-4" /> Novo incidente
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nenhum incidente.</p>
          ) : (
            <ul className="divide-y">
              {incidents.map((incident) => {
                const resolved = incident.status === "resolved";
                const open = expanded.has(incident.id);
                return (
                  <li key={incident.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <button type="button" aria-label={open ? "Recolher" : "Expandir"}
                        onClick={() => toggle(incident.id)}
                        className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <Siren className={`mt-0.5 h-4 w-4 shrink-0 ${resolved ? "text-success" : "text-destructive"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{incident.title}</span>
                          <Badge variant={incidentSeverityVariant(incident.severity)}>
                            {incidentSeverityLabel(incident.severity)}
                          </Badge>
                          <Badge variant={incidentStatusVariant(incident.status)}>
                            {incidentStatusLabel(incident.status)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(incident.created_ts).toLocaleString()}
                          </span>
                        </div>
                        {incident.description && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{incident.description}</p>
                        )}
                      </div>
                      {writable && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button variant="ghost" size="icon" aria-label="Nova atualização" onClick={() => setUpdate(incident)}>
                            <MessageSquarePlus className="h-4 w-4" />
                          </Button>
                          {!resolved && <Button variant="outline" size="sm" onClick={() => resolve(incident)}>Resolver</Button>}
                          <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => setDialog(incident)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => setToDelete(incident)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {open && <div className="mt-3 pl-11"><IncidentTimeline updates={incident.updates} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <IncidentDialog
          monitorId={monitorId}
          incident={dialog === "new" ? null : dialog}
          onOpenChange={() => setDialog(null)}
          onSaved={async () => { setDialog(null); await onChanged(); }}
        />
      )}
      {update && (
        <IncidentUpdateDialog
          monitorId={monitorId}
          incident={update}
          onOpenChange={() => setUpdate(null)}
          onSaved={async () => {
            setExpanded((current) => new Set(current).add(update.id));
            setUpdate(null);
            await onChanged();
          }}
        />
      )}
      <ConfirmDelete
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Remover incidente"
        description={`Remover o incidente “${toDelete?.title}”?`}
        confirmLabel="Remover"
        onConfirm={remove}
      />
    </>
  );
}

function IncidentDialog({ monitorId, incident, onOpenChange, onSaved }: {
  monitorId: string;
  incident: MonitorIncident | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = !!incident;
  const [title, setTitle] = useState(incident?.title ?? "");
  const [description, setDescription] = useState(incident?.description ?? "");
  const [status, setStatus] = useState<IncidentStatus>(incident?.status ?? "investigating");
  const [severity, setSeverity] = useState<IncidentSeverity>(incident?.severity ?? "degraded");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return toast.error("Informe o título do incidente.");
    setBusy(true);
    try {
      if (isEdit)
        await put(`/monitors/${monitorId}/incidents/${incident.id}`, { title, description, severity });
      else
        await post(`/monitors/${monitorId}/incidents`, { title, description, status, severity });
      toast.success(isEdit ? "Incidente atualizado" : "Incidente criado");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar");
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
            <DialogDescription>Registro manual de incidente do monitor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <LabelWithHelp help="Resumo do incidente." required>Título</LabelWithHelp>
              <Input value={title} onChange={(event) => setTitle(event.target.value)}
                placeholder="Instabilidade na API" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help={isEdit ? "Resumo/impacto do incidente." : "Primeira mensagem da linha do tempo."}>
                {isEdit ? "Descrição" : "Mensagem inicial"}
              </LabelWithHelp>
              <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Impacto do incidente no serviço." required>Severidade</LabelWithHelp>
              <SelectWithSearch
                options={INCIDENT_SEVERITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: `${option.label} — ${option.hint}`,
                }))}
                value={severity}
                onChange={(value) => setSeverity(value as IncidentSeverity)}
              />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <LabelWithHelp help="Estágio inicial do incidente." required>Status</LabelWithHelp>
                <SelectWithSearch options={INCIDENT_STATUS_OPTIONS} value={status}
                  onChange={(value) => setStatus(value as IncidentStatus)} />
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
