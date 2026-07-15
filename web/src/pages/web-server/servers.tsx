import { Fragment, lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Copy, Database, Pencil, Plus, RefreshCw, RotateCw, Search, Server as ServerIcon, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { CacheZoneStatus, ServerCacheStatus, ServerDetail, ServerSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ConfirmDelete } from "@/components/confirm-delete";

type EditState = { id: string; managed: boolean; initial: { raw: string; nodes: unknown[] } };
type CreateState = { initial?: { raw: string; nodes: unknown[] } };
type CacheState = { server: ServerSummary; status: ServerCacheStatus | null; loading: boolean; clearing: boolean };
type ServerTag = { value: string; label: string };
type IconActionProps = {
  label: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
};
const ServerFormDialog = lazy(async () => ({ default: (await import("@/components/server-form-dialog")).ServerFormDialog }));

function IconAction({ label, disabled, children, className, onClick }: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={label}
            className={className}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ServerTagFilterSelect({ tags, value, onChange }: {
  tags: ServerTag[];
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

// Domínio base (aprox. eTLD+1: últimos 2 rótulos) usado p/ agrupar os servers.
function baseDomain(name: string): string {
  const n = name.replace(/^\*\./, "").trim().toLowerCase();
  if (!n || n === "_") return "";
  const labels = n.split(".");
  if (labels.length <= 2) return n;
  return labels.slice(-2).join(".");
}

// Domínio de agrupamento de um server: 1º server_name com domínio válido.
function serverDomain(s: ServerSummary): string {
  for (const name of s.server_name) {
    const d = baseDomain(name);
    if (d) return d;
  }
  return "";
}

// Agrupa os servers por domínio, ordenando os grupos (sem domínio por último).
function groupByDomain(servers: ServerSummary[]): { domain: string; servers: ServerSummary[] }[] {
  const map = new Map<string, ServerSummary[]>();
  for (const s of servers) {
    const d = serverDomain(s);
    (map.get(d) ?? map.set(d, []).get(d)!).push(s);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (!a) return 1; // sem domínio por último
      if (!b) return -1;
      return a.localeCompare(b);
    })
    .map(([domain, servers]) => ({ domain, servers }));
}

function serverMatches(s: ServerSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    s.id,
    s.file,
    s.cache_zone ?? "",
    s.ssl_enabled ? "ssl https tls" : "",
    s.cache_enabled ? "cache" : "",
    ...s.server_name,
    ...s.listen,
  ].some((value) => value.toLowerCase().includes(q));
}

function serverTagValues(s: ServerSummary): string[] {
  return [
    s.cache_enabled ? "cache" : "",
    s.ssl_enabled ? "ssl" : "",
    !s.removable ? "default" : "",
    s.enabled ? "enabled" : "disabled",
  ].filter(Boolean);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatCacheLimit(value: string | null): string {
  return value?.trim() || "Não definido";
}

function parseSizeToBytes(value: string | null): number | null {
  const raw = value?.trim().toLowerCase();
  if (!raw || raw === "off" || raw === "unlimited" || raw === "infinite") return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)([kmgt])?b?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] ?? "";
  const multiplier = unit === "k" ? 1024
    : unit === "m" ? 1024 ** 2
    : unit === "g" ? 1024 ** 3
    : unit === "t" ? 1024 ** 4
    : 1;
  return amount * multiplier;
}

const CACHE_SECTIONS = [
  ["geral", "Geral"],
  ["zona", "Zonas dedicadas"],
  ["rota", "Rotas"],
] as const;

/** Bloco de status/limpeza de uma zona de cache no diálogo. */
function CacheZoneBlock({ z, clearing, onClear }: {
  z: CacheZoneStatus; clearing: boolean; onClear: () => void;
}) {
  const maxB = parseSizeToBytes(z.max_size);
  const pct = maxB && maxB > 0 ? Math.min((z.size_bytes / maxB) * 100, 100) : null;
  const title = z.category === "rota" ? z.route : "server inteiro";
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          <Badge variant={z.dedicated ? "info" : "muted"}>
            {z.dedicated ? "dedicada" : "compartilhada"}
          </Badge>
          {!z.exists && <Badge variant="warning">diretório não existe</Badge>}
        </div>
        <Button variant="outline" size="sm" disabled={clearing} onClick={onClear}>
          {clearing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />} Limpar
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><div className="text-xs text-muted-foreground">Tamanho</div>
          <div className="font-semibold">{formatBytes(z.size_bytes)}</div></div>
        <div><div className="text-xs text-muted-foreground">Máximo</div>
          <div className="font-semibold">{formatCacheLimit(z.max_size)}</div></div>
        <div><div className="text-xs text-muted-foreground">Arquivos</div>
          <div className="font-semibold">{z.files}</div></div>
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">zona: {z.zone}</span>
        <code className="break-all">{z.path}</code>
      </div>
    </div>
  );
}

