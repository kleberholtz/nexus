import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Play,
  Plug,
  RefreshCw,
  RotateCw,
  Server as ServerIcon,
  Settings2,
  Square,
  TerminalSquare,
} from "lucide-react";
import { get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useMetricsStream } from "@/lib/use-sse";
import { MetricPoint, SettingsData, SystemOverview } from "@/lib/types";
import { formatBps, formatBytes, formatCount, formatUptime } from "@/lib/utils";
import { validateInt, validateNumber } from "@/lib/validate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { LazyMetricChart as MetricChart } from "@/components/lazy-metric-chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RANGES = [
  { label: "1m", minutes: 1, maxPoints: 60 },
  { label: "30m", minutes: 30, maxPoints: 180 },
  { label: "1h", minutes: 60, maxPoints: 240 },
  { label: "6h", minutes: 360, maxPoints: 300 },
  { label: "12h", minutes: 720, maxPoints: 360 },
  { label: "24h", minutes: 1440, maxPoints: 480 },
  { label: "7d", minutes: 10080, maxPoints: 480 },
  { label: "15d", minutes: 21600, maxPoints: 600 },
  { label: "30d", minutes: 43200, maxPoints: 720 },
];
const DEFAULT_RANGE_MINUTES = 60;

const AVERAGE_KEYS: Array<keyof MetricPoint> = [
  "cpu",
  "mem",
  "disk",
  "req_per_s",
  "connections",
  "uplink_bps",
  "downlink_bps",
];
const LAST_KEYS: Array<keyof MetricPoint> = ["requests_total", "uplink_total", "downlink_total"];

function rangeFor(minutes: number) {
  return RANGES.find((r) => r.minutes === minutes) ?? RANGES[2];
}

function trimSeries(points: MetricPoint[], minutes: number, maxPoints: number) {
  const cutoff = Date.now() - minutes * 60 * 1000;
  const limit = Math.max(maxPoints * 4, 1000);
  return points.filter((p) => p.ts >= cutoff).slice(-limit);
}

function average(values: Array<number | null>) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : null;
}

