import { useEffect, useMemo, useState } from "react";
import {
  Ban, Box, Brush, CheckCircle2, Clock, Container, Copy, ExternalLink,
  FlaskConical, GitBranch, Hammer, HeartPulse, HelpCircle, ListChecks,
  PackagePlus, PlayCircle, RefreshCw, Rocket, RotateCcw, ScrollText, Settings2,
  Trash2, UploadCloud, Wand2, X, XCircle, type LucideIcon,
} from "lucide-react";
import { del, get, post, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import type { DeploymentHistory, DeploymentItem, DeployStatus, DeployType } from "@/lib/types";
import { formatTsMs } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDelete } from "@/components/confirm-delete";
import { toast } from "@/components/ui/sonner";
import { LogViewer } from "../log-viewer";

type DeploymentsResponse = { items: DeploymentItem[]; total: number; limit: number; offset: number };

const STATUS_BADGE: Record<DeployStatus, { variant: "success" | "destructive" | "info" | "warning" | "muted"; label: string }> = {
  queued: { variant: "warning", label: "queued" },
  deploying: { variant: "info", label: "deploying" },
  deployed: { variant: "success", label: "deployed" },
  failed: { variant: "destructive", label: "failed" },
  canceled: { variant: "muted", label: "canceled" },
};

const TYPE_LABEL: Record<DeployType, string> = {
  manual: "manual", auto: "auto", rebuild: "rebuild", rollback: "rollback",
};

function StatusBadge({ status }: { status: DeployStatus }) {
  const item = STATUS_BADGE[status] ?? STATUS_BADGE.failed;
  return <Badge variant={item.variant}>{item.label}</Badge>;
}

function duration(ms: number) {
  if (!ms) return "-";
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const PHASE_ICONS: Record<string, LucideIcon> = {
  queued: Clock, preparing: PlayCircle, checkout: GitBranch, setup: Settings2,
  dependencies: PackagePlus, generate: Wand2, build: Hammer, test: FlaskConical,
  lint: ListChecks, package: Box, image_build: Container, push_image: UploadCloud,
  deploy: Rocket, health_check: HeartPulse, cleanup: Brush, completed: CheckCircle2,
  failed: XCircle, cancelled: Ban,
};

function PhaseIcon({ phase }: { phase: string }) {
  const Icon = PHASE_ICONS[phase] ?? HelpCircle;
  return <Icon className="h-4 w-4 text-primary" />;
}

function elapsedTotal(data: DeploymentHistory) {
  if (data.deployment.duration_ms) return data.deployment.duration_ms;
  if (data.phases.length === 0) return 0;
  const start = Math.min(...data.phases.map((p) => p.started_ts).filter(Boolean));
  const end = Math.max(...data.phases.map((p) => p.finished_ts).filter(Boolean));
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

async function copyText(text: string) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast.success("URL copiada"); }
  catch { toast.error("Não foi possível copiar"); }
}

