import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import type { DockerRegistry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RegistriesManager() {
  const [items, setItems] = useState<DockerRegistry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DockerRegistry | "new" | null>(null);
  const [toDelete, setToDelete] = useState<DockerRegistry | null>(null);

  function load() {
    setLoading(true);
    get<DockerRegistry[]>("/deploy/registries").then(setItems)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(r: DockerRegistry) {
    try { await del(`/deploy/registries/${r.id}`); toast.success("Registry removido"); load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao remover"); throw e; }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Registries Docker</CardTitle>
          <CardDescription>Credenciais de registry para pull/push de imagens privadas.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Adicionar</Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
          : items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum registry.</p>
            : items.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Badge variant="secondary">#{r.id}</Badge>
                  <div className="min-w-0">
                    <div className="font-medium">{r.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {r.url || "docker.io"}{r.username ? ` · ${r.username}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
      </CardContent>

      {editing && (
        <RegistryDialog registry={editing === "new" ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      <ConfirmDelete open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}
        title={`Remover registry '${toDelete?.name}'?`}
        description="As credenciais serão apagadas."
        onConfirm={() => { if (toDelete) return remove(toDelete); }} />
    </Card>
  );
}

function RegistryDialog({ registry, onOpenChange, onSaved }: {
  registry: DockerRegistry | null; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const isEdit = !!registry;
  const [name, setName] = useState(registry?.name ?? "");
  const [url, setUrl] = useState(registry?.url ?? "");
  const [username, setUsername] = useState(registry?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const body = { name: name.trim(), url: url.trim(), username: username.trim(), password };
      if (isEdit) await put(`/deploy/registries/${registry!.id}`, body);
      else await post("/deploy/registries", body);
      toast.success(isEdit ? "Registry atualizado" : "Registry criado");
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar registry" : "Novo registry"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Deixe a senha vazia para mantê-la." : "Credenciais de um registry Docker privado."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Docker Hub" /></div>
          <div className="space-y-1.5"><Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs"
              placeholder="registry-1.docker.io (vazio = Docker Hub)" /></div>
          <div className="space-y-1.5"><Label>Usuário</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></div>
          <div className="space-y-1.5"><Label>Senha / token</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off"
              placeholder={isEdit ? "•••••• (deixe vazio para manter)" : ""} /></div>
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
