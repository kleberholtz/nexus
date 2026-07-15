import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, MoreHorizontal, Network, PlayCircle, Plus, Trash2, Upload } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import {
  PROXY_PROTOCOLS,
  ProxyCard,
  ProxyDraft,
  ProxyProtocol,
  duplicateProxyAt,
  emptyProxy,
  exportProxiesJson,
  exportProxiesTxt,
  hasSchemelessLines,
  newUid,
  parseProxyLines,
  proxyEndpointKey,
  proxyPayload,
  validateProxies,
} from "@/components/monitor-proxy-fields";
import { Select } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDelete } from "@/components/confirm-delete";
import { toast } from "@/components/ui/sonner";
import { PageToolbar, Pagination, Paged, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";

type ProxyRow = {
  id: number;
  protocol: ProxyDraft["protocol"];
  server: string;
  port: number;
  username: string;
  password: string;
  enabled: boolean;
};

const TEST_CONFIG = { url: "https://example.com", method: "HEAD", accepted_codes: "200-399", ssl: {} };

function rowToDraft(r: ProxyRow): ProxyDraft {
  return { ...r, uid: newUid(), port: String(r.port), auth: !!(r.username || r.password) };
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyDraft[]>([]);
  const [meta, setMeta] = useState<Omit<Paged<ProxyDraft>, "items"> | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<number | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const debounced = useDebounced(search);
  const { page, setPage } = useUrlPagination(debounced);

  const load = useCallback(async () => {
    try {
      const res = await get<Paged<ProxyRow>>(`/monitors/proxies?${pagedQuery(page, debounced)}`);
      setProxies(res.items.map(rowToDraft));
      setMeta({ page: res.page, pages: res.pages, total: res.total });
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar proxies");
    }
  }, [page, debounced]);
  useEffect(() => { load(); }, [load]);

  const patch = (index: number, value: Partial<ProxyDraft>) =>
    setProxies((ps) => ps.map((p, i) => (i === index ? { ...p, ...value } : p)));
  const add = () => setProxies((ps) => [...ps, emptyProxy()]);
  const duplicate = (index: number) => setProxies((ps) => duplicateProxyAt(ps, index));

  function deselect(uid?: string) {
    if (!uid) return;
    setSelected((s) => { const n = new Set(s); n.delete(uid); return n; });
  }
  function toggleSelect(uid: string, checked: boolean) {
    setSelected((s) => { const n = new Set(s); if (checked) n.add(uid); else n.delete(uid); return n; });
  }

  function requestDelete(index: number) {
    const proxy = proxies[index];
    if (proxy?.id) { setToDelete(index); return; }
    setProxies((ps) => ps.filter((_, i) => i !== index));
    deselect(proxy?.uid);
  }

  async function confirmDelete() {
    if (toDelete === null) return;
    const proxy = proxies[toDelete];
    try {
      if (proxy.id) await del(`/monitors/proxies/${proxy.id}`);
      deselect(proxy.uid);
      await load();
      toast.success("Proxy removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  async function saveOne(index: number) {
    const proxy = proxies[index];
    const error = validateProxies([proxy]);
    if (error) return toast.error(error);
    const key = proxyEndpointKey(proxy);
    if (proxies.some((p, i) => i !== index && proxyEndpointKey(p) === key)) {
      return toast.error(`Já existe um proxy ${proxy.protocol}://${proxy.server}:${proxy.port}.`);
    }
    setSavingIndex(index);
    try {
      const body = proxyPayload(proxy);
      if (proxy.id) await put(`/monitors/proxies/${proxy.id}`, body);
      else await post("/monitors/proxies", body);
      toast.success("Proxy salvo");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar proxy");
    } finally {
      setSavingIndex(null);
    }
  }

  async function test(proxy: ProxyDraft, index: number) {
    const error = validateProxies([proxy]);
    if (error) return toast.error(error);
    setTesting(index);
    try {
      const r = await post<{ latency_ms: number }>("/monitors/proxies/test", {
        proxy: proxyPayload(proxy), config: TEST_CONFIG, timeout_seconds: 10,
      });
      toast.success(`Proxy funcionando · ${r.latency_ms} ms`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar proxy");
    } finally {
      setTesting(null);
    }
  }

  async function testSelected() {
    const items = proxies.map((proxy, index) => ({ proxy, index })).filter(({ proxy }) => proxy.uid && selected.has(proxy.uid));
    if (!items.length) return;
    const error = validateProxies(items.map(({ proxy }) => proxy));
    if (error) return toast.error(error);
    setTesting(-1);
    const results = await Promise.allSettled(items.map(({ proxy }) =>
      post<{ latency_ms: number }>("/monitors/proxies/test", {
        proxy: proxyPayload(proxy), config: TEST_CONFIG, timeout_seconds: 10,
      })));
    const passed = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - passed;
    if (failed) {
      const names = results.flatMap((result, i) =>
        result.status === "rejected" ? [`${items[i].proxy.server}:${items[i].proxy.port}`] : []);
      toast.error(`${passed}/${results.length} proxies funcionando. Falharam: ${names.join(", ")}`);
    } else {
      toast.success(`${passed} proxies testados com sucesso.`);
    }
    setTesting(null);
  }

  async function bulkDelete() {
    const ids = proxies.filter((p) => p.uid && selected.has(p.uid) && p.id).map((p) => p.id!);
    try {
      for (const id of ids) await del(`/monitors/proxies/${id}`);
      setSelected(new Set());
      await load();
      toast.success(`${selected.size} proxy(s) removido(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover proxies");
    } finally {
      setBulkDeleteOpen(false);
    }
  }

  const pageUids = proxies.map((p) => p.uid).filter((u): u is string => !!u);
  const pageAllSelected = pageUids.length > 0 && pageUids.every((u) => selected.has(u));
  function togglePageSelection(checked: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      pageUids.forEach((u) => (checked ? n.add(u) : n.delete(u)));
      return n;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Network className="h-6 w-6" /> Proxies
        </h1>
        <p className="text-sm text-muted-foreground">
          Catálogo global de proxies reutilizáveis por vários monitores.
        </p>
      </div>

      <PageToolbar onRefresh={load} search={search} onSearch={setSearch} placeholder="Buscar proxy…">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button>
              Ações <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={add}>
              <Plus className="h-4 w-4" /> Novo proxy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Importar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setExportOpen(true)}>
              <Download className="h-4 w-4" /> Exportar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageToolbar>

      {meta === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Card key={i} className="h-64 animate-pulse" />)}</div>
      ) : proxies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {search ? "Nenhum proxy corresponde à busca." : "Nenhum proxy cadastrado. Use Ações → Novo proxy ou Importar."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={pageAllSelected}
                onCheckedChange={(v) => togglePageSelection(v === true)}
                aria-label="Selecionar página"
              />
              Selecionar página
            </label>
            {selected.size > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">{selected.size} selecionado(s)</span>
                <Button variant="secondary" size="sm" disabled={testing !== null} onClick={testSelected}>
                  <PlayCircle className="h-4 w-4" /> Testar selecionados
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" /> Deletar selecionados
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Limpar</Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {proxies.map((proxy, index) => (
              <ProxyCard
                key={proxy.uid ?? index}
                proxy={proxy}
                index={index}
                testing={testing}
                saving={savingIndex === index}
                selected={!!(proxy.uid && selected.has(proxy.uid))}
                onSelectedChange={(checked) => proxy.uid && toggleSelect(proxy.uid, checked)}
                onPatch={(value) => patch(index, value)}
                onDuplicate={() => duplicate(index)}
                onRemove={() => requestDelete(index)}
                onTest={() => test(proxy, index)}
                onSave={() => saveOne(index)}
              />
            ))}
          </div>

          <Pagination page={meta.page} pages={meta.pages} total={meta.total} onPage={setPage} />
        </>
      )}

      {importOpen && (
        <ImportDialog existing={proxies} onOpenChange={setImportOpen} onDone={() => { setImportOpen(false); load(); }} />
      )}
      {exportOpen && <ExportDialog onOpenChange={setExportOpen} />}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Remover proxy"
        description="Remover este proxy? Ele será desvinculado dos monitores que o usam."
        confirmLabel="Remover"
        onConfirm={confirmDelete}
      />
      <ConfirmDelete
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Remover proxies selecionados"
        description={`Remover ${selected.size} proxy(s)? Eles serão desvinculados dos monitores que os usam.`}
        confirmLabel="Remover"
        onConfirm={bulkDelete}
      />
    </div>
  );
}

function ImportDialog({ existing, onOpenChange, onDone }: {
  existing: ProxyDraft[];
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [defaultProtocol, setDefaultProtocol] = useState<ProxyProtocol>("socks5");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const needsType = hasSchemelessLines(text);
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  async function submit() {
    const { proxies: parsed, errors } = parseProxyLines(text, defaultProtocol);
    if (errors.length) return toast.error(errors.slice(0, 3).join(" · "));
    if (!parsed.length) return toast.error("Nada para importar.");
    const seen = new Set(existing.map(proxyEndpointKey));
    const dups: string[] = [];
    for (const p of parsed) {
      const key = proxyEndpointKey(p);
      if (seen.has(key)) dups.push(`${p.protocol}://${p.server}:${p.port}`);
      else seen.add(key);
    }
    if (dups.length) return toast.error(`Duplicado(s): ${dups.slice(0, 3).join(", ")}`);

    setBusy(true);
    setProgress({ done: 0, total: parsed.length });
    let done = 0;
    // Envia em paralelo, 3 requisições por vez, atualizando o progresso.
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < parsed.length) {
        const proxy = parsed[cursor++];
        await post("/monitors/proxies", proxyPayload(proxy));
        done += 1;
        setProgress({ done, total: parsed.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, parsed.length) }, worker));
      toast.success(`${parsed.length} proxy(s) importado(s)`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Falha ao importar (${done}/${parsed.length})`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar proxies</DialogTitle>
          <DialogDescription>Uma entrada por linha. Formatos aceitos:</DialogDescription>
        </DialogHeader>
        <pre className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
{`host:porta
host:porta:user:pass
socks5://host:porta:user:pass
http://user:pass@host:porta`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Prefixos aceitos: <code>http://</code>, <code>socks4://</code>, <code>socks5://</code>, <code>socks5h://</code>.
          Linhas sem prefixo usam o tipo escolhido abaixo.
        </p>
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder={"socks5://10.0.0.1:1080:user:senha\n10.0.0.1:1080\nhttp://user:senha@proxy.exemplo.com:8080"}
          spellCheck={false}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <label className={`text-sm ${needsType ? "font-medium" : "text-muted-foreground"}`}>
            Tipo das linhas sem prefixo
          </label>
          <Select
            value={defaultProtocol}
            onChange={(e) => setDefaultProtocol(e.target.value as ProxyProtocol)}
            disabled={busy}
            className="w-40"
          >
            {PROXY_PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        {progress && (
          <div className="space-y-1">
            <Progress value={pct} />
            <div className="text-right text-xs tabular-nums text-muted-foreground">
              {progress.done}/{progress.total} · {pct}%
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const [format, setFormat] = useState<"txt" | "json">("txt");
  const [all, setAll] = useState<ProxyDraft[] | null>(null);

  useEffect(() => {
    // exporta TODOS (não só a página) — busca a lista completa sob demanda.
    get<ProxyRow[]>("/monitors/proxies")
      .then((rows) => setAll(rows.map(rowToDraft)))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar proxies"));
  }, []);

  const content = all === null ? "" : format === "json" ? exportProxiesJson(all) : exportProxiesTxt(all);
  const masked = (all ?? []).some((p) => p.auth && p.password === "********");

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Exportar proxies</DialogTitle>
          <DialogDescription>{all === null ? "Carregando…" : `${all.length} proxy(s) no formato selecionado.`}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button variant={format === "txt" ? "default" : "outline"} size="sm" onClick={() => setFormat("txt")}>.txt</Button>
          <Button variant={format === "json" ? "default" : "outline"} size="sm" onClick={() => setFormat("json")}>.json</Button>
        </div>
        <Textarea readOnly rows={10} value={content} className="font-mono text-xs" />
        {masked && (
          <p className="text-xs text-warning">
            Senhas salvas ficam mascaradas e não são exportadas — informe-as de novo no destino.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={copy} disabled={all === null}>Copiar</Button>
          <Button disabled={all === null}
            onClick={() => download(`proxies.${format}`, content, format === "json" ? "application/json" : "text/plain")}>
            Baixar .{format}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
