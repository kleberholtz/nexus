import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AppWindow, ArrowLeft, Boxes, ChevronDown, Database, FileStack, LayoutTemplate,
  Loader2, Plus, RefreshCw, Trash2,
} from "lucide-react";
import { del, get } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useAuth } from "@/lib/auth";
import type { Project, ProjectService, ServiceKind, ServiceStatus } from "@/lib/types";
import { DB_ENGINES } from "@/lib/db-catalog";
import type { DbEngine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApplicationDialog } from "@/components/project/application-dialog";
import { DatabaseDialog } from "@/components/project/database-dialog";
import { ComposeDialog } from "@/components/project/compose-dialog";
import { TemplateDialog } from "@/components/project/template-dialog";

const KIND_META: Record<ServiceKind, { label: string; icon: React.ElementType }> = {
  application: { label: "Aplicação", icon: AppWindow },
  database: { label: "Banco de dados", icon: Database },
  compose: { label: "Compose", icon: FileStack },
  template: { label: "Template", icon: LayoutTemplate },
};

const STATUS_BADGE: Record<ServiceStatus, { variant: "success" | "muted" | "destructive" | "info"; label: string }> = {
  created: { variant: "muted", label: "criado" },
  deploying: { variant: "info", label: "deploying" },
  running: { variant: "success", label: "rodando" },
  stopped: { variant: "info", label: "parado" },
  failed: { variant: "destructive", label: "falhou" },
};

/** Resumo curto de um serviço, dependendo do tipo. */
function serviceSubtitle(svc: ProjectService): string {
  const c = svc.config as Record<string, unknown>;
  if (svc.kind === "database") {
    const engine = c.engine as DbEngine | undefined;
    const label = engine && DB_ENGINES[engine] ? DB_ENGINES[engine].label : String(engine ?? "");
    const tag = c.image ? String(c.image) : `${label} ${c.version ?? ""}`.trim();
    return tag;
  }
  if (svc.kind === "compose") return `Modo: ${c.mode ?? "compose"}`;
  if (svc.kind === "template") return `Template: ${c.name ?? c.template_id ?? ""}`;
  return svc.description || "";
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can("projects", "write");
  const { data, loading, error, reload } = useData<Project>(
    () => get(`/projects/${projectId}`), [projectId],
  );
  const [dialog, setDialog] = useState<ServiceKind | null>(null);
  const [toDelete, setToDelete] = useState<ProjectService | null>(null);

  async function remove(svc: ProjectService) {
    try {
      await del(`/projects/${projectId}/services/${svc.id}`);
      toast.success(`Serviço '${svc.name}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  const services = data?.services ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-1 -ml-2 h-7 text-muted-foreground"
                  onClick={() => navigate("/projects")}>
            <ArrowLeft className="h-4 w-4" /> Projetos
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Boxes className="h-6 w-6 text-primary" /> {data?.name ?? "…"}
          </h1>
          {data?.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
          {data && data.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {data.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[0.65rem]">{t}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Adicionar serviço <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {(Object.keys(KIND_META) as ServiceKind[]).map((k) => {
                  const { label, icon: Icon } = KIND_META[k];
                  return (
                    <DropdownMenuItem key={k} onSelect={() => setDialog(k)}>
                      <Icon className="h-4 w-4 text-muted-foreground" /> {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : services.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((svc) => {
            const { label, icon: Icon } = KIND_META[svc.kind];
            const status = STATUS_BADGE[svc.status] ?? STATUS_BADGE.created;
            return (
              <Card key={svc.id} role="button" tabIndex={0}
                    onClick={() => navigate(`/projects/${projectId}/services/${svc.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/projects/${projectId}/services/${svc.id}`)}
                    className="flex cursor-pointer flex-col gap-2 p-5 transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="font-semibold">{svc.name}</span>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="muted" className="text-[0.65rem]">{label}</Badge>
                  <span className="truncate">{serviceSubtitle(svc)}</span>
                </div>
                {canWrite && (
                  <div className="mt-auto flex justify-end pt-2">
                    <Button variant="ghost" size="icon"
                            onClick={(e) => { e.stopPropagation(); setToDelete(svc); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            : <>Nenhum serviço ainda. {canWrite && "Use “Adicionar serviço”."}</>}
        </Card>
      )}

      {dialog === "application" && (
        <ApplicationDialog projectId={projectId} onOpenChange={(o) => !o && setDialog(null)}
                           onCreated={() => { setDialog(null); reload(); }} />
      )}
      {dialog === "database" && (
        <DatabaseDialog projectId={projectId} onOpenChange={(o) => !o && setDialog(null)}
                        onCreated={() => { setDialog(null); reload(); }} />
      )}
      {dialog === "compose" && (
        <ComposeDialog projectId={projectId} onOpenChange={(o) => !o && setDialog(null)}
                       onCreated={() => { setDialog(null); reload(); }} />
      )}
      {dialog === "template" && (
        <TemplateDialog projectId={projectId} onOpenChange={(o) => !o && setDialog(null)}
                        onCreated={() => { setDialog(null); reload(); }} />
      )}

      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir serviço '${toDelete?.name}'?`}
        description="Remove o serviço do projeto."
        onConfirm={() => { if (toDelete) return remove(toDelete); }}
      />
    </div>
  );
}
