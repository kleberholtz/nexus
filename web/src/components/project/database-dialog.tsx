import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { post } from "@/lib/api";
import type { DbEngine, ProjectService } from "@/lib/types";
import { DB_ENGINES, DB_ENGINE_ORDER } from "@/lib/db-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function randomPassword(len = 20): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

export function DatabaseDialog({ projectId, onOpenChange, onCreated }: {
  projectId: number;
  onOpenChange: (o: boolean) => void;
  onCreated: (svc: ProjectService) => void;
}) {
  const [engine, setEngine] = useState<DbEngine | null>(null);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState(() => randomPassword());
  const [reveal, setReveal] = useState(false);
  const [useImage, setUseImage] = useState(false);
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);

  function pickEngine(e: DbEngine) {
    setEngine(e);
    setVersion(DB_ENGINES[e].versions[0]);
    if (!name.trim()) setName(e);
  }

  async function save() {
    if (!engine) return;
    setBusy(true);
    try {
      const config: Record<string, unknown> = {
        engine, user: user.trim(), password,
        version: useImage ? "" : version,
        image: useImage ? image.trim() : "",
      };
      const svc = await post<ProjectService>(`/projects/${projectId}/services`, {
        kind: "database", name: name.trim(), config,
      });
      toast.success("Banco de dados criado");
      onCreated(svc);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar");
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!engine && !!name.trim() && !!password && (!useImage || !!image.trim());

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {engine && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEngine(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {engine ? `Novo ${DB_ENGINES[engine].label}` : "Banco de dados"}
          </DialogTitle>
          <DialogDescription>
            {engine ? "Configure as credenciais do banco." : "Escolha o tipo de banco de dados."}
          </DialogDescription>
        </DialogHeader>

        {!engine ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DB_ENGINE_ORDER.map((e) => (
              <button key={e} type="button" onClick={() => pickEngine(e)}
                className="flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors hover:border-primary hover:bg-accent">
                {DB_ENGINES[e].label}
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="db-name">Nome do serviço</Label>
              <Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-version">Versão</Label>
              <Select id="db-version" value={version} disabled={useImage}
                onChange={(e) => setVersion(e.target.value)}>
                {DB_ENGINES[engine].versions.map((v) => (
                  <option key={v} value={v}>{DB_ENGINES[engine].label} {v}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-user">Usuário</Label>
              <Input id="db-user" value={user} onChange={(e) => setUser(e.target.value)}
                placeholder={engine === "redis" ? "(não usado pelo Redis)" : "admin"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-pass">Senha</Label>
              <div className="flex items-center gap-1">
                <Input id="db-pass" type={reveal ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} className="font-mono" />
                <Button variant="ghost" size="icon" onClick={() => setReveal((v) => !v)}
                  title={reveal ? "Ocultar" : "Mostrar"}>
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setPassword(randomPassword())}
                  title="Gerar senha">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="db-useimg">Imagem docker customizada</Label>
                <p className="text-xs text-muted-foreground">Ao ativar, define a imagem e ignora a versão.</p>
              </div>
              <Switch id="db-useimg" checked={useImage} onCheckedChange={setUseImage} />
            </div>
            {useImage && (
              <div className="space-y-1.5">
                <Label htmlFor="db-image">Imagem</Label>
                <Input id="db-image" value={image} onChange={(e) => setImage(e.target.value)}
                  placeholder="postgres:17-alpine" className="font-mono text-xs" />
              </div>
            )}
          </div>
        )}

        {engine && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={save} disabled={busy || !canSave}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Criar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