function DeploymentHistoryDialog({ base, deployment, onOpenChange }: {
  base: string; deployment: DeploymentItem; onOpenChange: (open: boolean) => void;
}) {
  const { data, loading, error } = useData<DeploymentHistory>(
    () => get(`${base}/${deployment.id}/history`), [deployment.id]);
  const [liveData, setLiveData] = useState<DeploymentHistory | null>(null);
  const viewData = liveData ?? data;
  const events = viewData?.events ?? [];

  useEffect(() => { setLiveData(data); }, [data]);

  useEffect(() => {
    setLiveData(null);
    const es = new EventSource(streamUrl(`${base}/${deployment.id}/history/stream`));
    es.addEventListener("snapshot", (event) => {
      try { setLiveData(JSON.parse((event as MessageEvent).data) as DeploymentHistory); } catch { /* ignore */ }
    });
    es.addEventListener("deleted", () => { toast.info("Deployment removido"); onOpenChange(false); });
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment.id]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,820px)] w-[min(96vw,1120px)] max-w-none grid-rows-[auto_1fr] overflow-hidden p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4" /> Histórico do deployment #{deployment.id}
          </DialogTitle>
          <DialogDescription>{deployment.service_name || `Serviço #${deployment.service_id}`}</DialogDescription>
        </DialogHeader>
        {loading && !data ? (
          <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-80 w-full" /></div>
        ) : error && !viewData ? (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        ) : viewData ? (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
              {viewData.phases.length > 0 ? viewData.phases.map((phase) => (
                <div key={phase.phase} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <PhaseIcon phase={phase.phase} /> <span>{phase.label}</span>
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold">{duration(phase.duration_ms)}</div>
                </div>
              )) : (
                <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">Sem fases registradas.</div>
              )}
            </div>
            <LogViewer
              className="min-h-0 flex-1"
              entries={events.map((event) => ({ id: event.id, timestamp: event.ts, level: event.level, context: event.phase_label, message: event.message }))}
              emptyMessage="Sem eventos registrados para este deployment."
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" /> <span>Tempo total decorrido</span>
                <span className="font-mono font-semibold text-foreground">{duration(elapsedTotal(viewData))}</span>
              </div>
              <Button variant="outline" onClick={() => onOpenChange(false)}><X className="h-4 w-4" /> Fechar</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDeployments({ projectId, serviceId, canWrite }: {
  projectId: number | string; serviceId: number | string; canWrite: boolean;
}) {
  const base = `/projects/${projectId}/services/${serviceId}/deployments`;
  const [status, setStatus] = useState<DeployStatus | "all">("all");
  const [toDelete, setToDelete] = useState<DeploymentItem | null>(null);
  const [toRollback, setToRollback] = useState<DeploymentItem | null>(null);
  const [history, setHistory] = useState<DeploymentItem | null>(null);

  const path = useMemo(() => (status === "all" ? base : `${base}?status=${status}`), [base, status]);
  const streamPath = useMemo(() => (status === "all" ? `${base}/stream` : `${base}/stream?status=${status}`), [base, status]);
  const { data, loading, error, reload } = useData<DeploymentsResponse>(() => get(path), [path]);
  const [liveData, setLiveData] = useState<DeploymentsResponse | null>(null);
  const viewData = liveData ?? data;
  const items = viewData?.items ?? [];

  useEffect(() => { setLiveData(data); }, [data]);

  useEffect(() => {
    setLiveData(null);
    const es = new EventSource(streamUrl(streamPath));
    es.addEventListener("snapshot", (event) => {
      try { setLiveData(JSON.parse((event as MessageEvent).data) as DeploymentsResponse); } catch { /* ignore */ }
    });
    return () => es.close();
  }, [streamPath]);

  async function removeDeployment(item: DeploymentItem) {
    await del(`${base}/${item.id}`);
    toast.success("Deployment excluído");
    reload();
  }
  async function rollbackDeployment(item: DeploymentItem) {
    await post(`${base}/${item.id}/rollback`, {});
    toast.success("Rollback aplicado");
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Histórico de deploys deste serviço.</p>
        <div className="flex items-center gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value as DeployStatus | "all")} className="h-9 w-36">
            <option value="all">Todos</option>
            <option value="queued">Queued</option>
            <option value="deploying">Deploying</option>
            <option value="deployed">Deployed</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </Select>
          <Button variant="outline" size="icon" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {loading && !data ? (
        <Card><Table><TableBody>
          {[...Array(4)].map((_, i) => <TableRow key={i}><TableCell><Skeleton className="h-5 w-full" /></TableCell></TableRow>)}
        </TableBody></Table></Card>
      ) : items.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead className="w-40">Deployado em</TableHead>
                <TableHead className="w-28">Duração</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={item.status} />
                      {item.active && <Badge variant="secondary">ativo</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{TYPE_LABEL[item.type] ?? item.type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatTsMs(item.finished_ts || item.started_ts || item.created_ts)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{duration(item.duration_ms)}</TableCell>
                  <TableCell>
                    {item.has_preview && item.preview_url ? (
                      <>
                        <div className="flex min-w-0 items-center gap-1">
                          <code className="max-w-64 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs" title={item.preview_url}>{item.preview_url}</code>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyText(item.preview_url)}><Copy className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <a href={item.preview_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </Button>
                        </div>
                        {item.server_name && <div className="mt-1 text-xs text-muted-foreground">{item.server_name}</div>}
                      </>
                    ) : <span className="text-sm text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    <div className="max-w-64 space-y-0.5 text-xs">
                      <div className="font-mono">{item.source_branch || "-"}</div>
                      <div className="truncate font-mono text-muted-foreground" title={item.source_commit}>{item.source_commit || "-"}</div>
                      {item.source_commit_desc && <div className="truncate text-muted-foreground" title={item.source_commit_desc}>{item.source_commit_desc}</div>}
                      {item.error && <div className="truncate text-destructive" title={item.error}>{item.error}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setHistory(item)}><ScrollText className="h-4 w-4" /></Button>
                        </TooltipTrigger>
                        <TooltipContent>Histórico</TooltipContent>
                      </Tooltip>
                      {canWrite && item.status === "deployed" && !item.active && item.type !== "rollback" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setToRollback(item)}><RotateCcw className="h-4 w-4 text-warning" /></Button>
                          </TooltipTrigger>
                          <TooltipContent>Rollback</TooltipContent>
                        </Tooltip>
                      )}
                      {canWrite && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setToDelete(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir deployment</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="py-8 text-center text-muted-foreground">
          Nenhum deployment ainda. Use o botão Deploy do serviço.
        </Card>
      )}

      {viewData && viewData.limit > 0 && viewData.total > viewData.limit && (
        <p className="text-xs text-muted-foreground">
          Exibindo {items.length} de {viewData.total}. Ajuste o limite em CI/CD / Configurações / Deployment.
        </p>
      )}

      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Excluir deployment #${toDelete?.id}?`}
        description="Remove este registro da lista de deployments."
        onConfirm={() => { if (toDelete) return removeDeployment(toDelete); }}
      />
      <ConfirmDelete
        open={toRollback !== null}
        onOpenChange={(open) => !open && setToRollback(null)}
        title={`Rollback para deployment #${toRollback?.id}?`}
        description="Marca este deployment como a versão ativa do serviço."
        confirmLabel="Rollback"
        onConfirm={() => { if (toRollback) return rollbackDeployment(toRollback); }}
      />
      {history && <DeploymentHistoryDialog base={base} deployment={history} onOpenChange={(open) => !open && setHistory(null)} />}
    </div>
  );
}
