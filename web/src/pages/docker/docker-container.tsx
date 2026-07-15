import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Braces, Copy, Eye, EyeOff, FileJson, HardDrive, Info,
  Network, Plug, RotateCw, Tags,
} from "lucide-react";
import { get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type PortBinding = { HostIp?: string; HostPort?: string };
type NetworkInfo = {
  IPAddress?: string; Gateway?: string; MacAddress?: string; NetworkID?: string;
  Aliases?: string[]; GlobalIPv6Address?: string;
};
type Mount = { Type?: string; Name?: string; Source?: string; Destination?: string; Mode?: string; RW?: boolean };
type Inspect = {
  Id?: string;
  Name?: string;
  Created?: string;
  Path?: string;
  Args?: string[];
  Platform?: string;
  Driver?: string;
  RestartCount?: number;
  State?: {
    Status?: string; Running?: boolean; StartedAt?: string; FinishedAt?: string;
    ExitCode?: number; Error?: string; Pid?: number;
  };
  HostConfig?: {
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    AutoRemove?: boolean; Privileged?: boolean; ReadonlyRootfs?: boolean;
    NetworkMode?: string; Runtime?: string; ShmSize?: number; IpcMode?: string;
    PidMode?: string; CgroupnsMode?: string; PortBindings?: Record<string, PortBinding[]>;
    Memory?: number; MemoryReservation?: number; NanoCpus?: number; PidsLimit?: number | null;
  };
  Mounts?: Mount[];
  Config?: {
    Image?: string; Hostname?: string; User?: string; WorkingDir?: string;
    Cmd?: string[] | null; Entrypoint?: string[] | null; Env?: string[];
    Labels?: Record<string, string>; ExposedPorts?: Record<string, unknown>;
  };
  NetworkSettings?: {
    Ports?: Record<string, PortBinding[] | null>;
    Networks?: Record<string, NetworkInfo>;
  };
};

const isDate = (s?: string) => !!s && !s.startsWith("0001-");
const fmtDate = (s?: string) => (isDate(s) ? new Date(s as string).toLocaleString() : "—");
const short = (id?: string) => (id ? id.replace(/^sha256:/, "").slice(0, 12) : "—");

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Copiado"),
    () => toast.error("Falha ao copiar"),
  );
}

