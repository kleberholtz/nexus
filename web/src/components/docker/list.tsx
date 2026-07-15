import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StatBox({ icon: Icon, label, value }: {
  icon: LucideIcon; label: string; value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function useUrlPagination(resetKey: string) {
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, Number(sp.get("p")) || 1);
  const setPage = useCallback((p: number) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete("p"); else next.set("p", String(p));
      return next;
    });
  }, [setSp]);

  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current === null) { prev.current = resetKey; return; }
    if (prev.current !== resetKey) { prev.current = resetKey; setPage(1); }
  }, [resetKey, setPage]);

  return { page, setPage };
}

export function Pagination({ page, pages, total, onPage }: {
  page: number; pages: number; total: number; onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
      <span className="tabular-nums">{total} itens</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8"
          disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">Página {page} de {pages}</span>
        <Button variant="outline" size="icon" className="h-8 w-8"
          disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
