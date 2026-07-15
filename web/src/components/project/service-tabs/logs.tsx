import { useEffect, useState } from "react";
import { Copy, Download, Pause, Play, Search } from "lucide-react";
import { get, streamUrl } from "@/lib/api";
import { copyText } from "@/lib/utils";
import { LogViewer } from "../log-viewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";

export function LogsTab({ base, containerName }: { base: string; containerName: string }) {
  const [lines, setLines] = useState<{ line: string; timestamp?: number | null }[]>([]);
  const [live, setLive] = useState(true);
  const [container, setContainer] = useState(containerName);
  const [containerState, setContainerState] = useState("unknown");
  const [containers, setContainers] = useState<{ id: string; name: string; state: string }[]>([]);
  const [tail, setTail] = useState("200");
  const [timeRange, setTimeRange] = useState("all");

  useEffect(() => {
    get<{ id: string; name: string; state: string }[]>(`${base}/containers`)
      .then((cs) => {
        setContainers(cs);
        const selected = cs.find((item) => item.name === container)
          ?? cs.find((item) => item.name === containerName)
          ?? cs.find((item) => item.state === "running")
          ?? cs[0];
        setContainer(selected?.name || containerName);
        setContainerState(selected?.state || "absent");
      })
      .catch(() => setContainerState("unknown"));
  }, [base, containerName]);
  const [logType, setLogType] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!live) return;
    setLines([]);
    // "Ao vivo" = só logs novos (tail=0); "Tudo" = envia o histórico (tail=<limite>).
    const q = new URLSearchParams({ tail: timeRange === "live" ? "0" : tail });
    if (container) q.set("container", container);
    const es = new EventSource(streamUrl(`${base}/logs/stream?${q.toString()}`));
    es.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data) as { line: string; timestamp?: number | null };
        setLines((prev) => [...prev.slice(-2000), entry]);
      } catch { /* ignora heartbeats */ }
    };
    es.onerror = () => { /* auto-reconnect do EventSource */ };
    return () => es.close();
  }, [live, container, base, tail, timeRange]);

  const filteredLines = lines.filter((entry) => {
    const normalized = entry.line.toLowerCase();
    if (query.trim() && !normalized.includes(query.trim().toLowerCase())) return false;
    if (logType === "error" && !/(error|fatal|exception|failed|denied)/i.test(entry.line)) return false;
    if (logType === "warn" && !/(warn|warning)/i.test(entry.line)) return false;
    if (logType === "info" && /(error|fatal|exception|failed|denied|warn|warning)/i.test(entry.line)) return false;
    return timeRange === "all" || true;
  });

  function lineKind(line: string): "error" | "warn" | "info" {
    if (/(error|fatal|exception|failed|denied)/i.test(line)) return "error";
    if (/(warn|warning)/i.test(line)) return "warn";
    return "info";
  }

  function copyLogs() {
    copyText(filteredLines.map((entry) => entry.line).join("\n"));
  }

  function downloadLogs() {
    const blob = new Blob([filteredLines.map((entry) => entry.line).join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `service-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const containerBadge = containerState === "running"
    ? { label: "rodando", variant: "success" as const }
    : containerState === "unknown"
      ? { label: "status indisponível", variant: "muted" as const }
      : { label: containerState || "parado", variant: "destructive" as const };

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Logs</h2>
          <p className="text-sm text-muted-foreground">Consulte logs em tempo real ou o histórico de qualquer container do serviço.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <code className="max-w-64 truncate font-mono text-muted-foreground">{container}</code>
          <Badge variant={containerBadge.variant}>{containerBadge.label}</Badge>
        </div>
      </div>

      <div className="space-y-2">
        <LabelWithHelp label="Container" help="Selecione o container do serviço para visualizar os logs." />
        <SelectWithSearch value={container} onChange={(value) => {
          const selected = containers.find((item) => item.name === value);
          setContainer(value);
          setContainerState(selected?.state || "unknown");
        }} disabled={containers.length === 0}
          options={containers.map((item) => ({
            value: item.name,
            label: `${item.name} (${item.state || "unknown"})`,
            searchText: `${item.name} ${item.id} ${item.state}`,
          }))}
          placeholder="Selecione um container"
          searchPlaceholder="Pesquisar container"
          emptyMessage={containers.length === 0 ? "Carregando containers..." : "Nenhum container encontrado."}
        />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <Label className="whitespace-nowrap text-sm font-medium">Limite</Label>
            <Select value={tail} onChange={(e) => setTail(e.target.value)} className="h-7 w-28 border-0 bg-muted px-2 shadow-none">
              <option value="100">100 linhas</option>
              <option value="200">200 linhas</option>
              <option value="500">500 linhas</option>
              <option value="1000">1000 linhas</option>
            </Select>
          </div>
          <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <Label className="whitespace-nowrap text-sm font-medium">Período</Label>
            <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="h-7 w-28 border-0 bg-muted px-2 shadow-none">
              <option value="all">Tudo</option>
              <option value="live">Ao vivo</option>
            </Select>
          </div>
          <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
            <Label className="whitespace-nowrap text-sm font-medium">Tipo</Label>
            <Select value={logType} onChange={(e) => setLogType(e.target.value)} className="h-7 w-28 border-0 bg-muted px-2 shadow-none">
              <option value="all">Todos</option>
              <option value="error">Erro</option>
              <option value="warn">Aviso</option>
              <option value="info">Info</option>
            </Select>
          </div>
          <div className="relative w-full md:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar logs..." className="pl-9" />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant={live ? "default" : "outline"} size="sm" onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {live ? "Pausar" : "Iniciar"}
          </Button>
          <Button variant="outline" size="sm" onClick={copyLogs} disabled={filteredLines.length === 0}>
            <Copy className="h-4 w-4" /> Copiar
          </Button>
          <Button variant="outline" size="sm" onClick={downloadLogs} disabled={filteredLines.length === 0}>
            <Download className="h-4 w-4" /> Baixar logs
          </Button>
        </div>
      </div>

      <LogViewer
        className="max-h-[30rem] min-h-56"
        entries={filteredLines.map((entry, index) => ({
          id: `${index}-${entry.timestamp ?? "no-ts"}`,
          timestamp: entry.timestamp ?? undefined,
          level: lineKind(entry.line),
          context: container,
          message: entry.line,
        }))}
        emptyMessage={live ? "Aguardando logs..." : "Clique em Iniciar para transmitir os logs."}
      />
    </Card>
  );
}