function Section({ icon: Icon, title, children, action }: {
  icon: React.ElementType; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "break-all font-mono text-xs" : ""}`}>{value || "—"}</div>
    </div>
  );
}

export function DockerContainerPage() {
  const { name = "" } = useParams();
  const { data, loading, error } = useData<Inspect>(
    () => get(`/docker/containers/${encodeURIComponent(name)}/inspect`), [name]);
  const [showEnv, setShowEnv] = useState(false);

  if (loading && !data) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error || "Container não encontrado"}</div>
      </div>
    );
  }

  const c = data;
  const state = c.State?.Status || "";
  const cmd = [c.Path, ...(c.Args || [])].filter(Boolean).join(" ") || (c.Config?.Cmd || []).join(" ");
  const host = c.HostConfig || {};
  const rp = host.RestartPolicy || {};
  const ports = Object.entries(c.NetworkSettings?.Ports || {});
  const networks = Object.entries(c.NetworkSettings?.Networks || {});
  const env = c.Config?.Env || [];
  const labels = Object.entries(c.Config?.Labels || {});
  const stateVariant = c.State?.Running ? "success" : state === "exited" || state === "dead" ? "destructive" : "muted";

  return (
    <div className="space-y-6">
      <div>
        <BackLink />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Network className="h-6 w-6 text-primary" /> {(c.Name || name).replace(/^\//, "")}
              <Badge variant={stateVariant}>{state || "—"}</Badge>
            </h1>
            <button className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              onClick={() => copy(c.Id || "")}>
              {short(c.Id)} <Copy className="h-3 w-3" />
            </button>
          </div>
          <Badge variant="muted" className="font-mono text-xs">{c.Config?.Image}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section icon={Info} title="Visão geral">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Imagem" value={c.Config?.Image} mono />
            <Field label="Plataforma" value={c.Platform} />
            <Field label="Comando" value={cmd} mono />
            <Field label="Working dir" value={c.Config?.WorkingDir} mono />
            <Field label="Usuário" value={c.Config?.User} mono />
            <Field label="Driver" value={c.Driver} />
            <Field label="Criado" value={fmtDate(c.Created)} />
            <Field label="Iniciado" value={fmtDate(c.State?.StartedAt)} />
            {!c.State?.Running && <Field label="Finalizado" value={fmtDate(c.State?.FinishedAt)} />}
            {!c.State?.Running && <Field label="Exit code" value={String(c.State?.ExitCode ?? "—")} />}
            {c.State?.Error ? <Field label="Erro" value={c.State.Error} /> : null}
          </div>
        </Section>

        <Section icon={RotateCw} title="Reinício, recursos e flags">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Restart policy" value={rp.Name || "no"} />
            <Field label="Max retries" value={String(rp.MaximumRetryCount ?? 0)} />
            <Field label="Restart count" value={String(c.RestartCount ?? 0)} />
            <Field label="Auto-remove" value={<Flag on={!!host.AutoRemove} />} />
            <Field label="Privileged" value={<Flag on={!!host.Privileged} />} />
            <Field label="Read-only rootfs" value={<Flag on={!!host.ReadonlyRootfs} />} />
            <Field label="Runtime" value={host.Runtime} />
            <Field label="Network mode" value={host.NetworkMode} mono />
            <Field label="Memory limit" value={host.Memory ? formatBytes(host.Memory) : "sem limite"} />
            <Field label="CPUs" value={host.NanoCpus ? (host.NanoCpus / 1e9).toFixed(2) : "sem limite"} />
            <Field label="Shm size" value={host.ShmSize ? formatBytes(host.ShmSize) : "—"} />
            <Field label="PIDs limit" value={host.PidsLimit ? String(host.PidsLimit) : "sem limite"} />
          </div>
        </Section>
      </div>

      <Section icon={Plug} title={`Portas (${ports.length})`}>
        {ports.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Porta do container</TableHead>
                <TableHead>Publicado em</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ports.map(([port, binds]) => (
                  <TableRow key={port}>
                    <TableCell className="font-mono text-xs">{port}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {binds && binds.length
                        ? binds.map((b) => `${b.HostIp || "0.0.0.0"}:${b.HostPort}`).join(", ")
                        : "não publicado"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhuma porta exposta.</p>}
      </Section>

      <Section icon={Network} title={`Redes (${networks.length})`}>
        {networks.length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Rede</TableHead><TableHead>IP</TableHead>
                <TableHead>Gateway</TableHead><TableHead>MAC</TableHead><TableHead>Aliases</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {networks.map(([net, n]) => (
                  <TableRow key={net}>
                    <TableCell className="font-medium">{net}</TableCell>
                    <TableCell className="font-mono text-xs">{n.IPAddress || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{n.Gateway || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{n.MacAddress || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{(n.Aliases || []).join(", ") || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sem redes.</p>}
      </Section>

      <Section icon={HardDrive} title={`Montagens (${(c.Mounts || []).length})`}>
        {(c.Mounts || []).length ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-20">Tipo</TableHead><TableHead>Origem</TableHead>
                <TableHead>Destino</TableHead><TableHead className="w-16">RW</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(c.Mounts || []).map((m, i) => (
                  <TableRow key={i}>
                    <TableCell><Badge variant="muted">{m.Type}</Badge></TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs" title={m.Name || m.Source}>{m.Name || m.Source}</TableCell>
                    <TableCell className="font-mono text-xs">{m.Destination}</TableCell>
                    <TableCell>{m.RW ? "sim" : "não"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sem montagens.</p>}
      </Section>

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
              const v = rest.join("=");
              return (
                <div key={e} className="flex items-start gap-2 hover:bg-muted/50">
                  <button className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => copy(e)} title="Copiar">
                    <Copy className="h-3 w-3" />
                  </button>
                  <span className="shrink-0 font-medium text-primary">{k}</span>
                  <span className="break-all text-muted-foreground">= {showEnv ? v : "••••••••"}</span>
                </div>
              );
            })}
          </div>
        ) : <p className="text-sm text-muted-foreground">Nenhuma variável.</p>}
      </Section>

      <Section icon={Tags} title={`Labels (${labels.length})`}>
        {labels.length ? (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table>
              <TableBody>
                {labels.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="w-1/3 break-all font-mono text-xs font-medium">{k}</TableCell>
                    <TableCell className="break-all font-mono text-xs text-muted-foreground">{v}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : <p className="text-sm text-muted-foreground">Sem labels.</p>}
      </Section>

      <Section icon={FileJson} title="JSON completo">
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Ver inspect bruto</summary>
          <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(c, null, 2)}
          </pre>
        </details>
      </Section>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/docker/containers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Voltar aos containers
    </Link>
  );
}

function Flag({ on }: { on: boolean }) {
  return <Badge variant={on ? "success" : "muted"}>{on ? "sim" : "não"}</Badge>;
}
