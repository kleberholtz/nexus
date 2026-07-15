import { useParams } from "react-router-dom";
import { Boxes, FileJson, Info, Network, Settings2, Tags, Waypoints } from "lucide-react";
import { get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CopyId, DetailBack, Field, Flag, KeyValueSection, RawJson, Section, fmtDockerDate,
} from "@/components/docker/detail";

type IpamConfig = { Subnet?: string; Gateway?: string; IPRange?: string };
type NetContainer = { Name?: string; IPv4Address?: string; IPv6Address?: string; MacAddress?: string };
type NetworkInspect = {
  Id?: string; Name?: string; Created?: string; Scope?: string; Driver?: string;
  Internal?: boolean; Attachable?: boolean; EnableIPv6?: boolean;
  IPAM?: { Driver?: string; Config?: IpamConfig[] };
  Containers?: Record<string, NetContainer>;
  Options?: Record<string, string> | null; Labels?: Record<string, string> | null;
};

export function DockerNetworkDetailPage() {
  const { name = "" } = useParams();
  const { data, loading, error } = useData<NetworkInspect>(
    () => get(`/docker/networks/${encodeURIComponent(name)}/inspect`), [name]);

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <DetailBack to="/docker/networks" label="Voltar às redes" />
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error || "Rede não encontrada"}</div>
      </div>
    );
  }

  const n = data;
  const ipam = n.IPAM?.Config || [];
  const containers = Object.values(n.Containers || {});
  const options = Object.entries(n.Options || {});
  const labels = Object.entries(n.Labels || {});

  return (
    <div className="space-y-6">
      <div>
        <DetailBack to="/docker/networks" label="Voltar às redes" />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Network className="h-6 w-6 text-primary" /> {n.Name}
            </h1>
            <CopyId id={n.Id} />
          </div>
          <Badge variant="muted">{n.Driver}</Badge>
        </div>
      </div>

      <Section icon={Info} title="Visão geral">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Driver" value={n.Driver} />
          <Field label="Escopo" value={n.Scope} />
          <Field label="Criado" value={fmtDockerDate(n.Created)} />
          <Field label="Internal" value={<Flag on={!!n.Internal} />} />
          <Field label="Attachable" value={<Flag on={!!n.Attachable} />} />
          <Field label="IPv6" value={<Flag on={!!n.EnableIPv6} />} />
        </div>
      </Section>

      <Section icon={Waypoints} title={`IPAM (${ipam.length})`}>
        {ipam.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Subnet</TableHead><TableHead>Gateway</TableHead><TableHead>IP range</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ipam.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{c.Subnet || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.Gateway || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.IPRange || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sem configuração IPAM (driver {n.IPAM?.Driver || "—"}).</p>}
      </Section>

      <Section icon={Boxes} title={`Containers conectados (${containers.length})`}>
        {containers.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Container</TableHead><TableHead>IPv4</TableHead>
                <TableHead>IPv6</TableHead><TableHead>MAC</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {containers.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{c.Name}</TableCell>
                    <TableCell className="font-mono text-xs">{(c.IPv4Address || "").split("/")[0] || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{(c.IPv6Address || "").split("/")[0] || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.MacAddress || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhum container conectado.</p>}
      </Section>

      <Section icon={Settings2} title={`Options (${options.length})`}>
        <KeyValueSection entries={options} empty="Sem options." />
      </Section>

      <Section icon={Tags} title={`Labels (${labels.length})`}>
        <KeyValueSection entries={labels} empty="Sem labels." />
      </Section>

      <Section icon={FileJson} title="JSON completo"><RawJson data={n} /></Section>
    </div>
  );
}
