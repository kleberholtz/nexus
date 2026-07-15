import { useEffect, useState } from "react";
import { Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import type { SshKey } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast.success("Copiado"); }
  catch { toast.error("Não foi possível copiar"); }
}

export function SshKeysManager() {
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SshKey | "new" | null>(null);
  const [toDelete, setToDelete] = useState<SshKey | null>(null);

  function load() {
    setLoading(true);
    get<SshKey[]>("/deploy/ssh-keys").then(setKeys)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(k: SshKey) {
    try { await del(`/deploy/ssh-keys/${k.id}`); toast.success("Chave removida"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao remover"); throw e; }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Chaves SSH</CardTitle>
          <CardDescription>Pares de chave para clone git via SSH. A privada é gerada se não for informada.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Adicionar</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : keys.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma chave SSH.</p>
          : keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Badge variant="secondary">#{k.id}</Badge>
                <div className="min-w-0">
                  <div className="font-medium">{k.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground" title={k.public_key}>
                    {k.public_key || "(sem chave pública)"}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                {k.public_key && (
                  <Button variant="ghost" size="icon" onClick={() => copyText(k.public_key)} title="Copiar chave pública">
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setToDelete(k)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
          ))}
      </CardContent>

      {editing && (
        <SshKeyDialog sshKey={editing === "new" ? null : editing}
                      onOpenChange={(o) => !o && setEditing(null)}
                      onSaved={() => { setEditing(null); load(); }} />
      )}
      <ConfirmDelete open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}
                     title={`Remover chave '${toDelete?.name}'?`}
                     description="A chave SSH será apagada. Deployments que a usam deixarão de autenticar."
                     onConfirm={() => { if (toDelete) return remove(toDelete); }} />
    </Card>
  );
}

function SshKeyDialog({ sshKey, onOpenChange, onSaved }: {
  sshKey: SshKey | null; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const isEdit = !!sshKey;
  const [name, setName] = useState(sshKey?.name ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState(sshKey?.public_key ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = { name: name.trim(), private_key: privateKey, public_key: publicKey };
      if (isEdit) await put(`/deploy/ssh-keys/${sshKey!.id}`, body);
      else await post("/deploy/ssh-keys", body);
      toast.success(isEdit ? "Chave atualizada" : "Chave criada");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar chave SSH" : "Nova chave SSH"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Deixe a chave privada vazia para mantê-la."
              : "Deixe a chave privada vazia para gerar um par ed25519 automaticamente."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="deploy-key" /></div>
          <div className="space-y-1.5"><Label>Chave privada (opcional)</Label>
            <Textarea value={privateKey} rows={5} spellCheck={false} className="font-mono text-xs"
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder={isEdit ? "•••••• (deixe vazio para manter)" : "-----BEGIN OPENSSH PRIVATE KEY----- (ou vazio p/ gerar)"} /></div>
          <div className="space-y-1.5"><Label>Chave pública (opcional)</Label>
            <Textarea value={publicKey} rows={2} spellCheck={false} className="font-mono text-xs"
                      onChange={(e) => setPublicKey(e.target.value)} placeholder="ssh-ed25519 AAAA…" /></div>
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
