import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Power, Wrench, XCircle } from "lucide-react";
import { Monitor, MonitorStatus, MonitorUptime } from "@/lib/monitor-config";
import { MonitorTagBadge } from "@/components/monitor-tag-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MonitorStateBadge({ active, status }: { active: boolean; status: MonitorStatus }) {
  if (!active)
    return <Badge variant="secondary" className="gap-1"><Power className="h-3.5 w-3.5" /> Pausado</Badge>;
  if (status === "maintenance")
    return <Badge variant="info" className="gap-1"><Wrench className="h-3.5 w-3.5" /> Manutenção</Badge>;
  if (status === "up")
    return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Saudável</Badge>;
  if (status === "degraded")
    return <Badge variant="warning" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Desempenho degradado</Badge>;
  if (status === "down")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3.5 w-3.5" /> Indisponível</Badge>;
  return <Badge variant="secondary" className="gap-1"><CircleDashed className="h-3.5 w-3.5" /> Pendente</Badge>;
}

function UptimeCard({ label, value }: { label: string; value: number | null }) {
  const color = value === null ? "text-muted-foreground"
    : value >= 99 ? "text-success" : value >= 90 ? "text-amber-500" : "text-destructive";
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Clock className="h-4 w-4" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-semibold ${color}`}>
          {value === null ? "—" : `${value.toFixed(value >= 99.9 ? 2 : 1)}%`}
        </p>
      </CardContent>
    </Card>
  );
}

export function UptimeCards({ uptime }: { uptime: MonitorUptime | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UptimeCard label="Tempo de atividade (24h)" value={uptime?.h24 ?? null} />
      <UptimeCard label="Tempo de atividade (30 dias)" value={uptime?.d30 ?? null} />
      <UptimeCard label="Tempo de atividade (1 ano)" value={uptime?.y1 ?? null} />
    </div>
  );
}

export function DetailTags({ monitor }: { monitor: Monitor }) {
  if (monitor.tags.length === 0 && !monitor.config?.description) return null;
  return (
    <>
      {monitor.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {monitor.tags.map((tag) => <MonitorTagBadge key={tag.id} tag={tag} showValue />)}
        </div>
      )}
      {monitor.config?.description && (
        <p className="max-w-2xl text-sm text-muted-foreground">{monitor.config.description}</p>
      )}
    </>
  );
}
