import { useEffect, useState } from "react";
import { Bot, FlaskConical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AiProvider, AiProviderTestResult, AiProviderType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function providerLabel(types: AiProviderType[], type: string): string {
  return types.find((item) => item.type === type)?.label ?? type;
}

export function AiProvidersManager() {
  const { can } = useAuth();
  const writable = can("ai", "write");
  const [types, setTypes] = useState<AiProviderType[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<AiProvider | "new" | null>(null);
  const [toDelete, setToDelete] = useState<AiProvider | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      get<AiProviderType[]>("/ai/provider-types"),
      get<AiProvider[]>("/ai/providers"),
    ])
      .then(([providerTypes, items]) => {
        setTypes(providerTypes);
        setProviders(items);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar providers IA"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggle(provider: AiProvider, enabled: boolean) {
    setBusyId(provider.id);
    try {
      const updated = await put<AiProvider>(`/ai/providers/${provider.id}`, { enabled });
      setProviders((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(enabled ? "Provider ativado" : "Provider desativado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar o provider");
    } finally {
      setBusyId(null);
    }
  }

  async function test(provider: AiProvider) {
    setBusyId(provider.id);
    try {
      const result = await post<AiProviderTestResult>(`/ai/providers/${provider.id}/test`);
      toast.success(`Conexão validada em ${result.latency_ms} ms`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar o provider");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(provider: AiProvider) {
    try {
      await del(`/ai/providers/${provider.id}`);
      toast.success("Provider IA removido");
      setProviders((items) => items.filter((item) => item.id !== provider.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover o provider");
      throw error;
    }
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-5 w-5 text-primary" /> Providers IA
            </CardTitle>
            <CardDescription>
              Conexões com modelos externos e locais usadas pelos recursos de inteligência artificial.
            </CardDescription>
          </div>
          {writable && (
            <Button size="sm" onClick={() => setEditing("new")} disabled={loading || types.length === 0}>
              <Plus className="h-4 w-4" /> Adicionar
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : providers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum provider IA configurado.
            </p>
          ) : (
            providers.map((provider) => (
              <div key={provider.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{provider.name}</span>
                    <Badge variant="outline">{providerLabel(types, provider.type)}</Badge>
                    {!provider.enabled && <Badge variant="secondary">desativado</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {provider.model} · {provider.api_url}
                  </p>
                </div>
                {writable && (
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Switch
                            checked={provider.enabled}
                            disabled={busyId === provider.id}
                            onCheckedChange={(checked) => toggle(provider, checked)}
                            aria-label={provider.enabled ? "Desativar provider" : "Ativar provider"}
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{provider.enabled ? "Desativar" : "Ativar"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busyId === provider.id}
                          onClick={() => test(provider)}
                          aria-label="Testar conexão"
                        >
                          {busyId === provider.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <FlaskConical className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Testar conexão e model</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setEditing(provider)} aria-label="Editar">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setToDelete(provider)} aria-label="Remover">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Remover</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>

        {editing && (
          <AiProviderDialog
            types={types}
            provider={editing === "new" ? null : editing}
            onOpenChange={(open) => !open && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
        <ConfirmDelete
          open={toDelete !== null}
          onOpenChange={(open) => !open && setToDelete(null)}
          title={`Remover provider '${toDelete?.name}'?`}
          description="A configuração e a API key serão apagadas."
          onConfirm={() => {
            if (toDelete) return remove(toDelete);
          }}
        />
      </Card>
    </TooltipProvider>
  );
}

function AiProviderDialog({
  types,
  provider,
  onOpenChange,
  onSaved,
}: {
  types: AiProviderType[];
  provider: AiProvider | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = provider !== null;
  const initialType = provider?.type ?? types[0]?.type ?? "openai";
  const initialMeta = types.find((item) => item.type === initialType);
  const [type, setType] = useState(initialType);
  const [name, setName] = useState(provider?.name ?? "");
  const [apiUrl, setApiUrl] = useState(provider?.api_url ?? initialMeta?.default_url ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider?.model ?? "");
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const meta = types.find((item) => item.type === type);

  function changeType(nextType: string) {
    const oldDefault = types.find((item) => item.type === type)?.default_url;
    const nextMeta = types.find((item) => item.type === nextType);
    setType(nextType);
    if (!apiUrl.trim() || apiUrl === oldDefault) {
      setApiUrl(nextMeta?.default_url ?? "");
    }
  }

  function body() {
    return {
      type,
      name: name.trim(),
      api_url: apiUrl.trim(),
      api_key: apiKey.trim(),
      model: model.trim(),
      enabled,
    };
  }

  function validate(): string | null {
    if (!name.trim()) return "Nome é obrigatório";
    if (!apiUrl.trim()) return "API URL é obrigatória";
    try {
      const parsed = new URL(apiUrl.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) return "API URL deve usar http:// ou https://";
      if (parsed.username || parsed.password) return "API URL não deve conter usuário ou senha";
    } catch {
      return "API URL inválida";
    }
    if (!model.trim()) return "Model é obrigatório";
    if (meta?.api_key_required && !apiKey.trim() && !(isEdit && provider.has_api_key)) {
      return "API key é obrigatória para este provider";
    }
    return null;
  }

  async function test() {
    const error = validate();
    if (error) return toast.error(error);
    setTesting(true);
    try {
      const payload = isEdit ? { ...body(), id: provider.id } : body();
      const result = await post<AiProviderTestResult>("/ai/providers/test", payload);
      toast.success(`Conexão validada em ${result.latency_ms} ms`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao testar o provider");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    const error = validate();
    if (error) return toast.error(error);
    setSaving(true);
    try {
      if (isEdit) await put(`/ai/providers/${provider.id}`, body());
      else await post("/ai/providers", body());
      toast.success(isEdit ? "Provider IA atualizado" : "Provider IA criado");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar o provider");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Provider IA" : "Novo Provider IA"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Deixe a API key em branco para manter a chave atual."
              : "Configure o endpoint e teste a conexão antes de salvar."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ai-type" help="Define o protocolo usado no teste e nas chamadas ao provider.">
              Provider
            </LabelWithHelp>
            <Select id="ai-type" value={type} onChange={(event) => changeType(event.target.value)}>
              {types.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ai-name" help="Nome amigável para identificar esta configuração no painel.">
              Nome <span className="text-destructive">*</span>
            </LabelWithHelp>
            <Input id="ai-name" value={name} onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: OpenAI principal" maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ai-url" help="URL base da API. Também aceita a URL completa do endpoint de chat do provider.">
              API URL <span className="text-destructive">*</span>
            </LabelWithHelp>
            <Input id="ai-url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)}
              placeholder={meta?.default_url} spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ai-key" help="Credencial enviada somente pelo backend. No Ollama local ela pode ficar vazia.">
              API key {meta?.api_key_required && <span className="text-destructive">*</span>}
            </LabelWithHelp>
            <Input
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={isEdit && provider.has_api_key ? "•••••• (deixe vazio para manter)" : "Chave do provider"}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="ai-model" help="Identificador exato do modelo disponibilizado pelo provider.">
              Model <span className="text-destructive">*</span>
            </LabelWithHelp>
            <Input id="ai-model" value={model} onChange={(event) => setModel(event.target.value)}
              placeholder={meta?.model_placeholder} spellCheck={false} maxLength={255} />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <div className="font-medium">Ativo</div>
              <p className="text-xs text-muted-foreground">Permite usar este provider nas funcionalidades de IA.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Ativar provider" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || testing}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={test} disabled={saving || testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Testar
          </Button>
          <Button onClick={save} disabled={saving || testing}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
