// @ts-nocheck
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Database, Download, Eye, EyeOff, Loader2, Pause,
  Pencil, Play, Plus, RefreshCw, Rocket, RotateCw, Search, ScrollText, Square,
  Terminal as TerminalIcon, Trash2, Upload, X,
} from "lucide-react";
import { del, get, getApiBase, post, put, streamUrl } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { useAuth } from "@/lib/auth";
import { formatBytes } from "@/lib/utils";
import type {
  AppProvider, BuildType, GitHubAccount, GitHubBranch, GitHubRepository, GitProvider, S3Config, ServiceDetail, ServiceStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { EnvEditor } from "@/components/project/env-editor";
import { ServiceTabSkeleton } from "@/components/project/service-tab-skeleton";
import { LogViewer } from "@/components/project/log-viewer";

const ServiceDeployments = lazy(async () => ({
  default: (await import("@/components/project/service-tabs/deployments")).ServiceDeployments,
}));
const LogsTab = lazy(async () => ({ default: (await import("@/components/project/service-tabs/logs")).LogsTab }));
const BackupsTab = lazy(async () => ({ default: (await import("@/components/project/service-tabs/backups")).BackupsTab }));
const SnapshotsTab = lazy(async () => ({ default: (await import("@/components/project/service-tabs/snapshots")).SnapshotsTab }));
const AdvancedTab = lazy(async () => ({ default: (await import("@/components/project/service-tabs/advanced")).AdvancedTab }));
const DomainsTab = lazy(async () => ({ default: (await import("@/components/project/service-tabs/domains")).DomainsTab }));
const TerminalDialog = lazy(async () => ({ default: (await import("@/components/terminal-dialog")).TerminalDialog }));
const FileManager = lazy(async () => ({ default: (await import("@/components/project/file-manager")).FileManager }));

const STATUS_BADGE: Record<ServiceStatus, { variant: "success" | "muted" | "destructive" | "info" | "warning"; label: string }> = {
  created: { variant: "muted", label: "criado" },
  running: { variant: "success", label: "rodando" },
  stopped: { variant: "info", label: "parado" },
  failed: { variant: "destructive", label: "falhou" },
  deploying: { variant: "warning", label: "provisionando" },
};

const APP_PROVIDER_LABELS: Record<AppProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  gitea: "Gitea",
  docker: "Docker",
  git: "Git",
  spa: "SPA",
};
const CONFIGURED_APP_PROVIDERS: AppProvider[] = ["github", "gitlab", "gitea", "bitbucket"];
const APP_PROVIDER_TABS: AppProvider[] = ["github", "gitlab", "gitea", "bitbucket", "docker", "git", "spa"];
const APP_WEBHOOK_TRIGGERS = [
  { value: "manual", label: "Manual", description: "Webhook criado, mas não dispara deploy automaticamente." },
  { value: "push", label: "On push", description: "Dispara deploy quando receber evento de push." },
  { value: "tag", label: "On tag", description: "Dispara deploy quando receber criação/publicação de tag." },
];
const SERVICE_TAB_PATHS = ["general", "deployments", "domains", "environment", "logs", "backups", "snapshots", "advanced"] as const;
type ServiceTabPath = typeof SERVICE_TAB_PATHS[number];
type RuntimeProgress = {
  seq: number;
  status: string;
  percent: number;
  message: string;
  verb?: string;
  ts?: number;
};

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Copiado"); }
  catch { toast.error("Não foi possível copiar"); }
}

