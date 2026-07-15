import { useEffect, useState } from "react";
import { Cloud, FileText, HelpCircle, Loader2, Plus, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { get, put } from "@/lib/api";
import { SettingsData } from "@/lib/types";

const SLOTS = [1, 2, 3] as const;

type TunnelDraft = {
  index: number;
  enabled: boolean;
  token: string;
};

type CloudflaredLog = {
  index: number;
  path: string;
  content: string;
  exists: boolean;
  truncated?: boolean;
  size?: number;
};

function enabledKey(index: number) {
  return `cloudflare_tunnel_${index}_enabled`;
}

function tokenKey(index: number) {
  return `cloudflare_tunnel_${index}_token`;
}

function Tip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground">
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

function statusBadge(active: boolean, yes: string, no: string) {
  return active ? <Badge variant="success">{yes}</Badge> : <Badge variant="muted">{no}</Badge>;
}

function emptyDrafts(): TunnelDraft[] {
  return SLOTS.map((index) => ({ index, enabled: false, token: "" }));
}

export function TunnelSettings() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [drafts, setDrafts] = useState<TunnelDraft[]>(emptyDrafts);
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>([]);
  const [logs, setLogs] = useState<Record<number, CloudflaredLog | undefined>>({});
  const [openLog, setOpenLog] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingLog, setLoadingLog] = useState<number | null>(null);

  function hydrate(d: SettingsData) {
    setData(d);
    const statuses = new Map((d.cloudflared?.tunnels || []).map((t) => [t.index, t]));
    const nextDrafts = SLOTS.map((index) => ({
      index,
      enabled: Boolean(d.values[enabledKey(index) as keyof SettingsData["values"]])
        || (index === 1 && Boolean(d.values.cloudflare_tunnel_enabled)),
      token: String(
        d.values[tokenKey(index) as keyof SettingsData["values"]]
        || (index === 1 ? d.values.cloudflare_tunnel_token : "")
        || "",
      ),
    }));
    setDrafts(nextDrafts);
    setVisibleIndexes(nextDrafts
      .filter((draft) => (
        draft.enabled
        || Boolean(draft.token)
        || Boolean(statuses.get(draft.index)?.has_token)
        || Boolean(statuses.get(draft.index)?.running)
      ))
      .map((draft) => draft.index));
  }

  async function load() {
    setLoading(true);
    try {
      hydrate(await get<SettingsData>("/settings"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar Tunnel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateDraft(index: number, patch: Partial<TunnelDraft>) {
    setDrafts((current) => current.map((item) => (
      item.index === index ? { ...item, ...patch } : item
    )));
  }

  function addTunnel() {
    const next = SLOTS.find((index) => !visibleIndexes.includes(index));
    if (!next) return;
    setVisibleIndexes((current) => [...current, next].sort((a, b) => a - b));
  }

  async function loadLog(index: number) {
    setOpenLog(index);
    setLoadingLog(index);
    try {
      const log = await get<CloudflaredLog>(`/settings/cloudflared/${index}/log?max_bytes=120000`);
      setLogs((current) => ({ ...current, [index]: log }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Falha ao carregar log do tunnel ${index}`);
    } finally {
      setLoadingLog(null);
    }
  }

  async function save() {
    for (const draft of drafts) {
      if (draft.enabled && !draft.token.trim()) {
        toast.error(`Informe o token do Cloudflare Tunnel ${draft.index} antes de ativar`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = {};
      payload.cloudflare_tunnel_enabled = false;
      for (const draft of drafts) {
        payload[enabledKey(draft.index)] = draft.enabled;
        payload[tokenKey(draft.index)] = draft.token.trim();
      }
      const updated = await put<SettingsData>("/settings", payload);
      hydrate(updated);
      toast.success("Cloudflare Tunnels salvos");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar Tunnel");
    } finally {
      setSaving(false);
    }
  }

  const statusByIndex = new Map((data?.cloudflared?.tunnels || []).map((t) => [t.index, t]));
  const visibleDrafts = drafts.filter((draft) => visibleIndexes.includes(draft.index));
  const canAdd = visibleIndexes.length < SLOTS.length;

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-5 w-5 text-primary" />
            Cloudflare Tunnel
          </CardTitle>
          <CardDescription>
            Configure até 3 tunnels independentes, cada um com token, processo e log próprios.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {visibleDrafts.length
              ? `${visibleDrafts.length} de ${SLOTS.length} tunnels configurados`
              : "Nenhum tunnel adicionado"}
          </div>
          <Button type="button" variant="outline" onClick={addTunnel} disabled={!canAdd || loading || saving}>
            <Plus className="h-4 w-4" />
            Adicionar tunnel
          </Button>
        </div>

        <div className="space-y-4">
          {visibleDrafts.map((draft) => {
            const status = statusByIndex.get(draft.index);
            const log = logs[draft.index];
            const isLogOpen = openLog === draft.index;
            return (
              <div key={draft.index} className="space-y-4 rounded-md border bg-muted/10 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">Tunnel {draft.index}</h3>
                      {statusBadge(Boolean(status?.running), "Rodando", "Parado")}
                      {statusBadge(Boolean(status?.installed), "Instalado", "Não instalado")}
                      {status?.pid ? <Badge variant="secondary">PID {status.pid}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Log em <span className="font-mono">{status?.log || `/var/log/nexus/cloudflared-${draft.index}.log`}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm text-muted-foreground">{draft.enabled ? "Ativo" : "Inativo"}</span>
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(v) => updateDraft(draft.index, { enabled: Boolean(v) })}
                      disabled={loading || saving}
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`cloudflare-tunnel-${draft.index}-token`} className="flex items-center gap-2">
                      Token do tunnel {draft.index}
                      <Tip text="Cole o token gerado pelo Cloudflare Zero Trust. Ao salvar com o switch ativo, o backend instala o cloudflared quando necessário e executa este slot com esse token." />
                    </Label>
                    <Input
                      id={`cloudflare-tunnel-${draft.index}-token`}
                      type="password"
                      value={draft.token}
                      onChange={(e) => updateDraft(draft.index, { token: e.target.value })}
                      placeholder="eyJhIjoi..."
                      spellCheck={false}
                      autoComplete="off"
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => loadLog(draft.index)}
                      disabled={loadingLog === draft.index}
                    >
                      {loadingLog === draft.index ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      Ver logs
                    </Button>
                  </div>
                </div>

                {isLogOpen ? (
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {log?.exists
                          ? `${log.path}${log.truncated ? " (últimos bytes)" : ""}`
                          : `Log ainda não criado para o tunnel ${draft.index}`}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => loadLog(draft.index)}
                        disabled={loadingLog === draft.index}
                      >
                        {loadingLog === draft.index ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Atualizar
                      </Button>
                    </div>
                    <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
                      {log?.content || "Sem conteúdo de log."}
                    </pre>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!visibleDrafts.length ? (
            <div className="rounded-md border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground">
              Clique em Adicionar tunnel para configurar o primeiro Cloudflare Tunnel.
            </div>
          ) : null}
        </div>

        {data?.cloudflared ? (
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Binário: </span>
            <span className="break-all font-mono">{data.cloudflared.path}</span>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </Button>
          <Button type="button" variant="outline" onClick={load} disabled={loading || saving}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Recarregar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
