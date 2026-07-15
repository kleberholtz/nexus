import { lazy, Suspense, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Database, Globe, Loader2, Palette, Plug,
  ScanLine, Settings2, Save,
} from "lucide-react";
import { api, get, getApiBase, getToken, post, put, setApiBase, setToken } from "@/lib/api";
import { SettingsData } from "@/lib/types";
import { validateInt, validateNumber, validateUrl } from "@/lib/validate";
import { useTheme, Theme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Lang } from "@/lib/locales";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";

const DnsProvidersManager = lazy(async () => ({ default: (await import("@/components/dns-providers")).DnsProvidersManager }));
const AiProvidersManager = lazy(async () => ({ default: (await import("@/components/ai-providers")).AiProvidersManager }));
const S3ConfigsManager = lazy(async () => ({ default: (await import("@/components/s3-configs")).S3ConfigsManager }));
const LogsSettingsCard = lazy(async () => ({ default: (await import("@/components/logs-settings")).LogsSettingsCard }));
const NginxSettings = lazy(async () => ({ default: (await import("@/components/nginx-settings")).NginxSettings }));
const TunnelSettings = lazy(async () => ({ default: (await import("@/components/tunnel-settings")).TunnelSettings }));

function TabFallback() {
  return <Skeleton className="h-48 w-full" />;
}

