import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { DnsProvider, DnsProviderType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

export function DnsProvidersManager() {
  const [types, setTypes] = useState<DnsProviderType[]>([]);
  const [providers, setProviders] = useState<DnsProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DnsProvider | "new" | null>(null);
  const [toDelete, setToDelete] = useState<DnsProvider | null>(null);

  function load() {
    setLoading(true);
    Promise.all([get<DnsProviderType[]>("/dns/provider-types"), get<DnsProvider[]>("/dns/providers")])
      .then(([t, p]) => {
        setTypes(t);
        setProviders(p);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(p: DnsProvider) {
    try {
      await del(`/dns/providers/${p.id}`);
      toast.success("Provedor removido");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  return (
    <TooltipProvider>
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Provedores DNS</CardTitle>
          <CardDescription>Credenciais usadas na gestão de DNS e no Let's Encrypt (DNS-01).</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum provedor configurado.</p>
        ) : (
          providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <Badge variant="secondary">{p.type}</Badge>
                <span className="font-medium">{p.label}</span>
              </div>
              <div className="flex gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(p)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Editar</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setToDelete(p)} aria-label="Remover">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remover</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {editing && (
        <ProviderDialog
          types={types}
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
        description="As credenciais serão apagadas. Certificados já emitidos continuam válidos."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </Card>
    </TooltipProvider>
  );
}

function ProviderDialog({
  types,
  provider,
  onOpenChange,
  onSaved,
}: {
  types: DnsProviderType[];
  provider: DnsProvider | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!provider;
  const [type, setType] = useState(provider?.type || types[0]?.type || "cloudflare");
  const [label, setLabel] = useState(provider?.label || "");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const schema = types.find((t) => t.type === type);

  useEffect(() => {
    // Em edição, começa com os campos vazios (segredos ficam mascarados; vazio = mantém).
    setConfig({});
  }, [type]);

  async function save() {
    // Validação: em criação, todos os campos são obrigatórios.
    if (!isEdit && schema) {
      const missing = schema.fields.filter((f) => !config[f.key]?.trim());
      if (missing.length) {
        toast.error(`Preencha: ${missing.map((f) => f.label).join(", ")}`);
        return;
      }
    }
    setBusy(true);
    try {
      if (isEdit) {
        await put(`/dns/providers/${provider!.id}`, { label, config });
      } else {
        await post("/dns/providers", { type, label, config });
      }
      toast.success(isEdit ? "Provedor atualizado" : "Provedor criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar provedor DNS" : "Novo provedor DNS"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Deixe um segredo em branco para mantê-lo." : "Escolha o provedor e informe as credenciais."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Provedor</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {types.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="prov-label">Rótulo</Label>
            <Input id="prov-label" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder={schema?.label} />
          </div>
          {schema?.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
              {f.multiline ? (
                <Textarea id={`f-${f.key}`} value={config[f.key] || ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={isEdit && f.secret ? "•••••• (deixe vazio para manter)" : undefined}
                  spellCheck={false} className="min-h-[100px] font-mono text-xs" />
              ) : (
                <Input id={`f-${f.key}`} type={f.secret ? "password" : "text"}
                  value={config[f.key] || ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={isEdit && f.secret ? "•••••• (deixe vazio para manter)" : undefined}
                  autoComplete="off" spellCheck={false} />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
