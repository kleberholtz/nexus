import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Database, FileJson, HardDrive, Loader2, MoreVertical, RefreshCw,
  Search, Trash2,
} from "lucide-react";
import { ApiError, del, get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
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

type DockerVolume = {
  name: string;
  driver: string;
  mountpoint: string;
  created: number;
  scope: string;
  labels: Record<string, string>;
  size: number;
  refcount: number;
  in_use: boolean;
};
type VolumesResp = {
  volumes: DockerVolume[]; summary: { total: number; unused: number; size: number }; drivers: string[];
  total: number; page: number; pages: number;
};

const errMsg = (e: unknown) =>
  e instanceof ApiError ? (e.messages[0]?.message ?? "Erro") : e instanceof Error ? e.message : "Erro";
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : "—");

function StatusBadge({ v }: { v: DockerVolume }) {
  if (v.refcount < 0) return <Badge variant="muted">desconhecido</Badge>;
  return v.in_use ? <Badge variant="success">em uso</Badge> : <Badge variant="muted">sem uso</Badge>;
}

function InspectDialog({ volume, onOpenChange }: { volume: DockerVolume; onOpenChange: (o: boolean) => void }) {
  const { data, loading } = useData<unknown>(
    () => get(`/docker/volumes/${encodeURIComponent(volume.name)}/inspect`), [volume.name]);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileJson className="h-4 w-4" /> Inspecionar</DialogTitle>
          <DialogDescription className="font-mono text-xs">{volume.name}</DialogDescription>
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

function RemoveDialog({ volume, onOpenChange, onDone }: {
  volume: DockerVolume; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await del(`/docker/volumes/${encodeURIComponent(volume.name)}?force=${force}`);
      toast.success("Volume removido");
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
          <DialogTitle>Remover volume</DialogTitle>
          <DialogDescription className="font-mono text-xs">{volume.name}</DialogDescription>
        </DialogHeader>
        {volume.in_use && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Volume em uso ({volume.refcount} referência(s)). Remover pode falhar sem parar os containers.
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

export function DockerVolumesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [driver, setDriver] = useState("");
  const [dialog, setDialog] = useState<{ volume: DockerVolume; kind: "inspect" | "remove" } | null>(null);
  const dq = useDebounced(search.trim());
  const { page, setPage } = useUrlPagination(`${dq}|${status}|${driver}`);

  const { data, loading, error, reload } = useData<VolumesResp>(
    () => get(`/docker/volumes?${new URLSearchParams({ page: String(page), search: dq, status, driver })}`),
    [page, dq, status, driver],
  );
  const slice = data?.volumes ?? [];
  const drivers = data?.drivers ?? ["local"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HardDrive className="h-6 w-6 text-primary" /> Volumes
          </h1>
          <p className="text-sm text-muted-foreground">Volumes Docker do host — uso, tamanho e ações</p>
        </div>
        <div className="flex gap-2">
          <StatBox icon={HardDrive} label="Volumes" value={String(data?.summary.total ?? 0)} />
          <StatBox icon={Database} label="Tamanho total" value={formatBytes(data?.summary.size ?? 0)} />
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
              placeholder="Pesquisar volume" className="h-9 w-48 pl-8" />
          </div>
          <SelectWithSearch value={status} onChange={setStatus} className="w-36"
            placeholder="Todos os status" searchPlaceholder="Status"
            options={[{ value: "", label: "Todos os status" },
              { value: "in_use", label: "Em uso" },
              { value: "unused", label: "Livre" }]} />
          <SelectWithSearch value={driver} onChange={setDriver} className="w-36"
            placeholder="Todos os drivers" searchPlaceholder="Driver"
            options={[{ value: "", label: "Todos os drivers" },
              ...drivers.map((d) => ({ value: d, label: d }))]} />
        </div>
      </div>

      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-24 text-right">Tamanho</TableHead>
                <TableHead className="w-28">Criado</TableHead>
                <TableHead className="w-28">Driver</TableHead>
                <TableHead className="w-12 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                [...Array(4)].map((_, i) => <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-5 w-full" /></TableCell></TableRow>)
              ) : slice.length > 0 ? (
                slice.map((v) => (
                  <TableRow key={v.name}>
                    <TableCell className="max-w-md truncate font-mono text-xs" title={v.name}>
                      <Link to={`/docker/volume/${encodeURIComponent(v.name)}`} className="text-primary hover:underline">{v.name}</Link>
                    </TableCell>
                    <TableCell><StatusBadge v={v} /></TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {v.size < 0 ? "—" : formatBytes(v.size)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(v.created)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.driver || "—"}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setDialog({ volume: v, kind: "inspect" })}>
                            <FileJson className="h-4 w-4 text-muted-foreground" /> Inspecionar
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDialog({ volume: v, kind: "remove" })}>
                            <Trash2 className="h-4 w-4" /> Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Nenhum volume."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? 0} onPage={setPage} />

      {dialog?.kind === "inspect" && <InspectDialog volume={dialog.volume} onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === "remove" && <RemoveDialog volume={dialog.volume} onOpenChange={(o) => !o && setDialog(null)} onDone={reload} />}
    </div>
  );
}
