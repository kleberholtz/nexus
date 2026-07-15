import { useState } from "react";
import { post } from "@/lib/api";
import {
  INCIDENT_STATUS_OPTIONS,
  IncidentStatus,
  IncidentUpdate,
  MonitorIncident,
  incidentStatusLabel,
  incidentStatusVariant,
} from "@/lib/monitor-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function fmtDate(ts: number): string {
  return ts ? new Date(ts).toLocaleString() : "—";
}

/** Linha do tempo (vertical) das atualizações de um incidente. */
export function IncidentTimeline({ updates }: { updates?: IncidentUpdate[] }) {
  if (!updates || updates.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Sem atualizações.</p>;
  }
  return (
    <ol className="relative ml-1 space-y-4 border-l pl-5">
      {updates.map((u, i) => {
        const resolved = u.status === "resolved";
        return (
          <li key={u.id ?? i} className="relative">
            <span
              className={`absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-background ${
                resolved ? "bg-success" : i === 0 ? "bg-primary" : "bg-muted-foreground/50"
              }`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={incidentStatusVariant(u.status)}>{incidentStatusLabel(u.status)}</Badge>
              <span className="text-xs text-muted-foreground">{fmtDate(u.created_ts)}</span>
            </div>
            {u.message && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{u.message}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** Diálogo para publicar uma atualização na linha do tempo do incidente. */
export function IncidentUpdateDialog({
  monitorId,
  incident,
  onOpenChange,
  onSaved,
}: {
  monitorId: number | string;
  incident: MonitorIncident;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!message.trim() && status === incident.status) {
      return toast.error("Escreva uma mensagem ou mude o status.");
    }
    setBusy(true);
    try {
      await post(`/monitors/${monitorId}/incidents/${incident.id}/updates`, { status, message });
      toast.success("Atualização publicada");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao publicar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova atualização</DialogTitle>
          <DialogDescription>Registra um novo passo na linha do tempo do incidente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <LabelWithHelp help="Estágio do incidente após esta atualização." required>Status</LabelWithHelp>
            <SelectWithSearch
              options={INCIDENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={status}
              onChange={(v) => setStatus(v as IncidentStatus)}
            />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp help="O que aconteceu / o que está sendo feito.">Mensagem</LabelWithHelp>
            <Textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Identificamos a causa no upstream e aplicamos o fix…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>Publicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
