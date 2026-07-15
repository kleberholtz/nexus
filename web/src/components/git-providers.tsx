import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clipboard, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { del, get, getApiBase, post, put } from "@/lib/api";
import { GitProvider, GitProviderKind } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const KIND_LABELS: Record<GitProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};
const DEFAULT_BASE_URL: Record<GitProviderKind, string> = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  gitea: "",
  bitbucket: "https://bitbucket.org",
};
const BITBUCKET_SCOPES = [
  "read:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "read:webhook:bitbucket",
  "read:workspace:bitbucket",
  "write:webhook:bitbucket",
];

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copiado");
  } catch {
    toast.error("Não foi possível copiar");
  }
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 80);
}

function randomSecret() {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function todaySlug() {
  return new Date().toISOString().replace(/[^0-9]+/g, "").slice(0, 14);
}

function defaultProviderName(type: GitProviderKind) {
  return type === "github" ? `app-${todaySlug()}` : type;
}

function postManifestToGithub(url: string, manifest: string, target: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = url;
  form.target = target;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = manifest;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function authorizationUrl(provider: Pick<GitProvider, "type" | "provider_url" | "base_url" | "app_id" | "name"> & Partial<Pick<GitProvider, "github_app_slug">>, callbackUrl: string) {
  const base = (provider.provider_url || provider.base_url || DEFAULT_BASE_URL[provider.type]).replace(/\/+$/, "");
  if (provider.type === "github") {
    const params = new URLSearchParams({
      state: `gh_setup:${crypto.randomUUID()}`,
    });
    return `${base}/apps/${provider.github_app_slug || provider.name}/installations/new?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: provider.app_id,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: provider.type === "gitlab" ? "read_repository" : "read:repository",
  });
  const path = provider.type === "gitlab" ? "/oauth/authorize" : "/login/oauth/authorize";
  return `${base}${path}?${params.toString()}`;
}

export function GitProvidersManager() {
  const [providers, setProviders] = useState<GitProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GitProvider | "new" | null>(null);
  const [toDelete, setToDelete] = useState<GitProvider | null>(null);

  function load() {
    setLoading(true);
    get<GitProvider[]>("/deploy/providers")
      .then(setProviders)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type === "nexus:github-provider-created" || event.data?.type === "nexus:github-provider-connected") {
        setEditing(null);
        load();
        toast.success(event.data.type === "nexus:github-provider-created" ? "GitHub App criado" : "GitHub App conectado");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function remove(p: GitProvider) {
    try {
      await del(`/deploy/providers/${p.id}`);
      toast.success("Provedor removido");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  function connect(p: GitProvider) {
    const callbackUrl = `${getApiBase()}/git/providers/${p.name}/callback`;
    const target = `nexus-github-connect-${p.id}-${crypto.randomUUID()}`;
    const popup = window.open(authorizationUrl(p, callbackUrl), target, "width=1100,height=850");
    if (popup) {
      const timer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(timer);
        load();
      }, 1000);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Provedores Git</CardTitle>
          <CardDescription>
            GitHub, GitLab e Gitea usam App OAuth. Bitbucket usa token com escopos de leitura e webhook.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum provedor configurado. Repositórios públicos podem usar origem Git direta.
          </p>
        ) : (
          providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{KIND_LABELS[p.type]}</Badge>
                  <span className="font-medium">{p.label}</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{p.name}</code>
                  {p.type !== "bitbucket" && (
                    p.has_token ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" /> conectado
                      </Badge>
                    ) : (
                      <Badge variant="warning">oauth pendente</Badge>
                    )
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {p.provider_url && <span className="font-mono">{p.provider_url}</span>}
                  {p.webhook_path && <span className="font-mono">{p.webhook_path}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                {p.type !== "bitbucket" && !p.has_token && (
                  <Button variant="outline" size="sm" onClick={() => connect(p)}>
                    <ExternalLink className="h-4 w-4" /> Conectar
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setEditing(p)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setToDelete(p)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {editing && (
        <ProviderDialog
          provider={editing === "new" ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Remover provedor '${toDelete?.label}'?`}
        description="Aplicações que referenciam este provedor deixam de autenticar o clone de repositórios privados."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </Card>
  );
}

function ProviderDialog({ provider, onOpenChange, onSaved }: {
  provider: GitProvider | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!provider;
  const [type, setType] = useState<GitProviderKind>(provider?.type || "github");
  const [name, setName] = useState(provider?.name || defaultProviderName(provider?.type || "github"));
  const [label] = useState(provider?.label || "");
  const [providerUrl, setProviderUrl] = useState(provider?.provider_url || provider?.base_url || DEFAULT_BASE_URL[type]);
  const [appId, setAppId] = useState(provider?.app_id || "");
  const [githubClientId, setGithubClientId] = useState(provider?.github_client_id || "");
  const [appSecret, setAppSecret] = useState("");
  const [githubPrivateKey, setGithubPrivateKey] = useState("");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState(provider?.webhook_secret || "");
  const [githubOrganization, setGithubOrganization] = useState(false);
  const [githubOrganizationName, setGithubOrganizationName] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testedKey, setTestedKey] = useState("");
  const initializedTest = useRef(false);
  const effectiveName = name.trim() || type;

  const callbackUrl = useMemo(() => {
    return `${getApiBase()}/git/providers/${effectiveName}/callback`;
  }, [effectiveName]);
  const webhookUrl = useMemo(() => {
    return `${getApiBase()}/git/providers/${effectiveName}/webhook`;
  }, [effectiveName]);
  const isBitbucket = type === "bitbucket";
  const isGitHub = type === "github";
  const testPayload = useMemo(() => ({
    provider_id: provider?.id,
    type,
    name: effectiveName,
    provider_url: providerUrl,
    app_id: isBitbucket ? "" : appId,
    github_client_id: isGitHub ? githubClientId : "",
    app_secret: isBitbucket ? "" : appSecret,
    github_private_key: isGitHub ? githubPrivateKey : "",
    token: isBitbucket ? token : "",
    callback_url: callbackUrl,
  }), [appId, appSecret, callbackUrl, effectiveName, githubClientId, githubPrivateKey, isBitbucket, isGitHub, provider?.id, providerUrl, token, type]);
  const testKey = useMemo(() => JSON.stringify(testPayload), [testPayload]);
  const tested = testedKey === testKey;

  useEffect(() => {
    if (!isEdit) {
      setProviderUrl(DEFAULT_BASE_URL[type]);
      setName(defaultProviderName(type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    if (isEdit && !initializedTest.current) {
      setTestedKey(testKey);
      initializedTest.current = true;
    }
  }, [isEdit, testKey]);

  async function testProvider() {
    setTesting(true);
    try {
      await post<{ ok: boolean; auth_mode: "app" | "token"; authorization_url?: string }>("/deploy/providers/test", testPayload);
      setTestedKey(testKey);
      toast.success("Configuração validada");
    } catch (e) {
      setTestedKey("");
      toast.error(e instanceof Error ? e.message : "Falha ao testar");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        type,
        name: effectiveName,
        label,
        provider_url: providerUrl,
        app_id: isBitbucket ? "" : appId,
        github_client_id: isGitHub ? githubClientId : "",
        app_secret: isBitbucket ? "" : appSecret,
        github_private_key: isGitHub ? githubPrivateKey : "",
        token: isBitbucket ? token : "",
        webhook_secret: webhookSecret,
      };
      if (isEdit) {
        await put(`/deploy/providers/${provider!.id}`, payload);
      } else {
        await post("/deploy/providers", payload);
      }
      toast.success(isEdit ? "Provedor atualizado" : "Provedor criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  function createGithubAppFromManifest() {
    if (!isGitHub) return;
    const base = (providerUrl || DEFAULT_BASE_URL.github).replace(/\/+$/, "");
    const organization = githubOrganizationName.trim();
    if (githubOrganization && !organization) {
      toast.error("Informe o nome da organização");
      return;
    }
    const setupParams = new URLSearchParams({
      name: effectiveName,
      label: label || KIND_LABELS.github,
      base_url: base,
    });
    const manifest = JSON.stringify(
      {
        redirect_url: `${getApiBase()}/git/providers/github/manifest/callback?${setupParams.toString()}`,
        name: effectiveName,
        url: window.location.origin,
        hook_attributes: {
          url: webhookUrl,
        },
        callback_urls: [callbackUrl],
        public: false,
        request_oauth_on_install: true,
        default_permissions: {
          contents: "read",
          metadata: "read",
          emails: "read",
          pull_requests: "write",
        },
        default_events: ["pull_request", "push"],
      },
      null,
      4,
    );
    const state = new URLSearchParams({ state: `gh_manifest:${crypto.randomUUID()}` });
    const setupPath = githubOrganization
      ? `/organizations/${encodeURIComponent(organization)}/settings/apps/new`
      : "/settings/apps/new";
    const target = `nexus-github-manifest-${crypto.randomUUID()}`;
    const popup = window.open("", target, "width=1100,height=850");
    postManifestToGithub(`${base}${setupPath}?${state.toString()}`, manifest, popup ? target : "_blank");
    if (popup) {
      const timer = window.setInterval(() => {
        if (!popup.closed) return;
        window.clearInterval(timer);
        onSaved();
      }, 1000);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar provedor Git" : "Novo provedor Git"}</DialogTitle>
          <DialogDescription>
            {isBitbucket
              ? "Informe o token do Bitbucket com os escopos exigidos."
              : type === "github"
                ? "Crie um GitHub App por manifesto ou informe App ID, App secret e Private key PEM."
                : "Crie um App no provedor, configure a callback URL e salve App ID e App Secret."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <div className="space-y-4">
            {!isEdit && (
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={type} onChange={(e) => setType(e.target.value as GitProviderKind)}>
                  <option value="github">GitHub App</option>
                  <option value="gitlab">GitLab App</option>
                  <option value="gitea">Gitea App</option>
                  <option value="bitbucket">Bitbucket token</option>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="gp-name">Name</Label>
              <Input id="gp-name" value={name} onChange={(e) => setName(normalizeName(e.target.value))}
                placeholder={type} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gp-url">{KIND_LABELS[type]} URL</Label>
              <Input id="gp-url" value={providerUrl} onChange={(e) => setProviderUrl(e.target.value)}
                placeholder={type === "gitea" ? "https://git.exemplo.com" : DEFAULT_BASE_URL[type]} />
            </div>
            {isGitHub && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="gp-github-org" className="cursor-pointer">Organização?</Label>
                  <Switch id="gp-github-org" checked={githubOrganization} onCheckedChange={setGithubOrganization} />
                </div>
                {githubOrganization && (
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="gp-github-org-name">Nome da organização</Label>
                    <Input id="gp-github-org-name" value={githubOrganizationName}
                      onChange={(e) => setGithubOrganizationName(e.target.value)}
                      placeholder="minha-organizacao"
                      autoComplete="off" spellCheck={false} />
                  </div>
                )}
              </div>
            )}
            {!isBitbucket ? (
              <>
                <div className="space-y-1.5">
                  <Label>Callback URL</Label>
                  <div className="flex gap-2">
                    <Input value={callbackUrl} readOnly className="font-mono text-xs" />
                    <Button type="button" variant="outline" size="icon" onClick={() => copyText(callbackUrl)}>
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="gp-app-id">App ID</Label>
                    <Input id="gp-app-id" value={appId} onChange={(e) => setAppId(e.target.value)}
                      autoComplete="off" spellCheck={false} />
                  </div>
                  {isGitHub && (
                    <div className="space-y-1.5">
                      <Label htmlFor="gp-github-client-id">Client ID</Label>
                      <Input id="gp-github-client-id" value={githubClientId}
                        onChange={(e) => setGithubClientId(e.target.value)}
                        autoComplete="off" spellCheck={false} />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="gp-app-secret">{isGitHub ? "Client secret" : "App secret"}</Label>
                    <Input id="gp-app-secret" type="password" value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder={isEdit ? "deixe vazio para manter" : undefined}
                      autoComplete="off" spellCheck={false} />
                  </div>
                </div>
                {isGitHub && (
                  <div className="space-y-1.5">
                    <Label htmlFor="gp-github-private-key">Private key (PEM)</Label>
                    <Textarea id="gp-github-private-key" value={githubPrivateKey}
                      onChange={(e) => setGithubPrivateKey(e.target.value)}
                      placeholder={isEdit ? "deixe vazio para manter" : "-----BEGIN RSA PRIVATE KEY-----"}
                      rows={7}
                      autoComplete="off" spellCheck={false} />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="gp-token">Bitbucket token</Label>
                <Input id="gp-token" type="password" value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder={isEdit ? "deixe vazio para manter" : undefined}
                  autoComplete="off" spellCheck={false} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Webhook URL</Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={() => copyText(webhookUrl)}>
                  <Clipboard className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gp-webhook-secret">Webhook secret</Label>
              <div className="flex gap-2">
                <Input id="gp-webhook-secret" type="password" value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="gerado automaticamente se ficar vazio"
                  autoComplete="off" spellCheck={false} />
                <Button type="button" variant="outline" size="icon" disabled={!webhookSecret} onClick={() => copyText(webhookSecret)}>
                  <Clipboard className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={() => setWebhookSecret(randomSecret())}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            {!isBitbucket ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 font-medium">
                  <ExternalLink className="h-4 w-4" /> Passos para {KIND_LABELS[type]}
                </div>
                {isGitHub && (
                  <Button type="button" variant="outline" className="w-full justify-center" onClick={createGithubAppFromManifest}>
                    <ExternalLink className="h-4 w-4" /> Criar app
                  </Button>
                )}
                <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                  <li>{isGitHub ? "Use Criar app para abrir o manifesto no GitHub." : "Crie um App OAuth na área de developer/admin do provedor."}</li>
                  <li>{isGitHub ? "O callback do manifesto salva App ID, App secret e Private key PEM neste provider." : "Informe a Callback URL mostrada aqui no campo redirect/callback do App."}</li>
                  <li>{isGitHub ? "Depois de criar, use Conectar para instalar ou atualizar permissões do GitHub App." : "Copie o App ID e o App Secret para este formulário."}</li>
                  <li>{isGitHub ? "O GitHub redireciona com installation_id; o backend gera installation tokens quando precisar clonar." : "Depois de salvar, autorize o App no provedor para o callback gravar o access token."}</li>
                  <li>Cadastre a Webhook URL no App/repositório usando o Webhook secret deste provider.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="font-medium">Escopos do Bitbucket</div>
                <div className="space-y-1 font-mono text-xs text-muted-foreground">
                  {BITBUCKET_SCOPES.map((scope) => <div key={scope}>{scope}</div>)}
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="outline" onClick={testProvider} disabled={busy || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Testar
          </Button>
          <Button onClick={save} disabled={busy || testing || !tested}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
