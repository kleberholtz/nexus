import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Download, Radio, RefreshCw, Search, ScrollText } from "lucide-react";
import { get, getApiBase, getToken, streamUrl } from "@/lib/api";
import { AccessLogEntry, ErrorLogEntry } from "@/lib/types";
import { formatBytes, formatTsMs } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Pagination } from "@/components/docker/list";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const MAX = 50; // live logs mostra no máximo 50 linhas

type Tab = "access" | "error";
type AccessRow = AccessLogEntry & { key: number };
type ErrorRow = ErrorLogEntry & { key: number };
type FilterOption = { value: string; label: string };
type LogsPageResp<T> = {
  items: T[];
  pagination: { page: number; page_size: number; total: number; pages: number };
};
let counter = 0;

function statusVariant(st: number): "success" | "destructive" | "warning" | "info" | "muted" {
  if (st >= 500) return "destructive";
  if (st >= 400) return "warning";
  if (st >= 300) return "info";
  if (st >= 200) return "success";
  return "muted";
}

function levelVariant(lvl: string): "success" | "destructive" | "warning" | "info" | "muted" {
  const l = lvl.toLowerCase();
  if (["emerg", "alert", "crit", "error"].includes(l)) return "destructive";
  if (l === "warn") return "warning";
  if (["notice", "info"].includes(l)) return "info";
  return "muted";
}

function latencyText(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n >= 1 ? `${n.toFixed(2)}s` : `${(n * 1000).toFixed(0)}ms`;
}

const field = (p: Record<string, unknown> | null, k: string) => (p ? (p[k] as string | number) : undefined);

function TruncatedValue({ value }: { value: unknown }) {
  const text = String(value ?? "—");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block truncate">{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-md break-all font-mono">{text}</TooltipContent>
    </Tooltip>
  );
}

function clean(v: unknown): string {
  const s = String(v ?? "");
  return s && s !== "-" ? s : "—";
}

function matchesAccessSearch(row: AccessRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const host = String(field(row.parsed, "host") ?? "");
  const uri = String(field(row.parsed, "uri") ?? "");
  return `${host} ${uri}`.toLowerCase().includes(q);
}

function matchesErrorSearch(row: ErrorRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const parsed = row.parsed ? Object.values(row.parsed).join(" ") : "";
  return `${row.raw} ${parsed}`.toLowerCase().includes(q);
}

function optionValues(rows: AccessRow[], key: string): FilterOption[] {
  const values = new Set<string>();
  rows.forEach((row) => {
    const value = clean(field(row.parsed, key));
    if (value !== "—") values.add(value);
  });
  return Array.from(values)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }));
}

function FilterSelect({ options, value, placeholder, searchPlaceholder, onChange }: {
  options: FilterOption[];
  value: string;
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? options.filter((option) => option.label.toLowerCase().includes(term))
      : options;
  }, [options, search]);

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

  function select(value: string) {
    onChange(value);
    setOpen(false);
    setSearch("");
  }

  const selected = options.find((option) => option.value === value);

  return (
    <div ref={ref} className="relative w-full sm:w-36">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full justify-between px-3 font-normal"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-full min-w-44 overflow-hidden rounded-md border bg-card text-card-foreground shadow-md">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-8"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onClick={() => select("")}
            >
              {placeholder}
              {!value && <Check className="h-4 w-4" />}
            </button>
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => select(option.value)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {value === option.value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nenhum item encontrado.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words font-mono text-sm">{value}</div>
    </div>
  );
}

type SelectedLog =
  | { type: "access"; row: AccessRow }
  | { type: "error"; row: ErrorRow }
  | null;