function smoothSeries(points: MetricPoint[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  const bucketSize = Math.ceil(points.length / maxPoints);
  const smoothed: MetricPoint[] = [];

  for (let i = 0; i < points.length; i += bucketSize) {
    const bucket = points.slice(i, i + bucketSize);
    const last = bucket[bucket.length - 1];
    const next: MetricPoint = { ...last };

    for (const key of AVERAGE_KEYS) {
      next[key] = average(bucket.map((p) => p[key] as number | null)) as never;
    }
    for (const key of LAST_KEYS) {
      next[key] = last[key] as never;
    }
    next.ts = last.ts;
    smoothed.push(next);
  }

  return smoothed;
}

function StatTile({
  icon: Icon,
  title,
  value,
  sub,
  percent,
}: {
  icon: React.ElementType;
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  percent?: number | null;
}) {
  const p = percent ?? null;
  const color = p == null ? "" : p >= 90 ? "bg-destructive" : p >= 70 ? "bg-amber-500" : "bg-primary";
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold">{value}</div>
        {p != null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
          </div>
        )}
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatTileSkeleton() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="h-3 w-36" />
      </CardContent>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[260px] w-full" />
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const sys = useData<SystemOverview>(() => get("/system"), []);
  const [range, setRange] = useState(DEFAULT_RANGE_MINUTES);
  const selectedRange = rangeFor(range);
  const history = useData<MetricPoint[]>(
    () => get(`/system/metrics?minutes=${range}&max_points=${selectedRange.maxPoints}`),
    [range],
  );
  const { live, connected } = useMetricsStream();

  const [series, setSeries] = useState<MetricPoint[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);

  // Semeia a série com o histórico e vai anexando os pontos do SSE.
  useEffect(() => {
    if (history.data) setSeries(history.data);
  }, [history.data]);
  useEffect(() => {
    if (!live) return;
    setSeries((prev) => trimSeries([...prev, live], selectedRange.minutes, selectedRange.maxPoints));
  }, [live, selectedRange.maxPoints, selectedRange.minutes]);

  const chartSeries = useMemo(
    () => smoothSeries(trimSeries(series, selectedRange.minutes, selectedRange.maxPoints), selectedRange.maxPoints),
    [series, selectedRange.maxPoints, selectedRange.minutes],
  );

  const nginx = sys.data?.nginx;
  const last = series.length ? series[series.length - 1] : null;
  const loadingTiles = sys.loading && !sys.data;
  const loadingCharts = history.loading && series.length === 0;

  async function action(kind: "test" | "reload" | "restart" | "start" | "stop") {
    setActing(kind);
    try {
      const res = await post<{ output: string }>(`/nginx/${kind}`);
      toast.success(res.output || `${kind} ok`);
      sys.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Falha no ${kind}`);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Dashboard
            <span
              className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-primary" : "bg-muted-foreground"}`}
              title={connected ? "SSE conectado" : "SSE desconectado"}
            />
          </h1>
          <p className="text-sm text-muted-foreground">
            {sys.loading && !sys.data ? (
              <Skeleton className="mt-1 h-4 w-48" />
            ) : (
              <>{sys.data?.host.hostname ?? "—"} · {sys.data?.host.os ?? ""}</>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCfgOpen(true)}>
          <Settings2 className="h-4 w-4" /> Configurar
        </Button>
      </div>

      {/* Status + ações do nginx */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerIcon className="h-5 w-5 text-primary" /> nginx
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => action("test")} disabled={acting !== null}>
              <TerminalSquare className="h-4 w-4" /> Testar
            </Button>
            <Button variant="outline" size="sm" onClick={() => action("reload")} disabled={acting !== null}>
              <RefreshCw className={`h-4 w-4 ${acting === "reload" ? "animate-spin" : ""}`} /> Reload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => action("start")}
              disabled={acting !== null || nginx?.running}
            >
              <Play className="h-4 w-4" /> Start
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => action("stop")}
              disabled={acting !== null || !nginx?.running}
            >
              <Square className="h-4 w-4" /> Stop
            </Button>
            <Button variant="outline" size="sm" onClick={() => action("restart")} disabled={acting !== null}>
              <RotateCw className={`h-4 w-4 ${acting === "restart" ? "animate-spin" : ""}`} /> Restart
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sys.loading && !sys.data ? (
            <Skeleton className="h-6 w-64" />
          ) : (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Estado</span>
                <Badge variant={nginx?.running ? "default" : "destructive"}>
                  <Activity className="mr-1 h-3 w-3" />
                  {nginx?.running ? "rodando" : "parado"}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Versão </span>
                <span className="font-medium">{nginx?.version ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">PID </span>
                <span className="font-medium">{nginx?.pid ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Config</span>
                <Badge variant={nginx?.config_ok ? "default" : "destructive"}>
                  {nginx?.config_ok ? "válida" : "inválida"}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tiles ao vivo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loadingTiles ? (
          [...Array(8)].map((_, i) => <StatTileSkeleton key={i} />)
        ) : (
          <>
            <StatTile icon={Cpu} title="CPU" percent={last?.cpu}
              value={last?.cpu != null ? `${last.cpu}%` : "—"}
              sub={`${sys.data?.cpu.count ?? "—"} vCPU · load ${sys.data?.cpu.load?.join(" / ") ?? "—"}`} />
            <StatTile icon={MemoryStick} title="Memória" percent={last?.mem}
              value={last?.mem != null ? `${last.mem}%` : "—"}
              sub={`${formatBytes(sys.data?.memory.used)} / ${formatBytes(sys.data?.memory.total)}`} />
            <StatTile icon={HardDrive} title="Disco" percent={last?.disk}
              value={last?.disk != null ? `${last.disk}%` : "—"}
              sub={`${formatBytes(sys.data?.disk.used)} / ${formatBytes(sys.data?.disk.total)}`} />
            <StatTile icon={Activity} title="Uptime" value={formatUptime(sys.data?.host.uptime_seconds)}
              sub={`kernel ${sys.data?.host.kernel ?? "—"}`} />
            <StatTile icon={Gauge} title="Req/s"
              value={last?.req_per_s != null ? last.req_per_s.toFixed(1) : "—"}
              sub={`total: ${formatCount(last?.requests_total)} req`} />
            <StatTile icon={Plug} title="Conexões"
              value={last?.connections != null ? last.connections : "—"} />
            <StatTile icon={ArrowUpFromLine} title="Uplink" value={formatBps(last?.uplink_bps)}
              sub={`total: ${formatBytes(last?.uplink_total)}`} />
            <StatTile icon={ArrowDownToLine} title="Downlink" value={formatBps(last?.downlink_bps)}
              sub={`total: ${formatBytes(last?.downlink_total)}`} />
          </>
        )}
      </div>

      {/* Gráficos */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Métricas</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button
              key={r.minutes}
              variant={range === r.minutes ? "default" : "outline"}
              size="sm"
              onClick={() => setRange(r.minutes)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {loadingCharts ? (
          [...Array(4)].map((_, i) => <ChartSkeleton key={i} />)
        ) : (
          <>
            <MetricChart
              title="CPU / Memória / Disco (%)"
              icon={Cpu}
              data={chartSeries}
              domain={[0, 100]}
              valueFormat={(v) => `${Math.round(v)}%`}
              series={[
                { key: "cpu", label: "CPU", color: "hsl(152 64% 45%)" },
                { key: "mem", label: "RAM", color: "hsl(217 91% 60%)" },
                { key: "disk", label: "Disco", color: "hsl(38 92% 50%)" },
              ]}
            />
            <MetricChart
              title="Requisições / s"
              icon={Gauge}
              data={chartSeries}
              valueFormat={(v) => v.toFixed(0)}
              series={[{ key: "req_per_s", label: "req/s", color: "hsl(152 64% 45%)" }]}
            />
            <MetricChart
              title="Conexões ativas"
              icon={Plug}
              data={chartSeries}
              valueFormat={(v) => v.toFixed(0)}
              series={[{ key: "connections", label: "conexões", color: "hsl(280 65% 60%)" }]}
            />
            <MetricChart
              title="Tráfego de rede"
              icon={ArrowDownToLine}
              data={chartSeries}
              valueFormat={formatBps}
              series={[
                { key: "downlink_bps", label: "downlink", color: "hsl(217 91% 60%)" },
                { key: "uplink_bps", label: "uplink", color: "hsl(152 64% 45%)" },
              ]}
            />
          </>
        )}
      </div>

      <SettingsDialog open={cfgOpen} onOpenChange={setCfgOpen} onSaved={() => history.reload()} />
    </div>
  );
}

/** Dialog rápido para ajustar intervalo do SSE e retenção (o botão "Configurar"). */
function SettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [interval, setIntervalV] = useState("");
  const [retention, setRetention] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    get<SettingsData>("/settings").then((d) => {
      setData(d);
      setIntervalV(String(d.values.sse_interval_seconds));
      setRetention(String(d.values.metrics_retention_days));
    });
  }, [open]);

  async function save() {
    if (!data) return;
    const iLim = data.limits.sse_interval_seconds;
    const rLim = data.limits.metrics_retention_days;
    const err =
      validateNumber(interval, { min: iLim.min, max: iLim.max, label: "Intervalo do SSE" }) ||
      validateInt(retention, { min: rLim.min, max: rLim.max, label: "Retenção" });
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      await put("/settings", {
        sse_interval_seconds: Number(interval),
        metrics_retention_days: Number(retention),
      });
      toast.success("Configurações salvas");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configurações do dashboard</DialogTitle>
          <DialogDescription>Cadência do tempo real e retenção do histórico.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sse">
              Intervalo do SSE (s){data && ` — ${data.limits.sse_interval_seconds.min}–${data.limits.sse_interval_seconds.max}`}
            </Label>
            <Input
              id="sse"
              type="number"
              step="1"
              min={data?.limits.sse_interval_seconds.min}
              max={data?.limits.sse_interval_seconds.max}
              value={interval}
              onChange={(e) => setIntervalV(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ret">
              Retenção de métricas (dias){data && ` — ${data.limits.metrics_retention_days.min}–${data.limits.metrics_retention_days.max}`}
            </Label>
            <Input id="ret" type="number" value={retention} onChange={(e) => setRetention(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || !data}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
