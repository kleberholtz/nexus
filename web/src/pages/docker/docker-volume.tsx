import { useParams } from "react-router-dom";
import { FileJson, HardDrive, Info, Settings2, Tags } from "lucide-react";
import { get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DetailBack, Field, KeyValueSection, RawJson, Section, fmtDockerDate,
} from "@/components/docker/detail";

type VolumeInspect = {
  Name?: string; Driver?: string; Mountpoint?: string; CreatedAt?: string;
  Scope?: string; Labels?: Record<string, string> | null; Options?: Record<string, string> | null;
  Status?: Record<string, unknown> | null;
};

export function DockerVolumeDetailPage() {
  const { name = "" } = useParams();
  const { data, loading, error } = useData<VolumeInspect>(
    () => get(`/docker/volumes/${encodeURIComponent(name)}/inspect`), [name]);

  if (loading && !data) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <DetailBack to="/docker/volumes" label="Voltar aos volumes" />
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error || "Volume não encontrado"}</div>
      </div>
    );
  }

  const v = data;
  const labels = Object.entries(v.Labels || {});
  const options = Object.entries(v.Options || {});

  return (
    <div className="space-y-6">
      <div>
        <DetailBack to="/docker/volumes" label="Voltar aos volumes" />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <HardDrive className="h-6 w-6 text-primary" /> <span className="break-all">{v.Name}</span>
          </h1>
          <Badge variant="muted">{v.Driver}</Badge>
        </div>
      </div>

      <Section icon={Info} title="Visão geral">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" value={v.Name} mono />
          <Field label="Driver" value={v.Driver} />
          <Field label="Escopo" value={v.Scope} />
          <Field label="Criado" value={fmtDockerDate(v.CreatedAt)} />
          <div className="sm:col-span-2"><Field label="Mountpoint" value={v.Mountpoint} mono /></div>
        </div>
      </Section>

      <Section icon={Settings2} title={`Options (${options.length})`}>
        <KeyValueSection entries={options} empty="Sem options." />
      </Section>

      <Section icon={Tags} title={`Labels (${labels.length})`}>
        <KeyValueSection entries={labels} empty="Sem labels." />
      </Section>

      <Section icon={FileJson} title="JSON completo"><RawJson data={v} /></Section>
    </div>
  );
}