export function LogsPage() {
  const [tab, setTab] = useState<Tab>("access");
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [errorRows, setErrorRows] = useState<ErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === "visible");
  const [selected, setSelected] = useState<SelectedLog>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, page_size: MAX, total: 0, pages: 1 });
  const [methodFilter, setMethodFilter] = useState("");
  const [protoFilter, setProtoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const pendingAccessRef = useRef<AccessRow[]>([]);
  const pendingErrorRef = useRef<ErrorRow[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const methodOptions = useMemo(() => optionValues(accessRows, "m"), [accessRows]);
  const protoOptions = useMemo(() => optionValues(accessRows, "pr"), [accessRows]);
  const statusOptions = useMemo(() => optionValues(accessRows, "st"), [accessRows]);
  const filteredAccessRows = accessRows.filter((row) => (
    matchesAccessSearch(row, query)
    && (!methodFilter || clean(field(row.parsed, "m")) === methodFilter)
    && (!protoFilter || clean(field(row.parsed, "pr")) === protoFilter)
    && (!statusFilter || clean(field(row.parsed, "st")) === statusFilter)
  ));
  const filteredErrorRows = errorRows.filter((row) => matchesErrorSearch(row, query));

  function loadAccess(nextPage = page) {
    setLoading(true);
    get<LogsPageResp<AccessLogEntry>>(`/logs/access?page=${nextPage}`)
      .then((data) => {
        setAccessRows(data.items.map((x) => ({ ...x, key: counter++ })));
        setPagination(data.pagination);
        if (data.pagination.page !== nextPage) setPage(data.pagination.page);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar logs"))
      .finally(() => setLoading(false));
  }

  function loadError(nextPage = page) {
    setLoading(true);
    get<LogsPageResp<ErrorLogEntry>>(`/logs/error?page=${nextPage}`)
      .then((data) => {
        setErrorRows(data.items.map((x) => ({ ...x, key: counter++ })));
        setPagination(data.pagination);
        if (data.pagination.page !== nextPage) setPage(data.pagination.page);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao carregar logs"))
      .finally(() => setLoading(false));
  }

  function load() {
    if (tab === "access") loadAccess(page);
    else loadError(page);
  }
  useEffect(() => {
    if (!live) load();
  }, [tab, page, live]);
  useEffect(() => {
    setPage(1);
    setPagination({ page: 1, page_size: MAX, total: 0, pages: 1 });
  }, [tab]);
  useEffect(() => {
    if (live) setPage(1);
  }, [live]);
  useEffect(() => {
    if (tab !== "access") {
      setMethodFilter("");
      setProtoFilter("");
      setStatusFilter("");
    }
  }, [tab]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  async function downloadCurrentLog() {
    const kind = tab === "access" ? "access" : "error";
    try {
      const token = getToken();
      const res = await fetch(`${getApiBase()}/logs/${kind}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Falha ao baixar log (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${kind}.log`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao baixar log");
    }
  }

  // Live logs via SSE — reconecta ao trocar de aba ou ligar/desligar o live.
  useEffect(() => {
    if (!live || !pageVisible) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }
    const es = new EventSource(streamUrl(tab === "access" ? "/logs/access/stream" : "/logs/error/stream"));
    esRef.current = es;
    const flush = () => {
      flushTimerRef.current = null;
      if (tab === "access" && pendingAccessRef.current.length) {
        const batch = pendingAccessRef.current.splice(0);
        setAccessRows((prev) => [...prev, ...batch].slice(-MAX));
      } else if (tab === "error" && pendingErrorRef.current.length) {
        const batch = pendingErrorRef.current.splice(0);
        setErrorRows((prev) => [...prev, ...batch].slice(-MAX));
      }
    };
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const entry = JSON.parse(e.data);
        if (tab === "access") {
          pendingAccessRef.current.push({ ...(entry as AccessLogEntry), key: counter++ });
        } else {
          pendingErrorRef.current.push({ ...(entry as ErrorLogEntry), key: counter++ });
        }
        if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flush, 100);
      } catch {
        /* ignora */
      }
    };
    es.onerror = () => {};
    return () => {
      es.close();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      flush();
    };
  }, [live, pageVisible, tab]);

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <ScrollText className="h-6 w-6 text-primary" /> Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            50 por página · live lê {tab === "access" ? "/var/log/nginx/access.log" : "o error_log do nginx"}
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="access" className="flex-1 sm:flex-none">Acesso</TabsTrigger>
            <TabsTrigger value="error" className="flex-1 sm:flex-none">Erros</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={load}
                disabled={loading || live}
                aria-label="Recarregar logs"
                className="w-full sm:w-9"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar logs</TooltipContent>
          </Tooltip>
          <Button variant="outline" size="sm" onClick={downloadCurrentLog} className="w-full sm:w-auto">
            <Download className="h-4 w-4" /> Baixar
          </Button>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="relative w-full sm:w-96">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "access" ? "Pesquisar host ou URI" : "Pesquisar nível, mensagem ou host"}
              className="pl-9"
            />
          </div>
          {tab === "access" && (
            <>
              <FilterSelect
                options={methodOptions}
                value={methodFilter}
                placeholder="Método"
                searchPlaceholder="Pesquisar método"
                onChange={setMethodFilter}
              />
              <FilterSelect
                options={protoOptions}
                value={protoFilter}
                placeholder="Proto"
                searchPlaceholder="Pesquisar proto"
                onChange={setProtoFilter}
              />
              <FilterSelect
                options={statusOptions}
                value={statusFilter}
                placeholder="Status"
                searchPlaceholder="Pesquisar status"
                onChange={setStatusFilter}
              />
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={live ? "default" : "outline"}
                size="sm"
                onClick={() => setLive((v) => !v)}
                className="w-full sm:w-auto"
              >
                <Radio className={`h-4 w-4 ${live ? "animate-pulse" : ""}`} />
                {live ? "Live ativo" : "Live logs"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{live ? "Pausar atualização ao vivo" : "Ativar atualização ao vivo"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {tab === "access" ? (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Hora</TableHead>
                  <TableHead className="w-16">Método</TableHead>
                  <TableHead className="w-20">Proto</TableHead>
                  <TableHead className="w-16">Status</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>URI</TableHead>
                  <TableHead className="w-20 text-right">Latência</TableHead>
                  <TableHead className="w-24">Cache</TableHead>
                  <TableHead className="w-16">País</TableHead>
                  <TableHead className="w-20 text-right">Tam.</TableHead>
                  <TableHead className="w-32">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && accessRows.length === 0 ? (
                  [...Array(8)].map((_, i) => (
                          <TableRow key={i}>
                          <TableCell colSpan={11}><Skeleton className="h-4 w-full" /></TableCell>
                        </TableRow>
                      ))
                ) : filteredAccessRows.length > 0 ? (
                  filteredAccessRows
                    .slice()
                    .reverse()
                    .map((r) =>
                      r.parsed ? (
                        <TableRow key={r.key} className="cursor-pointer" onClick={() => setSelected({ type: "access", row: r })}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">
                            {typeof field(r.parsed, "ts") === "number"
                              ? formatTsMs(Number(field(r.parsed, "ts")) * 1000)
                              : "—"}
                          </TableCell>
                          <TableCell><Badge variant="secondary">{field(r.parsed, "m") ?? "—"}</Badge></TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {field(r.parsed, "pr") ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(Number(field(r.parsed, "st")))}>
                              {field(r.parsed, "st") ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{field(r.parsed, "host") ?? "—"}</TableCell>
                          <TableCell className="max-w-[280px] font-mono text-xs">
                            <TruncatedValue value={field(r.parsed, "uri")} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {latencyText(field(r.parsed, "rt"))}
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const cs = String(field(r.parsed, "ucs") ?? "").toUpperCase();
                              if (!cs || cs === "-") return <span className="text-muted-foreground">—</span>;
                              const v = cs === "HIT" ? "success" : cs === "MISS" ? "warning" : "muted";
                              return <Badge variant={v as "success" | "warning" | "muted"}>{cs}</Badge>;
                            })()}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {field(r.parsed, "country") || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {formatBytes(Number(field(r.parsed, "bs")) || 0)}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{field(r.parsed, "ip") ?? "—"}</TableCell>
                        </TableRow>
                      ) : (
                        <TableRow key={r.key} className="cursor-pointer" onClick={() => setSelected({ type: "access", row: r })}>
                          <TableCell colSpan={11} className="font-mono text-xs text-muted-foreground">{r.raw}</TableCell>
                        </TableRow>
                      ),
                    )
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                      {query.trim() || methodFilter || protoFilter || statusFilter
                        ? "Nenhum log encontrado."
                        : "Nenhum log ainda."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Hora</TableHead>
                  <TableHead className="w-20">Nível</TableHead>
                  <TableHead className="w-20">PID</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead className="w-32">Cliente</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Request</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && errorRows.length === 0 ? (
                  [...Array(8)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}><Skeleton className="h-4 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredErrorRows.length > 0 ? (
                  filteredErrorRows
                    .slice()
                    .reverse()
                    .map((r) =>
                      r.parsed ? (
                        <TableRow key={r.key} className="cursor-pointer" onClick={() => setSelected({ type: "error", row: r })}>
                          <TableCell className="whitespace-nowrap font-mono text-xs">
                            {field(r.parsed, "time") ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={levelVariant(String(field(r.parsed, "level") ?? ""))}>
                              {field(r.parsed, "level") ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {field(r.parsed, "pid") ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[420px] text-xs">
                            <TruncatedValue value={field(r.parsed, "message")} />
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {field(r.parsed, "client") ?? "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {field(r.parsed, "host") ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-[280px] font-mono text-xs">
                            <TruncatedValue value={field(r.parsed, "request")} />
                          </TableCell>
                        </TableRow>
                      ) : (
                        <TableRow key={r.key} className="cursor-pointer" onClick={() => setSelected({ type: "error", row: r })}>
                          <TableCell colSpan={7} className="font-mono text-xs text-muted-foreground">{r.raw}</TableCell>
                        </TableRow>
                      ),
                    )
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {query.trim() ? "Nenhum log encontrado." : "Nenhum log ainda."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {!live && (
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          onPage={setPage}
        />
      )}
      {selected && <LogDrawer selected={selected} onOpenChange={(open) => !open && setSelected(null)} />}
    </div>
    </TooltipProvider>
  );
}

function LogDrawer({ selected, onOpenChange }: { selected: SelectedLog; onOpenChange: (open: boolean) => void }) {
  const parsed = selected?.row.parsed ?? null;
  const isAccess = selected?.type === "access";

  return (
    <Drawer direction="right" open={!!selected} onOpenChange={onOpenChange}>
      <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>{isAccess ? "Detalhes do acesso" : "Detalhes do erro"}</DrawerTitle>
          <DrawerDescription>
            {isAccess
              ? `${clean(field(parsed, "m"))} ${clean(field(parsed, "host"))}${clean(field(parsed, "uri"))}`
              : clean(field(parsed, "message"))}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody className="space-y-5">
          {!selected ? null : isAccess ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Hora" value={typeof field(parsed, "ts") === "number" ? formatTsMs(Number(field(parsed, "ts")) * 1000) : "—"} />
                <Detail label="Request ID" value={clean(field(parsed, "id"))} />
                <Detail label="Host" value={clean(field(parsed, "host"))} />
                <Detail label="Método" value={clean(field(parsed, "m"))} />
                <Detail label="Protocolo" value={clean(field(parsed, "pr"))} />
                <Detail label="Status" value={clean(field(parsed, "st"))} />
                <Detail label="IP" value={clean(field(parsed, "ip"))} />
                <Detail label="País" value={clean(field(parsed, "country"))} />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">URL</h3>
                <div className="grid gap-3">
                  <Detail label="URI" value={clean(field(parsed, "uri"))} />
                  <Detail label="Query" value={clean(field(parsed, "q"))} />
                  <Detail label="Referer" value={clean(field(parsed, "ref"))} />
                  <Detail label="User-Agent" value={clean(field(parsed, "ua"))} />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Tempos e upstream</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Request time" value={latencyText(field(parsed, "rt"))} />
                  <Detail label="Upstream" value={clean(field(parsed, "up"))} />
                  <Detail label="Connect" value={latencyText(field(parsed, "uct"))} />
                  <Detail label="TTFB" value={latencyText(field(parsed, "uht"))} />
                  <Detail label="Upstream total" value={latencyText(field(parsed, "urt"))} />
                  <Detail label="Cache" value={clean(field(parsed, "ucs"))} />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Resposta</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Bytes enviados" value={formatBytes(Number(field(parsed, "bs")) || 0)} />
                  <Detail label="Body bytes" value={formatBytes(Number(field(parsed, "bl")) || 0)} />
                  <Detail label="Request length" value={formatBytes(Number(field(parsed, "rl")) || 0)} />
                  <Detail label="Content-Length" value={formatBytes(Number(field(parsed, "cl")) || 0)} />
                  <Detail label="Content-Type" value={clean(field(parsed, "ct"))} />
                  <Detail label="Encoding" value={clean(field(parsed, "enc"))} />
                  <Detail label="Upstream bytes" value={`${formatBytes(Number(field(parsed, "ubs")) || 0)} / ${formatBytes(Number(field(parsed, "ubr")) || 0)}`} />
                  <Detail label="gzip ratio" value={clean(field(parsed, "gz"))} />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Borda e origem</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="CF Ray" value={clean(field(parsed, "ray"))} />
                  <Detail label="Origin" value={clean(field(parsed, "origin"))} />
                  <Detail label="SSL" value={clean(field(parsed, "ssl"))} />
                  <Detail label="Estado" value={clean(field(parsed, "state"))} />
                  <Detail label="Cidade" value={clean(field(parsed, "city"))} />
                  <Detail label="ISP" value={clean(field(parsed, "isp"))} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Hora" value={clean(field(parsed, "time"))} />
                <Detail label="Nível" value={clean(field(parsed, "level"))} />
                <Detail label="PID" value={clean(field(parsed, "pid"))} />
                <Detail label="Thread" value={clean(field(parsed, "tid"))} />
                <Detail label="Cliente" value={clean(field(parsed, "client"))} />
                <Detail label="Host" value={clean(field(parsed, "host"))} />
              </div>
              <Detail label="Mensagem" value={clean(field(parsed, "message"))} />
              <Detail label="Request" value={clean(field(parsed, "request"))} />
              <Detail label="Upstream" value={clean(field(parsed, "upstream"))} />
            </>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Raw</h3>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
              {selected?.row.raw}
            </pre>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
