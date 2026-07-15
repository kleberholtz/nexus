import {
  AlertTriangle,
  Ban,
  BarChart3,
  Bell,
  CheckCircle2,
  Gauge,
  Globe,
  History,
  Lock,
  Power,
  ShieldAlert,
  ShieldX,
  Siren,
  Timer,
  Unplug,
  Wrench,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { MonitorEvent } from "@/lib/monitor-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/confirm-delete";

type EventMeta = { label: string; icon: React.ElementType; className: string };

const EVENT_META: Record<string, EventMeta> = {
  recovery: { label: "Serviço voltou a ficar online", icon: CheckCircle2, className: "text-success" },
  down: { label: "Serviço ficou offline", icon: XCircle, className: "text-destructive" },
  degraded: { label: "Tempo de resposta acima do limite", icon: AlertTriangle, className: "text-amber-500" },
  slow: { label: "Latência média elevada", icon: Gauge, className: "text-amber-500" },
  http_error: { label: "Erro HTTP (4xx/5xx)", icon: Ban, className: "text-destructive" },
  ssl_expiring: { label: "Certificado prestes a expirar", icon: ShieldAlert, className: "text-amber-500" },
  ssl_expired: { label: "Certificado expirado", icon: ShieldX, className: "text-destructive" },
  domain_expiring: { label: "Domínio prestes a expirar", icon: Globe, className: "text-amber-500" },
  domain_expired: { label: "Domínio expirado", icon: Globe, className: "text-destructive" },
  domain_not_found: { label: "Domínio não encontrado", icon: Globe, className: "text-destructive" },
  domain_unavailable: { label: "Consulta do domínio indisponível", icon: Globe, className: "text-destructive" },
  dns_failure: { label: "Falha na resolução DNS", icon: Globe, className: "text-destructive" },
  timeout: { label: "Timeout", icon: Timer, className: "text-destructive" },
  connection_refused: { label: "Connection refused", icon: Unplug, className: "text-destructive" },
  tls_failure: { label: "Falha de TLS/Handshake", icon: Lock, className: "text-destructive" },
  proxy_failure: { label: "Falha no proxy", icon: Unplug, className: "text-destructive" },
  maintenance_start: { label: "Início da janela de manutenção", icon: Wrench, className: "text-blue-500" },
  maintenance_end: { label: "Fim da manutenção", icon: Wrench, className: "text-blue-500" },
  monitor_paused: { label: "Monitor pausado", icon: Power, className: "text-muted-foreground" },
  monitor_reactivated: { label: "Monitor reativado", icon: Power, className: "text-success" },
  availability_change: { label: "Mudança significativa na disponibilidade", icon: BarChart3, className: "text-amber-500" },
  incident_created: { label: "Incidente criado", icon: Siren, className: "text-destructive" },
  incident_resolved: { label: "Incidente resolvido", icon: CheckCircle2, className: "text-success" },
};

const EVENT_ALIASES: Record<string, string> = {
  healthy: "recovery",
  unhealthy: "down",
  activated: "monitor_reactivated",
  deactivated: "monitor_paused",
};

function eventMeta(type: string): EventMeta {
  return EVENT_META[EVENT_ALIASES[type] ?? type]
    ?? { label: type, icon: Bell, className: "text-muted-foreground" };
}

export function DetailEvents({ events, writable, onClear }: {
  events: MonitorEvent[];
  writable?: boolean;
  onClear?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> Eventos</CardTitle>
        {writable && onClear && events.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <Trash2 className="h-4 w-4" /> Limpar eventos
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nenhum evento registrado.</p>
        ) : (
          <ul className="divide-y">
            {events.map((event, index) => {
              const meta = eventMeta(event.type);
              const Icon = meta.icon;
              return (
                <li key={`${event.ts}-${index}`} className="flex items-start gap-3 py-2.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <span className="text-xs text-muted-foreground">{new Date(event.ts).toLocaleString()}</span>
                    </div>
                    {event.message && <p className="truncate text-xs text-muted-foreground">{event.message}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDelete
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={() => onClear?.()}
        title="Limpar eventos"
        description="Excluir todos os eventos deste monitor? Esta ação não pode ser desfeita."
        confirmLabel="Excluir todos"
      />
    </Card>
  );
}
