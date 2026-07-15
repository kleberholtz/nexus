import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Check, ChevronsUpDown, Database, FileStack, FolderGit2, LayoutTemplate, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useAuth } from "@/lib/auth";
import type { Project, ServiceKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const KIND_SUMMARY: { kind: ServiceKind; label: string; icon: React.ElementType }[] = [
  { kind: "database", label: "Banco de dados", icon: Database },
  { kind: "compose", label: "Docker / Compose", icon: FileStack },
  { kind: "template", label: "Template", icon: LayoutTemplate },
];
const TAGS_VISIBLE_LIMIT = 3;

function formatCreated(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^#/, "");
}

function TagFilterSelect({ tags, value, onChange }: {
  tags: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? tags.filter((tag) => tag.toLowerCase().includes(term)) : tags;
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

  return (
    <div ref={ref} className="relative w-full sm:w-52">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between px-3 font-normal"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{value ? `#${value}` : "Todas as tags"}</span>
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
                key={tag}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => selectTag(tag)}
              >
                <span className="min-w-0 truncate">#{tag}</span>
                {value === tag && <Check className="h-4 w-4 shrink-0" />}
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

/** Dialog de projeto: nome, descrição e tags. */
function ProjectDialog({ project, onOpenChange, onSaved }: {
  project?: Project | null;
  onOpenChange: (o: boolean) => void;
  onSaved: (p: Project) => void;
}) {
  const isEdit = !!project;
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [tags, setTags] = useState<string[]>(project?.tags ?? []);
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);

  function addTag(value = tagText) {
    const next = normalizeTag(value);
    if (!next) return;
    setTags((current) => current.includes(next) ? current : [...current, next]);
    setTagText("");
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((item) => item !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
    if (e.key === "Backspace" && !tagText && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  function handleTagChange(value: string) {
    if (value.includes(",")) {
      const parts = value.split(",");
      const pending = parts.pop() ?? "";
      const nextTags = parts.map(normalizeTag).filter(Boolean);
      setTags((current) => {
        const merged = [...current];
        nextTags.forEach((tag) => {
          if (!merged.includes(tag)) merged.push(tag);
        });
        return merged;
      });
      setTagText(pending);
      return;
    }
    setTagText(value);
  }

  async function save() {
    setBusy(true);
    try {
      const payload = { name: name.trim(), description: description.trim(), tags };
      const p = isEdit
        ? await put<Project>(`/projects/${project.id}`, payload)
        : await post<Project>("/projects", payload);
      toast.success(isEdit ? "Projeto atualizado" : "Projeto criado");
      onSaved(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar projeto" : "Novo projeto"}</DialogTitle>
          <DialogDescription>Agrupa serviços (aplicação, banco, compose, template).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prj-name">Nome</Label>
            <Input id="prj-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prj-desc">Descrição (opcional)</Label>
            <Textarea id="prj-desc" value={description} rows={3}
                      onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prj-tags">Tags (separadas por vírgula)</Label>
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 rounded-md px-2 py-0.5 text-xs">
                  #{tag}
                  <button
                    type="button"
                    className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remover tag ${tag}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <input
                id="prj-tags"
                value={tagText}
                onChange={(e) => handleTagChange(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => addTag()}
                placeholder={tags.length === 0 ? "produção, api" : "Adicionar tag"}
                className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const { can } = useAuth();
  const canWrite = can("projects", "write");
  const navigate = useNavigate();
  const { data, loading, error, reload } = useData<Project[]>(() => get("/projects"), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const allTags = useMemo(() => {
    const unique = new Set<string>();
    (data ?? []).forEach((project) => project.tags.forEach((tag) => unique.add(tag)));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filteredProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (data ?? []).filter((project) => {
      const matchesTag = !tagFilter || project.tags.includes(tagFilter);
      if (!matchesTag) return false;
      if (!term) return true;
      const searchable = [
        project.name,
        project.description,
        ...project.tags,
      ].join(" ").toLowerCase();
      return searchable.includes(term);
    });
  }, [data, query, tagFilter]);

  async function remove(project: Project) {
    try {
      await del(`/projects/${project.id}`);
      toast.success(`Projeto '${project.name}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FolderGit2 className="h-6 w-6 text-primary" /> Projetos
          </h1>
          <p className="text-sm text-muted-foreground">
            Agrupe serviços por projeto — aplicações, bancos, compose e templates
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={reload}
              disabled={loading}
              aria-label="Recarregar projetos"
              className="w-full sm:w-9"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Recarregar</TooltipContent>
        </Tooltip>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar projetos"
              className="pl-8"
            />
          </div>
          <TagFilterSelect tags={allTags} value={tagFilter} onChange={setTagFilter} />
          {canWrite && (
            <Button className="w-full sm:w-auto" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Adicionar projeto
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((p) => (
            <Card key={p.id} role="button" tabIndex={0}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/projects/${p.id}`)}
                  className="group flex min-h-48 cursor-pointer flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-sm">
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-base font-semibold leading-6">{p.name}</h2>
                    {p.description ? (
                      <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{p.description}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/70">Sem descrição</p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="-mr-2 -mt-2 shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" aria-label="Ações do projeto">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setEditing(p)}>
                            <Pencil className="h-4 w-4 text-muted-foreground" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setToDelete(p)}>
                            <Trash2 className="h-4 w-4" /> Deletar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>

                <div className="mt-4 min-h-7">
                  {p.tags.length > 0 ? (
                    <div className="flex max-w-full items-center gap-1.5 overflow-hidden">
                      {p.tags.slice(0, TAGS_VISIBLE_LIMIT).map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="max-w-[7.5rem] shrink truncate rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground"
                        >
                          #{t}
                        </Badge>
                      ))}
                      {p.tags.length > TAGS_VISIBLE_LIMIT && (
                        <Badge
                          variant="muted"
                          className="shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-medium"
                        >
                          +{p.tags.length - TAGS_VISIBLE_LIMIT}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">Sem tags</span>
                  )}
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{formatCreated(p.created_ts)}</span>
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="shrink-0 rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.service_count ?? 0} serviços
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="space-y-1">
                    {KIND_SUMMARY.map(({ kind, label, icon: Icon }) => (
                      <div key={kind} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" /> {label}
                        </span>
                        <span className="font-mono">{p.service_kind_counts?.[kind] ?? 0}</span>
                      </div>
                    ))}
                  </TooltipContent>
                </Tooltip>
              </div>
            </Card>
          ))}
          {filteredProjects.length === 0 && (
            <Card className="col-span-full p-10 text-center text-sm text-muted-foreground">
              Nenhum projeto encontrado com os filtros atuais.
            </Card>
          )}
        </div>
      ) : (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Nenhum projeto ainda. {canWrite && "Crie o primeiro para começar."}
        </Card>
      )}

      {creating && (
        <ProjectDialog
          onOpenChange={(o) => !o && setCreating(false)}
          onSaved={(p) => { setCreating(false); navigate(`/projects/${p.id}`); reload(); }}
        />
      )}
      {editing && (
        <ProjectDialog
          project={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Deletar projeto '${toDelete?.name}'?`}
        description="Todos os serviços vinculados ao projeto também serão removidos."
        onConfirm={() => { if (toDelete) return remove(toDelete); }}
      />
    </div>
    </TooltipProvider>
  );
}