/** Campo somente-leitura com botão de copiar (e revelar, opcional). */
function ReadonlyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const shown = secret && !reveal ? "•".repeat(Math.min(value.length || 8, 24)) : value;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">{shown}</code>
        {secret && (
          <Button variant="ghost" size="icon" onClick={() => setReveal((v) => !v)}>
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => copyText(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CopyInputField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [reveal, setReveal] = useState(false);
  const shown = secret && !reveal ? "•".repeat(Math.min(value.length || 8, 24)) : value;
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input readOnly value={shown} className="pr-20 font-mono text-xs" />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {secret && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReveal((v) => !v)}>
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyText(value)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Diálogo simples de renomear (nome + descrição). */
function RenameDialog({ svc, base, onOpenChange, onSaved }: {
  svc: ServiceDetail; base: string; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const [name, setName] = useState(svc.name);
  const [description, setDescription] = useState(svc.description);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await put(base, { name: name.trim(), description: description.trim() });
      toast.success("Serviço atualizado");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Editar serviço</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="space-y-1.5"><Label>Descrição</Label>
            <Textarea value={description} rows={3} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDetailPage() {
  const { id, sid } = useParams<{ id: string; sid: string }>();
  const projectId = Number(id);
  const serviceId = Number(sid);
  const base = `/projects/${projectId}/services/${serviceId}`;
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const canWrite = can("projects", "write");
  const { data: svc, loading, error, reload } = useData<ServiceDetail>(() => get(base), [base]);

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionJobId, setActionJobId] = useState("");
  const [actionProgress, setActionProgress] = useState<RuntimeProgress | null>(null);
  const [actionEvents, setActionEvents] = useState<RuntimeProgress[]>([]);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const actionStatusRef = useRef("");
  const [revealEnvValues, setRevealEnvValues] = useState(false);
  const [gitProviders, setGitProviders] = useState<GitProvider[]>([]);
  const [gitProvidersLoaded, setGitProvidersLoaded] = useState(false);
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccount[]>([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [githubBranches, setGithubBranches] = useState<GitHubBranch[]>([]);
  const [githubLoading, setGithubLoading] = useState<"accounts" | "repos" | "branches" | null>(null);

  // Estado editável de config, sincronizado ao carregar.
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  useEffect(() => { if (svc) setCfg(svc.config); }, [svc]);
  const set = (patch: Record<string, unknown>) => setCfg((c) => ({ ...c, ...patch }));

  useEffect(() => {
    if (svc?.kind !== "application") return;
    setGitProvidersLoaded(false);
    get<GitProvider[]>("/deploy/providers")
      .then(setGitProviders)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar provedores Git"))
      .finally(() => setGitProvidersLoaded(true));
  }, [svc?.kind]);

  const githubProvider = gitProviders.find((provider) => provider.type === "github" && provider.has_token);
  const githubProviderId = githubProvider?.id ?? 0;
  const selectedGithubInstallationId = String(cfg.github_installation_id ?? "");
  const selectedGithubRepoName = String(cfg.github_repo ?? "");

  useEffect(() => {
    if (svc?.kind !== "application" || cfg.provider !== "github" || !githubProviderId) {
      setGithubAccounts([]);
      return;
    }
    setGithubLoading("accounts");
    get<GitHubAccount[]>(`/deploy/providers/${githubProviderId}/github/accounts`)
      .then((items) => {
        setGithubAccounts(items);
        const selected = items.find((item) => item.selected) ?? items[0];
        if (selected && !String(cfg.github_installation_id ?? "")) {
          set({ github_installation_id: String(selected.id), github_account: selected.account.login });
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar contas do GitHub"))
      .finally(() => setGithubLoading((current) => (current === "accounts" ? null : current)));
  }, [svc?.kind, cfg.provider, cfg.github_installation_id, githubProviderId]);

  useEffect(() => {
    if (svc?.kind !== "application" || cfg.provider !== "github" || !githubProviderId || !selectedGithubInstallationId) {
      setGithubRepos([]);
      return;
    }
    setGithubLoading("repos");
    get<GitHubRepository[]>(`/deploy/providers/${githubProviderId}/github/repositories?installation_id=${encodeURIComponent(selectedGithubInstallationId)}`)
      .then((items) => {
        setGithubRepos(items);
        const selected = items.find((repo) => repo.full_name === String(cfg.github_repo ?? "")) ?? items[0];
        if (selected && !String(cfg.github_repo ?? "")) {
          set({
            github_repo: selected.full_name,
            git_url: selected.clone_url,
            branch: selected.default_branch,
          });
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar repositórios do GitHub"))
      .finally(() => setGithubLoading((current) => (current === "repos" ? null : current)));
  }, [svc?.kind, cfg.provider, cfg.github_repo, githubProviderId, selectedGithubInstallationId]);

  useEffect(() => {
    if (svc?.kind !== "application" || cfg.provider !== "github" || !githubProviderId || !selectedGithubInstallationId || !selectedGithubRepoName) {
      setGithubBranches([]);
      return;
    }
    setGithubLoading("branches");
    get<GitHubBranch[]>(`/deploy/providers/${githubProviderId}/github/branches?repo=${encodeURIComponent(selectedGithubRepoName)}&installation_id=${encodeURIComponent(selectedGithubInstallationId)}`)
      .then((items) => {
        setGithubBranches(items);
        if (items[0] && !String(cfg.branch ?? "")) {
          set({ branch: items[0].name });
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar branches do GitHub"))
      .finally(() => setGithubLoading((current) => (current === "branches" ? null : current)));
  }, [svc?.kind, cfg.provider, cfg.branch, githubProviderId, selectedGithubInstallationId, selectedGithubRepoName]);

  async function saveConfig(patch: Record<string, unknown>, msg = "Salvo") {
    try { await put(base, { config: { ...cfg, ...patch } }); toast.success(msg); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); }
  }

  async function generateWebhookSecret() {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    set({ webhook_secret: secret });
    await saveConfig({ webhook_secret: secret }, "Secret do webhook gerada");
  }

  async function saveAdvanced(path: string, payload: Record<string, unknown>, msg: string) {
    try { await put(`${base}/advanced/${path}`, payload); toast.success(msg); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); }
  }

  useEffect(() => {
    if (!actionJobId) return;
    const es = new EventSource(streamUrl(`${base}/runtime/jobs/${actionJobId}/stream`));
    let failed = false;
    let closedByClient = false;
    const closeStream = () => {
      closedByClient = true;
      es.close();
      setActionBusy(null);
      setActionJobId("");
    };
    const pushEvent = (data: RuntimeProgress) => {
      setActionProgress(data);
      setActionEvents((prev) => [...prev.slice(-80), data]);
    };
    es.addEventListener("progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as RuntimeProgress;
      pushEvent(data);
      if (actionStatusRef.current !== data.status) {
        actionStatusRef.current = data.status;
        reload();
      }
      if (data.status === "failed") {
        failed = true;
        toast.error(data.message || "Falha na ação");
        closeStream();
        reload();
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
      reload();
    });
    es.addEventListener("end", () => {
      closeStream();
      reload();
      if (!failed) toast.success("Ação concluída");
    });
    es.onerror = () => {
      if (closedByClient || failed) return;
      es.close();
      setActionBusy(null);
      setActionJobId("");
      toast.error("Conexão com o progresso da ação caiu");
      reload();
    };
    return () => {
      closedByClient = true;
      es.close();
    };
  }, [actionJobId, base, reload]);

  async function action(verb: string) {
    setActionBusy(verb);
    setActionJobId("");
    if (verb === "deploy" || verb === "rebuild") setActionDrawerOpen(true);
    actionStatusRef.current = "queued";
    const initial = { seq: 0, status: "queued", percent: 0, message: `Iniciando '${verb}'`, verb, ts: Date.now() };
    setActionProgress(initial);
    setActionEvents([initial]);
    try {
      const job = await post<{ job_id: string; status: string; verb: string }>(`${base}/${verb}`);
      setActionJobId(job.job_id);
      toast.success("Ação iniciada");
    }
    catch (e) {
      const message = e instanceof Error ? e.message : "Falha na ação";
      setActionBusy(null);
      const failed = { seq: 0, status: "failed", percent: 100, message, verb, ts: Date.now() };
      setActionProgress(failed);
      setActionEvents((events) => [...events, failed]);
      toast.error(message);
    }
  }

  async function remove() {
    await del(base);
    toast.success("Serviço removido");
    navigate(`/projects/${projectId}`);
  }

  const rawTab = location.pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
  const activeTab: ServiceTabPath = SERVICE_TAB_PATHS.includes(rawTab as ServiceTabPath)
    ? rawTab as ServiceTabPath
    : "general";
  if (loading && !svc) return <ServiceTabSkeleton tab={activeTab} />;
  if (error || !svc) return <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error ?? "Serviço não encontrado"}</div>;
  const status = STATUS_BADGE[svc.status] ?? STATUS_BADGE.created;
  const running = svc.status === "running";
  const busy = actionBusy !== null;
  const deployLabel = actionBusy === "deploy"
    ? (actionProgress?.status === "running" ? "Em deployment" : "Iniciando deploy")
    : svc.status === "deploying" ? "Em deployment"
      : svc.status === "running" ? "Rodando"
        : svc.status === "failed" ? "Falhou"
          : "Deploy";
  const showRuntime = svc.kind !== "template";
  const canStartService = !!svc.has_successful_deployment;
  const configuredProviderTypes = new Set(gitProviders.map((provider) => provider.type));
  const currentAppProvider = String(cfg.provider ?? "git") as AppProvider;
  const databaseInternalPort = svc.credentials?.internal_port ?? 0;
  const currentProviderUnavailable = (
    svc.kind === "application"
    && CONFIGURED_APP_PROVIDERS.includes(currentAppProvider)
    && !configuredProviderTypes.has(currentAppProvider as GitProvider["type"])
  );
  const appProviderHasWebhook = CONFIGURED_APP_PROVIDERS.includes(currentAppProvider) && !currentProviderUnavailable;
  const webhookEnabled = !!cfg.webhook_enabled && appProviderHasWebhook;
  const forcedBuildType: BuildType | null = currentAppProvider === "spa" ? "static" : currentAppProvider === "docker" ? "dockerfile" : null;
  const effectiveBuildType = forcedBuildType ?? (String(cfg.build_type ?? "dockerfile") as BuildType);
  const webhookSecret = String(cfg.webhook_secret ?? "");
  const webhookUrl = `${getApiBase()}${base}/webhook`;
  const currentGithubRepo = githubRepos.find((repo) => repo.full_name === selectedGithubRepoName);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-1 -ml-2 h-7 text-muted-foreground"
            onClick={() => navigate(`/projects/${projectId}`)}>
            <ArrowLeft className="h-4 w-4" /> Voltar ao projeto
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Database className="h-6 w-6 text-primary" /> {svc.name}
            <Badge variant={status.variant}>{status.label}</Badge>
          </h1>
          <code className="font-mono text-xs text-muted-foreground">{svc.slug}</code>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(value) => navigate(`${base}/${value}`)}>
        <TabsList>
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
          {svc.kind === "application" && <TabsTrigger value="domains">Domains</TabsTrigger>}
          <TabsTrigger value="environment">Variáveis de ambiente</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="advanced">Avançado</TabsTrigger>
        </TabsList>

        {/* ---- Geral ---- */}
        {activeTab === "general" && <TabsContent value="general" className="space-y-6">
          {showRuntime && (
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">Configurações de deploy</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!canWrite || busy} onClick={() => action("deploy")}>
                  {actionBusy === "deploy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} {deployLabel}
                </Button>
                <Button variant="outline" size="sm" disabled={!canWrite || busy || !running} onClick={() => action("restart")}>
                  {actionBusy === "restart" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} Reload
                </Button>
                {running ? (
                  <Button variant="outline" size="sm" disabled={!canWrite || busy} onClick={() => action("stop")}>
                    {actionBusy === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canWrite || busy || !canStartService}
                    title={!canStartService ? "Execute um deploy com sucesso antes de iniciar o serviço." : undefined}
                    onClick={() => action("start")}
                  >
                    {actionBusy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={!running}
                  onClick={() => setTerminal(true)}>
                  <TerminalIcon className="h-4 w-4" /> Terminal
                </Button>
              </div>
            </Card>
          )}

          {svc.kind === "database" && svc.credentials && (
            <>
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold">Credenciais</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadonlyField label="Usuário" value={svc.credentials.user} />
                  <ReadonlyField label="Senha" value={svc.credentials.password} secret />
                  <ReadonlyField label="Database" value={svc.credentials.database} />
                  <ReadonlyField label="Internal host" value={svc.credentials.internal_host} />
                  <ReadonlyField label="Internal port" value={String(svc.credentials.internal_port)} />
                </div>
                <ReadonlyField label="URL de conexão" value={svc.credentials.connection_url} secret />
              </Card>
              <Card className="space-y-4 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Acesso externo (bind)</h2>
                    <p className="text-xs text-muted-foreground">Publica a porta do banco no host.</p>
                  </div>
                  <Switch checked={!!cfg.expose} disabled={!canWrite || running}
                    onCheckedChange={(v) => {
                      const externalPort = Number(cfg.external_port) || databaseInternalPort;
                      const patch = v ? { expose: v, external_port: externalPort } : { expose: v };
                      set(patch);
                      saveConfig(patch);
                    }} />
                </div>
                {running && (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Pare o container antes de alterar credenciais ou publicação externa do banco.
                  </p>
                )}
                {!!cfg.expose && (
                  <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                      <LabelWithHelp label="Porta externa" help="Porta TCP do host que será publicada para acesso externo ao banco." />
                      <Input type="number" value={String(Number(cfg.external_port) || svc.credentials.internal_port)} className="w-40"
                        onChange={(e) => set({ external_port: Number(e.target.value) })}
                        disabled={running}
                        placeholder={String(svc.credentials.internal_port)} />
                    </div>
                    <div className="flex justify-end border-t pt-4">
                      <Button disabled={!canWrite || running} onClick={() => saveConfig({ external_port: Number(cfg.external_port) || databaseInternalPort })}>Salvar</Button>
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}

          {svc.kind === "application" && (
            <>
              <Card className="space-y-4 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold">Webhook</h2>
                    <p className="text-xs text-muted-foreground">
                      Desligado por padrão. Ative para aceitar deploy automático via provider configurado.
                    </p>
                  </div>
                  <Switch
                    checked={webhookEnabled}
                    disabled={!canWrite || !appProviderHasWebhook}
                    onCheckedChange={(v) => set({
                      webhook_enabled: v,
                      webhook_trigger: v ? (String(cfg.webhook_trigger ?? "manual") === "manual" ? "push" : cfg.webhook_trigger) : "manual",
                    })}
                  />
                </div>
                {webhookEnabled ? (
                  <>
                    <CopyInputField label="URL do webhook" value={webhookUrl} />
                    <CopyInputField label="Secret" value={webhookSecret || "Clique em gerar secret"} secret />
                    <div className="flex justify-end border-t pt-4">
                      <Button variant="outline" disabled={!canWrite} onClick={generateWebhookSecret}>
                        <RefreshCw className="h-4 w-4" />
                        Gerar secret
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Webhook inativo para este serviço.
                  </div>
                )}
              </Card>
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold">Provider</h2>
                <Tabs
                  value={currentAppProvider}
                  onValueChange={(value) => {
                    const provider = value as AppProvider;
                    const providerHasWebhook = CONFIGURED_APP_PROVIDERS.includes(provider);
                    set({
                      provider,
                      ...(provider === "spa" ? { build_type: "static", spa: true } : {}),
                      ...(provider === "docker" ? { build_type: "dockerfile", spa: false } : {}),
                      ...(!providerHasWebhook ? { webhook_enabled: false, webhook_trigger: "manual" } : {}),
                    });
                  }}
                >
                  <TabsList className="flex h-auto flex-wrap">
                    {APP_PROVIDER_TABS.map((provider) => (
                      <TabsTrigger key={provider} value={provider} disabled={!canWrite || !gitProvidersLoaded}>
                        {APP_PROVIDER_LABELS[provider]}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="github" className="space-y-4 pt-2">
                    {!githubProvider ? (
                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        Configure e conecte um GitHub App em CI/CD antes de selecionar repositórios.
                      </div>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-[1.1fr_1.4fr_1fr_0.9fr_1fr_auto] xl:items-end">
                        <div className="space-y-1.5">
                          <Label>GitHub account</Label>
                          <SelectWithSearch
                            value={selectedGithubInstallationId}
                            disabled={!canWrite || githubLoading === "accounts"}
                            options={[
                              { value: "", label: "Selecione" },
                              ...githubAccounts.map((item) => ({
                                value: String(item.id),
                                label: item.account.login || String(item.id),
                              })),
                            ]}
                            onChange={(value) => {
                              const account = githubAccounts.find((item) => String(item.id) === value);
                              set({
                                github_installation_id: value,
                                github_account: account?.account.login ?? "",
                                github_repo: "",
                                git_url: "",
                                branch: "",
                              });
                            }}
                            placeholder="Selecione"
                            searchPlaceholder="Pesquisar conta"
                            emptyMessage="Nenhuma conta encontrada."
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Repository</Label>
                          <SelectWithSearch
                            value={selectedGithubRepoName}
                            disabled={!canWrite || !selectedGithubInstallationId || githubLoading === "repos"}
                            options={[
                              { value: "", label: "Selecione" },
                              ...githubRepos.map((repo) => ({ value: repo.full_name, label: repo.full_name })),
                            ]}
                            onChange={(value) => {
                              const repo = githubRepos.find((item) => item.full_name === value);
                              set({
                                github_repo: value,
                                git_url: repo?.clone_url ?? "",
                                branch: repo?.default_branch ?? "",
                              });
                            }}
                            placeholder="Selecione"
                            searchPlaceholder="Pesquisar repository"
                            emptyMessage="Nenhum repository encontrado."
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Branch</Label>
                          <SelectWithSearch
                            value={String(cfg.branch ?? "")}
                            disabled={!canWrite || !selectedGithubRepoName || githubLoading === "branches"}
                            options={[
                              { value: "", label: "Default" },
                              ...githubBranches.map((branch) => ({ value: branch.name, label: branch.name })),
                            ]}
                            onChange={(value) => set({ branch: value })}
                            placeholder="Default"
                            searchPlaceholder="Pesquisar branch"
                            emptyMessage="Nenhuma branch encontrada."
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Build path</Label>
                          <Input value={String(cfg.docker_context ?? ".")} className="font-mono text-xs"
                            onChange={(e) => set({ docker_context: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Trigger type</Label>
                          <SelectWithSearch
                            value={webhookEnabled ? String(cfg.webhook_trigger ?? "push") : "manual"}
                            disabled={!canWrite || !webhookEnabled}
                            options={APP_WEBHOOK_TRIGGERS.map((trigger) => ({
                              value: trigger.value,
                              label: trigger.label,
                              searchText: trigger.description,
                            }))}
                            onChange={(value) => set({ webhook_trigger: value })}
                            searchPlaceholder="Pesquisar trigger"
                            emptyMessage="Nenhum trigger encontrado."
                          />
                        </div>
                        <Button disabled={!canWrite || !gitProvidersLoaded || !selectedGithubInstallationId || !selectedGithubRepoName} onClick={() => saveConfig({
                          provider: "github",
                          github_installation_id: selectedGithubInstallationId,
                          github_account: String(cfg.github_account ?? ""),
                          github_repo: selectedGithubRepoName,
                          git_url: currentGithubRepo?.clone_url || cfg.git_url,
                          branch: cfg.branch,
                          docker_context: cfg.docker_context,
                          webhook_enabled: webhookEnabled,
                          webhook_trigger: webhookEnabled ? String(cfg.webhook_trigger ?? "push") : "manual",
                        })}>
                          Salvar
                        </Button>
                      </div>
                    )}
                  </TabsContent>

                  {(["gitlab", "gitea", "bitbucket", "docker", "git", "spa"] as AppProvider[]).map((provider) => {
                    const unavailable = CONFIGURED_APP_PROVIDERS.includes(provider)
                      && !configuredProviderTypes.has(provider as GitProvider["type"]);
                    const providerHasWebhook = CONFIGURED_APP_PROVIDERS.includes(provider) && !unavailable;
                    return (
                      <TabsContent key={provider} value={provider} className="space-y-4 pt-2">
                        {unavailable && (
                          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            Configure e conecte {APP_PROVIDER_LABELS[provider]} em CI/CD antes de salvar este provider.
                          </div>
                        )}
                        {provider === "spa" ? (
                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-muted-foreground">
                                SPA sem repositório — os arquivos são geridos aqui e servidos de{" "}
                                <code className="rounded bg-muted px-1 py-0.5">/var/www/apps</code>.
                              </p>
                              <Button disabled={!canWrite} onClick={() => saveConfig({
                                provider: "spa", build_type: "static", spa: true,
                                webhook_enabled: false, webhook_trigger: "manual",
                              }, "Provider SPA salvo")}>
                                Salvar provider
                              </Button>
                            </div>
                            {String(svc.config?.build_type) === "static" ? (
                              <Suspense fallback={<Skeleton className="h-80 w-full" />}><FileManager projectId={projectId} serviceId={serviceId} canWrite={canWrite} /></Suspense>
                            ) : (
                              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                Clique em “Salvar provider” para habilitar o gerenciador de arquivos.
                              </div>
                            )}
                          </div>
                        ) : (
                        <div className="grid gap-3 xl:grid-cols-[minmax(220px,1.6fr)_0.8fr_1fr_auto] xl:items-end">
                          <div className="space-y-1.5">
                            <Label>URL do repositório</Label>
                            <Input value={String(cfg.git_url ?? "")} className="font-mono text-xs"
                              disabled={provider === "docker"}
                              onChange={(e) => set({ git_url: e.target.value })}
                              placeholder={provider === "git" ? "https://host/org/repo.git" : `https://${provider}.com/org/repo.git`} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Build path</Label>
                            <Input value={String(cfg.docker_context ?? ".")} className="font-mono text-xs"
                              onChange={(e) => set({ docker_context: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Trigger type</Label>
                            <SelectWithSearch
                              value={providerHasWebhook && webhookEnabled ? String(cfg.webhook_trigger ?? "push") : "manual"}
                              disabled={!canWrite || !providerHasWebhook || !webhookEnabled}
                              options={APP_WEBHOOK_TRIGGERS.map((trigger) => ({
                                value: trigger.value,
                                label: trigger.label,
                                searchText: trigger.description,
                              }))}
                              onChange={(value) => set({ webhook_trigger: value })}
                              searchPlaceholder="Pesquisar trigger"
                              emptyMessage="Nenhum trigger encontrado."
                            />
                          </div>
                          <Button disabled={!canWrite || !gitProvidersLoaded || unavailable} onClick={() => saveConfig({
                            provider,
                            git_url: cfg.git_url,
                            docker_context: cfg.docker_context,
                            webhook_enabled: providerHasWebhook ? webhookEnabled : false,
                            webhook_trigger: providerHasWebhook && webhookEnabled ? String(cfg.webhook_trigger ?? "push") : "manual",
                            ...(provider === "docker" ? { build_type: "dockerfile", spa: false } : {}),
                          })}>
                            Salvar
                          </Button>
                        </div>
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </Card>
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold">Build Type</h2>
                <div className="space-y-1.5">
                  <Label>Tipo de build</Label>
                  <SelectWithSearch
                    value={effectiveBuildType}
                    disabled={!canWrite || !!forcedBuildType}
                    options={[
                      { value: "dockerfile", label: "Dockerfile" },
                      { value: "static", label: "Static" },
                    ]}
                    onChange={(value) => set({ build_type: value as BuildType })}
                    searchPlaceholder="Pesquisar tipo"
                    emptyMessage="Nenhum tipo encontrado."
                  />
                  {forcedBuildType && (
                    <p className="text-xs text-muted-foreground">
                      {currentAppProvider === "spa"
                        ? "Provider SPA usa sempre build static com SPA ativado."
                        : "Provider Docker usa sempre build Dockerfile."}
                    </p>
                  )}
                </div>
                {effectiveBuildType !== "static" ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1.5"><Label>Dockerfile</Label>
                        <Input value={String(cfg.dockerfile ?? "Dockerfile")} className="font-mono text-xs"
                          onChange={(e) => set({ dockerfile: e.target.value })} /></div>
                      <div className="space-y-1.5"><Label>Docker context path</Label>
                        <Input value={String(cfg.docker_context ?? ".")} className="font-mono text-xs"
                          onChange={(e) => set({ docker_context: e.target.value })} /></div>
                      <div className="space-y-1.5"><Label>Docker build stage</Label>
                        <Input value={String(cfg.build_stage ?? "")} className="font-mono text-xs"
                          onChange={(e) => set({ build_stage: e.target.value })} /></div>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
                      <div className="space-y-0.5">
                        <Label>Build Cache</Label>
                        <p className="text-xs text-muted-foreground">Usa o cache padrão do Docker durante o build.</p>
                      </div>
                      <Switch
                        checked={cfg.docker_build_cache !== false}
                        disabled={!canWrite}
                        onCheckedChange={(v) => set({ docker_build_cache: !!v })}
                      />
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={currentAppProvider === "spa" || !!cfg.spa} disabled={currentAppProvider === "spa"} onCheckedChange={(v) => set({ spa: !!v })} />
                    Single Page Application (SPA)
                  </label>
                )}
                <div className="flex justify-end border-t pt-4">
                  <Button disabled={!canWrite} onClick={() => saveConfig({
                    build_type: effectiveBuildType, dockerfile: cfg.dockerfile,
                    docker_context: cfg.docker_context, build_stage: cfg.build_stage,
                    docker_build_cache: cfg.docker_build_cache !== false,
                    spa: currentAppProvider === "spa" ? true : currentAppProvider === "docker" ? false : cfg.spa,
                  })}>Salvar</Button>
                </div>
              </Card>
            </>
          )}

          {svc.kind === "compose" && (
            <Card className="space-y-3 p-5">
              <h2 className="font-semibold">Docker Compose ({String(cfg.mode ?? "compose")})</h2>
              <Textarea value={String(cfg.content ?? "")} rows={14} spellCheck={false}
                className="font-mono text-xs" onChange={(e) => set({ content: e.target.value })} />
              <div className="flex justify-end border-t pt-4">
                <Button disabled={!canWrite} onClick={() => saveConfig({ content: cfg.content })}>Salvar</Button>
              </div>
            </Card>
          )}

          {svc.kind === "template" && (
            <Card className="p-5 text-sm text-muted-foreground">
              Template <strong>{String(cfg.name ?? cfg.template_id ?? "")}</strong>
              {cfg.version ? ` (${String(cfg.version)})` : ""} — provisionamento em breve.
            </Card>
          )}
        </TabsContent>}

        {/* ---- Deployments ---- */}
        {activeTab === "deployments" && <TabsContent value="deployments">
          <Suspense fallback={<ServiceTabSkeleton tab="deployments" />}>
            <ServiceDeployments projectId={projectId} serviceId={serviceId} canWrite={canWrite} />
          </Suspense>
        </TabsContent>}

        {svc.kind === "application" && activeTab === "domains" && <TabsContent value="domains">
          <Suspense fallback={<ServiceTabSkeleton tab="domains" />}><DomainsTab base={base} canWrite={canWrite}
            isSpa={String(cfg.provider) === "spa" || !!cfg.spa} running={running} /></Suspense>
        </TabsContent>}

        {/* ---- Variáveis de ambiente ---- */}
        {activeTab === "environment" && <TabsContent value="environment" className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Configurações do Ambiente</h2>
                <p className="text-sm text-muted-foreground">
                  Você pode adicionar variáveis de ambiente ao seu recurso.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevealEnvValues((current) => !current)}
                className="w-full sm:w-auto"
              >
                {revealEnvValues ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {revealEnvValues ? "Esconder valores" : "Mostrar valores"}
              </Button>
            </div>
            <EnvEditor value={String(cfg.env ?? "")} disabled={!canWrite} revealValues={revealEnvValues}
              onChange={(v) => set({ env: v })} />
            <div className="flex justify-end border-t pt-4">
              <Button disabled={!canWrite} onClick={() => saveConfig({ env: cfg.env }, "Variáveis salvas")}>
                Salvar
              </Button>
            </div>
          </Card>
        </TabsContent>}

        {/* ---- Logs ---- */}
        {activeTab === "logs" && <TabsContent value="logs">
          <Suspense fallback={<ServiceTabSkeleton tab="logs" />}><LogsTab base={base} containerName={svc.container_name} /></Suspense>
        </TabsContent>}

        {/* ---- Backups ---- */}
        {activeTab === "backups" && <TabsContent value="backups">
          <Suspense fallback={<ServiceTabSkeleton tab="backups" />}><BackupsTab base={base} isDatabase={svc.kind === "database"} /></Suspense>
        </TabsContent>}

        {activeTab === "snapshots" && <TabsContent value="snapshots">
          <Suspense fallback={<ServiceTabSkeleton tab="snapshots" />}><SnapshotsTab base={base} /></Suspense>
        </TabsContent>}

        {/* ---- Avançado ---- */}
        {activeTab === "advanced" && <TabsContent value="advanced" className="space-y-6">
          <Suspense fallback={<ServiceTabSkeleton tab="advanced" />}>
            <AdvancedTab kind={svc.kind} cfg={cfg} set={set} canWrite={canWrite}
              onSave={saveConfig} onSaveAdvanced={saveAdvanced}
              onRebuild={() => action("rebuild")} rebuilding={actionBusy === "rebuild"} />
          </Suspense>
        </TabsContent>}
      </Tabs>

      {editing && (
        <RenameDialog svc={svc} base={base} onOpenChange={(o) => !o && setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }} />
      )}
      {terminal && <Suspense fallback={null}><TerminalDialog containersUrl={`${base}/containers`}
        description="Selecione o container do serviço que deseja acessar pelo terminal."
        terminalPath={(container, shell) => `${base}/terminal?shell=${shell}&container=${encodeURIComponent(container.name)}`}
        onOpenChange={(o) => !o && setTerminal(false)} /></Suspense>}
      <Drawer
        open={actionDrawerOpen}
        onOpenChange={(open) => {
          if (open || !busy) setActionDrawerOpen(open);
        }}
        direction="right"
      >
        <DrawerContent className="sm:max-w-3xl">
          <DrawerHeader>
            <DrawerTitle>Logs do deployment</DrawerTitle>
            <DrawerDescription>{actionProgress?.message || "Aguardando eventos do deployment."}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody className="flex min-h-0 flex-col gap-4">
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{actionProgress?.message || "Preparando deployment"}</span>
                <span className="text-muted-foreground">{actionProgress?.percent ?? 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${actionProgress?.percent ?? 0}%` }} />
              </div>
            </div>
            <LogViewer
              className="min-h-80 flex-1"
              entries={actionEvents.map((event, index) => ({
                id: `${event.seq}-${index}`,
                timestamp: event.ts,
                level: event.status === "failed" ? "error" : event.status === "done" ? "success" : "info",
                context: event.verb || actionBusy || "deploy",
                message: event.message,
              }))}
              emptyMessage="Aguardando logs do deployment..."
            />
          </DrawerBody>
          <DrawerFooter className="border-t">
            <Button variant="outline" disabled={busy} onClick={() => setActionDrawerOpen(false)}>Fechar</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <ConfirmDelete
        open={confirmDelete} onOpenChange={setConfirmDelete}
        title={`Excluir serviço '${svc.name}'?`}
        description="Remove o serviço do projeto (e o container/volume, se provisionado)."
        onConfirm={remove}
      />
    </div>
  );
}
