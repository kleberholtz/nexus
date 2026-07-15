import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Clock, Copy, HeartPulse, RefreshCw } from "lucide-react";
import { DetailChart } from "@/components/uptime/detail-chart";
import { DetailEvents } from "@/components/uptime/detail-events";
import { DetailIncidents } from "@/components/uptime/detail-incidents";
import { DetailTags, MonitorStateBadge, UptimeCards } from "@/components/uptime/detail-summary";
import { useUptimeDetail } from "@/components/uptime/use-uptime-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBase } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/utils";

function timeAgo(timestamp: number): string {
  if (!timestamp) return "nenhum beat recebido";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `há ${seconds}s`;
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)}h`;
  return `há ${Math.floor(seconds / 86400)}d`;
}

export function HeartbeatDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const detail = useUptimeDetail({ id, onDeleted: () => navigate("/heartbeats") });
  const chartPoints = (detail.chart?.points ?? []).map((point) => ({
    ...point,
    metric: point.uptime ?? 0,
  }));

  return (
    <div className="space-y-6">
      <Link to="/heartbeats" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Heartbeats
      </Link>

      {detail.monitor === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <HeartPulse className="h-6 w-6" />
                {detail.monitor.name}
                <Badge variant="outline" className="uppercase">heartbeat</Badge>
                <MonitorStateBadge active={detail.monitor.active} status={detail.monitor.status} />
              </h1>
              {detail.monitor.push_url && (
                <div className="flex max-w-2xl items-center gap-1.5">
                  <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {detail.monitor.push_url}
                  </code>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                    onClick={() => copyText(`${getApiBase()}${detail.monitor?.push_url}`, "URL copiada")}
                    aria-label="Copiar URL do heartbeat">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> Esperado a cada {detail.monitor.interval_seconds}s
                </span>
                <span>
                  Último beat: {detail.monitor.active ? timeAgo(detail.monitor.last_check_ts) : "pausado"}
                </span>
                {detail.monitor.group_name && <span>Grupo: {detail.monitor.group_name}</span>}
              </div>
              <DetailTags monitor={detail.monitor} />
            </div>
            <Button variant="outline" size="icon" onClick={() => void detail.reload()} aria-label="Recarregar">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <UptimeCards uptime={detail.uptime} />
          <DetailChart
            title="Disponibilidade dos beats"
            chart={detail.chart}
            points={chartPoints}
            range={detail.range}
            onRangeChange={detail.setRange}
            curve="stepAfter"
            domain={[0, 100]}
            formatYAxis={(value) => `${value}%`}
            showLatency={false}
          />
          {id && (
            <DetailIncidents monitorId={id} incidents={detail.incidents}
              writable={writable} onChanged={detail.loadCore} />
          )}
          <DetailEvents events={detail.events} />
        </>
      )}
    </div>
  );
}
