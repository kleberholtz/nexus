import { type ReactNode, useState } from "react";
import { Pencil, Plus, RadioTower, RefreshCw, Search, Trash2, Zap } from "lucide-react";
import { del, get, post } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { RtmpSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { RtmpFormDialog } from "@/components/rtmp-form-dialog";
import { RtmpTestDialog } from "@/components/rtmp-test-dialog";

function onOff(v: string) {
  return v === "on" ? <Badge variant="success">on</Badge> : <span className="text-muted-foreground">—</span>;
}

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

function matchesRtmp(a: RtmpSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    a.id,
    a.name,
    a.listen,
    a.live === "on" ? "live" : "",
    a.hls === "on" ? "hls" : "",
    a.record,
    a.enabled ? "ativo enabled" : "desativado disabled",
  ].some((value) => value.toLowerCase().includes(q));
}

export function RtmpPage() {
  const { data, loading, error, reload } = useData<RtmpSummary[]>(() => get("/rtmp"), []);
  const [editing, setEditing] = useState<RtmpSummary | "new" | null>(null);
  const [testing, setTesting] = useState<RtmpSummary | null>(null);
  const [toDelete, setToDelete] = useState<RtmpSummary | null>(null);
  const [query, setQuery] = useState("");

  const filtered = data?.filter((a) => matchesRtmp(a, query)) ?? [];

  async function remove(a: RtmpSummary) {
    try {
      await del(`/rtmp/${encodeURIComponent(a.id)}`);
      toast.success(`Aplicação '${a.id}' removida`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  // O toggle vale pela PORTA inteira (todas as apps dela) — o backend agrupa
  // 1 arquivo por porta, então ativar/desativar qualquer app da porta afeta
  // todas juntas. Usamos a 1ª app da porta como "representante" do grupo.
  async function togglePort(a: RtmpSummary) {
    try {
      await post(`/rtmp/${encodeURIComponent(a.id)}/${a.enabled ? "disable" : "enable"}`);
      toast.success(`Porta ${a.listen} ${a.enabled ? "desativada" : "ativada"}`);
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
            <RadioTower className="h-6 w-6 text-primary" /> RTMP
          </h1>
          <p className="text-sm text-muted-foreground">Aplicações de live streaming (módulo nginx-rtmp)</p>
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
                placeholder="Pesquisar por aplicação, porta ou status"
                className="pl-9"
              />
            </div>
            <Button size="sm" onClick={() => setEditing("new")} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Nova aplicação
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
              <TableHead>Aplicação</TableHead>
              <TableHead className="w-24">Porta</TableHead>
              <TableHead className="w-20">Live</TableHead>
              <TableHead className="w-20">HLS</TableHead>
              <TableHead className="w-28">Gravação</TableHead>
              <TableHead className="w-20">Ativo</TableHead>
              <TableHead className="w-24 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !data ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))
            ) : filtered.length > 0 ? (
              filtered.map((a, idx) => {
                // Ativo/desativo vale por PORTA (todas as apps juntas, mesmo
                // arquivo no backend) — mostra o switch só na 1ª linha do
                // grupo, com rowSpan cobrindo as demais apps da mesma porta.
                const isFirstOfPort = filtered.findIndex((x) => x.listen === a.listen) === idx;
                const portCount = filtered.filter((x) => x.listen === a.listen).length;
                return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{a.listen}</TableCell>
                  <TableCell>{onOff(a.live)}</TableCell>
                  <TableCell>{onOff(a.hls)}</TableCell>
                  <TableCell>
                    {a.record && a.record !== "off"
                      ? <Badge variant="secondary">{a.record}</Badge>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  {isFirstOfPort && (
                    <TableCell rowSpan={portCount} className="align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Switch checked={a.enabled} onCheckedChange={() => togglePort(a)} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Vale pra porta {a.listen} inteira ({portCount} app(s))</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconAction label="Testar live streaming" onClick={() => setTesting(a)}>
                        <Zap className="h-4 w-4 text-primary" />
                      </IconAction>
                      <IconAction label="Editar" onClick={() => setEditing(a)}>
                        <Pencil className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Excluir" onClick={() => setToDelete(a)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconAction>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {query.trim() ? "Nenhuma aplicação RTMP encontrada." : "Nenhuma aplicação RTMP."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {editing && (
        <RtmpFormDialog
          editing={editing === "new" ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {testing && (
        <RtmpTestDialog app={testing} onOpenChange={(o) => !o && setTesting(null)} />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir aplicação '${toDelete?.name}'?`}
        description="Remove o bloco application do rtmp {} e recarrega o nginx."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </div>
    </TooltipProvider>
  );
}
