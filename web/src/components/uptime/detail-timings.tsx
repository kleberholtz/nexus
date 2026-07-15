import { Gauge } from "lucide-react";
import { ResponseTimings } from "@/lib/monitor-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Phase = { key: keyof ResponseTimings; label: string; color: string };

const PHASES: Phase[] = [
  { key: "dns", label: "DNS Lookup", color: "bg-sky-500" },
  { key: "tcp", label: "TCP Connect", color: "bg-emerald-500" },
  { key: "tls", label: "TLS Handshake", color: "bg-violet-500" },
  { key: "request", label: "Request Sent", color: "bg-amber-500" },
  { key: "ttfb", label: "Waiting (TTFB)", color: "bg-orange-500" },
  { key: "download", label: "Content Download", color: "bg-pink-500" },
];

const KEYS: (keyof ResponseTimings)[] = [...PHASES.map((p) => p.key), "total"];

export function hasTimings(t?: ResponseTimings | null): t is ResponseTimings {
  return !!t && PHASES.some((p) => typeof t[p.key] === "number");
}

/** Percentil (nearest-rank) de uma lista de números. */
function percentile(values: number[], p: number): number | null {
  const arr = values.filter((v) => typeof v === "number").sort((a, b) => a - b);
  if (!arr.length) return null;
  const rank = Math.ceil((p / 100) * arr.length);
  return arr[Math.min(arr.length - 1, Math.max(0, rank - 1))];
}

/** Objeto de timings com o percentil `p` de cada fase (calculado por fase). */
function percentileTimings(samples: ResponseTimings[], p: number): ResponseTimings {
  const out = {} as ResponseTimings;
  for (const k of KEYS) {
    const vals = samples.map((t) => t[k]).filter((v): v is number => typeof v === "number");
    out[k] = percentile(vals, p);
  }
  return out;
}

/** Média de cada fase (para comparação de um beat com a média). */
export function averageTimings(samples: ResponseTimings[]): ResponseTimings {
  const out = {} as ResponseTimings;
  for (const k of KEYS) {
    const vals = samples.map((t) => t[k]).filter((v): v is number => typeof v === "number");
    out[k] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return out;
}

/** Compara `value` com a média `base`: badge ↑/↓ com a variação %. */
function DeltaBadge({ value, base }: { value: number; base?: number | null }) {
  if (typeof base !== "number" || base <= 0) return null;
  const d = Math.round(((value - base) / base) * 100);
  if (d === 0) return null;
  // Latência: acima da média (↑) é pior (destaque), abaixo (↓) é melhor.
  return (
    <span className={`ml-1 tabular-nums ${d > 0 ? "text-destructive" : "text-success"}`}>
      {d > 0 ? `↑ +${d}%` : `↓ ${d}%`}
    </span>
  );
}

/** Barras (waterfall) do detalhamento do tempo de resposta. `compareTo` (média)
 * habilita a variação percentual ao lado de cada fase. */
export function ResponseTimingsBars({ timings, showTotal = true, compareTo }: {
  timings: ResponseTimings; showTotal?: boolean; compareTo?: ResponseTimings | null;
}) {
  const phases = PHASES.filter((p) => typeof timings[p.key] === "number");
  const sum = phases.reduce((acc, p) => acc + (timings[p.key] as number), 0);
  const total = typeof timings.total === "number" ? timings.total : sum;
  const denom = sum || 1;

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {phases.map((p) => (
          <div key={p.key} className={p.color}
            style={{ width: `${((timings[p.key] as number) / denom) * 100}%` }} />
        ))}
      </div>
      <div className="space-y-1.5">
        {phases.map((p) => (
          <div key={p.key} className="flex items-center gap-2 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${p.color}`} />
            <span className="flex-1 text-muted-foreground">{p.label}</span>
            <span className="tabular-nums font-medium">{timings[p.key] as number} ms</span>
            {compareTo && <DeltaBadge value={timings[p.key] as number} base={compareTo[p.key]} />}
          </div>
        ))}
        {showTotal && (
          <div className="mt-1 flex items-center gap-2 border-t pt-1.5 text-sm font-semibold">
            <span className="h-2.5 w-2.5 shrink-0" />
            <span className="flex-1">Total</span>
            <span className="tabular-nums">{total} ms</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Um bloco de estatística (Último / p95 / p99) com o detalhamento por fase. */
function TimingStatCard({ title, timings }: { title: string; timings: ResponseTimings }) {
  const headline = timings.total;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Gauge className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold tabular-nums">
          {headline == null ? "—" : (
            <>{headline}<span className="ml-1 text-sm font-normal text-muted-foreground">ms</span></>
          )}
        </div>
        <ResponseTimingsBars timings={timings} showTotal={false} />
      </CardContent>
    </Card>
  );
}

/** Linha com 3 blocos: Último tempo de resposta, p95 e p99 (com o waterfall). */
export function TimingStatsRow({ samples }: { samples: ResponseTimings[] }) {
  if (!samples.length) return null;
  const last = samples[samples.length - 1];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TimingStatCard title="Último tempo de resposta" timings={last} />
      <TimingStatCard title="p95" timings={percentileTimings(samples, 95)} />
      <TimingStatCard title="p99" timings={percentileTimings(samples, 99)} />
    </div>
  );
}
