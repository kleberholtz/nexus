import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronRight, Copy, File as FileIcon, Folder,
  FolderPlus, Home, Loader2, MoreVertical, Move, Pencil, RefreshCw, Trash2,
  Upload, UploadCloud, X,
} from "lucide-react";
import { ApiError, del, get, post, uploadWithProgress } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type FileEntry = {
  name: string;
  path: string;
  type: "dir" | "file" | "symlink";
  size: number;
  mtime: number;
  ext: string;
};

type PromptState =
  | { mode: "mkdir"; value: string }
  | { mode: "rename" | "move" | "copy"; entry: FileEntry; value: string }
  | null;

type UploadStatus = "queued" | "uploading" | "done" | "error";
type UploadItem = {
  id: string;
  name: string;
  dest: string;
  file: File;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
};

const errMsg = (e: unknown) =>
  e instanceof ApiError ? (e.messages[0]?.message ?? "Erro") : e instanceof Error ? e.message : "Erro";

const join = (...parts: string[]) => parts.filter(Boolean).join("/");
const parentOf = (p: string) => p.split("/").slice(0, -1).join("/");
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleString() : "—");

export function FileManager({ projectId, serviceId, canWrite }: {
  projectId: number;
  serviceId: number;
  canWrite: boolean;
}) {
  const base = `/projects/${projectId}/services/${serviceId}/files`;
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [confirmDel, setConfirmDel] = useState<FileEntry | null>(null);
  const [maxMb, setMaxMb] = useState(100);
  const [concurrency, setConcurrency] = useState(8);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragUpload, setDragUpload] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  const activeRef = useRef(0);
  const pathRef = useRef("");

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const data = await get<{ path: string; entries: FileEntry[]; upload?: { max_mb: number; concurrency: number } }>(
        `${base}?path=${encodeURIComponent(p)}`);
      setEntries(data.entries);
      setPath(data.path);
      pathRef.current = data.path;
      if (data.upload) { setMaxMb(data.upload.max_mb); setConcurrency(data.upload.concurrency); }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(""); }, [load, serviceId]);

  const crumbs = path ? path.split("/") : [];
  const doneCount = uploads.filter((u) => u.status === "done").length;
  const pendingCount = uploads.filter((u) => u.status === "queued" || u.status === "uploading").length;
  const totalBytes = uploads.reduce((s, u) => (u.status === "error" ? s : s + u.size), 0);
  const loadedBytes = uploads.reduce((s, u) => (u.status === "error" ? s : s + (u.size * u.progress) / 100), 0);
  const overall = totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : 0;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load(path);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function doMove(src: string, dst: string) {
    if (!src || src === dst) return;
    await run(() => post(`${base}/move`, { src, dst }), "Item movido");
  }

  function setItem(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) => {
      const next = prev.map((u) => (u.id === id ? { ...u, ...patch } : u));
      uploadsRef.current = next;
      return next;
    });
  }

  function pump() {
    while (activeRef.current < concurrency) {
      const next = uploadsRef.current.find((u) => u.status === "queued");
      if (!next) break;
      startUpload(next);
    }
  }

  function startUpload(item: UploadItem) {
    activeRef.current += 1;
    setItem(item.id, { status: "uploading", progress: 0 });
    const fd = new FormData();
    fd.append("path", item.dest);
    fd.append("files", item.file);
    fd.append("paths", item.name);
    const { promise } = uploadWithProgress(`${base}/upload`, fd, (loaded, total) => {
      setItem(item.id, { progress: total ? Math.round((loaded / total) * 100) : 0 });
    });
    promise
      .then(() => setItem(item.id, { status: "done", progress: 100 }))
      .catch((e) => setItem(item.id, { status: "error", error: errMsg(e) }))
      .finally(() => {
        activeRef.current -= 1;
        pump();
        if (activeRef.current === 0
          && !uploadsRef.current.some((u) => u.status === "queued" || u.status === "uploading")) {
          void load(pathRef.current);
        }
      });
  }

  function enqueueItems(files: { file: File; rel: string }[], dest: string) {
    if (!files.length) return;
    const limit = maxMb * 1024 * 1024;
    const items: UploadItem[] = files.map(({ file, rel }) => {
      const over = file.size > limit;
      return {
        id: crypto.randomUUID(),
        name: rel,
        dest,
        file,
        size: file.size,
        status: over ? "error" : "queued",
        progress: 0,
        error: over ? `excede o limite de ${maxMb}MB` : undefined,
      };
    });
    setUploads((prev) => {
      const next = [...prev, ...items];
      uploadsRef.current = next;
      return next;
    });
    setTimeout(pump, 0);
  }

  function enqueue(files: FileList | null, asFolder: boolean) {
    if (!files || !files.length) return;
    enqueueItems(
      Array.from(files).map((f) => ({
        file: f,
        rel: asFolder ? (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name : f.name,
      })),
      path,
    );
  }

  // Drag & drop do SO: percorre pastas via a File System API (webkitGetAsEntry).
  async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<{ file: File; rel: string }[]> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      return [{ file, rel: prefix + entry.name }];
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      await new Promise<void>((resolve, reject) => {
        const read = () => reader.readEntries((batch) => {
          if (!batch.length) { resolve(); return; }
          children.push(...batch);
          read();  // readEntries devolve em lotes; lê até esvaziar
        }, reject);
        read();
      });
      let out: { file: File; rel: string }[] = [];
      for (const child of children) out = out.concat(await walkEntry(child, `${prefix + entry.name}/`));
      return out;
    }
    return [];
  }

  function handleExternalDrop(dt: DataTransfer, dest: string) {
    // Captura os entries SINCRONAMENTE (só válidos durante o evento).
    const entries: FileSystemEntry[] = [];
    for (const it of Array.from(dt.items || [])) {
      if (it.kind === "file") {
        const entry = it.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    const fallback = Array.from(dt.files || []);
    void (async () => {
      let collected: { file: File; rel: string }[] = [];
      if (entries.length) {
        for (const e of entries) collected = collected.concat(await walkEntry(e, ""));
      } else {
        collected = fallback.map((f) => ({ file: f, rel: f.name }));
      }
      enqueueItems(collected, dest);
    })();
  }

  function clearFinished() {
    setUploads((prev) => {
      const next = prev.filter((u) => u.status === "queued" || u.status === "uploading");
      uploadsRef.current = next;
      return next;
    });
  }

  function submitPrompt() {
    if (!prompt) return;
    const value = prompt.value.trim();
    if (!value) return;
    if (prompt.mode === "mkdir") {
      void run(() => post(`${base}/folder`, { path, name: value }), "Pasta criada");
    } else if (prompt.mode === "rename") {
      const dst = join(parentOf(prompt.entry.path), value);
      void run(() => post(`${base}/move`, { src: prompt.entry.path, dst }), "Renomeado");
    } else if (prompt.mode === "move") {
      void run(() => post(`${base}/move`, { src: prompt.entry.path, dst: value }), "Item movido");
    } else if (prompt.mode === "copy") {
      void run(() => post(`${base}/copy`, { src: prompt.entry.path, dst: value }), "Item copiado");
    }
    setPrompt(null);
  }

  const promptTitle = prompt?.mode === "mkdir" ? "Nova pasta"
    : prompt?.mode === "rename" ? "Renomear"
      : prompt?.mode === "move" ? "Mover para"
        : "Copiar para";
  const promptLabel = prompt?.mode === "mkdir" || prompt?.mode === "rename"
    ? "Nome" : "Caminho de destino";

  const hasFiles = (dt: DataTransfer) => Array.from(dt.types || []).includes("Files");

  return (
    <div className="space-y-3"
      onDragOver={(e) => { if (canWrite && hasFiles(e.dataTransfer)) { e.preventDefault(); setDragUpload(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragUpload(false); }}
      onDrop={(e) => {
        if (canWrite && hasFiles(e.dataTransfer)) {
          e.preventDefault();
          setDragUpload(false);
          handleExternalDrop(e.dataTransfer, path);
        }
      }}>
      {/* Header: navegação + ações */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
          <button className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
            onClick={() => void load("")}
            onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDropTarget("/"); } }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              setDropTarget(null);
              if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); setDragUpload(false); handleExternalDrop(e.dataTransfer, ""); return; }
              void doMove(e.dataTransfer.getData("text/path"), "");
            }}
            data-active={dropTarget === "/"}>
            <Home className="h-3.5 w-3.5" /> raiz
          </button>
          {crumbs.map((seg, i) => {
            const segPath = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={segPath} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                <button className="rounded px-1.5 py-0.5 hover:bg-muted data-[active=true]:bg-primary/20"
                  onClick={() => void load(segPath)}
                  onDragOver={(e) => { if (canWrite) { e.preventDefault(); setDropTarget(segPath); } }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    setDropTarget(null);
                    if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); setDragUpload(false); handleExternalDrop(e.dataTransfer, segPath); return; }
                    void doMove(e.dataTransfer.getData("text/path"), segPath);
                  }}
                  data-active={dropTarget === segPath}>
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(path)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={() => setPrompt({ mode: "mkdir", value: "" })}>
                <FolderPlus className="h-4 w-4" /> Nova pasta
              </Button>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={() => fileInput.current?.click()}>
                <Upload className="h-4 w-4" /> Upload
              </Button>
              <Button variant="outline" size="sm" disabled={busy}
                onClick={() => folderInput.current?.click()}>
                <UploadCloud className="h-4 w-4" /> Upload pasta
              </Button>
            </>
          )}
        </div>
      </div>

      <input ref={fileInput} type="file" multiple className="hidden"
        onChange={(e) => { enqueue(e.target.files, false); e.target.value = ""; }} />
      <input ref={folderInput} type="file" multiple className="hidden"
        // @ts-expect-error atributos não-padrão de upload de diretório
        webkitdirectory="" directory=""
        onChange={(e) => { enqueue(e.target.files, true); e.target.value = ""; }} />

      {/* Fila de uploads (progresso por arquivo + geral) */}
      {uploads.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              Uploads — {doneCount}/{uploads.length} concluído(s)
              {pendingCount > 0 && <span className="text-muted-foreground"> · {pendingCount} na fila</span>}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                até {maxMb}MB · {concurrency} em paralelo
              </span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">{overall}%</span>
              <Button variant="ghost" size="sm" onClick={clearFinished} disabled={pendingCount === uploads.length}>
                <X className="h-4 w-4" /> Limpar concluídos
              </Button>
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${overall}%` }} />
          </div>
          <div className="max-h-48 space-y-1.5 overflow-auto">
            {uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-xs">
                {u.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  : u.status === "error" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    : u.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                      : <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate" title={u.name}>{u.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(u.size)}</span>
                <div className="hidden h-1 w-24 shrink-0 overflow-hidden rounded bg-muted sm:block">
                  <div className={`h-full ${u.status === "error" ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${u.status === "error" ? 100 : u.progress}%` }} />
                </div>
                <span className="w-24 shrink-0 truncate text-right text-muted-foreground"
                  title={u.status === "error" ? u.error : undefined}>
                  {u.status === "error" ? (u.error || "erro")
                    : u.status === "done" ? "concluído"
                      : u.status === "uploading" ? `${u.progress}%` : "na fila"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Listagem */}
      <div className={`rounded-md border transition-colors ${dragUpload ? "border-primary ring-2 ring-primary/40" : ""}`}>
        {dragUpload && (
          <div className="flex items-center justify-center gap-2 border-b bg-primary/5 py-2 text-xs font-medium text-primary">
            <UploadCloud className="h-4 w-4" /> Solte para enviar para {path ? `/${path}` : "a raiz"}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-24">Tipo</TableHead>
              <TableHead className="w-28 text-right">Tamanho</TableHead>
              <TableHead className="w-48">Modificado</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Carregando…" : "Pasta vazia — faça upload ou crie uma pasta."}
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => {
              const isDir = e.type === "dir";
              return (
                <TableRow key={e.path}
                  draggable={canWrite}
                  onDragStart={(ev) => ev.dataTransfer.setData("text/path", e.path)}
                  onDragOver={(ev) => { if (canWrite && isDir) { ev.preventDefault(); setDropTarget(e.path); } }}
                  onDragLeave={() => dropTarget === e.path && setDropTarget(null)}
                  onDrop={(ev) => {
                    if (!isDir) return;
                    setDropTarget(null);
                    if (hasFiles(ev.dataTransfer)) {  // arquivos do SO → upload p/ dentro da pasta
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDragUpload(false);
                      handleExternalDrop(ev.dataTransfer, e.path);
                      return;
                    }
                    void doMove(ev.dataTransfer.getData("text/path"), e.path);
                  }}
                  data-drop={dropTarget === e.path}
                  className="data-[drop=true]:bg-primary/10">
                  <TableCell>
                    <button className="inline-flex items-center gap-2 text-left disabled:cursor-default"
                      disabled={!isDir}
                      onClick={() => isDir && void load(e.path)}>
                      {isDir
                        ? <Folder className="h-4 w-4 shrink-0 text-primary" />
                        : <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className={isDir ? "font-medium hover:underline" : ""}>{e.name}</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {isDir ? "pasta" : (e.ext || "arquivo")}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {isDir ? "—" : formatBytes(e.size)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(e.mtime)}</TableCell>
                  <TableCell>
                    {canWrite && (
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setPrompt({ mode: "rename", entry: e, value: e.name })}>
                            <Pencil className="h-4 w-4" /> Renomear
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setPrompt({ mode: "move", entry: e, value: path })}>
                            <Move className="h-4 w-4" /> Mover
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setPrompt({ mode: "copy", entry: e, value: join(path, `copia-${e.name}`) })}>
                            <Copy className="h-4 w-4" /> Copiar
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDel(e)}>
                            <Trash2 className="h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Arraste um item para uma pasta (ou para a trilha acima) para mover. Arquivos ficam em
        <code className="mx-1 rounded bg-muted px-1 py-0.5">/var/www/apps</code>.
      </p>

      {/* Prompt (nova pasta / renomear / mover / copiar) */}
      <Dialog open={!!prompt} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{promptTitle}</DialogTitle>
            {prompt && prompt.mode !== "mkdir" && (
              <DialogDescription className="font-mono text-xs">{prompt.entry.path}</DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{promptLabel}</Label>
            <Input autoFocus value={prompt?.value ?? ""}
              onChange={(ev) => setPrompt((p) => (p ? { ...p, value: ev.target.value } : p))}
              onKeyDown={(ev) => ev.key === "Enter" && submitPrompt()}
              className="font-mono text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>Cancelar</Button>
            <Button onClick={submitPrompt} disabled={busy || !prompt?.value.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir item</DialogTitle>
            <DialogDescription className="font-mono text-xs">{confirmDel?.path}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmDel?.type === "dir"
              ? "A pasta e todo o seu conteúdo serão removidos. Esta ação não pode ser desfeita."
              : "O arquivo será removido. Esta ação não pode ser desfeita."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy}
              onClick={() => {
                const target = confirmDel;
                setConfirmDel(null);
                if (target) void run(() => del(`${base}?path=${encodeURIComponent(target.path)}`), "Item removido");
              }}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
