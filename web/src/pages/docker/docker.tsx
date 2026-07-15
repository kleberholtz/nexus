import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2, CircleArrowUp, CircleDashed, Container, FileJson, HardDrive,
  Loader2, MoreVertical, Network, Play, RefreshCw, ScrollText, Search, Square,
  Terminal as TerminalIcon,
} from "lucide-react";
import { ApiError, get, post, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import type { ContainerPort, ContainerStats, DockerContainer } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, StatBox, useDebounced, useUrlPagination } from "@/components/docker/list";

type ContainersResp = {
  containers: DockerContainer[]; states: string[];
  summary: { total: number; running: number }; total: number; page: number; pages: number;
};
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Inspect = {
  Mounts?: { Type: string; Source: string; Destination: string; RW: boolean; Name?: string }[];
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string; Gateway?: string; MacAddress?: string }> };
  [k: string]: unknown;
};
type DockerAction = "logs" | "config" | "mounts" | "networks" | "terminal";
const TerminalDialog = lazy(async () => ({ default: (await import("@/components/terminal-dialog")).TerminalDialog }));

/** Viewer de logs (SSE) de um container. */
function LogsPane({ cid }: { cid: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const boxRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!live) return;
    setLines([]);
    const es = new EventSource(streamUrl(`/docker/containers/${cid}/logs/stream?tail=200`));
    es.onmessage = (ev) => {
      try { const { line } = JSON.parse(ev.data) as { line: string }; setLines((p) => [...p.slice(-2000), line]); }
      catch { /* heartbeat */ }
    };
    return () => es.close();
  }, [live, cid]);
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }); }, [lines]);
  return (
    <div className="space-y-2">
      <Button variant={live ? "default" : "outline"} size="sm" onClick={() => setLive((v) => !v)}>
        {live ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />} Real time
      </Button>
      <pre ref={boxRef} className="max-h-96 min-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
        {lines.length ? lines.join("\n") : "aguardando logs…"}
      </pre>
    </div>
  );
}

