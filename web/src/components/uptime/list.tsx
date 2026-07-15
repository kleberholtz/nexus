import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUrlPagination, useDebounced, Pagination } from "@/components/docker/list";

export { useUrlPagination, useDebounced, Pagination };
export const PAGE_SIZE = 50;

/** Envelope de lista paginada devolvido pelo backend. */
export type Paged<T> = { items: T[]; total: number; pages: number; page: number };

/** Linha compacta compartilhada pelas listas de monitores e heartbeats. */
export function UptimeListRow({ dragging = false, className = "", children, ...props }: {
  dragging?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-monitor-row
      className={`relative flex min-h-14 cursor-pointer flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 transition-[background-color,opacity] hover:bg-accent/50 sm:flex-nowrap ${dragging ? "opacity-40" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

/** Monta a query string de paginação/busca (`?page=&limit=50&search=`). */
export function pagedQuery(page: number, search: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (search.trim()) p.set("search", search.trim());
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Barra padrão: refresh à esquerda; busca (e ações extras) à direita. */
export function PageToolbar({ onRefresh, search, onSearch, placeholder = "Pesquisar…", children }: {
  onRefresh: () => void;
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Recarregar" onClick={onRefresh}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder}
            className="w-52 pl-8" spellCheck={false} />
        </div>
        {children}
      </div>
    </div>
  );
}