export function SettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const canReadAi = can("ai", "read");
  const [activeTab, setActiveTab] = useState("aparencia");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Settings2 className="h-6 w-6 text-primary" /> {t("settings.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="aparencia">{t("settings.tabAppearance")}</TabsTrigger>
          <TabsTrigger value="geral">{t("settings.tabGeneral")}</TabsTrigger>
          <TabsTrigger value="api">{t("settings.tabApi")}</TabsTrigger>
          {canReadAi && <TabsTrigger value="ai">{t("settings.tabAiProvider")}</TabsTrigger>}
          <TabsTrigger value="database">{t("settings.tabDatabase")}</TabsTrigger>
          <TabsTrigger value="docker">{t("settings.tabDocker")}</TabsTrigger>
          <TabsTrigger value="nginx">{t("settings.tabNginx")}</TabsTrigger>
          <TabsTrigger value="tunnel">{t("settings.tabTunnel")}</TabsTrigger>
          <TabsTrigger value="logs">{t("settings.tabLogs")}</TabsTrigger>
          <TabsTrigger value="s3">{t("settings.tabS3")}</TabsTrigger>
          <TabsTrigger value="dns">{t("settings.tabDns")}</TabsTrigger>
        </TabsList>
        <TabsContent value="aparencia">
          <AppearanceCard />
        </TabsContent>
        <TabsContent value="geral" className="space-y-6">
          <ConnectionCard />
          <MetricsCard />
          <AcmeCard />
        </TabsContent>
        <TabsContent value="api">
          <ApiSettingsCard />
        </TabsContent>
        {canReadAi && (
          <TabsContent value="ai">
            {activeTab === "ai" && <Suspense fallback={<TabFallback />}><AiProvidersManager /></Suspense>}
          </TabsContent>
        )}
        <TabsContent value="database">
          <DatabaseCard />
        </TabsContent>
        <TabsContent value="docker">
          <DockerSettingsCard />
        </TabsContent>
        <TabsContent value="nginx">
          {activeTab === "nginx" && <Suspense fallback={<TabFallback />}><NginxSettings /></Suspense>}
        </TabsContent>
        <TabsContent value="tunnel">
          {activeTab === "tunnel" && <Suspense fallback={<TabFallback />}><TunnelSettings /></Suspense>}
        </TabsContent>
        <TabsContent value="logs">
          {activeTab === "logs" && <Suspense fallback={<TabFallback />}><LogsSettingsCard /></Suspense>}
        </TabsContent>
        <TabsContent value="s3">
          {activeTab === "s3" && <Suspense fallback={<TabFallback />}><S3ConfigsManager /></Suspense>}
        </TabsContent>
        <TabsContent value="dns">
          {activeTab === "dns" && <Suspense fallback={<TabFallback />}><DnsProvidersManager /></Suspense>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-5 w-5 text-primary" /> {t("settings.appearance.title")}
        </CardTitle>
        <CardDescription>{t("settings.appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <LabelWithHelp htmlFor="theme" help="Define o tema visual usado no painel. Auto acompanha a preferência do sistema.">
            {t("settings.appearance.theme")}
          </LabelWithHelp>
          <Select
            id="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="auto">{t("settings.appearance.themeAuto")}</option>
            <option value="dark">{t("settings.appearance.themeDark")}</option>
            <option value="light">{t("settings.appearance.themeLight")}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <LabelWithHelp htmlFor="lang" help="Idioma usado nos textos da interface do painel.">
            {t("settings.appearance.language")}
          </LabelWithHelp>
          <Select
            id="lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="pt">{t("settings.appearance.langPt")}</option>
            <option value="en">{t("settings.appearance.langEn")}</option>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionCard() {
  const { t } = useI18n();
  const [base, setBase] = useState(getApiBase());
  const [token, setTok] = useState(getToken() ?? "");
  const [testing, setTesting] = useState(false);

  function save() {
    const err = validateUrl(base, t("settings.connection.address"));
    if (err) {
      toast.error(err);
      return;
    }
    setApiBase(base.trim() || null);
    setToken(token.trim() || null);
    toast.success(t("settings.connection.saved"));
  }

  async function testConn() {
    setTesting(true);
    // Usa os valores atuais dos campos (salva antes de testar).
    setApiBase(base.trim() || null);
    setToken(token.trim() || null);
    try {
      await api("/auth/verify");
      toast.success(t("settings.connection.testOk"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.connection.testFail"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="h-5 w-5 text-primary" /> Conexão com a API
        </CardTitle>
        <CardDescription>Endpoint e token usados pelo navegador para chamar o backend do Holtz Nexus.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <LabelWithHelp htmlFor="apibase" help="URL base da API. Vazio usa a origem atual; informe protocolo, host e porta quando o backend estiver em outro endereço.">
            {t("settings.connection.address")}
          </LabelWithHelp>
          <Input
            id="apibase"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="http://host:3001"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.connection.addressHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <LabelWithHelp htmlFor="apitoken" help="Token enviado nas chamadas à API. Pode ser o token mestre ou um token de sessão válido.">
            {t("settings.connection.token")}
          </LabelWithHelp>
          <Input
            id="apitoken"
            type="password"
            value={token}
            onChange={(e) => setTok(e.target.value)}
            placeholder="Bearer token"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={save}>
            <Save className="h-4 w-4" /> {t("settings.connection.save")}
          </Button>
          <Button variant="outline" onClick={testConn} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("settings.connection.test")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsCard() {
  const { t } = useI18n();
  const [data, setData] = useState<SettingsData | null>(null);
  const [interval, setIntervalV] = useState("");
  const [retention, setRetention] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((d) => {
        setData(d);
        setIntervalV(String(d.values.sse_interval_seconds));
        setRetention(String(d.values.metrics_retention_days));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"));
  }, []);

  async function save() {
    if (!data) return;
    const iLim = data.limits.sse_interval_seconds;
    const rLim = data.limits.metrics_retention_days;
    const err =
      validateNumber(interval, { min: iLim.min, max: iLim.max, label: t("settings.metrics.interval") }) ||
      validateInt(retention, { min: rLim.min, max: rLim.max, label: t("settings.metrics.retention") });
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const updated = await put<SettingsData>("/settings", {
        sse_interval_seconds: Number(interval),
        metrics_retention_days: Number(retention),
      });
      setData(updated);
      toast.success(t("settings.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const iLim = data?.limits.sse_interval_seconds;
  const rLim = data?.limits.metrics_retention_days;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Métricas em tempo real</CardTitle>
        <CardDescription>Cadência de coleta/SSE e retenção do histórico usado pelos gráficos da home.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="sse" help="Intervalo, em segundos, entre coletas do backend e eventos SSE enviados à interface. Valores menores atualizam mais rápido e geram mais registros.">
              {t("settings.metrics.interval")}{iLim && ` — ${iLim.min}–${iLim.max}`}
            </LabelWithHelp>
            <Input id="sse" type="number" step="0.1" min={iLim?.min} max={iLim?.max}
              value={interval} onChange={(e) => setIntervalV(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ret" help="Quantidade de dias mantidos na tabela de métricas. Registros mais antigos são removidos pelo coletor.">
              {t("settings.metrics.retention")}{rLim && ` — ${rLim.min}–${rLim.max}`}
            </LabelWithHelp>
            <Input id="ret" type="number" min={rLim?.min} max={rLim?.max}
              value={retention} onChange={(e) => setRetention(e.target.value)} />
          </div>
        </div>
        <Button onClick={save} disabled={saving || !data}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("settings.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

function AcmeCard() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData & { values: { acme_email?: string } }>("/settings")
      .then((d) => setEmail(((d.values as Record<string, unknown>).acme_email as string) || ""))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    const v = email.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      toast.error(t("settings.acme.invalid"));
      return;
    }
    setSaving(true);
    try {
      await put("/settings", { acme_email: v });
      toast.success(t("settings.acme.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conta ACME</CardTitle>
        <CardDescription>E-mail usado para emissão e renovação de certificados Let's Encrypt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 sm:max-w-sm">
          <LabelWithHelp htmlFor="acme-email" help="Endereço associado à conta ACME. Usado pelo Let's Encrypt para avisos de renovação e políticas da conta.">
            {t("settings.acme.email")}
          </LabelWithHelp>
          <Input id="acme-email" type="email" value={email} disabled={!loaded}
            onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
        </div>
        <Button onClick={save} disabled={saving || !loaded}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("settings.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Aviso de que a mudança só vale após reiniciar a API. */
function RestartNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Esta configuração é lida no boot da API — a mudança só vale após <strong>reiniciar</strong> o serviço.</span>
    </div>
  );
}

function DockerSettingsCard() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [scan, setScan] = useState(false);
  const [rateLimit, setRateLimit] = useState("");
  const [maxDetails, setMaxDetails] = useState("");
  const [workers, setWorkers] = useState("");
  const [statsInterval, setStatsInterval] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((d) => {
        setData(d);
        setScan(!!d.values.docker_scan_enabled);
        setRateLimit(String(d.values.docker_scan_rate_limit_seconds ?? d.defaults.docker_scan_rate_limit_seconds ?? 60));
        setMaxDetails(String(d.values.docker_scan_max_details ?? d.defaults.docker_scan_max_details ?? 2000));
        setWorkers(String(d.values.docker_scan_workers ?? d.defaults.docker_scan_workers ?? 1));
        setStatsInterval(String(d.values.docker_stats_interval_seconds ?? d.defaults.docker_stats_interval_seconds ?? 1));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    if (!data) return;
    const rateLimitLim = data.limits.docker_scan_rate_limit_seconds;
    const maxDetailsLim = data.limits.docker_scan_max_details;
    const workersLim = data.limits.docker_scan_workers;
    const statsLim = data.limits.docker_stats_interval_seconds;
    const err =
      validateInt(rateLimit, { min: rateLimitLim.min, max: rateLimitLim.max, label: "Rate limit" }) ||
      validateInt(maxDetails, { min: maxDetailsLim.min, max: maxDetailsLim.max, label: "MAX_DETAILS" }) ||
      validateInt(workers, { min: workersLim.min, max: workersLim.max, label: "SCAN_WORKERS" }) ||
      validateInt(statsInterval, { min: statsLim.min, max: statsLim.max, label: "Intervalo de uso" });
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      const updated = await put<SettingsData>("/settings", {
        docker_scan_enabled: scan,
        docker_scan_rate_limit_seconds: Number(rateLimit),
        docker_scan_max_details: Number(maxDetails),
        docker_scan_workers: Number(workers),
        docker_stats_interval_seconds: Number(statsInterval),
      });
      setData(updated);
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  const rateLimitLim = data?.limits.docker_scan_rate_limit_seconds;
  const maxDetailsLim = data?.limits.docker_scan_max_details;
  const workersLim = data?.limits.docker_scan_workers;
  const statsLim = data?.limits.docker_stats_interval_seconds;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="h-5 w-5 text-primary" /> Scanner de vulnerabilidades Docker
        </CardTitle>
        <CardDescription>
          Controla execução, frequência, volume de detalhes salvos e paralelismo dos scans Trivy em imagens locais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Trivy habilitado</div>
            <p className="text-xs text-muted-foreground">
              O trivy roda sob demanda via o socket do Docker; requer acesso à internet para a base de vulns.
            </p>
          </div>
          <Switch checked={scan} onCheckedChange={setScan} disabled={!loaded} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="docker-scan-rate-limit" help="Tempo mínimo, em segundos, entre dois scans solicitados para a mesma imagem. Evita rescans acidentais e excesso de uso da base do Trivy.">
              Rate Limit
            </LabelWithHelp>
            <Input
              id="docker-scan-rate-limit"
              type="number"
              min={rateLimitLim?.min}
              max={rateLimitLim?.max}
              value={rateLimit}
              disabled={!loaded}
              onChange={(e) => setRateLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Intervalo mínimo entre scans da mesma imagem.
            </p>
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="docker-scan-max-details" help="Quantidade máxima de CVEs detalhados armazenados no resultado do scan. O total por severidade continua sendo calculado antes do corte.">
              Max CVE Details
            </LabelWithHelp>
            <Input
              id="docker-scan-max-details"
              type="number"
              min={maxDetailsLim?.min}
              max={maxDetailsLim?.max}
              value={maxDetails}
              disabled={!loaded}
              onChange={(e) => setMaxDetails(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Máximo de CVEs detalhados salvos por scan.
            </p>
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="docker-scan-workers" help="Número de scans que podem rodar em paralelo após reiniciar a API. Cada worker pode iniciar um container Trivy.">
              Scan Workers
            </LabelWithHelp>
            <Input
              id="docker-scan-workers"
              type="number"
              min={workersLim?.min}
              max={workersLim?.max}
              value={workers}
              disabled={!loaded}
              onChange={(e) => setWorkers(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Workers paralelos do scanner. Aplica no restart da API.
            </p>
          </div>
        </div>
        <div className="space-y-1.5 border-t pt-4 sm:max-w-xs">
          <LabelWithHelp htmlFor="docker-stats-interval" help="Cadência, em segundos, do stream (SSE) que atualiza CPU e memória dos containers na página Docker → Containers.">
            Intervalo de uso
          </LabelWithHelp>
          <Input
            id="docker-stats-interval"
            type="number"
            min={statsLim?.min}
            max={statsLim?.max}
            value={statsInterval}
            disabled={!loaded}
            onChange={(e) => setStatsInterval(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Frequência de atualização de CPU/memória dos containers (SSE).
          </p>
        </div>
        <Button onClick={save} disabled={saving || !loaded}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
        </Button>
      </CardContent>
    </Card>
  );
}

function ApiSettingsCard() {
  const [cors, setCors] = useState("");
  const [ttl, setTtl] = useState("");
  const [tls, setTls] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((d) => {
        setCors(d.values.api_cors_origins ?? "*");
        setTtl(String(d.values.session_ttl_days ?? 7));
        setTls(!!d.values.api_tls_enabled);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    const n = Number(ttl);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      toast.error("Validade da sessão deve ser um inteiro entre 1 e 3650 dias");
      return;
    }
    setSaving(true);
    try {
      await put("/settings", {
        api_cors_origins: cors.trim() || "*",
        session_ttl_days: n,
        api_tls_enabled: tls,
      });
      toast.success("Configurações salvas");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-5 w-5 text-primary" /> Segurança e acesso da API
        </CardTitle>
        <CardDescription>Origens permitidas, duração de sessões e TLS servido diretamente pelo backend.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <LabelWithHelp htmlFor="cors" help="Lista de origens autorizadas a chamar a API pelo navegador. Separe múltiplas origens por vírgula; use * apenas em ambientes confiáveis.">
            Origens CORS permitidas
          </LabelWithHelp>
          <Input id="cors" value={cors} disabled={!loaded} spellCheck={false}
            onChange={(e) => setCors(e.target.value)} placeholder="*" />
          <p className="text-xs text-muted-foreground">
            Lista separada por vírgula. <code>*</code> = qualquer origem.
          </p>
        </div>
        <div className="space-y-1.5 sm:max-w-xs">
          <LabelWithHelp htmlFor="ttl" help="Tempo de validade para novas sessões de usuários autenticados pelo banco. Não altera sessões já emitidas nem o token mestre do ambiente.">
            Validade da sessão (dias) — 1–3650
          </LabelWithHelp>
          <Input id="ttl" type="number" min={1} max={3650} value={ttl} disabled={!loaded}
            onChange={(e) => setTtl(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Vale para novas sessões de usuários do banco (o master usa o token do .env).
          </p>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
          <div className="space-y-0.5">
            <LabelWithHelp help="Liga TLS diretamente no processo da API usando certificado self-signed. A URL configurada no cliente precisa usar https:// depois do restart.">
              HTTPS (TLS) da API
            </LabelWithHelp>
            <p className="text-xs text-muted-foreground">
              Serve a API em HTTPS com cert self-signed. Ajuste a base para <code>https://…</code>.
            </p>
          </div>
          <Switch checked={tls} onCheckedChange={setTls} disabled={!loaded} />
        </label>
        <RestartNotice />
        <Button onClick={save} disabled={saving || !loaded}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
        </Button>
      </CardContent>
    </Card>
  );
}

type DbConfig = {
  type: string; dsn: string; host: string; port: string;
  user: string; password: string; name: string; sqlite_path: string;
};

function DatabaseCard() {
  const [cfg, setCfg] = useState<DbConfig | null>(null);
  const [source, setSource] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<{ config: DbConfig; source: string }>("/settings/database")
      .then((d) => { setCfg(d.config); setSource(d.source); })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"));
  }, []);

  const set = (k: keyof DbConfig, v: string) => setCfg((c) => (c ? { ...c, [k]: v } : c));
  const isSqlite = cfg?.type === "sqlite";

  async function testConn() {
    if (!cfg) return;
    setTesting(true);
    try {
      await post("/settings/database/test", cfg);
      toast.success("Conexão bem-sucedida");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na conexão");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      const r = await put<{ config: DbConfig; source: string }>("/settings/database", cfg);
      setCfg(r.config);
      setSource(r.source);
      toast.success("Salvo — reinicie a API para aplicar");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-5 w-5 text-primary" /> Banco de dados da aplicação
        </CardTitle>
        <CardDescription>
          Conexão usada pela API para dados persistentes. A configuração fica em arquivo e só é salva após teste bem-sucedido · fonte atual: <strong>{source || "…"}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!cfg ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="db-type" help="Engine usado pela API. SQLite usa arquivo local; MySQL, MariaDB e PostgreSQL usam conexão de rede.">
                  Tipo
                </LabelWithHelp>
                <Select id="db-type" value={cfg.type} onChange={(e) => set("type", e.target.value)}>
                  <option value="sqlite">SQLite</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB</option>
                  <option value="postgresql">PostgreSQL</option>
                </Select>
              </div>
            </div>
            {isSqlite ? (
              <div className="space-y-1.5">
                <LabelWithHelp htmlFor="db-path" help="Caminho absoluto do arquivo SQLite visto pelo container da API.">
                  Caminho do arquivo
                </LabelWithHelp>
                <Input id="db-path" value={cfg.sqlite_path} spellCheck={false}
                  onChange={(e) => set("sqlite_path", e.target.value)} placeholder="/var/lib/nexus/nexus.db" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <LabelWithHelp htmlFor="db-host" help="Hostname ou IP do servidor de banco acessível pela API.">
                    Host
                  </LabelWithHelp>
                  <Input id="db-host" value={cfg.host} onChange={(e) => set("host", e.target.value)} spellCheck={false} />
                </div>
                <div className="space-y-1.5">
                  <LabelWithHelp htmlFor="db-port" help="Porta TCP do banco. Vazio usa o padrão do engine selecionado.">
                    Porta
                  </LabelWithHelp>
                  <Input id="db-port" value={cfg.port} onChange={(e) => set("port", e.target.value)}
                    placeholder="padrão do engine" spellCheck={false} />
                </div>
                <div className="space-y-1.5">
                  <LabelWithHelp htmlFor="db-user" help="Usuário usado pela API para abrir conexões e executar migrations/consultas.">
                    Usuário
                  </LabelWithHelp>
                  <Input id="db-user" value={cfg.user} onChange={(e) => set("user", e.target.value)} spellCheck={false} />
                </div>
                <div className="space-y-1.5">
                  <LabelWithHelp htmlFor="db-pass" help="Senha do usuário do banco. Se estiver mascarada, deixe como está para manter a senha atual.">
                    Senha
                  </LabelWithHelp>
                  <Input id="db-pass" type="password" value={cfg.password} autoComplete="off"
                    onChange={(e) => set("password", e.target.value)} placeholder="•••• (mantém a atual)" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <LabelWithHelp htmlFor="db-name" help="Nome do database/schema usado pela aplicação.">
                    Banco
                  </LabelWithHelp>
                  <Input id="db-name" value={cfg.name} onChange={(e) => set("name", e.target.value)} spellCheck={false} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <LabelWithHelp htmlFor="db-dsn" help="String de conexão completa. Quando preenchida, tem prioridade sobre host, porta, usuário, senha e banco.">
                DSN (avançado — sobrepõe os campos acima)
              </LabelWithHelp>
              <Input id="db-dsn" type="password" value={cfg.dsn} autoComplete="off" spellCheck={false}
                onChange={(e) => set("dsn", e.target.value)} placeholder="engine://user:pass@host/db (opcional)" />
            </div>
            <RestartNotice />
            <div className="flex gap-2">
              <Button variant="outline" onClick={testConn} disabled={testing || saving}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Testar conexão
              </Button>
              <Button onClick={save} disabled={saving || testing}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
