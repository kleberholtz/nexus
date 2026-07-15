import { Link, useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowLeft, Pause, Play, RefreshCw } from "lucide-react";
import { DetailChart } from "@/components/uptime/detail-chart";
import { DetailEvents } from "@/components/uptime/detail-events";
import { DetailHeartbeats } from "@/components/uptime/detail-heartbeats";
import { DetailIncidents } from "@/components/uptime/detail-incidents";
import { DetailTags, MonitorStateBadge, UptimeCards } from "@/components/uptime/detail-summary";
import { TimingStatsRow, hasTimings } from "@/components/uptime/detail-timings";
import { useUptimeDetail } from "@/components/uptime/use-uptime-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { monitorTarget } from "@/lib/monitor-config";

export function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const detail = useUptimeDetail({ id, onDeleted: () => navigate("/monitors") });
  const chartPoints = (detail.chart?.points ?? []).map((point) => ({
    ...point,
    metric: point.avg_latency ?? 0,
  }));
  const timingSamples = (detail.monitor?.beats ?? [])
    .map((b) => b.timings).filter(hasTimings);

  return (
    <div className="space-y-6">
      <Link to="/monitors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Monitores
      </Link>

      {detail.monitor === null ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-2xl font-semibold">
                <Activity className="h-6 w-6" />
                {detail.monitor.name}
                <Badge variant="outline" className="uppercase">{detail.monitor.type}</Badge>
                <MonitorStateBadge active={detail.monitor.active} status={detail.monitor.status} />
              </h1>
              <p className="text-sm text-muted-foreground">{monitorTarget(detail.monitor)}</p>
              <DetailTags monitor={detail.monitor} />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => detail.setPaused(!detail.paused)}
                aria-label={detail.paused ? "Retomar stream" : "Pausar stream"}>
                {detail.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {detail.paused ? "Retomar" : "Pausar"}
              </Button>
              <Button variant="outline" size="icon" onClick={() => void detail.reload()} aria-label="Recarregar">
                <RefreshCw className="h-4 w-4" />
              </Button>
              {writable && (
                <Button onClick={() => void detail.checkNow()} disabled={detail.checking}>
                  <Play className="h-4 w-4" /> Checar agora
                </Button>
              )}
            </div>
          </div>

          <UptimeCards uptime={detail.uptime} />
          <TimingStatsRow samples={timingSamples} />
          <DetailHeartbeats monitor={detail.monitor} now={Date.now()}
            writable={writable} onClear={() => void detail.clearHeartbeats()} />
          <DetailChart
            title="Gráfico de heartbeats"
            chart={detail.chart}
            points={chartPoints}
            range={detail.range}
            onRangeChange={detail.setRange}
            curve="monotone"
            formatYAxis={(value) => `${value}ms`}
            showLatency
          />
          {id && (
            <DetailIncidents monitorId={id} incidents={detail.incidents}
              writable={writable} onChanged={detail.loadCore} />
          )}
          <DetailEvents events={detail.events} writable={writable}
            onClear={() => void detail.clearEvents()} />
        </>
      )}
    </div>
  );
}
