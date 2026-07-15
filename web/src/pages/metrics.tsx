import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Database,
  FileArchive,
  Gauge,
  Globe,
  ListOrdered,
  MonitorSmartphone,
  Network,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { get } from "@/lib/api";
import { LogMetrics, LatencyStats, SystemOverview } from "@/lib/types";
import { formatBytes, formatCount } from "@/lib/utils";

// Paleta alinhada aos tokens do tema (roxo/laranja/ciano/verde/amarelo/vermelho/cinza).
const PALETTE = [
  "hsl(266 90% 66%)", // primary roxo
  "hsl(25 95% 55%)",  // secondary laranja
  "hsl(190 92% 52%)", // info ciano
  "hsl(142 70% 46%)", // success verde
  "hsl(45 96% 56%)",  // warning amarelo
  "hsl(0 82% 60%)",   // error vermelho
  "hsl(0 0% 55%)",    // outros cinza
];
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

// bits/s → Mbps/Gbps (o backend já entrega throughput em bits por segundo).
function formatBits(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  return v >= 1 ? `${v.toFixed(2)} s` : `${(v * 1000).toFixed(0)} ms`;
}

function num(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/** Bloco de estatística compacto (rótulo + valor + hint opcional). */
function Stat({ label, value, hint, accent }: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${accent ?? ""}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StatGridSkeleton({ count = 8, cols = "lg:grid-cols-4" }: { count?: number; cols?: string }) {
  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${cols}`}>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

function SectionSkeleton({
  icon: Icon,
  title,
  rows = 5,
  chart = false,
}: {
  icon: React.ElementType;
  title: string;
  rows?: number;
  chart?: boolean;
}) {
  return (
    <Section icon={Icon} title={title}>
      {chart ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-3">
          {[...Array(rows)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MetricsSkeleton() {
  return (
    <div className="space-y-6">
      <Section icon={Activity} title="Tráfego">
        <StatGridSkeleton count={12} />
      </Section>
      <Section icon={Gauge} title="Status HTTP">
        <StatGridSkeleton count={4} cols="lg:grid-cols-4" />
        <div className="mt-4 flex flex-wrap gap-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-6 w-16 rounded-full" />)}
        </div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionSkeleton icon={Timer} title="Latência" rows={4} />
        <SectionSkeleton icon={Timer} title="Requests lentas" rows={4} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionSkeleton icon={ListOrdered} title="Top Endpoints" chart />
        <SectionSkeleton icon={Timer} title="Slowest Endpoints" chart />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionSkeleton icon={MonitorSmartphone} title="User Agents" chart />
        <SectionSkeleton icon={MonitorSmartphone} title="Sistemas Operacionais" chart />
      </div>
      <Section icon={FileArchive} title="Compressão">
        <StatGridSkeleton count={5} cols="lg:grid-cols-5" />
        <Skeleton className="mt-4 h-52 w-full" />
      </Section>
    </div>
  );
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--card-foreground))",
  fontSize: 12,
};

function truncate(s: string, n = 34): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Barra horizontal (endpoints). data: rótulo + valor já formatado no tooltip. */
function HBar({ data, color, unit }: {
  data: { label: string; value: number }[];
  color: string;
  unit?: (v: number) => string;
}) {
  if (!data.length) return <p className="text-sm text-muted-foreground">Sem dados na amostra.</p>;
  const fmt = unit ?? ((v: number) => String(v));
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 30 + 16)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v) => fmt(Number(v))} stroke="hsl(var(--border))" />
        <YAxis type="category" dataKey="label" width={220}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(s) => truncate(String(s), 30)} stroke="hsl(var(--border))" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(Number(v))}
          labelFormatter={(l) => String(l)} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut a partir de um Record, respeitando uma ordem de categorias. */
function Donut({ record, order }: { record: Record<string, number>; order: string[] }) {
  const keys = [...order.filter((k) => record[k]), ...Object.keys(record).filter((k) => !order.includes(k) && record[k])];
  const data = keys.map((k) => ({ name: k, value: record[k] }));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <p className="text-sm text-muted-foreground">Sem dados na amostra.</p>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90}
          paddingAngle={2} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} stroke="transparent" fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ color: "hsl(var(--card-foreground))" }}
          labelStyle={{ color: "hsl(var(--card-foreground))" }}
          formatter={(v: number, n) => [`${formatCount(Number(v))} (${((Number(v) / total) * 100).toFixed(1)}%)`, n]} />
        <Legend verticalAlign="middle" align="right" layout="vertical"
          iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const STATUS_STYLE: Record<string, string> = {
  "2xx": "text-success",
  "3xx": "text-info",
  "4xx": "text-warning",
  "5xx": "text-destructive",
};

const CACHE_ORDER = ["HIT", "MISS", "BYPASS", "EXPIRED", "STALE", "REVALIDATED", "UPDATING"];
const CACHE_STYLE: Record<string, "success" | "warning" | "muted" | "info"> = {
  HIT: "success",
  MISS: "warning",
  BYPASS: "muted",
  EXPIRED: "warning",
  STALE: "info",
  REVALIDATED: "info",
  UPDATING: "info",
};

function LatencyTable({ stats }: { stats: { label: string; s: LatencyStats }[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Métrica</TableHead>
            <TableHead className="text-right">Média</TableHead>
            <TableHead className="text-right">P50</TableHead>
            <TableHead className="text-right">P90</TableHead>
            <TableHead className="text-right">P95</TableHead>
            <TableHead className="text-right">P99</TableHead>
            <TableHead className="text-right">Máx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map(({ label, s }) => (
            <TableRow key={label}>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.avg)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.p50)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.p90)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.p95)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.p99)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{ms(s.max)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function MetricsPage() {
  const [m, setM] = useState<LogMetrics | null>(null);
  const [conns, setConns] = useState<SystemOverview["live"] | null>(null);
  const [lines, setLines] = useState("5000");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [lm, ov] = await Promise.all([
        get<LogMetrics>(`/logs/metrics?lines=${encodeURIComponent(lines)}`),
        get<SystemOverview>("/system").catch(() => null),
      ]);
      setM(lm);
      if (ov) setConns(ov.live);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar métricas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, lines]);

  const t = m?.traffic;
  const totalStatus = m ? Object.values(m.status).reduce((a, b) => a + b, 0) : 0;
  const statusCodes = m ? Object.entries(m.status_codes ?? {}).sort((a, b) => Number(a[0]) - Number(b[0])) : [];
  const methods = m ? Object.entries(m.methods ?? {}).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gauge className="h-6 w-6 text-primary" /> Métricas
          </h1>
          <p className="text-sm text-muted-foreground">
            Derivadas do access.log (JSON){m && ` · ${formatCount(m.sample_size)} reqs · janela ${num(m.window_seconds, 0)}s`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={lines} onChange={(e) => setLines(e.target.value)} className="w-32">
            <option value="1000">1.000 linhas</option>
            <option value="5000">5.000 linhas</option>
            <option value="10000">10.000 linhas</option>
          </Select>
          <Button
            variant={auto ? "default" : "outline"}
            size="sm"
            onClick={() => setAuto((v) => !v)}
          >
            <Activity className={`h-4 w-4 ${auto ? "animate-pulse" : ""}`} />
            {auto ? "Auto 30s" : "Manual"}
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading && !m ? (
        <MetricsSkeleton />
      ) : m && t ? (
        <>
          {/* Tráfego */}
          <Section icon={Activity} title="Tráfego">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Requests / s (RPS)" value={num(t.rps, 2)} accent="text-primary" />
              <Stat label="Requests / min" value={num(t.rpm, 0)} />
              <Stat label="Requests / hora" value={num(t.rph, 0)} />
              <Stat label="Total na amostra" value={formatCount(m.sample_size)} />
              <Stat label="Throughput saída" value={formatBits(t.throughput_out_bps)} accent="text-secondary" hint="bytes enviados / janela" />
              <Stat label="Throughput entrada" value={formatBits(t.throughput_in_bps)} hint="bytes recebidos / janela" />
              <Stat label="Bytes enviados" value={formatBytes(t.bytes_out)} />
              <Stat label="Bytes recebidos" value={formatBytes(t.bytes_in)} />
              <Stat label="Conexões ativas" value={conns?.connections != null ? num(conns.connections, 0) : "—"} hint="stub_status (agora)" />
              <Stat label="Uplink atual" value={conns?.uplink_bps != null ? formatBits(conns.uplink_bps * 8) : "—"} />
              <Stat label="Downlink atual" value={conns?.downlink_bps != null ? formatBits(conns.downlink_bps * 8) : "—"} />
              <Stat label="req/s (nginx)" value={conns?.req_per_s != null ? num(conns.req_per_s, 1) : "—"} hint="stub_status" />
            </div>
            {Object.keys(m.protocols).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(m.protocols).map(([p, c]) => (
                  <Badge key={p} variant="info">{p}: {formatCount(c)}</Badge>
                ))}
              </div>
            )}
          </Section>

          {/* Status HTTP */}
          <Section icon={Gauge} title="Status HTTP">
            <div className="grid gap-3 sm:grid-cols-4">
              {["2xx", "3xx", "4xx", "5xx"].map((k) => {
                const c = m.status[k] ?? 0;
                const pct = totalStatus ? (c / totalStatus) * 100 : 0;
                return (
                  <Stat
                    key={k}
                    label={k}
                    value={formatCount(c)}
                    hint={`${pct.toFixed(1)}%`}
                    accent={STATUS_STYLE[k]}
                  />
                );
              })}
            </div>
            {statusCodes.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {statusCodes.map(([code, count]) => (
                  <Badge key={code} variant={Number(code) >= 500 ? "destructive" : Number(code) >= 400 ? "warning" : "secondary"}>
                    {code}: {formatCount(count)}
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          {/* Métodos */}
          <Section icon={ListOrdered} title="Métodos HTTP">
            {methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem métodos na amostra.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {methods.map(([method, count]) => (
                  <Badge key={method} variant="info">{method}: {formatCount(count)}</Badge>
                ))}
              </div>
            )}
          </Section>

          {/* Latência */}
          <Section icon={Timer} title="Latência">
            <LatencyTable
              stats={[
                { label: "Requisição total", s: m.latency.request },
                { label: "TTFB (upstream header)", s: m.latency.ttfb },
                { label: "Upstream (response)", s: m.latency.upstream },
              ]}
            />
          </Section>

          {/* Requests lentas */}
          <Section icon={Timer} title="Requests lentas">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Stat label="> 1s" value={formatCount(m.slow_requests?.thresholds.gt_1s ?? 0)} />
              <Stat label="> 5s" value={formatCount(m.slow_requests?.thresholds.gt_5s ?? 0)} accent="text-warning" />
              <Stat label="> 30s" value={formatCount(m.slow_requests?.thresholds.gt_30s ?? 0)} accent="text-destructive" />
            </div>
            {(m.slow_requests?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem requests lentas na amostra.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Host</TableHead>
                      <TableHead>Rota</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                      <TableHead className="text-right">Tempo</TableHead>
                      <TableHead>Upstream</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(m.slow_requests?.items ?? []).slice(0, 10).map((r, i) => (
                      <TableRow key={`${r.host}-${r.path}-${i}`}>
                        <TableCell className="font-mono text-xs">{r.host}</TableCell>
                        <TableCell className="max-w-[260px] truncate font-mono text-xs">{r.path}</TableCell>
                        <TableCell><Badge variant="secondary">{r.method}</Badge></TableCell>
                        <TableCell className="text-right">{r.status || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{ms(r.request_time)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.upstream}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* Cache */}
          <Section icon={Database} title="Cache">
            {Object.keys(m.cache).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de cache na amostra.</p>
            ) : (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <Stat label="Hit ratio" value={pct(m.cache_summary?.hit_ratio)} accent="text-success" />
                  <Stat label="Cache hits" value={formatCount(m.cache_summary?.hits ?? 0)} />
                  <Stat label="Cache misses/bypass" value={formatCount(m.cache_summary?.misses ?? 0)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {CACHE_ORDER.filter((k) => m.cache[k]).map((k) => (
                    <div key={k} className="rounded-lg border bg-card p-3">
                      <Badge variant={CACHE_STYLE[k] ?? "muted"}>{k}</Badge>
                      <div className="mt-2 text-xl font-semibold">{formatCount(m.cache[k])}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>

          {/* Hosts */}
          <Section icon={Globe} title="Hosts / domínios">
            {(m.hosts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem hosts na amostra.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Host</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Erros</TableHead>
                      <TableHead className="text-right">Erro %</TableHead>
                      <TableHead className="text-right">P95</TableHead>
                      <TableHead className="text-right">P99</TableHead>
                      <TableHead className="text-right">Cache hit</TableHead>
                      <TableHead className="text-right">Bandwidth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(m.hosts ?? []).slice(0, 12).map((h) => (
                      <TableRow key={h.host}>
                        <TableCell className="font-mono text-xs">{h.host}</TableCell>
                        <TableCell className="text-right">{formatCount(h.requests)}</TableCell>
                        <TableCell className="text-right">
                          {h.errors ? <Badge variant="destructive">{formatCount(h.errors)}</Badge> : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{pct(h.error_rate)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{ms(h.p95_latency)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{ms(h.p99_latency)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{pct(h.cache_hit_ratio)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatBytes(h.bytes)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* Upstreams */}
          <Section icon={Server} title="Upstreams">
            {m.upstreams.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum upstream na amostra.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endereço</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Falhas (5xx)</TableHead>
                      <TableHead className="text-right">Latência média</TableHead>
                      <TableHead className="text-right">P95</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.upstreams.map((u) => (
                      <TableRow key={u.addr}>
                        <TableCell className="flex items-center gap-2 font-mono text-xs">
                          <Network className="h-3.5 w-3.5 text-muted-foreground" /> {u.addr}
                        </TableCell>
                        <TableCell className="text-right">{formatCount(u.requests)}</TableCell>
                        <TableCell className="text-right">
                          {u.failures > 0 ? (
                            <Badge variant="destructive">{formatCount(u.failures)}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{ms(u.avg_latency)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{ms(u.p95_latency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          {/* IPs */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section icon={Network} title="Top IPs">
              {(m.top_ips ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem IPs na amostra.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                        <TableHead className="text-right">Bandwidth</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(m.top_ips ?? []).slice(0, 10).map((ip) => (
                        <TableRow key={ip.ip}>
                          <TableCell className="font-mono text-xs">{ip.ip}</TableCell>
                          <TableCell className="text-right">{formatCount(ip.requests)}</TableCell>
                          <TableCell className="text-right">{ip.errors ? <Badge variant="warning">{formatCount(ip.errors)}</Badge> : "0"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatBytes(ip.bytes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>
            <Section icon={AlertTriangle} title="Top IPs com erro">
              {(m.top_error_ips ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem erros por IP na amostra.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP</TableHead>
                        <TableHead className="text-right">Erros</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Bandwidth</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(m.top_error_ips ?? []).slice(0, 10).map((ip) => (
                        <TableRow key={ip.ip}>
                          <TableCell className="font-mono text-xs">{ip.ip}</TableCell>
                          <TableCell className="text-right"><Badge variant="destructive">{formatCount(ip.errors)}</Badge></TableCell>
                          <TableCell className="text-right">{formatCount(ip.requests)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatBytes(ip.bytes)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>
          </div>

          {/* Endpoints */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section icon={ListOrdered} title="Top Endpoints">
              <HBar
                color="hsl(266 90% 66%)"
                unit={(v) => formatCount(v)}
                data={m.top_endpoints.map((e) => ({ label: e.path, value: e.count }))}
              />
            </Section>
            <Section icon={Timer} title="Slowest Endpoints">
              <HBar
                color="hsl(45 96% 56%)"
                unit={ms}
                data={m.slowest_endpoints.map((e) => ({ label: e.path, value: e.avg_latency ?? 0 }))}
              />
            </Section>
          </div>
          <Section icon={AlertTriangle} title="Error Endpoints (4xx/5xx)">
            <HBar
              color="hsl(0 82% 60%)"
              unit={(v) => formatCount(v)}
              data={m.error_endpoints.map((e) => ({ label: e.path, value: e.errors }))}
            />
          </Section>

          {/* Países */}
          <Section icon={Globe} title="Países">
            {m.countries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de geolocalização na amostra.</p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-2">
                  {(() => {
                    const max = m.countries[0]?.requests || 1;
                    return m.countries.slice(0, 12).map((c) => (
                      <div key={c.country}>
                        <div className="mb-0.5 flex justify-between text-xs">
                          <span>{c.country}</span>
                          <span className="text-muted-foreground">{formatCount(c.requests)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(2, (c.requests / max) * 100)}%` }} />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Country</TableHead>
                        <TableHead className="text-right">Requests</TableHead>
                        <TableHead className="text-right">Bandwidth</TableHead>
                        <TableHead className="text-right">Latency</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {m.countries.slice(0, 15).map((c) => (
                        <TableRow key={c.country}>
                          <TableCell>{c.country}</TableCell>
                          <TableCell className="text-right">{formatCount(c.requests)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatBytes(c.bytes)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{ms(c.avg_latency)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </Section>

          {/* User agents & sistemas operacionais */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section icon={MonitorSmartphone} title="User Agents">
              <Donut record={m.browsers} order={["Chrome", "Firefox", "Safari", "Edge", "Bots", "Outros"]} />
            </Section>
            <Section icon={MonitorSmartphone} title="Sistemas Operacionais">
              <Donut record={m.os} order={["Windows", "Linux", "Android", "iOS", "macOS", "Outros"]} />
            </Section>
          </div>

          {/* Compressão */}
          <Section icon={FileArchive} title="Compressão">
            <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="Gzip" value={formatCount(m.compression.counts.gzip ?? 0)}
                hint={formatBytes(m.compression.bytes.gzip ?? 0)} accent="text-success" />
              <Stat label="Brotli" value={formatCount(m.compression.counts.br ?? 0)}
                hint={formatBytes(m.compression.bytes.br ?? 0)} accent="text-secondary" />
              <Stat label="Zstandard" value={formatCount(m.compression.counts.zstd ?? 0)}
                hint={formatBytes(m.compression.bytes.zstd ?? 0)} accent="text-info" />
              <Stat label="Sem compressão" value={formatCount(m.compression.counts.none ?? 0)}
                hint={formatBytes(m.compression.bytes.none ?? 0)} />
              <Stat label="Economia estimada" value={formatBytes(m.compression.saved_bytes_est)}
                hint="gzip_ratio" accent="text-info" />
            </div>
            {m.compression.series.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={m.compression.series} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-gzip" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142 70% 46%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(142 70% 46%)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="grad-brotli" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(25 95% 55%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(25 95% 55%)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="grad-zstd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(190 92% 52%)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(190 92% 52%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="ts"
                    tickFormatter={(ts) => new Date(Number(ts)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} stroke="hsl(var(--border))" />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={40} stroke="hsl(var(--border))" />
                  <Tooltip contentStyle={tooltipStyle}
                    labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="gzip" name="Gzip" stroke="hsl(142 70% 46%)"
                    fill="url(#grad-gzip)" strokeWidth={2} isAnimationActive={false} stackId="1" />
                  <Area type="monotone" dataKey="brotli" name="Brotli" stroke="hsl(25 95% 55%)"
                    fill="url(#grad-brotli)" strokeWidth={2} isAnimationActive={false} stackId="1" />
                  <Area type="monotone" dataKey="zstd" name="Zstandard" stroke="hsl(190 92% 52%)"
                    fill="url(#grad-zstd)" strokeWidth={2} isAnimationActive={false} stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Sem métricas.</p>
      )}
    </div>
  );
}
