import { useEffect, useState } from "react";
import { Globe2, KeyRound, Loader2, Save, SlidersHorizontal, UploadCloud } from "lucide-react";
import { get, put } from "@/lib/api";
import type { SettingsData } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { SshKeysManager } from "@/components/cicd/ssh-keys";
import { RegistriesManager } from "@/components/cicd/registries";
import { GitProvidersManager } from "@/components/git-providers";

export function CicdSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <SlidersHorizontal className="h-6 w-6 text-primary" /> Configurações
        </h1>
        <p className="text-sm text-muted-foreground">Credenciais do CI/CD — provedores Git, chaves SSH e registries Docker</p>
      </div>
      <Tabs defaultValue="git">
        <TabsList>
          <TabsTrigger value="git">Provedores Git</TabsTrigger>
          <TabsTrigger value="ssh">Chaves SSH</TabsTrigger>
          <TabsTrigger value="registry">Registry</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="deployment">Deployment</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>
        <TabsContent value="git"><GitProvidersManager /></TabsContent>
        <TabsContent value="ssh"><SshKeysManager /></TabsContent>
        <TabsContent value="registry"><RegistriesManager /></TabsContent>
        <TabsContent value="backups"><BackupSecurityCard /></TabsContent>
        <TabsContent value="deployment"><DeploymentSettingsCard /></TabsContent>
        <TabsContent value="upload"><UploadSettingsCard /></TabsContent>
      </Tabs>
    </div>
  );
}

function BackupSecurityCard() {
  const [secret, setSecret] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((data) => setSecret(data.values.backup_encryption_secret ?? ""))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar configurações"))
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const data = await put<SettingsData>("/settings", { backup_encryption_secret: secret });
      setSecret(data.values.backup_encryption_secret ?? secret);
      toast.success("Secret de backup salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar secret");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Criptografia de backups
        </CardTitle>
        <CardDescription>Secret global usada quando a criptografia estiver habilitada em um serviço.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 sm:max-w-lg">
          <Label>Secret</Label>
          <Input type="password" value={secret} disabled={!loaded}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Defina uma senha forte para AES-256-CBC" />
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={save} disabled={saving || !loaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadSettingsCard() {
  const [maxMb, setMaxMb] = useState("100");
  const [concurrency, setConcurrency] = useState("8");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((data) => {
        setMaxMb(String(data.values.upload_max_mb ?? 100));
        setConcurrency(String(data.values.upload_concurrency ?? 8));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar configurações"))
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const data = await put<SettingsData>("/settings", {
        upload_max_mb: Number(maxMb) || 100,
        upload_concurrency: Number(concurrency) || 8,
      });
      setMaxMb(String(data.values.upload_max_mb ?? maxMb));
      setConcurrency(String(data.values.upload_concurrency ?? concurrency));
      toast.success("Configuração de upload salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UploadCloud className="h-4 w-4" /> Upload de arquivos
        </CardTitle>
        <CardDescription>
          Limites do gerenciador de arquivos das aplicações SPA (aba Provider → SPA).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tamanho máximo por arquivo (MB)</Label>
            <Input type="number" min={1} max={10240} value={maxMb} disabled={!loaded}
              onChange={(e) => setMaxMb(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Arquivos em paralelo (fila)</Label>
            <Input type="number" min={1} max={64} value={concurrency} disabled={!loaded}
              onChange={(e) => setConcurrency(e.target.value)} />
            <p className="text-xs text-muted-foreground">Quantos arquivos da fila são enviados simultaneamente.</p>
          </div>
        </div>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={save} disabled={saving || !loaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeploymentSettingsCard() {
  const [domain, setDomain] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("0");
  const [limit, setLimit] = useState("0");
  const [https, setHttps] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<SettingsData>("/settings")
      .then((data) => {
        const values = data.values;
        setDomain(values.deployment_preview_domain ?? "");
        setIp(values.deployment_preview_ip ?? "");
        setPort(String(values.deployment_preview_port ?? 0));
        setLimit(String(values.deployment_preview_limit ?? 0));
        setHttps(!!values.deployment_preview_https);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar configurações"))
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const data = await put<SettingsData>("/settings", {
        deployment_preview_domain: domain,
        deployment_preview_ip: ip,
        deployment_preview_port: Number(port) || 0,
        deployment_preview_limit: Number(limit) || 0,
        deployment_preview_https: https,
      });
      const values = data.values;
      setDomain(values.deployment_preview_domain ?? domain);
      setIp(values.deployment_preview_ip ?? ip);
      setPort(String(values.deployment_preview_port ?? port));
      setLimit(String(values.deployment_preview_limit ?? limit));
      setHttps(!!values.deployment_preview_https);
      toast.success("Configuração de deployment salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe2 className="h-4 w-4" /> Deployment
        </CardTitle>
        <CardDescription>
          Configuração usada para gerar URLs atômicas de preview dos deployments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Wildcard domain</Label>
            <Input value={domain} disabled={!loaded}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="*.preview.example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>IP ou host fallback</Label>
            <Input value={ip} disabled={!loaded}
              onChange={(e) => setIp(e.target.value)}
              placeholder="127.0.0.1" />
          </div>
          <div className="space-y-1.5">
            <Label>Porta</Label>
            <Input type="number" min={0} max={65535} value={port} disabled={!loaded}
              onChange={(e) => setPort(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Preview limit</Label>
            <Input type="number" min={0} value={limit} disabled={!loaded}
              onChange={(e) => setLimit(e.target.value)} />
            <p className="text-xs text-muted-foreground">0 exibe todos os deployments.</p>
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>
            <span className="block font-medium">HTTPS</span>
            <span className="text-muted-foreground">Usar https nas URLs geradas.</span>
          </span>
          <Switch checked={https} disabled={!loaded} onCheckedChange={setHttps} />
        </label>
        <div className="flex justify-end border-t pt-4">
          <Button onClick={save} disabled={saving || !loaded}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
