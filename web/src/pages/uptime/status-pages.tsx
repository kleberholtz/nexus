import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Globe, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, getApiBase } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { StatusPage } from "@/lib/status-page-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { PageToolbar, Pagination, Paged, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";

function publicUrl(p: StatusPage): string {
  if (p.domain) return `https://${p.domain}/`;
  return `${getApiBase()}${p.public_path}`;
}

export function StatusPagesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const writable = can("monitors", "write");
  const [data, setData] = useState<Paged<StatusPage> | null>(null);
  const [toDelete, setToDelete] = useState<StatusPage | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const { page, setPage } = useUrlPagination(debounced);

  const load = useCallback(async () => {
    try {
      setData(await get<Paged<StatusPage>>(`/monitors/status-pages?${pagedQuery(page, debounced)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar páginas");
    }
  }, [page, debounced]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/status-pages/${toDelete.id}`);
      await load();
      toast.success("Página removida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <LayoutTemplate className="h-6 w-6" /> Status pages
        </h1>
        <p className="text-sm text-muted-foreground">
          Páginas públicas de status — expõem só nome, status e uptime dos monitores selecionados.
        </p>
      </div>

      <PageToolbar onRefresh={load} search={search} onSearch={setSearch} placeholder="Pesquisar páginas">
        {writable && (
          <Button onClick={() => navigate("/status-pages/new")}>
            <Plus className="h-4 w-4" /> Nova página
          </Button>
        )}
      </PageToolbar>

      {data === null ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {search ? "Nenhuma página corresponde à busca." : "Nenhuma página criada."}
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((p) => (
            <Card key={p.id} className="transition-colors hover:border-primary/40">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="min-w-0 text-left"
                    onClick={() => writable && navigate(`/status-pages/${p.id}`)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.title || p.slug}</span>
                      {p.published
                        ? <Badge variant="success">Publicada</Badge>
                        : <Badge variant="muted">Rascunho</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">/{p.slug} · {p.monitor_ids.length} monitor(es)</p>
                  </button>
                  {writable && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" aria-label="Editar" onClick={() => navigate(`/status-pages/${p.id}`)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => setToDelete(p)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href={publicUrl(p)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir página
                  </a>
                  {p.domain && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Globe className="h-3.5 w-3.5" /> {p.domain}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
        </>
      )}

      <ConfirmDelete
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remover status page"
        description={`Remover a página “${toDelete?.title || toDelete?.slug}”? O server block nginx vinculado (se houver) também é removido.`}
        confirmLabel="Remover"
        onConfirm={remove}
      />
    </div>
  );
}
