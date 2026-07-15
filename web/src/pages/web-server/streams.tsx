import { type ReactNode, useState } from "react";
import { Pencil, Plus, RefreshCw, Search, Trash2, Waypoints } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { StreamDetail, StreamSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StreamFormDialog } from "@/components/stream-form-dialog";
import { ConfirmDelete } from "@/components/confirm-delete";

type IconActionProps = {
  label: string;
  children: ReactNode;
  onClick?: () => void;
};

function IconAction({ label, children, onClick }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function matchesStream(s: StreamSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    s.id,
    s.file,
    s.enabled ? "ativo enabled" : "desativado disabled",
    ...s.listen,
  ].some((value) => value.toLowerCase().includes(q));
}

export function StreamsPage() {
  const { data, loading, error, reload } = useData<StreamSummary[]>(() => get("/streams"), []);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; id: string; initial: { raw: string; nodes: unknown[] } } | null
  >(null);
  const [toDelete, setToDelete] = useState<StreamSummary | null>(null);
  const [query, setQuery] = useState("");

  const filtered = data?.filter((s) => matchesStream(s, query)) ?? [];

  function openCreate() {
    setDialog({ mode: "create" });
  }

  async function openEdit(id: string) {
    try {
      const detail = await get<StreamDetail>(`/streams/${encodeURIComponent(id)}`);
      setDialog({ mode: "edit", id, initial: { raw: detail.raw, nodes: detail.nodes } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }

  async function submit(raw: string) {
    try {
      if (dialog?.mode === "edit") {
        await put(`/streams/${encodeURIComponent(dialog.id)}`, { raw });
        toast.success("Stream atualizado");
      } else {
        await post("/streams", { raw });
        toast.success("Stream criado");
      }
      setDialog(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
      throw e;
    }
  }

  async function remove(s: StreamSummary) {
    try {
      await del(`/streams/${encodeURIComponent(s.id)}`);
      toast.success(`Stream '${s.id}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  async function toggle(s: StreamSummary) {
    try {
      await post(`/streams/${encodeURIComponent(s.id)}/${s.enabled ? "disable" : "enable"}`);
      toast.success(`Stream '${s.id}' ${s.enabled ? "desativado" : "ativado"}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar estado");
    }
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Waypoints className="h-6 w-6 text-primary" /> Streams
          </h1>
          <p className="text-sm text-muted-foreground">Proxy TCP/UDP (bloco stream)</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={reload}
                disabled={loading}
                aria-label="Recarregar lista"
                className="w-full sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar lista</TooltipContent>
          </Tooltip>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar por ID, listen ou arquivo"
                className="pl-9"
              />
            </div>
            <Button size="sm" onClick={openCreate} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Novo stream
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>listen</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead className="w-20">Ativo</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length > 0 ? (
              filtered.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.id}</TableCell>
                  <TableCell className="text-muted-foreground">{s.listen.join(", ") || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.file}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Switch
                            checked={s.enabled}
                            aria-label={s.enabled ? "Desativar stream" : "Ativar stream"}
                            onCheckedChange={() => toggle(s)}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{s.enabled ? "Desativar stream" : "Ativar stream"}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconAction label="Editar" onClick={() => openEdit(s.id)}>
                        <Pencil className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Excluir" onClick={() => setToDelete(s)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconAction>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {query.trim() ? "Nenhum stream encontrado." : "Nenhum stream."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {dialog && (
        <StreamFormDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog.mode === "edit" ? dialog.initial : null}
          onSubmit={submit}
        />
      )}

      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir stream '${toDelete?.id}'?`}
        description="Remove o server block do contexto stream e recarrega o nginx. Não pode ser desfeita."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </div>
    </TooltipProvider>
  );
}
