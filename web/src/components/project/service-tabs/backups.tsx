import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Copy, Database, Loader2,
  RefreshCw, Rocket, RotateCw, ScrollText, Trash2, Upload,
} from "lucide-react";
import { del, get, post, put, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { copyText, formatBytes } from "@/lib/utils";
import type { S3Config } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { BlockHeader } from "../block-header";

type BackupItem = {
  id: string;
  name: string;
  ts: number;
  engine: string;
  database: string;
  compress: boolean;
  compression_method: string;
  compression_level: number | null;
  encrypted: boolean;
  elapsed_ms: number;
  original_size: number;
  compressed_size: number;
  compression_ratio: number;
  sha256: string;
  parts: number;
  split_size_mb: number;
  size: number;
  local: { available: boolean; path: string; paths?: string[] };
  s3: { available: boolean; key: string; keys?: string[]; config_id: number | null; error?: string };
};
type BackupCompressionMethod = {
  value: string;
  extension: string;
  min_level: number;
  max_level: number;
  default_level: number;
};
type BackupDatabaseOption = {
  value: string;
  label: string;
};
type BackupSettings = {
  s3_enabled: boolean;
  s3_config_id: number | null;
  compress: boolean;
  database: string;
  database_options: BackupDatabaseOption[];
  file_format: string;
  compression_method: string;
  compression_level: number;
  compression_methods: BackupCompressionMethod[];
  name_variables: string[];
  local_retention: number;
  s3_retention: number;
  split_size_mb: number;
  split_sizes_mb: number[];
  encryption_enabled: boolean;
  schedule_enabled: boolean;
  schedule_cron: string;
  s3_configs: S3Config[];
};

type BackupList = {
  items: BackupItem[];
  pagination: { page: number; page_size: number; total: number; pages: number };
  settings: BackupSettings;
};

type BackupProgress = {
  seq: number;
  status: string;
  percent: number;
  message: string;
  backup?: BackupItem;
};
type RestoreProgress = BackupProgress & { backup_id?: string };

function formatBackupDate(ts: number): string {
  return ts ? new Date(ts).toLocaleString() : "-";
}

function formatElapsed(ms: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

const BACKUP_COMPRESSION_COPY: Record<string, { label: string; description: string; tooltip: string }> = {
  zip: {
    label: "ZIP",
    description: "Arquivo amplamente compatível para troca e inspeção manual.",
    tooltip: "Bom quando o backup precisa ser aberto em muitas ferramentas. A compressão costuma ser moderada.",
  },
  bzip2: {
    label: "Bzip2",
    description: "Compressão maior que gzip, geralmente mais lenta.",
    tooltip: "Útil para economizar espaço em backups menos frequentes. Usa níveis de 1 a 9.",
  },
  gzip: {
    label: "Gzip",
    description: "Padrão equilibrado entre velocidade e tamanho.",
    tooltip: "Escolha segura para bancos SQL e compatível com praticamente qualquer ambiente Unix.",
  },
  "7z": {
    label: "7z",
    description: "Alta compactação em formato 7-Zip.",
    tooltip: "Requer o binário 7z/7zz/7za instalado no backend. Bom para priorizar tamanho menor.",
  },
  xz: {
    label: "XZ",
    description: "Compressão forte com custo maior de CPU.",
    tooltip: "Boa para arquivamento frio. Níveis altos podem consumir bastante memória e tempo.",
  },
  zstd: {
    label: "Zstandard",
    description: "Compressão moderna, rápida e ajustável.",
    tooltip: "Requer o binário zstd instalado no backend. Níveis baixos são muito rápidos; altos priorizam tamanho.",
  },
};

const BACKUP_NAME_VARIABLES: Record<string, string> = {
  "{name}": "Slug do serviço.",
  "{date}": "Data UTC no formato YYYYMMDD.",
  "{time}": "Hora UTC no formato HHMMSS.",
  "{datetime}": "Data e hora UTC no formato YYYYMMDD-HHMMSS.",
  "{hostname}": "Hostname da máquina que executa o backend.",
  "{server}": "Nome do container/servidor do serviço.",
  "{uuid}": "Identificador único do backup.",
  "{version}": "Versão configurada do banco, ou engine quando não houver versão.",
  "{random}": "Sufixo aleatório curto.",
};

const CRON_PRESETS = [
  { value: "0 3 * * *", label: "Diário às 03:00", description: "Executa uma vez por dia, de madrugada." },
  { value: "0 */6 * * *", label: "A cada 6 horas", description: "Executa quatro backups por dia." },
  { value: "0 */12 * * *", label: "A cada 12 horas", description: "Executa dois backups por dia." },
  { value: "0 3 * * 0", label: "Domingo às 03:00", description: "Executa uma vez por semana, no domingo." },
  { value: "0 3 1 * *", label: "Dia 1 às 03:00", description: "Executa uma vez por mês, no primeiro dia." },
  { value: "30 2 * * 1-5", label: "Dias úteis às 02:30", description: "Executa de segunda a sexta." },
  { value: "0 1,13 * * *", label: "01:00 e 13:00", description: "Executa duas vezes ao dia em horários fixos." },
  { value: "*/30 * * * *", label: "A cada 30 minutos", description: "Executa frequentemente; use apenas para bases pequenas." },
];

function backupSettingsFallback(): BackupSettings {
  return {
    s3_enabled: false,
    s3_config_id: null,
    compress: true,
    database: "",
    database_options: [],
    file_format: "backup-{name}-{datetime}",
    compression_method: "gzip",
    compression_level: 6,
    compression_methods: [],
    name_variables: Object.keys(BACKUP_NAME_VARIABLES).map((v) => v.slice(1, -1)),
    local_retention: 10,
    s3_retention: 20,
    split_size_mb: 0,
    split_sizes_mb: [0, 1024, 2048, 4096, 8192],
    encryption_enabled: false,
    schedule_enabled: false,
    schedule_cron: "",
    s3_configs: [],
  };
}

export function BackupsTab({ base, isDatabase }: { base: string; isDatabase: boolean }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [restoreJobId, setRestoreJobId] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreDrawerOpen, setRestoreDrawerOpen] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);
  const [restoreEvents, setRestoreEvents] = useState<RestoreProgress[]>([]);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupItem | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const { data: backups, loading, reload } = useData<BackupList>(
    () => get<BackupList>(`${base}/backups?page=${page}&page_size=${pageSize}`).catch(() => ({
      items: [],
      pagination: { page: 1, page_size: pageSize, total: 0, pages: 1 },
      settings: backupSettingsFallback(),
    })), [base, page],
  );
  // A mesma lista paginada alimenta listagem e restauração. Evita baixar até 100
  // registros antecipadamente só para uma ação que talvez nem seja usada.
  const restoreLoading = loading;
  const reloadRestoreBackups = reload;
  const [settings, setSettings] = useState<BackupSettings | null>(null);

  useEffect(() => {
    if (backups?.settings) setSettings(backups.settings);
  }, [backups]);

  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(streamUrl(`${base}/backup/jobs/${jobId}/stream`));
    let failed = false;
    let closedByClient = false;
    const closeStream = () => {
      closedByClient = true;
      es.close();
      setBusy(false);
      setJobId("");
    };
    es.addEventListener("progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as BackupProgress;
      setProgress(data);
      if (data.status === "failed") {
        failed = true;
        toast.error(data.message || "Falha no backup");
        closeStream();
      }
    });
    es.addEventListener("error", (ev) => {
      const message = "data" in ev
        ? String((ev as MessageEvent).data || "")
        : "";
      if (message) {
        try {
          const data = JSON.parse(message) as { message?: string };
          setProgress({ seq: 0, status: "failed", percent: 100, message: data.message || "Falha no stream do backup" });
          toast.error(data.message || "Falha no stream do backup");
        } catch {
          setProgress({ seq: 0, status: "failed", percent: 100, message });
          toast.error(message);
        }
        failed = true;
        closeStream();
      }
    });
    es.addEventListener("end", () => {
      closeStream();
      reload();
      reloadRestoreBackups();
      if (!failed) toast.success("Backup concluído");
    });
    es.onerror = () => {
      if (closedByClient || failed) return;
      es.close();
      setBusy(false);
      setJobId("");
      toast.error("Conexão com o progresso do backup caiu");
    };
    return () => {
      closedByClient = true;
      es.close();
    };
  }, [base, jobId, reload]);

  useEffect(() => {
    if (!restoreJobId) return;
    const es = new EventSource(streamUrl(`${base}/backup/restore-jobs/${restoreJobId}/stream`));
    let failed = false;
    let closedByClient = false;
    const closeStream = () => {
      closedByClient = true;
      es.close();
      setRestoreBusy(false);
      setRestoreJobId("");
    };
    const pushEvent = (data: RestoreProgress) => {
      setRestoreProgress(data);
      setRestoreEvents((prev) => [...prev.slice(-99), data]);
    };
    es.addEventListener("progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as RestoreProgress;
      pushEvent(data);
      if (data.status === "failed") {
        failed = true;
        toast.error(data.message || "Falha na restauração");
        closeStream();
      }
    });
    es.addEventListener("error", (ev) => {
      const message = "data" in ev ? String((ev as MessageEvent).data || "") : "";
      if (!message) return;
      let text = message;
      try {
        text = (JSON.parse(message) as { message?: string }).message || message;
      } catch { /* mantém texto cru */ }
      pushEvent({ seq: 0, status: "failed", percent: 100, message: text });
      failed = true;
      toast.error(text);
      closeStream();
    });
    es.addEventListener("end", () => {
      closeStream();
      if (!failed) toast.success("Backup restaurado");
    });
    es.onerror = () => {
      if (closedByClient || failed) return;
      es.close();
      setRestoreBusy(false);
      setRestoreJobId("");
      toast.error("Conexão com o progresso da restauração caiu");
    };
    return () => {
      closedByClient = true;
      es.close();
    };
  }, [base, restoreJobId]);

  async function runBackup() {
    setBusy(true);
    setProgress({ seq: 0, status: "queued", percent: 0, message: "Iniciando backup" });
    try {
      const job = await post<{ job_id: string; status: string }>(`${base}/backup`);
      setJobId(job.job_id);
      toast.success("Backup iniciado");
    }
    catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Falha no backup");
    }
  }

  async function saveSettings(patch: Partial<BackupSettings>) {
    const next = { ...(settings ?? backups?.settings), ...patch } as BackupSettings;
    setSettings(next);
    try {
      const saved = await put<BackupSettings>(`${base}/backup-settings`, {
        s3_enabled: next.s3_enabled,
        s3_config_id: next.s3_config_id,
        compress: next.compress,
        database: next.database,
        file_format: next.file_format,
        compression_method: next.compression_method,
        compression_level: next.compression_level,
        local_retention: next.local_retention,
        s3_retention: next.s3_retention,
        split_size_mb: next.split_size_mb,
        encryption_enabled: next.encryption_enabled,
        schedule_enabled: next.schedule_enabled,
        schedule_cron: next.schedule_cron,
      });
      setSettings({
        ...next,
        ...saved,
        s3_configs: next.s3_configs,
        compression_methods: saved.compression_methods?.length ? saved.compression_methods : next.compression_methods,
        database_options: saved.database_options?.length ? saved.database_options : next.database_options,
      });
      toast.success("Configurações de backup salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar configurações");
      reload();
    }
  }

  async function uploadBackup(item: BackupItem) {
    try {
      await post(`${base}/backups/${encodeURIComponent(item.id)}/upload`);
      toast.success("Backup enviado ao S3");
      reload();
      reloadRestoreBackups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar backup");
    }
  }

  async function removeBackup(item: BackupItem) {
    try {
      await del(`${base}/backups/${encodeURIComponent(item.id)}`);
      toast.success("Backup removido");
      if (backups?.items.length === 1 && page > 1) setPage((p) => p - 1);
      reload();
      reloadRestoreBackups();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover backup");
    }
  }

  async function restoreBackup(item: BackupItem) {
    setRestoreBusy(true);
    setRestoreDrawerOpen(true);
    const initial = { seq: 0, status: "queued", percent: 0, message: `Iniciando restauração de ${item.name}` };
    setRestoreProgress(initial);
    setRestoreEvents([initial]);
    try {
      const job = await post<{ job_id: string; status: string }>(`${base}/backups/${encodeURIComponent(item.id)}/restore`);
      setRestoreJobId(job.job_id);
      toast.success("Restauração iniciada");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao iniciar restauração";
      setRestoreBusy(false);
      const failed = { seq: 0, status: "failed", percent: 100, message };
      setRestoreProgress(failed);
      setRestoreEvents((prev) => [...prev, failed]);
      toast.error(message);
    }
  }

  if (!isDatabase) {
    return <Card className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ScrollText className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Backups indisponíveis</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Os backups só estão disponíveis para serviços de banco de dados. Para serviços de arquivos, você pode usar o recurso de snapshots.
        </p>
      </div>
    </Card>;
  }
  if (loading) return <Skeleton className="h-24 w-full" />;
  const cfg = settings ?? backups?.settings;
  const s3Configs = cfg?.s3_configs ?? [];
  const compressionMethods = cfg?.compression_methods?.length
    ? cfg.compression_methods
    : Object.keys(BACKUP_COMPRESSION_COPY).map((value) => ({
      value, extension: value === "bzip2" ? "bz2" : value === "gzip" ? "gz" : value === "zstd" ? "zst" : value,
      min_level: value === "bzip2" || value === "zstd" ? 1 : 0,
      max_level: value === "zstd" ? 22 : 9,
      default_level: value === "zstd" ? 3 : value === "7z" ? 5 : 6,
    }));
  const selectedMethod = compressionMethods.find((m) => m.value === cfg?.compression_method) ?? compressionMethods[0] ?? {
    value: "gzip", extension: "gz", min_level: 0, max_level: 9, default_level: 6,
  };
  const selectedCopy = BACKUP_COMPRESSION_COPY[selectedMethod?.value ?? "gzip"] ?? BACKUP_COMPRESSION_COPY.gzip;
  const splitPresetValues = [0, 1024, 2048, 4096, 8192];
  const currentSplitSize = cfg?.split_size_mb ?? 0;
  const splitIsCustom = !splitPresetValues.includes(currentSplitSize);
  const selectedCronPreset = CRON_PRESETS.find((preset) => preset.value === cfg?.schedule_cron);
  const restoreItems = (backups?.items ?? []).filter((item) => (
    item.local.available || item.s3.available || !!item.s3.key || !!item.s3.keys?.length
  ));
  const pagination = backups?.pagination ?? { page, page_size: pageSize, total: backups?.items.length ?? 0, pages: 1 };
  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <BlockHeader title="Backups" description="Gera uma cópia independente dos dados, configurações e arquivos selecionados, permitindo restaurar a aplicação mesmo após falhas no servidor ou no armazenamento original." />
          <Button onClick={runBackup} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Fazer backup agora
          </Button>
        </div>
        {progress && busy && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{progress.message}</span>
              <span className="text-muted-foreground">{progress.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        )}
        {backups && backups.items.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            <div className="hidden gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[1fr_1.4fr_1fr_1.1fr_.8fr_1fr]">
              <span>Data</span>
              <span>Backup</span>
              <span>Detalhes</span>
              <span>Tamanhos</span>
              <span>S3</span>
              <span className="text-right">Ações</span>
            </div>
            {backups.items.map((b) => (
              <div key={b.id} className="grid grid-cols-1 gap-3 border-b px-3 py-3 text-sm last:border-b-0 lg:grid-cols-[1fr_1.4fr_1fr_1.1fr_.8fr_1fr] lg:items-center">
                <span className="text-muted-foreground">{formatBackupDate(b.ts)}</span>
                <div className="min-w-0 space-y-1">
                  <code className="block truncate font-mono text-xs">{b.name}</code>
                  <span className="text-xs text-muted-foreground">{formatElapsed(b.elapsed_ms)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {b.compress ? (
                    <Badge variant="success">
                      {BACKUP_COMPRESSION_COPY[b.compression_method]?.label ?? (b.compression_method || "gzip")}
                      {b.compression_level !== null && b.compression_level !== undefined ? ` ${b.compression_level}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="muted">Sem compressão</Badge>
                  )}
                  {b.encrypted && <Badge variant="info">Criptografado</Badge>}
                  {b.parts > 1 && <Badge variant="warning">{b.parts} partes</Badge>}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div>Original: {formatBytes(b.original_size)}</div>
                  <div>Final: {formatBytes(b.compressed_size)}</div>
                  {!!b.compression_ratio && <Badge variant="muted">Taxa {b.compression_ratio}x</Badge>}
                </div>
                <span>
                  {b.s3.available ? (
                    <Badge variant="success">Disponível</Badge>
                  ) : (
                    <Badge variant={b.s3.error ? "destructive" : "muted"}>{b.s3.error ? "Erro" : "Não enviado"}</Badge>
                  )}
                </span>
                <div className="flex justify-start gap-2 lg:justify-end">
                  {!!b.sha256 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => copyText(b.sha256)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copiar SHA-256</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!b.s3.available && b.local.available && (
                    <Button variant="outline" size="sm" onClick={() => uploadBackup(b)}>
                      <Upload className="h-4 w-4" /> Enviar S3
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => removeBackup(b)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-3 border-t bg-muted/20 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="text-muted-foreground">
                {pagination.total} backup{pagination.total === 1 ? "" : "s"} · página {pagination.page} de {pagination.pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-md border border-dashed px-4 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Database className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="font-semibold">Nenhum backup ainda</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Execute o primeiro backup para criar um ponto de restauração deste serviço.
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <BlockHeader title="Schedule" description="Rotina para criação automática de backups deste serviço. A execução só ocorre quando o container está rodando." />
          <Switch checked={!!cfg?.schedule_enabled}
            onCheckedChange={(v) => saveSettings({
              schedule_enabled: v,
              schedule_cron: cfg?.schedule_cron?.trim() || "0 3 * * *",
            })}
          />
        </div>
        {!!cfg?.schedule_enabled && (<>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="space-y-1.5">
              <LabelWithHelp
                label="Preset de rotina"
                help={CRON_PRESETS.map((preset) => `${preset.value}: ${preset.label} - ${preset.description}`).join("\n")}
              />
              <Select
                value={selectedCronPreset?.value ?? "custom"}
                onChange={(e) => {
                  if (!cfg) return;
                  if (e.target.value === "custom") return;
                  setSettings({ ...cfg, schedule_cron: e.target.value });
                }}
              >
                {CRON_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
                <option value="custom">Custom</option>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedCronPreset?.description ?? "Informe uma expressão cron manual com 5 campos."}
              </p>
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp
                label="Cron expression"
                help="Define a rotina de execução do snapshot. Use 5 campos separados por espaço: minuto, hora, dia do mês, mês e dia da semana. Exemplo: '0 2 * * *' executa todo dia às 2h da manhã."
              />
              <Input value={cfg.schedule_cron}
                onChange={(e) => setSettings({ ...cfg, schedule_cron: e.target.value })}
                placeholder="0 3 * * *" className="font-mono text-xs" />
            </div>
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button onClick={() => saveSettings({
              schedule_cron: cfg.schedule_cron
            })}>Salvar</Button>
          </div>
        </>)}
      </Card>

      <Card className="space-y-4 p-5">
        <BlockHeader title="Configuração do backup" description="Formato do arquivo e compactação usada nos próximos backups." />
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-1.5">
            <LabelWithHelp
              label="Formato do arquivo"
              help={Object.entries(BACKUP_NAME_VARIABLES).map(([key, desc]) => `${key}: ${desc}`).join("\n")}
            />
            <Input value={cfg?.file_format ?? "backup-{name}-{datetime}"} className="font-mono text-xs"
              onChange={(e) => cfg && setSettings({ ...cfg, file_format: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp
              label="Database"
              help="Selecione a database para backup. Use 'Todas as databases' para gerar dump completo."
            />
            <SelectWithSearch
              options={[
                { value: "", label: "Todas as databases" },
                ...(cfg?.database_options ?? []),
              ]}
              value={cfg?.database ?? ""}
              onChange={(database) => cfg && setSettings({ ...cfg, database })}
              placeholder="Todas as databases"
              searchPlaceholder="Pesquisar database"
              emptyMessage="Nenhuma database encontrada."
            />
            <p className="text-xs text-muted-foreground">Use Todas as databases para gerar dump completo.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:items-start">
          <div className="space-y-1.5">
            <LabelWithHelp
              label="Retenção local"
              help="Define por quanto tempo os backups locais serão mantidos antes de serem removidos automaticamente."
            />
            <Input type="number" min={0} value={String(cfg?.local_retention ?? 10)} onChange={(e) => cfg && setSettings({ ...cfg, local_retention: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">0 remove arquivos locais após registrar.</p>
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp
              label="Retenção S3"
              help="Define por quanto tempo os backups no S3 serão mantidos antes de serem removidos automaticamente."
            />
            <Input type="number" min={0} value={String(cfg?.s3_retention ?? 20)} onChange={(e) => cfg && setSettings({ ...cfg, s3_retention: Number(e.target.value) })} />
            <p className="text-xs text-muted-foreground">0 mantém arquivos no S3 indefinidamente.</p>
          </div>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Label>Compressão</Label>
              <p className="text-xs text-muted-foreground">Reduz o tamanho do backup para economizar espaço de armazenamento e largura de banda durante transferências. A compressão aumenta o uso de CPU durante a criação e a restauração do backup.</p>
            </div>
            <Switch checked={!!cfg?.compress} onCheckedChange={(v) => cfg && setSettings({ ...cfg, compress: v })} />
          </div>
          {!!cfg?.compress && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-start">
              <div className="space-y-1.5">
                <div className="flex min-h-5 items-center">
                  <LabelWithHelp label="Método de compressão" help={selectedCopy.tooltip} />
                </div>
                <SelectWithSearch value={cfg?.compression_method ?? selectedMethod.value} onChange={(value) => {
                  if (!cfg) return;
                  const method = compressionMethods.find((m) => m.value === value) ?? selectedMethod;
                  setSettings({ ...cfg, compression_method: method.value, compression_level: method.default_level });
                }}
                  options={compressionMethods.map((method) => {
                    const copy = BACKUP_COMPRESSION_COPY[method.value] ?? { label: method.value, description: "", tooltip: "" };
                    return {
                      value: method.value,
                      label: `${copy.label} (.${method.extension})`,
                      searchText: `${method.extension} ${copy.description} ${copy.tooltip}`,
                    };
                  })}
                  searchPlaceholder="Pesquisar método"
                  emptyMessage="Nenhum método encontrado."
                />
                <p className="line-clamp-2 text-xs text-muted-foreground">{selectedCopy.description}</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex min-h-5 items-center">
                  <LabelWithHelp
                    label="Nível"
                    help={`Nível de compressão para ${selectedCopy.label}. Valores aceitos: ${selectedMethod?.min_level ?? 0} a ${selectedMethod?.max_level ?? 9}. Padrão: ${selectedMethod?.default_level ?? 6}.`}
                  />
                </div>
                <Input type="number" min={selectedMethod?.min_level ?? 0} max={selectedMethod?.max_level ?? 9}
                  value={String(cfg?.compression_level ?? selectedMethod?.default_level ?? 6)}
                  onChange={(e) => cfg && setSettings({ ...cfg, compression_level: Number(e.target.value) })}
                  className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">
                  {selectedMethod?.min_level ?? 0}-{selectedMethod?.max_level ?? 9}, padrão {selectedMethod?.default_level ?? 6}
                </p>
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp
                  label="Split do arquivo"
                  help="Define o tamanho máximo de cada arquivo de backup. Arquivos maiores serão divididos em múltiplos arquivos."
                />
                <SelectWithSearch value={splitIsCustom ? "custom" : String(currentSplitSize)}
                  onChange={(value) => {
                    if (!cfg) return;
                    setSettings({ ...cfg, split_size_mb: value === "custom" ? (splitIsCustom ? currentSplitSize : 512) : Number(value) });
                  }}
                  options={[
                    { value: "0", label: "Sem split" },
                    { value: "1024", label: "1 GB" },
                    { value: "2048", label: "2 GB" },
                    { value: "4096", label: "4 GB" },
                    { value: "8192", label: "8 GB" },
                    { value: "custom", label: "Custom" },
                  ]}
                  searchPlaceholder="Pesquisar split"
                  emptyMessage="Nenhuma opção encontrada."
                />
              </div>
              {splitIsCustom && (
                <div className="space-y-1.5">
                  <LabelWithHelp
                    label="Tamanho (MB)"
                    help="Define o tamanho máximo de cada arquivo de backup em MB. Arquivos maiores serão divididos em múltiplos arquivos."
                  />
                  <Input type="number" min={0} value={String(cfg?.split_size_mb ?? 0)}
                    onChange={(e) => cfg && setSettings({ ...cfg, split_size_mb: Number(e.target.value) })} />
                </div>
              )}
            </div>
          )}
        </div>

        {!!cfg?.compress && <div className="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Label>Criptografia</Label>
            <p className="text-xs text-muted-foreground">Usa a secret configurada em CI/CD e adiciona extensão .enc ao backup.</p>
          </div>
          <Switch checked={!!cfg?.encryption_enabled} onCheckedChange={(v) => cfg && saveSettings({ encryption_enabled: v })} />
        </div>}

        <div className="flex justify-end border-t pt-4">
          <Button onClick={() => cfg && saveSettings({
            file_format: cfg.file_format,
            database: cfg.database,
            compression_method: cfg.compression_method,
            compression_level: cfg.compression_level,
            compress: cfg.compress,
            local_retention: cfg.local_retention,
            s3_retention: cfg.s3_retention,
            split_size_mb: cfg.split_size_mb,
          })}>
            Salvar
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <BlockHeader title="Restaurar backup" description="Pontos disponíveis para restauração a partir do armazenamento local ou S3." />
          <Button variant="outline" size="sm" onClick={reloadRestoreBackups} disabled={restoreLoading}>
            {restoreLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recarregar
          </Button>
        </div>
        {restoreItems.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            <div className="hidden gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto]">
              <span>Data</span>
              <span>Backup</span>
              <span>Origem</span>
              <span>Tamanho</span>
              <span className="text-right">Ações</span>
            </div>
            {restoreItems.map((item) => (
              <div key={`restore-${item.id}`} className="grid grid-cols-1 gap-3 border-b px-3 py-3 text-sm last:border-b-0 lg:grid-cols-[1fr_1.4fr_1fr_1fr_auto] lg:items-center">
                <span className="text-muted-foreground">{formatBackupDate(item.ts)}</span>
                <div className="min-w-0 space-y-1">
                  <code className="block truncate font-mono text-xs">{item.name}</code>
                  <span className="text-xs text-muted-foreground">{item.engine || "database"}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.local.available && <Badge variant="success">Local</Badge>}
                  {(item.s3.available || !!item.s3.key || !!item.s3.keys?.length) && <Badge variant="info">S3</Badge>}
                  {item.parts > 1 && <Badge variant="warning">{item.parts} partes</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  <div>{formatBytes(item.compressed_size)}</div>
                  {!!item.compression_ratio && <div>Taxa {item.compression_ratio}x</div>}
                </div>
                <div className="flex justify-start lg:justify-end">
                  <Button size="sm" variant="outline" disabled={restoreBusy} onClick={() => setRestoreCandidate(item)}>
                    {restoreBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    Restaurar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum backup local ou S3 disponível para restauração.
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <BlockHeader title="Configuração S3" description="Escolha qual destino S3 será usado para enviar backups após a criação." />
          <Switch checked={!!cfg?.s3_enabled} onCheckedChange={(v) => saveSettings({ s3_enabled: v })} />
        </div>
        {!!cfg?.s3_enabled && (
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <LabelWithHelp label="Destino S3" help="Escolha qual configuração S3 será usada para enviar backups. Se não houver configuração, você será redirecionado para a página de configurações." />
              <SelectWithSearch
                value={String(cfg.s3_config_id ?? "")}
                options={[
                  { value: "", label: "Usar primeiro destino disponível" },
                  ...s3Configs.map((s3) => ({ value: String(s3.id), label: s3.label })),
                ]}
                onChange={(value) => setSettings({ ...cfg, s3_config_id: value ? Number(value) : null })}
                searchPlaceholder="Pesquisar destino"
                emptyMessage="Nenhum destino encontrado."
              />
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button onClick={() => s3Configs.length ? saveSettings({ s3_config_id: cfg.s3_config_id }) : navigate("/settings")}>
                {s3Configs.length ? "Salvar" : "Configurar S3"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {restoreDrawerOpen && <Drawer open onOpenChange={setRestoreDrawerOpen} direction="right">
        <DrawerContent className="sm:max-w-xl">
          <DrawerHeader>
            <DrawerTitle>Logs de restauração</DrawerTitle>
            <DrawerDescription>Acompanhe a aplicação do backup no banco de dados.</DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="space-y-4">
            {restoreProgress && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{restoreProgress.message}</span>
                  <span className="text-muted-foreground">{restoreProgress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${restoreProgress.percent}%` }} />
                </div>
              </div>
            )}
            <div className="max-h-[calc(100vh-16rem)] overflow-auto rounded-md border bg-black p-4 font-mono text-xs leading-relaxed text-zinc-200">
              {restoreEvents.length > 0 ? restoreEvents.map((event, index) => (
                <div key={`${event.seq}-${index}`} className={event.status === "failed" ? "text-red-200" : "text-zinc-200"}>
                  <span className="text-zinc-500">[{event.status}]</span> {event.message}
                </div>
              )) : (
                <span className="text-zinc-500">aguardando restauração...</span>
              )}
            </div>
          </DrawerBody>
          <DrawerFooter className="border-t">
            <Button variant="outline" onClick={() => setRestoreDrawerOpen(false)}>Fechar</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>}

      <ConfirmDelete
        open={!!restoreCandidate}
        onOpenChange={(open) => !open && setRestoreCandidate(null)}
        title="Restaurar backup?"
        description={restoreCandidate
          ? `Restaurar o backup "${restoreCandidate.name}" no banco atual? Esta ação pode sobrescrever dados existentes.`
          : ""}
        confirmLabel="Restaurar"
        onConfirm={async () => {
          if (!restoreCandidate) return;
          const item = restoreCandidate;
          setRestoreCandidate(null);
          await restoreBackup(item);
        }}
      />
    </div>
  );
}