function DialogShell({ container, title, icon, children, onOpenChange, className }: {
  container: DockerContainer;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onOpenChange: (o: boolean) => void;
  className?: string;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={className ?? "sm:max-w-3xl"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon} {title}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {container.name} · {container.image}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({ container, onOpenChange }: {
  container: DockerContainer; onOpenChange: (o: boolean) => void;
}) {
  const { data: inspect, loading } = useData<Inspect>(
    () => get(`/docker/containers/${container.id}/inspect`), [container.id]);
  return (
    <DialogShell
      container={container}
      title="Config"
      icon={<FileJson className="h-4 w-4" />}
      onOpenChange={onOpenChange}
    >
      {loading ? <Skeleton className="h-64 w-full" /> : (
        <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(inspect, null, 2)}
        </pre>
      )}
    </DialogShell>
  );
}

function MountsDialog({ container, onOpenChange }: {
  container: DockerContainer; onOpenChange: (o: boolean) => void;
}) {
  const { data: inspect, loading } = useData<Inspect>(
    () => get(`/docker/containers/${container.id}/inspect`), [container.id]);
  return (
    <DialogShell
      container={container}
      title="Mounts"
      icon={<HardDrive className="h-4 w-4" />}
      onOpenChange={onOpenChange}
    >
      {loading ? <Skeleton className="h-64 w-full" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tipo</TableHead><TableHead>Source</TableHead>
            <TableHead>Destino</TableHead><TableHead className="w-16">RW</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(inspect?.Mounts ?? []).map((m, i) => (
              <TableRow key={i}>
                <TableCell>{m.Type}</TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs" title={m.Name || m.Source}>{m.Name || m.Source}</TableCell>
                <TableCell className="font-mono text-xs">{m.Destination}</TableCell>
                <TableCell>{m.RW ? "sim" : "não"}</TableCell>
              </TableRow>
            ))}
            {(!inspect?.Mounts || inspect.Mounts.length === 0) && (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Sem mounts.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </DialogShell>
  );
}

function NetworksDialog({ container, onOpenChange }: {
  container: DockerContainer; onOpenChange: (o: boolean) => void;
}) {
  const { data: inspect, loading } = useData<Inspect>(
    () => get(`/docker/containers/${container.id}/inspect`), [container.id]);
  const networks = Object.entries(inspect?.NetworkSettings?.Networks ?? {});
  return (
    <DialogShell
      container={container}
      title="Networks"
      icon={<Network className="h-4 w-4" />}
      onOpenChange={onOpenChange}
    >
      {loading ? <Skeleton className="h-64 w-full" /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Rede</TableHead><TableHead>IP</TableHead>
            <TableHead>Gateway</TableHead><TableHead>MAC</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {networks.map(([name, n]) => (
              <TableRow key={name}>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell className="font-mono text-xs">{n.IPAddress || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{n.Gateway || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{n.MacAddress || "—"}</TableCell>
              </TableRow>
            ))}
            {networks.length === 0 && (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Sem redes.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </DialogShell>
  );
}

function LogsDialog({ container, onOpenChange }: {
  container: DockerContainer; onOpenChange: (o: boolean) => void;
}) {
  return (
    <DialogShell
      container={container}
      title="Logs"
      icon={<ScrollText className="h-4 w-4" />}
      onOpenChange={onOpenChange}
    >
      <LogsPane cid={container.id} />
    </DialogShell>
  );
}

const fmtCreated = (s?: number) => {
  if (!s) return "N/D";
  const d = new Date(s * 1000);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

/** Anel de progresso (donut) com o valor ao lado. `tone` = classe stroke-*. */
function Ring({ pct, tone, label }: { pct: number; tone: string; label: string }) {
  const r = 8, circ = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90 shrink-0">
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="3" className="stroke-muted" />
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="3" strokeLinecap="round"
          className={tone} strokeDasharray={circ} strokeDashoffset={circ * (1 - p / 100)} />
      </svg>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{label}</span>
    </div>
  );
}

const STATE_STYLE: Record<string, string> = {
  running: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  exited: "border-rose-500/40 text-rose-600 dark:text-rose-400",
  dead: "border-rose-500/40 text-rose-600 dark:text-rose-400",
  created: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  restarting: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  paused: "border-zinc-500/40 text-zinc-600 dark:text-zinc-400",
};

function StateBadge({ state }: { state: string }) {
  const cls = STATE_STYLE[state] ?? "border-zinc-500/40 text-muted-foreground";
  return (
    <span className={`inline-flex rounded-full border bg-transparent px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {state}
    </span>
  );
}

function UpdateIcon({ status }: { status?: string }) {
  if (status === "outdated")
    return <CircleArrowUp className="h-5 w-5 text-rose-500" aria-label="atualização disponível" />;
  if (status === "current")
    return <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="atualizada" />;
  return <CircleDashed className="h-5 w-5 text-muted-foreground" aria-label="desconhecido" />;
}

function PortBadges({ ports }: { ports?: ContainerPort[] }) {
  if (!ports || ports.length === 0) return <span className="text-xs text-muted-foreground">Sem portas</span>;
  const shown = ports.slice(0, 3);
  const extra = ports.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((p, i) => (
        <span key={i} title={p.published ? "publicada" : "exposta (sem mapeamento)"}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[0.7rem] ${p.published ? "" : "opacity-50"}`}>
          {p.text} <span className="text-muted-foreground">{p.proto}</span>
        </span>
      ))}
      {extra > 0 && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">+{extra}</span>}
    </div>
  );
}

export function DockerPage() {
  const [open, setOpen] = useState<{ container: DockerContainer; action: DockerAction } | null>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const dq = useDebounced(search.trim());
  const { page, setPage } = useUrlPagination(`${dq}|${state}`);

  const { data, loading, error, reload } = useData<ContainersResp>(
    () => get(`/docker/containers?${new URLSearchParams({ page: String(page), search: dq, state })}`),
    [page, dq, state],
  );
  const slice = data?.containers ?? [];
  const states = data?.states ?? [];
  const summary = data?.summary ?? { total: 0, running: 0 };

  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [updates, setUpdates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Uso (cpu/memória) ao vivo via SSE (cadência nas settings → aba Docker).
  useEffect(() => {
    const es = new EventSource(streamUrl("/docker/containers/stats/stream"));
    es.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data) as Record<string, ContainerStats> & { error?: string };
        if (!m.error) setStats(m);
      } catch { /* ignora */ }
    };
    return () => es.close();
  }, []);

  // Atualização das imagens dos containers (async, best-effort).
  function loadUpdates() {
    get<Record<string, string>>("/docker/containers/updates")
      .then(setUpdates).catch(() => {});
  }
  useEffect(() => { loadUpdates(); }, []);

  async function power(ct: DockerContainer, action: "start" | "stop") {
    setBusy(ct.id);
    try {
      await post(`/docker/containers/${ct.id}/${action}`);
      toast.success(action === "start" ? "Container iniciado" : "Container parado");
      reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? (e.messages[0]?.message ?? "Erro") : e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Container className="h-6 w-6 text-primary" /> Containers
          </h1>
          <p className="text-sm text-muted-foreground">Containers do host — logs, config, mounts, networks e terminal</p>
        </div>
        <StatBox icon={Container} label="Rodando / Total" value={`${summary.running} / ${summary.total}`} />
      </div>

      {/* Toolbar: refresh (esquerda) + pesquisa/estado (direita) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => { reload(); loadUpdates(); }} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar container" className="h-9 w-48 pl-8" />
          </div>
          <SelectWithSearch value={state} onChange={setState} className="w-40"
            placeholder="Todos os estados" searchPlaceholder="Estado"
            options={[{ value: "", label: "Todos os estados" },
              ...states.map((s) => ({ value: s, label: s }))]} />
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <Card>
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-28">Estado</TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead className="w-10 text-center">Atu.</TableHead>
              <TableHead className="w-28">CPU</TableHead>
              <TableHead className="w-40">Memória</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32">IP</TableHead>
              <TableHead>Portas</TableHead>
              <TableHead className="w-44">Criado</TableHead>
              <TableHead className="w-16 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              [...Array(4)].map((_, i) => <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-5 w-full" /></TableCell></TableRow>)
            ) : slice.length > 0 ? (
              slice.map((ct) => {
                const st = stats[ct.id];
                const running = ct.state === "running";
                const cpuTone = st && st.cpu >= 80 ? "stroke-rose-500" : st && st.cpu >= 50 ? "stroke-amber-500" : "stroke-primary";
                const memTone = st && st.mem_pct >= 90 ? "stroke-rose-500" : st && st.mem_pct >= 70 ? "stroke-amber-500" : "stroke-violet-500";
                return (
                <TableRow key={ct.id}>
                  <TableCell className="font-medium">
                    <Link to={`/docker/container/${encodeURIComponent(ct.name)}`}
                      className="text-primary hover:underline">{ct.name}</Link>
                  </TableCell>
                  <TableCell><StateBadge state={ct.state} /></TableCell>
                  <TableCell>
                    <Button size="icon" disabled={busy === ct.id}
                      title={running ? "Parar" : "Iniciar"}
                      onClick={() => power(ct, running ? "stop" : "start")}
                      variant={running ? "default" : "outline"}
                      className={running
                        ? "h-6 w-6 bg-rose-500 text-white hover:bg-rose-600"
                        : "h-6 w-6 border-emerald-500/50 text-emerald-600 hover:text-emerald-600 dark:text-emerald-400"}>
                      {busy === ct.id ? <Loader2 className="h-3 w-3 animate-spin" />
                        : running ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                    </Button>
                  </TableCell>
                  <TableCell className="text-center"><div className="flex justify-center"><UpdateIcon status={updates[ct.id]} /></div></TableCell>
                  <TableCell>
                    {running && st ? <Ring pct={st.cpu} tone={cpuTone} label={`${st.cpu.toFixed(1)}%`} />
                      : <span className="text-xs text-muted-foreground">N/D</span>}
                  </TableCell>
                  <TableCell>
                    {running && st ? <Ring pct={st.mem_pct} tone={memTone} label={formatBytes(st.mem)} />
                      : <span className="text-xs text-muted-foreground">N/D</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{ct.status}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{ct.ip || "N/D"}</TableCell>
                  <TableCell><PortBadges ports={ct.ports} /></TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtCreated(ct.created)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setOpen({ container: ct, action: "logs" })}>
                          <ScrollText className="h-4 w-4 text-muted-foreground" /> Logs
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setOpen({ container: ct, action: "config" })}>
                          <FileJson className="h-4 w-4 text-muted-foreground" /> Config
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setOpen({ container: ct, action: "mounts" })}>
                          <HardDrive className="h-4 w-4 text-muted-foreground" /> Mounts
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setOpen({ container: ct, action: "networks" })}>
                          <Network className="h-4 w-4 text-muted-foreground" /> Networks
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setOpen({ container: ct, action: "terminal" })}>
                          <TerminalIcon className="h-4 w-4 text-muted-foreground" /> Terminal
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                );
              })
            ) : (
              <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Nenhum container."}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? 0} onPage={setPage} />

      {open?.action === "logs" && (
        <LogsDialog container={open.container} onOpenChange={(o) => !o && setOpen(null)} />
      )}
      {open?.action === "config" && (
        <ConfigDialog container={open.container} onOpenChange={(o) => !o && setOpen(null)} />
      )}
      {open?.action === "mounts" && (
        <MountsDialog container={open.container} onOpenChange={(o) => !o && setOpen(null)} />
      )}
      {open?.action === "networks" && (
        <NetworksDialog container={open.container} onOpenChange={(o) => !o && setOpen(null)} />
      )}
      {open?.action === "terminal" && (
        <Suspense fallback={null}><TerminalDialog
          containers={[{ id: open.container.id, name: open.container.name, state: open.container.state }]}
          description={`${open.container.name} · ${open.container.image}`}
          terminalPath={(container, shell) => `/docker/containers/${encodeURIComponent(container.id)}/terminal?shell=${shell}`}
          onOpenChange={(o) => !o && setOpen(null)} /></Suspense>
      )}
    </div>
  );
}
