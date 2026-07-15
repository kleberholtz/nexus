import { useState } from "react";
import { Activity, Trash2 } from "lucide-react";
import { Beat, Monitor, ResponseTimings } from "@/lib/monitor-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { ResponseTimingsBars, averageTimings, hasTimings } from "@/components/uptime/detail-timings";

function fmtBytes(n?: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Grade de rótulo→valor, pulando os vazios. */
function MetaGrid({ title, rows }: { title: string; rows: [string, string][] }) {
  const items = rows.filter(([, v]) => v && v !== "—");
  if (items.length === 0) return null;
  return (
    <div className="text-xs">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="contents">
            <span>{k}</span><span className="truncate font-mono text-foreground sm:text-right" title={v}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ago(ts: number, now: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s / 60)}min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`;
  return `há ${Math.floor(s / 86400)}d`;
}

/** Detalhe da checagem apontada (ou a última). */
function BeatInfo({ beat, now, degraded, partial, avg }: {
  beat: Beat; now: number; degraded: boolean; partial: boolean; avg?: ResponseTimings | null;
}) {
  const ratio = Math.max(0, Math.min(1, beat.up_ratio ?? 1));
  const s = beat.status === "down" ? { label: "Falha", cls: "text-destructive" }
    : partial ? { label: "Proxy parcial", cls: "text-warning" }
    : degraded ? { label: "Degradado", cls: "text-warning" }
    : { label: "OK", cls: "text-success" };
  const proxyLines = (beat.proxy || "").split(/[;\n]/).map((l) => l.trim()).filter(Boolean);
  const m = beat.meta || {};
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{new Date(beat.ts).toLocaleString()}</span>
        <span className={`text-xs font-medium ${s.cls}`}>● {s.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <span>Quando</span><span className="text-foreground sm:text-right">{ago(beat.ts, now)}</span>
        <span>Latência</span><span className="text-foreground sm:text-right">{beat.latency_ms} ms</span>
        {partial && <><span>Disponibilidade</span><span className="text-warning sm:text-right">{Math.round(ratio * 100)}%</span></>}
      </div>

      <MetaGrid title="Response" rows={[
        ["Status", m.status ? String(m.status) : ""],
        ["Size", m.size != null ? fmtBytes(m.size) : ""],
        ["Compressed", m.compressed != null ? fmtBytes(m.compressed) : ""],
        ["Type", m.content_type || ""],
      ]} />

      <MetaGrid title="Informações da conexão" rows={[
        ["IP", m.remote_ip || ""],
        ["Protocol", m.http_version || ""],
        ["TLS", m.tls_version || ""],
        ["Cipher", m.tls_cipher || ""],
        ["ALPN", m.alpn || ""],
      ]} />

      {proxyLines.length > 0 && (
        <div className="text-xs">
          <span className="text-muted-foreground">{proxyLines.length > 1 ? "Proxies" : "Proxy"}</span>
          <div className="mt-0.5 space-y-0.5 font-mono">
            {proxyLines.map((line, i) => <div key={i} className="truncate" title={line}>{line}</div>)}
          </div>
        </div>
      )}
      {hasTimings(beat.timings) && (
        <div className="border-t pt-2">
          <div className="mb-1 text-xs font-medium">Tempo de resposta {avg ? "(vs. média)" : ""}</div>
          <ResponseTimingsBars timings={beat.timings} compareTo={avg} />
        </div>
      )}
    </div>
  );
}

/** Bloco completo de heartbeats (barra + resumo + detalhe) na página do monitor. */
export function DetailHeartbeats({ monitor, now, writable, onClear }: {
  monitor: Monitor;
  now: number;
  writable?: boolean;
  onClear?: () => void;
}) {
  const beats = (monitor.beats ?? []) as Beat[];
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);

  const threshold = monitor.config?.latency_threshold_ms || 0;
  const beatDegraded = (b: Beat) => b.status === "up" && threshold > 0 && b.latency_ms > threshold;
  const beatPartial = (b: Beat) => b.status === "up" && (b.up_ratio ?? 1) < 1;
  const beatRatio = (b: Beat) => (b.status === "up" ? Math.max(0, Math.min(1, b.up_ratio ?? 1)) : 0);
  const cls = (b: Beat) => b.status === "down" ? "bg-destructive"
    : (beatDegraded(b) || beatPartial(b)) ? "bg-warning" : "bg-success";

  const okCount = beats.filter((b) => b.status === "up" && !beatDegraded(b) && !beatPartial(b)).length;
  const degradedCount = beats.filter((b) => beatDegraded(b) && !beatPartial(b)).length;
  const partialCount = beats.filter(beatPartial).length;
  const downCount = beats.filter((b) => b.status === "down").length;
  const lats = beats.filter((b) => b.status === "up").map((b) => b.latency_ms);
  const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null;
  const pct = beats.length ? Math.round((beats.reduce((s, b) => s + beatRatio(b), 0) / beats.length) * 100) : null;

  const timed = beats.map((b) => b.timings).filter(hasTimings);
  const avgTimings = timed.length ? averageTimings(timed) : null;
  const hovered = hoverIdx != null ? beats[hoverIdx] : (beats.length ? beats[beats.length - 1] : null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Heartbeats</CardTitle>
        {writable && beats.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
            <Trash2 className="h-4 w-4" /> Limpar heartbeats
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {beats.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Sem heartbeats registrados.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-[2px]" onMouseLeave={() => setHoverIdx(null)}>
                {beats.map((b, i) => (
                  <span key={i}
                    onMouseEnter={() => setHoverIdx(i)}
                    className={`h-8 w-1.5 shrink-0 rounded-sm ${cls(b)} ${
                      i === hoverIdx ? "outline outline-1 outline-offset-1 outline-foreground/60" : ""}`} />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Disponibilidade" value={pct === null ? "—" : `${pct}%`} />
              <Stat label="Latência média" value={avg === null ? "—" : `${avg} ms`} />
              <Stat label="Checagens" value={String(beats.length)} />
              <Stat label="Última checagem" value={ago(monitor.last_check_ts, now)} />
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="text-success">{okCount} ok</span>
              {" · "}<span className="text-warning">{degradedCount} degradado(s)</span>
              {partialCount > 0 && <>{" · "}<span className="text-warning">{partialCount} parcial(is)</span></>}
              {" · "}<span className="text-destructive">{downCount} falha(s)</span>
            </div>

            {hovered && (
              <BeatInfo beat={hovered} now={now}
                degraded={beatDegraded(hovered)} partial={beatPartial(hovered)} avg={avgTimings} />
            )}
          </>
        )}
      </CardContent>
      <ConfirmDelete
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={() => onClear?.()}
        title="Limpar heartbeats"
        description="Excluir todo o histórico de heartbeats e uptime deste monitor? Esta ação não pode ser desfeita."
        confirmLabel="Excluir tudo"
      />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
