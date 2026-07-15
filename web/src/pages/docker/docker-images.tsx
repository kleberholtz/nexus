import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Download, FileJson, HardDrive, History, Layers, Loader2, MoreVertical,
  RefreshCw, ScanLine, Search, ShieldAlert, ShieldCheck, Trash2, Download as DownloadIcon,
} from "lucide-react";
import { ApiError, del, get, post, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { formatBytes } from "@/lib/utils";
import { SEV, SEV_ORDER, topSeverity, type ScanRecord } from "@/lib/severity";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverPopover } from "@/components/ui/hover-popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Pagination, StatBox, useDebounced, useUrlPagination } from "@/components/docker/list";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type DockerImage = {
  id: string;
  short_id: string;
  name: string;
  tags: string[];
  repo_digests: string[];
  size: number;
  created: number;
  containers: { name: string; state: string }[];
  in_use: boolean;
  dangling: boolean;
};
type ImagesResp = {
  images: DockerImage[]; summary: { total: number; size: number }; scan_enabled: boolean;
  total: number; page: number; pages: number;
};
type UpdateStatus = "outdated" | "current" | "unknown";
type ScanResult = { total: number; severities: Record<string, number>; finished_at?: number };
type Layer = { id: string; created: number; created_by: string; size: number; comment: string; tags: string[] };

const errMsg = (e: unknown) =>
  e instanceof ApiError ? (e.messages[0]?.message ?? "Erro") : e instanceof Error ? e.message : "Erro";
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : "—");
const fmtDateTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");

function VulnPopover({ scan, onScan }: { scan: ScanResult; onScan: () => void }) {
  const top = topSeverity(scan.severities);
  const style = top ? SEV[top] : null;
  const rows = SEV_ORDER.filter((s) => scan.severities[s] > 0);
  const badge = scan.total === 0
    ? <Badge variant="success" className="cursor-default">0</Badge>
    : (
      <span className={`inline-flex cursor-default items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${style?.badge}`}>
        <ShieldAlert className="h-3.5 w-3.5" /> {scan.total}
      </span>
    );

  return (
    <HoverPopover width={264} trigger={badge}>
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          {scan.total === 0
            ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            : <ShieldAlert className={`mt-0.5 h-5 w-5 ${style?.text}`} />}
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">{top ? SEV[top].label : "Seguro"}</div>
            <div className="text-xs text-muted-foreground">Resumo das vulnerabilidades</div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular-nums">{scan.total}</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {scan.total > 0 && SEV_ORDER.map((s) => scan.severities[s] ? (
              <div key={s} className={SEV[s].bar} style={{ width: `${(scan.severities[s] / scan.total) * 100}%` }} />
            ) : null)}
          </div>
        </div>

        {rows.length > 0 && (
          <div className="space-y-1">
            {rows.map((s) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <span className={SEV[s].text}>{SEV[s].label}</span>
                <span className={`font-semibold tabular-nums ${SEV[s].text}`}>{scan.severities[s]}</span>
              </div>
            ))}
          </div>
        )}

        {scan.finished_at ? (
          <div className="text-[0.7rem] text-muted-foreground">Última análise: {fmtDateTime(scan.finished_at)}</div>
        ) : null}
        <Button variant="outline" size="sm" className="w-full" onClick={onScan}>
          <ScanLine className="h-3.5 w-3.5" /> Escanear novamente
        </Button>
      </div>
    </HoverPopover>
  );
}

function VulnCell({ scan, phase, enabled, onScan }: {
  scan?: ScanResult; phase?: string; enabled: boolean; onScan: () => void;
}) {
  if (phase !== undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {phase || "na fila"}
      </span>
    );
  }
  if (!scan) {
    if (!enabled) {
      return <span className="text-xs text-muted-foreground" title="Ative em Configurações → Docker">desativado</span>;
    }
    return (
      <Button variant="outline" size="sm" className="h-7" onClick={onScan}>
        <ScanLine className="h-3.5 w-3.5" /> escanear
      </Button>
    );
  }
  return <VulnPopover scan={scan} onScan={onScan} />;
}

