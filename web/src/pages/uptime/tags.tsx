import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Palette, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MonitorTag } from "@/lib/monitor-config";
import { MonitorTagBadge } from "@/components/monitor-tag-badge";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { PageToolbar, Pagination, Paged, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_COLOR = "#64748b";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COMMON_COLORS = [
  { name: "Cinza", value: "#64748b" },
  { name: "Vermelho", value: "#ef4444" },
  { name: "Laranja", value: "#f97316" },
  { name: "Âmbar", value: "#f59e0b" },
  { name: "Amarelo", value: "#eab308" },
  { name: "Lima", value: "#84cc16" },
  { name: "Verde", value: "#22c55e" },
  { name: "Esmeralda", value: "#10b981" },
  { name: "Turquesa", value: "#14b8a6" },
  { name: "Ciano", value: "#06b6d4" },
  { name: "Azul-céu", value: "#0ea5e9" },
  { name: "Azul", value: "#3b82f6" },
  { name: "Índigo", value: "#6366f1" },
  { name: "Violeta", value: "#8b5cf6" },
  { name: "Roxo", value: "#a855f7" },
  { name: "Rosa", value: "#ec4899" },
] as const;

export function TagsPage() {
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const [data, setData] = useState<Paged<MonitorTag> | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MonitorTag | "new" | null>(null);
  const [removing, setRemoving] = useState<MonitorTag | null>(null);
  const debounced = useDebounced(search);
  const { page, setPage } = useUrlPagination(debounced);

  const load = useCallback(async () => {
    try {
      setData(await get<Paged<MonitorTag>>(`/monitors/tags?${pagedQuery(page, debounced)}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar tags");
    }
  }, [page, debounced]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    if (!removing) return;
    try {
      await del(`/monitors/tags/${removing.id}`);
      toast.success("Tag removida");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover tag");
    } finally {
      setRemoving(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Tags className="h-6 w-6" /> Tags
        </h1>
        <p className="text-sm text-muted-foreground">
          Catálogo de tags reutilizáveis por monitores e heartbeats.
        </p>
      </div>

      <PageToolbar onRefresh={load} search={search} onSearch={setSearch} placeholder="Pesquisar tags">
        {writable && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Nova tag
          </Button>
        )}
      </PageToolbar>

      {data === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {search ? "Nenhuma tag encontrada." : "Nenhuma tag cadastrada."}
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {items.map((tag) => (
              <Card key={tag.id} className="flex flex-wrap items-center gap-4 p-3">
                <span className="h-8 w-8 shrink-0 rounded-md border" style={{ backgroundColor: tag.color }} />
                <div className="min-w-40 flex-1">
                  <p className="truncate font-medium">{tag.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {tag.value || "Sem valor"} · {tag.usage_count ?? 0} uso(s)
                  </p>
                </div>
                <div className="min-w-40">
                  <MonitorTagBadge tag={tag} showValue />
                </div>
                <code className="text-xs text-muted-foreground">{tag.color}</code>
                {writable && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label="Editar tag" onClick={() => setEditing(tag)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Remover tag" onClick={() => setRemoving(tag)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
        </>
      )}

      {editing && (
        <TagDialog
          tag={editing === "new" ? null : editing}
          onOpenChange={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      <ConfirmDelete
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover tag"
        description={`Remover a tag “${removing?.name}”? Ela será desvinculada dos monitores e heartbeats.`}
        confirmLabel="Remover"
        onConfirm={remove}
      />
    </div>
  );
}

function TagDialog({ tag, onOpenChange, onSaved }: {
  tag: MonitorTag | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!tag;
  const [name, setName] = useState(tag?.name ?? "");
  const [value, setValue] = useState(tag?.value ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const preview: MonitorTag = { id: tag?.id ?? 0, name: name.trim() || "Nome da tag", value: value.trim(), color: HEX_COLOR.test(color) ? color : DEFAULT_COLOR };

  async function save() {
    if (!name.trim()) return toast.error("Informe o nome da tag.");
    if (!HEX_COLOR.test(color)) return toast.error("Informe uma cor hexadecimal no formato #RRGGBB.");
    setBusy(true);
    try {
      const payload = { name: name.trim(), value: value.trim(), color: color.toLowerCase() };
      if (isEdit) await put(`/monitors/tags/${tag.id}`, payload);
      else await post("/monitors/tags", payload);
      toast.success(isEdit ? "Tag atualizada" : "Tag criada");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar tag");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[30rem]">
        <DialogHeader className="gap-1.5 pr-10">
          <DialogTitle className="text-lg">{isEdit ? "Editar tag" : "Nova tag"}</DialogTitle>
          <DialogDescription>
            Use nome e valor para identificar a tag e uma cor para reconhecê-la rapidamente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <LabelWithHelp htmlFor="tag-name" help="A combinação entre nome e valor deve ser única." required>Nome</LabelWithHelp>
            <Input id="tag-name" value={name} onChange={(event) => setName(event.target.value)}
              placeholder="Produção" autoFocus />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="tag-value" help="Informação complementar que, junto ao nome, identifica a tag.">Valor</LabelWithHelp>
            <Input id="tag-value" value={value} onChange={(event) => setValue(event.target.value)}
              placeholder="prod" />
          </div>
          <div className="space-y-2">
            <LabelWithHelp htmlFor="tag-color" help="Cor hexadecimal usada na tag." required>Cor</LabelWithHelp>
            <div className="space-y-4 rounded-lg border bg-muted/25 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Palette className="h-3.5 w-3.5" /> Cores sugeridas
                </span>
                <span className="text-[0.7rem] text-muted-foreground/70">16 opções</span>
              </div>
              <div className="grid grid-cols-8 justify-items-center gap-x-1 gap-y-3 sm:gap-x-2" aria-label="Cores sugeridas">
                {COMMON_COLORS.map((option) => {
                  const selected = color.toLowerCase() === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`flex h-7 w-7 items-center justify-center rounded-full border border-black/10 shadow-sm transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-8 sm:w-8 ${selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                      style={{ backgroundColor: option.value }}
                      onClick={() => setColor(option.value)}
                      aria-label={`${option.name} (${option.value})`}
                      aria-pressed={selected}
                      title={`${option.name} · ${option.value}`}
                    >
                      {selected && <Check className="h-4 w-4 text-white drop-shadow" strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative h-9 w-12 shrink-0">
                <input
                  type="color"
                  value={HEX_COLOR.test(color) ? color : DEFAULT_COLOR}
                  onChange={(event) => setColor(event.target.value)}
                  className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  aria-label="Selecionar uma cor personalizada"
                />
                <span className="flex h-9 w-12 items-center justify-center rounded-md border border-input bg-background shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                  <span className="h-5 w-7 rounded-sm border border-black/10" style={{ backgroundColor: preview.color }} />
                </span>
              </div>
              <Input id="tag-color" value={color} onChange={(event) => setColor(event.target.value)}
                placeholder="#64748b" spellCheck={false} className="font-mono uppercase" />
            </div>
          </div>
          <div className="flex min-h-20 items-center justify-between gap-4 rounded-lg border border-dashed bg-muted/20 p-4">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Prévia</p>
              <p className="text-xs text-muted-foreground/70">Exibição nos monitores</p>
            </div>
            <div className="flex min-w-0 justify-end"><MonitorTagBadge tag={preview} showValue /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !name.trim() || !HEX_COLOR.test(color)}>
            {busy && <Loader2 className="animate-spin" />}
            {isEdit ? "Salvar alterações" : "Criar tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