export function ServersPage() {
  const { data, loading, error, reload } = useData<ServerSummary[]>(() => get("/servers"), []);
  const [create, setCreate] = useState<CreateState | null>(null);
  const [dialog, setDialog] = useState<EditState | null>(null);
  const [toDelete, setToDelete] = useState<ServerSummary | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [cache, setCache] = useState<CacheState | null>(null);
  const [applyingReload, setApplyingReload] = useState(false);

  const tagOptions = useMemo<ServerTag[]>(() => {
    const available = new Set((data ?? []).flatMap(serverTagValues));
    const options: ServerTag[] = [
      { value: "cache", label: "Cache" },
      { value: "ssl", label: "SSL" },
      { value: "default", label: "Default" },
      { value: "enabled", label: "Ativo" },
      { value: "disabled", label: "Inativo" },
    ];
    return options.filter((option) => available.has(option.value));
  }, [data]);
  const filtered = useMemo(() => (data ?? []).filter((s) => (
    serverMatches(s, query) && (!tagFilter || serverTagValues(s).includes(tagFilter))
  )), [data, query, tagFilter]);
  const groupedServers = useMemo(() => groupByDomain(filtered), [filtered]);

  async function openEdit(id: string) {
    try {
      const detail = await get<ServerDetail>(`/servers/${encodeURIComponent(id)}`);
      setDialog({ id, managed: !!detail.managed_by_service, initial: { raw: detail.raw, nodes: detail.nodes } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }

  // Duplicar: abre o dialog de criação pré-preenchido com a config do server
  // (o usuário ajusta o server_name — igual gera 409 de nome duplicado).
  async function openDuplicate(id: string) {
    try {
      const detail = await get<ServerDetail>(`/servers/${encodeURIComponent(id)}`);
      setCreate({ initial: { raw: detail.raw, nodes: detail.nodes } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }

  async function createServer(config: string) {
    try {
      await post("/servers", { raw: config });
      toast.success("Server criado");
      setCreate(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar");
      throw e; // mantém o dialog aberto
    }
  }

  async function saveEdit(config: string) {
    if (!dialog) return;
    try {
      await put(`/servers/${encodeURIComponent(dialog.id)}`, { raw: config });
      toast.success("Server atualizado");
      setDialog(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
      throw e;
    }
  }

  async function remove(s: ServerSummary) {
    try {
      await del(`/servers/${encodeURIComponent(s.id)}`);
      toast.success(`Server '${s.id}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  async function toggle(s: ServerSummary) {
    try {
      await post(`/servers/${encodeURIComponent(s.id)}/${s.enabled ? "disable" : "enable"}`);
      toast.success(`Server '${s.id}' ${s.enabled ? "desativado" : "ativado"}`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar estado");
    }
  }

  async function applyReload() {
    setApplyingReload(true);
    try {
      const res = await post<{ output: string }>("/nginx/reload");
      toast.success(res.output || "Reload aplicado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar reload");
    } finally {
      setApplyingReload(false);
    }
  }

  async function openCache(s: ServerSummary) {
    setCache({ server: s, status: null, loading: true, clearing: false });
    try {
      const status = await get<ServerCacheStatus>(`/servers/${encodeURIComponent(s.id)}/cache/status`);
      setCache({ server: s, status, loading: false, clearing: false });
    } catch (e) {
      setCache(null);
      toast.error(e instanceof Error ? e.message : "Falha ao carregar cache");
    }
  }

  async function reloadCache() {
    if (!cache) return;
    setCache({ ...cache, loading: true });
    try {
      const status = await get<ServerCacheStatus>(`/servers/${encodeURIComponent(cache.server.id)}/cache/status`);
      setCache({ server: cache.server, status, loading: false, clearing: false });
    } catch (e) {
      setCache({ ...cache, loading: false });
      toast.error(e instanceof Error ? e.message : "Falha ao recarregar cache");
    }
  }

  async function clearCache(zone?: string) {
    if (!cache) return;
    setCache({ ...cache, clearing: true });
    try {
      const qs = zone ? `?zone=${encodeURIComponent(zone)}` : "";
      const status = await post<ServerCacheStatus>(`/servers/${encodeURIComponent(cache.server.id)}/cache/clear${qs}`);
      setCache({ server: cache.server, status, loading: false, clearing: false });
      toast.success(zone ? "Zona de cache limpa" : "Cache limpo");
    } catch (e) {
      setCache({ ...cache, clearing: false });
      toast.error(e instanceof Error ? e.message : "Falha ao limpar cache");
    }
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ServerIcon className="h-6 w-6 text-primary" /> Servers
            </h1>
            <p className="text-sm text-muted-foreground">Server blocks HTTP/HTTPS</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={applyReload}
            disabled={applyingReload}
            className="w-full sm:w-auto"
          >
            <RotateCw className={`h-4 w-4 ${applyingReload ? "animate-spin" : ""}`} />
            Aplicar alterações
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-96">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar por ID, domínio, listen ou arquivo"
                className="pl-9"
              />
            </div>
            <ServerTagFilterSelect tags={tagOptions} value={tagFilter} onChange={setTagFilter} />
            <Button size="sm" onClick={() => setCreate({})} className="w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Novo server
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
              <TableHead>server_name</TableHead>
              <TableHead>listen</TableHead>
              <TableHead className="w-20">Ativo</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
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
              groupedServers.map((group) => (
                <Fragment key={`group-${group.domain || "_"}`}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="bg-muted/50 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {group.domain || "Sem domínio"}
                      <span className="ml-2 font-normal normal-case tracking-normal">
                        ({group.servers.length})
                      </span>
                    </TableCell>
                  </TableRow>
                  {group.servers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {s.id}
                        {!s.removable && (
                          <Badge variant="muted" className="ml-2">
                            default
                          </Badge>
                        )}
                        {s.cache_enabled && (
                          <Badge variant="success" className="ml-2">
                            cache
                          </Badge>
                        )}
                        {s.ssl_enabled && (
                          <Badge variant="info" className="ml-2">
                            SSL
                          </Badge>
                        )}
                        {s.managed_by_service && (
                          <Badge variant="warning" className="ml-2">Controlado por um serviço</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.server_name.join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.listen.join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Switch
                                checked={s.enabled}
                                disabled={!s.removable || s.managed_by_service}
                                aria-label={s.enabled ? "Desativar server" : "Ativar server"}
                                onCheckedChange={() => toggle(s)}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {s.managed_by_service
                              ? "Controlado por um serviço"
                              : s.removable
                              ? (s.enabled ? "Desativar server" : "Ativar server")
                              : "O server default não pode ser desativado"}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {s.cache_enabled && (
                            <IconAction label="Ver cache" onClick={() => openCache(s)}>
                              <Database className="h-4 w-4" />
                            </IconAction>
                          )}
                          <IconAction label={s.managed_by_service ? "Editar opções permitidas" : "Editar"}
                            onClick={() => openEdit(s.id)}>
                            <Pencil className="h-4 w-4" />
                          </IconAction>
                          <IconAction label={s.managed_by_service ? "Controlado por um serviço" : "Duplicar"}
                            disabled={s.managed_by_service} onClick={() => openDuplicate(s.id)}>
                            <Copy className="h-4 w-4" />
                          </IconAction>
                          <IconAction
                            label={s.managed_by_service ? "Controlado por um serviço" : s.removable ? "Excluir" : "O server default não pode ser removido"}
                            disabled={!s.removable || s.managed_by_service}
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </IconAction>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {query.trim() || tagFilter ? "Nenhum server encontrado." : "Nenhum server."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {create !== null && <Suspense fallback={null}><ServerFormDialog
        open={create !== null}
        onOpenChange={(o) => !o && setCreate(null)}
        onSubmit={createServer}
        initial={create?.initial ?? null}
        isEdit={false}
      /></Suspense>}

      {dialog && (
        <Suspense fallback={null}><ServerFormDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          initial={dialog.initial}
          serviceManaged={dialog.managed}
          onSubmit={saveEdit}
        /></Suspense>
      )}

      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir server '${toDelete?.id}'?`}
        description="Esta ação remove o server block da configuração e recarrega o nginx. Não pode ser desfeita."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />

      {cache && <Dialog open onOpenChange={(o) => !o && setCache(null)}>
        <DialogContent className="sm:max-w-xl">
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogHeader>
              <DialogTitle>Cache de {cache?.server.id}</DialogTitle>
              <DialogDescription>
                Verifique o tamanho atual do cache local e limpe os arquivos quando necessário.
              </DialogDescription>
            </DialogHeader>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={reloadCache}
                  disabled={!cache || cache.loading || cache.clearing}
                  aria-label="Recarregar"
                >
                  <RefreshCw className={`h-4 w-4 ${cache?.loading ? "animate-spin" : ""}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Recarregar</TooltipContent>
            </Tooltip>
          </div>

          {cache?.loading ? (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded-md border p-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-6 w-20" />
                  </div>
                ))}
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="mt-3 h-2 w-full rounded-full" />
              </div>
              <div className="rounded-md border p-3">
                <Skeleton className="h-3 w-10" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
              <div className="rounded-md border p-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-4 w-full" />
              </div>
            </div>
          ) : cache?.status ? (
            <div className="grid gap-4 text-sm">
              {CACHE_SECTIONS.map(([cat, label]) => {
                const zs = cache.status!.zones.filter((z) => z.category === cat);
                if (!zs.length) return null;
                return (
                  <div key={cat} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
                    {zs.map((z) => (
                      <CacheZoneBlock key={z.zone} z={z} clearing={cache.clearing}
                        onClear={() => clearCache(z.zone)} />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCache(null)}>
              Fechar
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearCache()}
              disabled={!cache?.status || cache.clearing}
            >
              {cache?.clearing && <RefreshCw className="h-4 w-4 animate-spin" />}
              Limpar cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
    </TooltipProvider>
  );
}