function ScanHistoryDialog({ image, onOpenChange }: { image: DockerImage; onOpenChange: (o: boolean) => void }) {
  const { data, loading } = useData<ScanRecord[]>(
    () => get(`/docker/images/scans?image_id=${encodeURIComponent(image.id)}`), [image.id]);
  const statusBadge = (st: ScanRecord["status"]) =>
    st === "success" ? <Badge variant="success">concluído</Badge>
      : st === "failed" ? <Badge variant="destructive">falhou</Badge>
      : st === "canceled" ? <Badge variant="muted">cancelado</Badge>
      : <Badge variant="warning">{st}</Badge>;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Histórico de scans</DialogTitle>
          <DialogDescription className="font-mono text-xs">{image.tags[0] || image.short_id}</DialogDescription>
        </DialogHeader>
        {loading ? <Skeleton className="h-48 w-full" /> : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Solicitado</TableHead>
                <TableHead>Concluído</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-16 text-right">Total</TableHead>
                <TableHead>Severidades</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.finished_at)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{r.status === "success" ? r.total : "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {SEV_ORDER.filter((s) => r.severities?.[s] > 0).map((s) => (
                          <span key={s} className={`rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${SEV[s].badge}`}>
                            {SEV[s].label[0]} {r.severities[s]}
                          </span>
                        ))}
                        {r.status === "failed" && <span className="text-[0.7rem] text-destructive" title={r.error ?? ""}>erro</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!data || data.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Nenhum scan ainda.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UpdateCell({ status }: { status?: UpdateStatus }) {
  if (status === undefined) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === "outdated") return <Badge variant="warning">atualização</Badge>;
  if (status === "current") return <Badge variant="muted">atualizada</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

function InspectDialog({ image, onOpenChange }: { image: DockerImage; onOpenChange: (o: boolean) => void }) {
  const { data, loading } = useData<unknown>(() => get(`/docker/images/${encodeURIComponent(image.id)}/inspect`), [image.id]);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileJson className="h-4 w-4" /> Inspecionar</DialogTitle>
          <DialogDescription className="font-mono text-xs">{image.tags[0] || image.short_id}</DialogDescription>
        </DialogHeader>
        {loading ? <Skeleton className="h-64 w-full" /> : (
          <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ image, onOpenChange }: { image: DockerImage; onOpenChange: (o: boolean) => void }) {
  const { data, loading } = useData<Layer[]>(() => get(`/docker/images/${encodeURIComponent(image.id)}/history`), [image.id]);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Histórico de camadas</DialogTitle>
          <DialogDescription className="font-mono text-xs">{image.tags[0] || image.short_id}</DialogDescription>
        </DialogHeader>
        {loading ? <Skeleton className="h-64 w-full" /> : (
          <div className="max-h-96 overflow-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-24 text-right">Tamanho</TableHead>
                <TableHead>Comando</TableHead>
                <TableHead className="w-28">Criado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(data ?? []).map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatBytes(l.size)}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-[11px]" title={l.created_by}>
                      {l.created_by.replace(/^\/bin\/sh -c #\(nop\)\s*/, "").trim() || l.comment || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(l.created)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ image, onOpenChange, onDone }: {
  image: DockerImage; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [force, setForce] = useState(image.in_use);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await del(`/docker/images/${encodeURIComponent(image.id)}?force=${force}`);
      toast.success("Imagem removida");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remover imagem</DialogTitle>
          <DialogDescription className="font-mono text-xs">{image.tags[0] || image.short_id}</DialogDescription>
        </DialogHeader>
        {image.in_use && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Imagem em uso por {image.containers.length} container(s). Remover exige forçar.
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={force} onCheckedChange={(v) => setForce(!!v)} /> Forçar remoção
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DockerImagesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const dq = useDebounced(search.trim());
  const { page, setPage } = useUrlPagination(`${dq}|${status}`);

  const { data, loading, error, reload } = useData<ImagesResp>(
    () => get(`/docker/images?${new URLSearchParams({ page: String(page), search: dq, status })}`),
    [page, dq, status],
  );
  const [updates, setUpdates] = useState<Record<string, UpdateStatus> | null>(null);
  const [scans, setScans] = useState<Record<string, ScanResult>>({});
  const [scanPhase, setScanPhase] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ image: DockerImage; kind: "inspect" | "history" | "remove" | "scans" } | null>(null);
  const esRef = useRef<EventSource[]>([]);

  const slice = useMemo(() => data?.images ?? [], [data]);
  const scanEnabled = data?.scan_enabled ?? false;

  // Checagem de atualizações (async, após a lista) — popula a coluna Atualizações.
  useEffect(() => {
    if (!slice.length) { setUpdates({}); return; }
    setUpdates(null);
    let alive = true;
    get<Record<string, UpdateStatus>>("/docker/images/updates")
      .then((m) => { if (alive) setUpdates(m); })
      .catch(() => { if (alive) setUpdates({}); });
    return () => { alive = false; };
  }, [slice]);

  // Último scan salvo por imagem (persistido no banco) — popula os badges no load.
  useEffect(() => {
    let alive = true;
    get<Record<string, ScanRecord>>("/docker/images/scans/latest")
      .then((m) => {
        if (!alive) return;
        const out: Record<string, ScanResult> = {};
        for (const [id, r] of Object.entries(m)) out[id] = { total: r.total, severities: r.severities, finished_at: r.finished_at };
        setScans(out);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const clearPhase = (id: string) => setScanPhase((p) => { const n = { ...p }; delete n[id]; return n; });

  // Acompanha as fases de um scan via SSE (na fila → subindo container → digitalizando…).
  const followScan = (imageId: string, scanId: number, initialPhase: string) => {
    setScanPhase((p) => ({ ...p, [imageId]: initialPhase }));
    const es = new EventSource(streamUrl(`/docker/images/scans/${scanId}/stream`));
    esRef.current.push(es);
    const finish = () => {
      es.close();
      esRef.current = esRef.current.filter((x) => x !== es);
      clearPhase(imageId);
    };
    es.onmessage = (ev) => {
      try {
        const row = JSON.parse(ev.data) as ScanRecord & { error?: string };
        if (!row.status) return;
        setScanPhase((p) => ({ ...p, [imageId]: row.phase }));
        if (row.status === "success") {
          setScans((m) => ({ ...m, [imageId]: { total: row.total, severities: row.severities, finished_at: row.finished_at } }));
        } else if (row.status === "failed") {
          toast.error(row.error || "scan falhou");
        }
      } catch { /* ignora heartbeat/linha inválida */ }
    };
    es.addEventListener("end", finish);
    es.onerror = finish;
  };

  // Ao (re)carregar a tela, restaura o acompanhamento dos scans em andamento.
  useEffect(() => {
    let alive = true;
    get<Record<string, ScanRecord>>("/docker/images/scans/active")
      .then((m) => {
        if (!alive) return;
        for (const [id, r] of Object.entries(m)) followScan(id, r.id, r.phase || "na fila");
      })
      .catch(() => {});
    // Fecha os EventSource abertos ao desmontar.
    return () => { alive = false; esRef.current.forEach((es) => es.close()); esRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan(image: DockerImage) {
    if (scanPhase[image.id] !== undefined) return;  // já em andamento
    setScanPhase((p) => ({ ...p, [image.id]: "na fila" }));
    try {
      const r = await post<ScanRecord>(`/docker/images/${encodeURIComponent(image.id)}/scan`);
      followScan(image.id, r.id, r.phase || "na fila");
    } catch (e) {
      toast.error(errMsg(e));
      clearPhase(image.id);
    }
  }

  async function pull(image: DockerImage) {
    setBusy(image.id);
    try {
      const r = await post<{ reference: string }>(`/docker/images/${encodeURIComponent(image.id)}/pull`);
      toast.success(`Imagem ${r.reference} atualizada`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  function exportImage(image: DockerImage) {
    window.open(streamUrl(`/docker/images/${encodeURIComponent(image.id)}/export`), "_blank");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Layers className="h-6 w-6 text-primary" /> Imagens
          </h1>
          <p className="text-sm text-muted-foreground">Imagens Docker do host — uso, atualizações, vulnerabilidades e ações</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatBox icon={Layers} label="Imagens" value={String(data?.summary.total ?? 0)} />
          <StatBox icon={HardDrive} label="Tamanho total" value={formatBytes(data?.summary.size ?? 0)} />
        </div>
      </div>

      {/* Toolbar: refresh (esquerda) + pesquisa/filtros (direita) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar imagem" className="h-9 w-48 pl-8" />
          </div>
          <SelectWithSearch value={status} onChange={setStatus} className="w-36"
            placeholder="Todos os status" searchPlaceholder="Status"
            options={[{ value: "", label: "Todos os status" },
              { value: "in_use", label: "Em uso" },
              { value: "dangling", label: "Dangling" },
              { value: "free", label: "Livre" }]} />
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Usado por</TableHead>
                <TableHead className="w-32">Atualizações</TableHead>
                <TableHead className="w-40">Vulnerabilidades</TableHead>
                <TableHead className="w-24 text-right">Tamanho</TableHead>
                <TableHead className="w-28">Criado</TableHead>
                <TableHead className="w-12 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                [...Array(4)].map((_, i) => <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-5 w-full" /></TableCell></TableRow>)
              ) : slice.length > 0 ? (
                slice.map((im) => (
                  <TableRow key={im.id}>
                    <TableCell className="max-w-[16rem] font-medium">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link to={`/docker/image/${encodeURIComponent(im.id)}`}
                            className="block truncate text-primary hover:underline">{im.name}</Link>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm break-all font-mono">{im.name}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="max-w-[12rem]">
                      {im.tags.length ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1">
                              {im.tags.slice(0, 2).map((t) => (
                                <Badge key={t} variant="muted" className="max-w-[8rem] truncate font-mono text-[0.7rem]">
                                  {t.split(":").pop()}
                                </Badge>
                              ))}
                              {im.tags.length > 2 && <Badge variant="muted" className="shrink-0">+{im.tags.length - 2}</Badge>}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <div className="space-y-0.5 break-all font-mono">
                              {im.tags.map((t) => <div key={t}>{t}</div>)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-xs text-muted-foreground">{im.short_id}</span>}
                    </TableCell>
                    <TableCell>
                      {im.dangling ? <Badge variant="destructive">dangling</Badge>
                        : im.in_use ? <Badge variant="success">em uso</Badge>
                        : <Badge variant="muted">livre</Badge>}
                    </TableCell>
                    <TableCell className="max-w-[12rem] text-xs text-muted-foreground">
                      {im.containers.length === 0 ? "—" : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block truncate">
                              {im.containers.slice(0, 2).map((c) => c.name).join(", ")}
                              {im.containers.length > 2 ? ` +${im.containers.length - 2}` : ""}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <div className="space-y-0.5 break-all font-mono">
                              {im.containers.map((c) => <div key={c.name}>{c.name}</div>)}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell><UpdateCell status={updates?.[im.id]} /></TableCell>
                    <TableCell><VulnCell scan={scans[im.id]} phase={scanPhase[im.id]} enabled={scanEnabled} onScan={() => scan(im)} /></TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatBytes(im.size)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(im.created)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy === im.id}>
                            {busy === im.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDialog({ image: im, kind: "inspect" })}>
                            <FileJson className="h-4 w-4 text-muted-foreground" /> Inspecionar
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ image: im, kind: "history" })}>
                            <Layers className="h-4 w-4 text-muted-foreground" /> Histórico de camadas
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => exportImage(im)}>
                            <Download className="h-4 w-4 text-muted-foreground" /> Exportar
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => pull(im)}>
                            <DownloadIcon className="h-4 w-4 text-muted-foreground" /> Puxar
                          </DropdownMenuItem>
                          {scanEnabled && (
                            <DropdownMenuItem onSelect={() => scan(im)}>
                              <ScanLine className="h-4 w-4 text-muted-foreground" /> Escanear
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => setDialog({ image: im, kind: "scans" })}>
                            <History className="h-4 w-4 text-muted-foreground" /> Histórico de scans
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDialog({ image: im, kind: "remove" })}>
                            <Trash2 className="h-4 w-4" /> Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Nenhuma imagem."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? 0} onPage={setPage} />

      {dialog?.kind === "inspect" && <InspectDialog image={dialog.image} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === "history" && <HistoryDialog image={dialog.image} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === "scans" && <ScanHistoryDialog image={dialog.image} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === "remove" && <RemoveDialog image={dialog.image} onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
    </div>
  );
}
