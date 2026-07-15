import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ArrowUpDown, Boxes, Braces, Eye, EyeOff, FileJson, History, Info, Layers, Loader2,
  ScanLine, Search, Settings2, ShieldAlert, ShieldCheck, Tags,
} from "lucide-react";
import { get, post, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { formatBytes } from "@/lib/utils";
import { SEV, SEV_ORDER, topSeverity, type ScanRecord, type Vuln } from "@/lib/severity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CopyId, DetailBack, Field, KeyValueSection, RawJson, Section, copyText, fmtDockerDate, shortId,
} from "@/components/docker/detail";
import { Pagination } from "@/components/docker/list";

const fmtDateTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");

type ImageInspect = {
  Id?: string; RepoTags?: string[]; RepoDigests?: string[]; Created?: string;
  Size?: number; Architecture?: string; Os?: string; Author?: string; DockerVersion?: string;
  Config?: {
    User?: string; WorkingDir?: string; Cmd?: string[] | null; Entrypoint?: string[] | null;
    Env?: string[]; ExposedPorts?: Record<string, unknown>; Volumes?: Record<string, unknown>;
    Labels?: Record<string, string>;
  };
  RootFS?: { Type?: string; Layers?: string[] };
};
type Layer = { id: string; created: number; created_by: string; size: number; comment: string; tags: string[] };

function statusBadge(st: ScanRecord["status"]) {
  return st === "success" ? <Badge variant="success">concluído</Badge>
    : st === "failed" ? <Badge variant="destructive">falhou</Badge>
    : st === "canceled" ? <Badge variant="muted">cancelado</Badge>
    : <Badge variant="warning">{st}</Badge>;
}

