import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HeartPulse } from "lucide-react";
import { CHART_RANGE_OPTIONS, ChartPoint, MonitorChart } from "@/lib/monitor-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponseTimingsBars, hasTimings } from "@/components/uptime/detail-timings";

export type DetailChartPoint = ChartPoint & { metric: number };

function ChartTooltip({ active, payload, showLatency }: {
  active?: boolean;
  payload?: { payload: DetailChartPoint }[];
  showLatency: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const when = new Date(point.ts).toLocaleString([], {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const statusLabel = point.status === "up" ? "Saudável" : point.status === "down" ? "Falha" : "Parcial";
  const statusClass = point.status === "up" ? "text-success"
    : point.status === "down" ? "text-destructive" : "text-amber-500";
  return (
    <div className="min-w-[220px] rounded-md border bg-black/10 px-3 py-2 text-xs shadow backdrop-blur-md">
      <div className="font-medium">{when}</div>
      <div className={statusClass}>● {statusLabel}</div>
      {showLatency && point.avg_latency !== null && <div>Resposta: {point.avg_latency} ms</div>}
      {point.uptime !== null && <div>Disponibilidade: {point.uptime}%</div>}
      <div className="text-muted-foreground">↑ {+point.up.toFixed(2)} · ↓ {+point.down.toFixed(2)}</div>
      {point.proxy && (() => {
        const lines = point.proxy.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
        return (
          <div className="mt-1 max-w-[240px] border-t pt-1 text-muted-foreground">
            <div>{lines.length > 1 ? "Proxies:" : "Proxy:"}</div>
            <div className="font-mono">
              {lines.map((line, i) => <div key={i} className="truncate" title={line}>{line}</div>)}
            </div>
          </div>
        );
      })()}
      {point.message && point.status !== "up" && (
        <div className="mt-1 max-w-[220px] text-destructive">{point.message}</div>
      )}
      {hasTimings(point.timings) && (
        <div className="mt-2 border-t pt-2">
          <ResponseTimingsBars timings={point.timings} />
        </div>
      )}
    </div>
  );
}

function FailureDot(props: { cx?: number; cy?: number; index?: number; payload?: DetailChartPoint }) {
  const { cx, cy, index, payload } = props;
  if (cx == null || cy == null || !payload || payload.status === "up") return <g key={index} />;
  const fill = payload.status === "down" ? "hsl(var(--destructive))" : "hsl(38 92% 50%)";
  return (
    <circle key={index} cx={cx} cy={cy} r={3.5} fill={fill}
      stroke="hsl(var(--background))" strokeWidth={1} />
  );
}

type DetailChartProps = {
  title: string;
  chart: MonitorChart | null;
  points: DetailChartPoint[];
  range: string;
  onRangeChange: (range: string) => void;
  curve: "monotone" | "stepAfter";
  formatYAxis: (value: number) => string;
  showLatency: boolean;
  domain?: [number, number];
};

export function DetailChart({
  title,
  chart,
  points,
  range,
  onRangeChange,
  curve,
  formatYAxis,
  showLatency,
  domain,
}: DetailChartProps) {
  const gradientId = `uptime-gradient-${useId().replace(/:/g, "")}`;
  const longRange = range === "1w" || range === "1m";
  const shortRange = range === "1min" || range === "10min";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4" /> {title}
        </CardTitle>
        <div className="w-44">
          <SelectWithSearch options={CHART_RANGE_OPTIONS} value={range} onChange={onRangeChange} />
        </div>
      </CardHeader>
      <CardContent>
        {chart === null ? (
          <Skeleton className="h-[200px] w-full" />
        ) : points.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sem dados neste período.
          </div>
        ) : (
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(timestamp) => new Date(timestamp).toLocaleString([], longRange
                    ? { day: "2-digit", month: "2-digit" }
                    : shortRange
                    ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
                    : { hour: "2-digit", minute: "2-digit" })}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  minTickGap={40}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={48}
                  stroke="hsl(var(--border))"
                  domain={domain}
                  tickFormatter={formatYAxis}
                />
                <RechartsTooltip
                  content={<ChartTooltip showLatency={showLatency} />}
                  cursor={{ stroke: "hsl(var(--border))" }}
                />
                <Area
                  type={curve}
                  dataKey="metric"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={<FailureDot />}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
