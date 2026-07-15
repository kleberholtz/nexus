import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText, Search } from "lucide-react";
import { get } from "@/lib/api";
import { AuditEntry } from "@/lib/types";
import { formatTsMs } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const PAGE = 25;

type AuditResponse = { items: AuditEntry[]; total: number; limit: number; offset: number };

function statusVariant(status: number): "default" | "destructive" | "muted" {
  if (status >= 500) return "destructive";
  if (status >= 400) return "muted";
  return "default";
}

export function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState("");
  const [action, setAction] = useState("");

  function load(nextOffset = offset) {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(nextOffset) });
    if (user.trim()) params.set("user", user.trim());
    if (action.trim()) params.set("action", action.trim());
    get<AuditResponse>(`/audit?${params.toString()}`)
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
        setOffset(d.offset);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters() {
    load(0);
  }

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ScrollText className="h-6 w-6 text-primary" /> Auditoria
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro de tudo que foi modificado no sistema
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} aria-label="Recarregar auditoria">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Recarregar auditoria</TooltipContent>
        </Tooltip>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="f-user">Usuário</Label>
            <Input id="f-user" value={user} onChange={(e) => setUser(e.target.value)}
              className="h-8 w-40" placeholder="todos" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-action">Ação (prefixo)</Label>
            <Input id="f-action" value={action} onChange={(e) => setAction(e.target.value)}
              className="h-8 w-48" placeholder="ex.: server" />
          </div>
          <Button size="sm" onClick={applyFilters}>
            <Search className="h-4 w-4" /> Filtrar
          </Button>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">Data (ms)</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Requisição</TableHead>
              <TableHead className="w-20 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && items.length === 0 ? (
              [...Array(6)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length > 0 ? (
              items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-mono text-xs">{formatTsMs(it.ts)}</TableCell>
                  <TableCell className="font-medium">{it.user}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{it.action}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {it.method} {it.path}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={statusVariant(it.status)}>{it.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhum registro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} registro(s)</span>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="outline" size="icon" className="h-8 w-8"
                  disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Página anterior</TooltipContent>
          </Tooltip>
          <span>
            {page} / {pages}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="outline" size="icon" className="h-8 w-8"
                  disabled={offset + PAGE >= total || loading} onClick={() => load(offset + PAGE)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Próxima página</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
    </TooltipProvider>
  );
}