function SevBadge({ sev }: { sev: string }) {
  const s = SEV[sev];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s?.badge ?? ""}`}>{s?.label ?? sev}</span>;
}

const CVE_PAGE_SIZE = 50;
type CveSortKey = "id" | "pkg" | "severity" | "installed" | "fixed";

function vulnText(v: Vuln, key: CveSortKey) {
  if (key === "severity") return String(SEV_ORDER.indexOf(v.severity as (typeof SEV_ORDER)[number]));
  return String(v[key] ?? "").toLowerCase();
}

/** Tabela de CVEs de um scan (CVE, pacote, severidade, versão instalada/fixa). */
function CveTable({ scanId }: { scanId: number }) {
  const { data, loading } = useData<ScanRecord>(() => get(`/docker/images/scans/${scanId}`), [scanId]);
  const [sev, setSev] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: CveSortKey; dir: "asc" | "desc" }>({ key: "severity", dir: "asc" });
  const vulns = data?.details ?? [];
  const present = SEV_ORDER.filter((s) => vulns.some((v) => v.severity === s));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vulns.filter((v) => {
      if (sev && v.severity !== sev) return false;
      if (!q) return true;
      return [v.id, v.pkg, v.installed, v.fixed, v.title].some((value) => value?.toLowerCase().includes(q));
    });
  }, [query, sev, vulns]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = vulnText(a, sort.key);
      const bv = vulnText(b, sort.key);
      const result = sort.key === "severity"
        ? Number(av) - Number(bv)
        : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return sort.dir === "asc" ? result : -result;
    });
  }, [filtered, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / CVE_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = sorted.slice((currentPage - 1) * CVE_PAGE_SIZE, currentPage * CVE_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, scanId, sev]);

  function sortBy(key: CveSortKey) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" }));
  }

  function SortHead({ column, children, className = "" }: { column: CveSortKey; children: React.ReactNode; className?: string }) {
    return (
      <TableHead className={className}>
        <Button variant="ghost" size="sm" className="-ml-3 h-8 px-2" onClick={() => sortBy(column)}>
          {children}
          <ArrowUpDown className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </TableHead>
    );
  }

  if (loading && !data) return <Skeleton className="h-32 w-full" />;
  if (!vulns.length) return <p className="text-sm text-muted-foreground">Sem vulnerabilidades neste scan.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {sorted.length} de {vulns.length} vulnerabilidade(s)
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar CVE, pacote ou versão"
              className="h-8 pl-8"
            />
          </div>
          <SelectWithSearch
            value={sev}
            onChange={setSev}
            options={[
              { value: "", label: "Todas as severidades" },
              ...present.map((s) => ({ value: s, label: SEV[s].label })),
            ]}
            placeholder="Todas as severidades"
            searchPlaceholder="Buscar severidade"
            emptyMessage="Nenhuma severidade"
            className="h-8 w-52"
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow>
            <SortHead column="id">CVE</SortHead>
            <SortHead column="pkg">Pacote</SortHead>
            <SortHead column="severity" className="w-32">Severidade</SortHead>
            <SortHead column="installed">Versão instalada</SortHead>
            <SortHead column="fixed">Versão fixa</SortHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.map((v, i) => (
              <TableRow key={`${v.id}-${v.pkg}-${v.installed}-${currentPage}-${i}`}>
                <TableCell className="font-mono text-xs">
                  {v.url
                    ? <a href={v.url} target="_blank" rel="noreferrer" className="text-primary hover:underline" title={v.title}>{v.id}</a>
                    : <span title={v.title}>{v.id}</span>}
                </TableCell>
                <TableCell className="font-mono text-xs">{v.pkg}</TableCell>
                <TableCell><SevBadge sev={v.severity} /></TableCell>
                <TableCell className="font-mono text-xs">{v.installed || "—"}</TableCell>
                <TableCell className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{v.fixed || "—"}</TableCell>
              </TableRow>
            ))}
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma vulnerabilidade encontrada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Pagination page={currentPage} pages={pages} total={sorted.length} onPage={setPage} />
    </div>
  );
}

/** Seção de scans de vulnerabilidade da imagem: resultado mais recente, ação de
 * escanear (com fase ao vivo via SSE), CVEs e o histórico de análises. */
function ScanSection({ imageId }: { imageId: string }) {
  const { data, loading, reload } = useData<ScanRecord[]>(
    () => get(`/docker/images/scans?image_id=${encodeURIComponent(imageId)}`), [imageId]);
  const [phase, setPhase] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const scans = data ?? [];
  const latest = scans.find((s) => s.status === "success");
  const running = scans.find((s) => s.status === "queued" || s.status === "running");
  const viewScanId = selected ?? latest?.id ?? null;

  function follow(scanId: number, initial: string) {
    setPhase(initial || "na fila");
    esRef.current?.close();
    const es = new EventSource(streamUrl(`/docker/images/scans/${scanId}/stream`));
    esRef.current = es;
    const finish = () => { es.close(); if (esRef.current === es) esRef.current = null; setPhase(null); reload(); };
    es.onmessage = (ev) => {
      try {
        const row = JSON.parse(ev.data) as ScanRecord & { error?: string };
        if (!row.status) return;
        setPhase(row.phase);
        if (row.status === "failed") toast.error(row.error || "scan falhou");
      } catch { /* heartbeat */ }
    };
    es.addEventListener("end", finish);
    es.onerror = finish;
  }

  // Acompanha um scan já em andamento ao abrir a tela; fecha o SSE ao desmontar.
  useEffect(() => {
    if (running && phase === null && esRef.current === null) follow(running.id, running.phase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.id]);
  useEffect(() => () => esRef.current?.close(), []);

  async function startScan() {
    if (phase !== null) return;
    setPhase("na fila");
    try {
      const r = await post<ScanRecord>(`/docker/images/${encodeURIComponent(imageId)}/scan`);
      follow(r.id, r.phase);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enfileirar o scan");
      setPhase(null);
    }
  }

  const top = latest ? topSeverity(latest.severities) : null;
  const rows = latest ? SEV_ORDER.filter((s) => latest.severities[s] > 0) : [];

  return (
    <Section icon={ShieldAlert} title="Scans de segurança"
      action={phase !== null ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {phase}
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={startScan}>
          <ScanLine className="h-3.5 w-3.5" /> Escanear
        </Button>
      )}>
      {loading && !data ? <Skeleton className="h-24 w-full" /> : (
        <div className="space-y-4">
          {latest && (
            <div className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-2">
                {latest.total === 0
                  ? <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  : <ShieldAlert className={`h-5 w-5 ${top ? SEV[top].text : ""}`} />}
                <div className="text-sm font-semibold">{top ? SEV[top].label : "Seguro"}</div>
                <div className="ml-auto text-xs text-muted-foreground">Última análise: {fmtDateTime(latest.finished_at)}</div>
              </div>
              <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-muted">
                {latest.total > 0 && SEV_ORDER.map((s) => latest.severities[s] ? (
                  <div key={s} className={SEV[s].bar} style={{ width: `${(latest.severities[s] / latest.total) * 100}%` }} />
                ) : null)}
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Total {latest.total}</span>
                {rows.map((s) => (
                  <span key={s} className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEV[s].badge}`}>
                    {SEV[s].label} {latest.severities[s]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {viewScanId !== null && <CveTable scanId={viewScanId} />}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="flex items-center gap-1"><History className="h-3.5 w-3.5" /> Solicitado</TableHead>
                <TableHead>Concluído</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-16 text-right">Total</TableHead>
                <TableHead>Severidades</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scans.map((r) => (
                  <TableRow key={r.id}
                    onClick={() => r.status === "success" && setSelected(r.id)}
                    className={`${r.status === "success" ? "cursor-pointer" : ""} ${viewScanId === r.id ? "bg-muted/50" : ""}`}>
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
                {scans.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Nenhum scan ainda.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Section>
  );
}

export function DockerImageDetailPage() {
  const { id = "" } = useParams();
  const { data, loading, error } = useData<ImageInspect>(
    () => get(`/docker/images/${encodeURIComponent(id)}/inspect`), [id]);
  const { data: history } = useData<Layer[]>(
    () => get(`/docker/images/${encodeURIComponent(id)}/history`), [id]);
  const [showEnv, setShowEnv] = useState(false);

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <DetailBack to="/docker/images" label="Voltar às imagens" />
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error || "Imagem não encontrada"}</div>
      </div>
    );
  }

  const im = data;
  const tags = im.RepoTags?.filter((t) => t && t !== "<none>:<none>") ?? [];
  const cfg = im.Config || {};
  const env = cfg.Env || [];
  const exposed = Object.keys(cfg.ExposedPorts || {});
  const volumes = Object.keys(cfg.Volumes || {});
  const labels = Object.entries(cfg.Labels || {});

  return (
    <div className="space-y-6">
      <div>
        <DetailBack to="/docker/images" label="Voltar às imagens" />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Layers className="h-6 w-6 text-primary" /> {tags[0]?.split("/").pop() || shortId(im.Id)}
            </h1>
            <CopyId id={im.Id} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="muted">{im.Os}/{im.Architecture}</Badge>
            <Badge variant="muted">{formatBytes(im.Size)}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Info} title="Visão geral">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tamanho" value={formatBytes(im.Size)} />
            <Field label="Criado" value={fmtDockerDate(im.Created)} />
            <Field label="Arquitetura" value={im.Architecture} />
            <Field label="SO" value={im.Os} />
            <Field label="Autor" value={im.Author} />
            <Field label="Docker version" value={im.DockerVersion} />
            <div className="col-span-2">
              <Field label="Tags" value={tags.length ? (
                <div className="flex flex-wrap gap-1">{tags.map((t) => <Badge key={t} variant="muted" className="font-mono text-[0.7rem]">{t}</Badge>)}</div>
              ) : "—"} />
            </div>
            <div className="col-span-2">
              <Field label="Digests" mono value={im.RepoDigests?.length ? (
                <button className="text-left hover:text-foreground" onClick={() => copyText((im.RepoDigests || []).join("\n"))}>
                  {(im.RepoDigests || []).join("\n")}
                </button>
              ) : "—"} />
            </div>
          </div>
        </Section>

        <Section icon={Settings2} title="Config">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Usuário" value={cfg.User} mono />
            <Field label="Working dir" value={cfg.WorkingDir} mono />
            <Field label="Entrypoint" value={(cfg.Entrypoint || []).join(" ")} mono />
            <Field label="Cmd" value={(cfg.Cmd || []).join(" ")} mono />
            <Field label="Portas expostas" value={exposed.length ? exposed.join(", ") : "—"} mono />
            <Field label="Volumes" value={volumes.length ? volumes.join(", ") : "—"} mono />
          </div>
        </Section>
      </div>

      <ScanSection imageId={id} />

      <Section icon={Braces} title={`Variáveis de ambiente (${env.length})`}
        action={env.length ? (
          <Button variant="outline" size="sm" onClick={() => setShowEnv((v) => !v)}>
            {showEnv ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showEnv ? "Ocultar valores" : "Mostrar valores"}
          </Button>
        ) : null}>
        {env.length ? (
          <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2 font-mono text-xs">
            {env.map((e) => {
              const [k, ...rest] = e.split("=");
              return (
                <div key={e} className="flex items-start gap-2">
                  <span className="shrink-0 font-medium text-primary">{k}</span>
                  <span className="break-all text-muted-foreground">= {showEnv ? rest.join("=") : "••••••••"}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhuma variável.</p>}
      </Section>

      <Section icon={Boxes} title={`Histórico de camadas (${history?.length ?? 0})`}>
        {history && history.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-24 text-right">Tamanho</TableHead>
                <TableHead>Comando</TableHead>
                <TableHead className="w-28">Criado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {history.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{formatBytes(l.size)}</TableCell>
                    <TableCell className="max-w-lg truncate font-mono text-[11px]" title={l.created_by}>
                      {l.created_by.replace(/^\/bin\/sh -c #\(nop\)\s*/, "").trim() || l.comment || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.created ? new Date(l.created).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sem histórico.</p>}
      </Section>

      <Section icon={Tags} title={`Labels (${labels.length})`}>
        <KeyValueSection entries={labels} empty="Sem labels." />
      </Section>

      <Section icon={FileJson} title="JSON completo"><RawJson data={im} /></Section>
    </div>
  );
}
