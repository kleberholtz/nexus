import { useEffect, useState } from "react";
import { Cloud, FileText, Loader2, RotateCw, Save, Trash2 } from "lucide-react";
import { ApiError, api, get, post, put } from "@/lib/api";
import { S3Config } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

type Values = {
  log_rotate_enabled: boolean;
  log_rotate_max_mb: number;
  log_rotate_keep: number;
  log_rotate_interval_min: number;
  log_compress: boolean;
  log_s3_enabled: boolean;
  log_s3_config_id: number;
};

type SettingsResp = {
  values: Record<string, number | string | boolean>;
  limits: Record<string, { min: number; max: number }>;
};

type LogFile = {
  name: string;
  path: string;
  kind: "access" | "error";
  current: boolean;
  size: number;
  mtime: number;
  s3: {
    status: "available" | "missing" | "disabled" | "not_applicable" | "error";
    key?: string;
    error?: string;
  };
};

type LogFilesResp = {
  s3_enabled: boolean;
  s3_config_id: number;
  s3_label: string;
  files: LogFile[];
};

const NUMS: (keyof Values)[] = ["log_rotate_max_mb", "log_rotate_keep", "log_rotate_interval_min"];

export function LogsSettingsCard() {
  const [v, setV] = useState<Values | null>(null);
  const [limits, setLimits] = useState<SettingsResp["limits"]>({});
  const [s3, setS3] = useState<S3Config[]>([]);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    Promise.all([get<SettingsResp>("/settings"), get<S3Config[]>("/s3/configs").catch(() => [])])
      .then(([s, cfgs]) => {
        const val = s.values;
        setV({
          log_rotate_enabled: !!val.log_rotate_enabled,
          log_rotate_max_mb: Number(val.log_rotate_max_mb),
          log_rotate_keep: Number(val.log_rotate_keep),
          log_rotate_interval_min: Number(val.log_rotate_interval_min),
          log_compress: !!val.log_compress,
          log_s3_enabled: !!val.log_s3_enabled,
          log_s3_config_id: Number(val.log_s3_config_id),
        });
        setLimits(s.limits);
        setS3(cfgs);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"));
  }, []);

  function set<K extends keyof Values>(k: K, val: Values[K]) {
    setV((cur) => (cur ? { ...cur, [k]: val } : cur));
  }

  async function save() {
    if (!v) return;
    for (const k of NUMS) {
      const lim = limits[k];
      const n = v[k] as number;
      if (lim && (n < lim.min || n > lim.max)) {
        toast.error(`${k} deve estar entre ${lim.min} e ${lim.max}`);
        return;
      }
    }
    if (v.log_s3_enabled && !v.log_s3_config_id) {
      toast.error("Selecione uma configuração S3 para o envio.");
      return;
    }
    setSaving(true);
    try {
      await put("/settings", v);
      toast.success("Configurações de logs salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function rotateNow() {
    setRotating(true);
    try {
      const r = await post<{ rotated: boolean; file?: string }>("/logs/rotate");
      toast.success(r.rotated ? `Rotacionado: ${r.file}` : "Nada a rotacionar");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao rotacionar");
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rotação de logs</CardTitle>
          <CardDescription>
            Rotaciona o access.log por tamanho, comprime (gzip) e opcionalmente envia ao S3.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!v ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <Switch checked={v.log_rotate_enabled}
                  onCheckedChange={(c) => set("log_rotate_enabled", !!c)} />
                <span className="text-sm font-medium">Rotação automática habilitada</span>
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="max-mb">Tamanho máx. (MB)</Label>
                  <Input id="max-mb" type="number" value={v.log_rotate_max_mb}
                    min={limits.log_rotate_max_mb?.min} max={limits.log_rotate_max_mb?.max}
                    onChange={(e) => set("log_rotate_max_mb", Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="keep">Manter (arquivos)</Label>
                  <Input id="keep" type="number" value={v.log_rotate_keep}
                    min={limits.log_rotate_keep?.min} max={limits.log_rotate_keep?.max}
                    onChange={(e) => set("log_rotate_keep", Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="interval">Checar a cada (min)</Label>
                  <Input id="interval" type="number" value={v.log_rotate_interval_min}
                    min={limits.log_rotate_interval_min?.min} max={limits.log_rotate_interval_min?.max}
                    onChange={(e) => set("log_rotate_interval_min", Number(e.target.value))} />
                </div>
              </div>

              <label className="flex items-center gap-2">
                <Switch checked={v.log_compress} onCheckedChange={(c) => set("log_compress", !!c)} />
                <span className="text-sm">Comprimir rotacionados (gzip)</span>
              </label>

              <div className="space-y-3 rounded-md border p-3">
                <label className="flex items-center gap-2">
                  <Switch checked={v.log_s3_enabled} onCheckedChange={(c) => set("log_s3_enabled", !!c)} />
                  <span className="text-sm font-medium">Enviar rotacionados ao S3</span>
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="s3-cfg">Destino S3</Label>
                  <Select id="s3-cfg" value={String(v.log_s3_config_id)}
                    onChange={(e) => set("log_s3_config_id", Number(e.target.value))}
                    disabled={!v.log_s3_enabled}>
                    <option value="0">— selecione —</option>
                    {s3.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} ({c.config.bucket})</option>
                    ))}
                  </Select>
                  {s3.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma configuração S3. Crie na aba <strong>S3</strong>.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
                <Button variant="outline" onClick={rotateNow} disabled={rotating}>
                  {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                  Rotacionar agora
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <LogFilesCard />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ts));
}

function s3Badge(file: LogFile) {
  switch (file.s3.status) {
    case "available":
      return <Badge variant="success">Disponível</Badge>;
    case "missing":
      return <Badge variant="warning">Ausente</Badge>;
    case "disabled":
      return <Badge variant="muted">S3 desligado</Badge>;
    case "error":
      return <Badge variant="destructive">Erro</Badge>;
    default:
      return <Badge variant="outline">Não se aplica</Badge>;
  }
}

function canRetry(file: LogFile, data: LogFilesResp): boolean {
  return !!file.s3.key && file.s3.status !== "available" && data.s3_config_id > 0;
}

function canDeleteLocal(file: LogFile, data: LogFilesResp): boolean {
  return !!file.s3.key && file.s3.status === "available" && data.s3_config_id > 0;
}

function LogFilesCard() {
  const [data, setData] = useState<LogFilesResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    get<LogFilesResp>("/logs/files")
      .then(setData)
      .catch((e) => {
        const message =
          e instanceof ApiError && e.status === 404
            ? "A API em execução ainda não possui /logs/files. Reinicie ou reconstrua o backend para carregar a nova rota."
            : e instanceof Error ? e.message : "Falha ao carregar arquivos";
        setError(message);
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function retryUpload(file: LogFile) {
    setRetrying(file.name);
    try {
      await post("/logs/files/retry", { name: file.name });
      toast.success(`Reenviado ao S3: ${file.name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reenviar para o S3");
    } finally {
      setRetrying(null);
    }
  }

  async function deleteLocal(file: LogFile) {
    setDeleting(file.name);
    try {
      await api("/logs/files/local", { method: "DELETE", body: { name: file.name } });
      toast.success(`Arquivo local removido: ${file.name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover arquivo local");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-primary" />
              Arquivos de log
            </CardTitle>
            <CardDescription>
              Arquivos locais de access/error log e disponibilidade dos rotacionados no S3.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Cloud className="h-4 w-4" />
          {data?.s3_enabled
            ? `Destino S3: ${data.s3_label || `#${data.s3_config_id}`}`
            : "Envio S3 desabilitado"}
        </div>
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Tentar novamente
            </Button>
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{loading ? "Carregando…" : "Nenhum dado carregado."}</p>
        ) : data.files.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum arquivo de log encontrado.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">Arquivo</TableHead>
                <TableHead className="w-[130px]">Tipo</TableHead>
                <TableHead className="w-[110px]">Tamanho</TableHead>
                <TableHead className="w-[150px]">Modificado</TableHead>
                <TableHead className="min-w-[260px]">S3</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.files.map((file) => (
                <TableRow key={file.path}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-mono text-xs">{file.name}</div>
                      <div className="max-w-[360px] truncate text-xs text-muted-foreground">{file.path}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={file.kind === "access" ? "info" : "secondary"}>
                        {file.kind}
                      </Badge>
                      {file.current && <Badge variant="outline">atual</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{formatBytes(file.size)}</TableCell>
                  <TableCell>{formatDate(file.mtime)}</TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {s3Badge(file)}
                        {canRetry(file, data) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => retryUpload(file)}
                            disabled={retrying === file.name}
                          >
                            {retrying === file.name ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="h-3.5 w-3.5" />
                            )}
                            Reenviar
                          </Button>
                        )}
                        {canDeleteLocal(file, data) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => deleteLocal(file)}
                            disabled={deleting === file.name}
                          >
                            {deleting === file.name ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Excluir local
                          </Button>
                        )}
                      </div>
                      {file.s3.key && (
                        <div className="max-w-[340px] truncate font-mono text-xs text-muted-foreground">
                          {file.s3.key}
                        </div>
                      )}
                      {file.s3.error && (
                        <div className="max-w-[340px] truncate text-xs text-destructive">
                          {file.s3.error}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
