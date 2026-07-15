import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Network, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { UpstreamDetail, UpstreamSummary } from "@/lib/types";
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
import { UpstreamFormDialog } from "@/components/upstream-form-dialog";

type EditState = { id: string; initial: { name: string; context: "http" | "stream"; raw: string; nodes: unknown[] } };
type UpstreamTag = { value: string; label: string };
type IconActionProps = {
  label: string;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
};

function IconAction({ label, disabled, children, onClick }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="ghost" size="icon" disabled={disabled} aria-label={label} onClick={onClick}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function UpstreamTagFilterSelect({ tags, value, onChange }: {
  tags: UpstreamTag[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? tags.filter((tag) => tag.label.toLowerCase().includes(term) || tag.value.includes(term))
      : tags;
  }, [search, tags]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectTag(tag: string) {
    onChange(tag);
    setOpen(false);
    setSearch("");
  }

  const selected = tags.find((tag) => tag.value === value);

  return (
    <div ref={ref} className="relative w-full sm:w-52">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between px-3 font-normal"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "Todas as tags"}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-full overflow-hidden rounded-md border bg-card text-card-foreground shadow-md">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar tag"
                className="h-8 pl-8"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => selectTag("")}
            >
              Todas as tags
              {!value && <Check className="h-4 w-4" />}
            </button>
            {filtered.map((tag) => (
              <button
                key={tag.value}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => selectTag(tag.value)}
              >
                <span className="min-w-0 truncate">{tag.label}</span>
                {value === tag.value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nenhuma tag encontrada.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function matchesUpstream(u: UpstreamSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    u.id,
    u.context,
    u.in_use ? "em uso in use" : "",
    u.enabled ? "ativo enabled" : "desativado disabled",
    ...u.used_by,
    ...u.servers.map((s) => s.join(" ")),
  ].some((value) => value.toLowerCase().includes(q));
}

function upstreamTagValues(u: UpstreamSummary): string[] {
  return [
    u.context === "stream" ? "stream" : "http",
    u.in_use ? "in-use" : "free",
    u.enabled ? "enabled" : "disabled",
  ];
}

export function UpstreamsPage() {
  const { data, loading, error, reload } = useData<UpstreamSummary[]>(() => get("/upstreams"), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [toDelete, setToDelete] = useState<UpstreamSummary | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const tagOptions = useMemo<UpstreamTag[]>(() => {
    const available = new Set((data ?? []).flatMap(upstreamTagValues));
    const options: UpstreamTag[] = [
      { value: "http", label: "HTTP" },
      { value: "stream", label: "Stream" },
      { value: "in-use", label: "Em uso" },
      { value: "free", label: "Livre" },
      { value: "enabled", label: "Ativo" },
      { value: "disabled", label: "Inativo" },
    ];
    return options.filter((option) => available.has(option.value));
  }, [data]);
  const filtered = (data ?? []).filter((u) => (
    matchesUpstream(u, query) && (!tagFilter || upstreamTagValues(u).includes(tagFilter))
  ));

  async function openEdit(u: UpstreamSummary) {
    try {
      const detail = await get<UpstreamDetail>(`/upstreams/${encodeURIComponent(u.id)}`);
      setEdit({
        id: u.id,
        initial: {
          name: u.id,
          context: (u.context === "stream" ? "stream" : "http"),
          raw: detail.raw,
          nodes: detail.nodes,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }

  async function createUpstream(name: string, body: string, context: "http" | "stream") {
    try {
      await post(
        `/upstreams?name=${encodeURIComponent(name)}&context=${context}`,
        { raw: body },
      );
      toast.success("Upstream criado");
      setCreateOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar");
      throw e;
    }
  }

  async function saveEdit(_name: string, body: string) {
    if (!edit) return;
    try {
      await put(`/upstreams/${encodeURIComponent(edit.id)}`, { raw: body });
      toast.success("Upstream atualizado");
      setEdit(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
      throw e;
    }
  }

  async function remove(u: UpstreamSummary) {
    try {
      await del(`/upstreams/${encodeURIComponent(u.id)}`);
      toast.success(`Upstream '${u.id}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  async function toggle(u: UpstreamSummary) {
    if (u.enabled && u.in_use) {
      toast.error(`Upstream em uso por: ${u.used_by.join(", ")}`);
      return;
    }
    try {
      await post(`/upstreams/${encodeURIComponent(u.id)}/${u.enabled ? "disable" : "enable"}`);
      toast.success(`Upstream '${u.id}' ${u.enabled ? "desativado" : "ativado"}`);
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
            <Network className="h-6 w-6 text-primary" /> Upstreams
          </h1>
          <p className="text-sm text-muted-foreground">Grupos de backends (load balancing)</p>
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
                placeholder="Pesquisar por nome, contexto ou backend"
                className="pl-9"
              />
            </div>
            <UpstreamTagFilterSelect tags={tagOptions} value={tagFilter} onChange={setTagFilter} />
            <Button size="sm" onClick={() => setCreateOpen(true)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Novo upstream
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
              <TableHead>Nome</TableHead>
              <TableHead>Contexto</TableHead>
              <TableHead>Servers</TableHead>
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
              filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.id}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.context}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.servers.map((s) => s.join(" ")).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Switch
                            checked={u.enabled}
                            disabled={u.enabled && u.in_use}
                            aria-label={u.enabled ? "Desativar upstream" : "Ativar upstream"}
                            onCheckedChange={() => toggle(u)}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {u.enabled && u.in_use
                          ? `Em uso por: ${u.used_by.join(", ")}`
                          : (u.enabled ? "Desativar upstream" : "Ativar upstream")}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <IconAction label="Editar" onClick={() => openEdit(u)}>
                        <Pencil className="h-4 w-4" />
                      </IconAction>
                      <IconAction
                        label={u.in_use ? `Em uso por: ${u.used_by.join(", ")}` : "Excluir"}
                        disabled={u.in_use}
                        onClick={() => setToDelete(u)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </IconAction>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {query.trim() || tagFilter ? "Nenhum upstream encontrado." : "Nenhum upstream."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <UpstreamFormDialog open={createOpen} onOpenChange={setCreateOpen} onSubmit={createUpstream} />

      {edit && (
        <UpstreamFormDialog
          open
          onOpenChange={(o) => !o && setEdit(null)}
          initial={edit.initial}
          onSubmit={saveEdit}
        />
      )}

      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir upstream '${toDelete?.id}'?`}
        description="Remove o bloco upstream e recarrega o nginx. Servers que apontam para ele deixarão de funcionar."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </div>
    </TooltipProvider>
  );
}
