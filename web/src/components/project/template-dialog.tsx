import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { get, post } from "@/lib/api";
import type { ProjectService, TemplateItem, TemplatesPage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PAGE = 50;

export function TemplateDialog({ projectId, onOpenChange, onCreated }: {
  projectId: number;
  onOpenChange: (o: boolean) => void;
  onCreated: (svc: ProjectService) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [page, setPage] = useState<TemplatesPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  useEffect(() => {
    get<string[]>("/templates/tags").then(setTags).catch(() => { });
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => setOffset(0), [debounced, tag]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (debounced) params.set("search", debounced);
    if (tag) params.set("tags", tag);
    get<TemplatesPage>(`/templates?${params.toString()}`)
      .then(setPage)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao buscar"))
      .finally(() => setLoading(false));
  }, [debounced, tag, offset]);

  async function choose(t: TemplateItem) {
    setCreatingId(t.id);
    try {
      const svc = await post<ProjectService>(`/projects/${projectId}/services`, {
        kind: "template", name: t.name,
        config: { template_id: t.id, name: t.name, version: t.version, logo: t.logo, tags: t.tags },
      });
      toast.success(`Template '${t.name}' adicionado`);
      onCreated(svc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar");
      setCreatingId(null);
    }
  }

  const total = page?.total ?? 0;
  const rangeEnd = Math.min(offset + PAGE, total);
  const pageInfo = useMemo(
    () => (total > 0 ? `${offset + 1}–${rangeEnd} de ${total}` : "nenhum resultado"),
    [offset, rangeEnd, total],
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adicionar template</DialogTitle>
          <DialogDescription>Busca e filtro por tag (paginado, {PAGE}/página).</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou descrição…" className="pl-8" autoFocus />
          </div>
          <SelectWithSearch
            value={tag}
            options={[
              { value: "", label: "Todas as tags" },
              ...tags.map((item) => ({ value: item, label: `#${item}`, searchText: item })),
            ]}
            onChange={setTag}
            placeholder="Todas as tags"
            searchPlaceholder="Pesquisar tag"
            emptyMessage="Nenhuma tag encontrada."
            className="sm:w-52"
          />
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {loading && !page ? (
            [...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : page && page.items.length > 0 ? (
            page.items.map((t) => (
              <button key={t.id} type="button" disabled={creatingId !== null}
                onClick={() => choose(t)}
                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent disabled:opacity-60">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.version && <Badge variant="muted">{t.version}</Badge>}
                    {creatingId === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.tags.slice(0, 6).map((tg) => (
                      <Badge key={tg} variant="secondary" className="text-[0.65rem]">{tg}</Badge>
                    ))}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum template encontrado.</p>
          )}
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{pageInfo}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={rangeEnd >= total || loading}
              onClick={() => setOffset(offset + PAGE)}>Próxima</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
