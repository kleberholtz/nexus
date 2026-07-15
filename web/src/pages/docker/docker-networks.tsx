import { useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Loader2, Network, RefreshCw, Search } from "lucide-react";
import { get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { formatCount } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, StatBox, useDebounced, useUrlPagination } from "@/components/docker/list";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Subnet = { subnet: string; gateway: string; total: number };
type DockerNetwork = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: number;
  internal: boolean;
  attachable: boolean;
  ipv6: boolean;
  ipam: Subnet[];
  ip_used: number;
  ip_total: number;
  containers: { name: string; ipv4: string }[];
  in_use: boolean;
  labels: Record<string, string>;
};
type NetworksResp = {
  networks: DockerNetwork[]; summary: { total: number; in_use: number }; drivers: string[];
  total: number; page: number; pages: number;
};

const yesno = (b: boolean) => (b ? "sim" : "não");
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : "—");

function IpamCell({ net }: { net: DockerNetwork }) {
  if (!net.ipam.length) return <span className="text-xs text-muted-foreground">—</span>;
  const total = net.ip_total < 0 ? "—" : formatCount(net.ip_total);
  const pct = net.ip_total > 0 ? Math.min(100, Math.round((net.ip_used / net.ip_total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="tabular-nums font-medium">{net.ip_used}</span>
        <span className="text-muted-foreground">/ {total} disponíveis</span>
      </div>
      {net.ip_total > 0 && (
        <div className="h-1 w-28 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="font-mono text-[0.7rem] text-muted-foreground">
        {net.ipam.map((s) => s.subnet).join(", ")}
      </div>
    </div>
  );
}

export function DockerNetworksPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [driver, setDriver] = useState("");
  const dq = useDebounced(search.trim());
  const { page, setPage } = useUrlPagination(`${dq}|${status}|${driver}`);

  const { data, loading, error, reload } = useData<NetworksResp>(
    () => get(`/docker/networks?${new URLSearchParams({ page: String(page), search: dq, status, driver })}`),
    [page, dq, status, driver],
  );
  const slice = data?.networks ?? [];
  const drivers = data?.drivers ?? ["bridge", "host", "overlay"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Network className="h-6 w-6 text-primary" /> Networks
          </h1>
          <p className="text-sm text-muted-foreground">Redes Docker do host — IPAM, uso e configuração</p>
        </div>
        <div className="flex gap-2">
          <StatBox icon={Network} label="Redes" value={String(data?.summary.total ?? 0)} />
          <StatBox icon={Boxes} label="Em uso" value={String(data?.summary.in_use ?? 0)} />
        </div>
      </div>

      {/* Toolbar: refresh (esquerda) + filtros (direita) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar rede" className="h-9 w-44 pl-8" />
          </div>
          <SelectWithSearch value={status} onChange={setStatus} className="w-36"
            placeholder="Todos os status" searchPlaceholder="Status"
            options={[{ value: "", label: "Todos os status" },
              { value: "in_use", label: "Em uso" },
              { value: "unused", label: "Sem uso" }]} />
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
                <TableHead className="w-24">Driver</TableHead>
                <TableHead className="w-56">IPAM</TableHead>
                <TableHead className="w-20">Internal</TableHead>
                <TableHead className="w-24">Attachable</TableHead>
                <TableHead className="w-28">Criado</TableHead>
                <TableHead>Em uso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                [...Array(4)].map((_, i) => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell></TableRow>)
              ) : slice.length > 0 ? (
                slice.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">
                      <Link to={`/docker/network/${encodeURIComponent(n.name)}`} className="text-primary hover:underline">{n.name}</Link>
                    </TableCell>
                    <TableCell><Badge variant="muted">{n.driver || "—"}</Badge></TableCell>
                    <TableCell><IpamCell net={n} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{yesno(n.internal)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{yesno(n.attachable)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(n.created)}</TableCell>
                    <TableCell>
                      {n.in_use ? (
                        <div className="flex flex-wrap gap-1">
                          {n.containers.slice(0, 4).map((c) => (
                            <Badge key={c.name} variant="success" className="font-mono text-[0.7rem]"
                              title={c.ipv4 ? `${c.name} · ${c.ipv4}` : c.name}>
                              {c.name}
                            </Badge>
                          ))}
                          {n.containers.length > 4 && (
                            <Badge variant="muted">+{n.containers.length - 4}</Badge>
                          )}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Nenhuma rede."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Pagination page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? 0} onPage={setPage} />
    </div>
  );
}
