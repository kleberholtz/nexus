import { useState } from "react";
import { Loader2 } from "lucide-react";
import { post } from "@/lib/api";
import type { ProjectService } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ApplicationDialog({ projectId, onOpenChange, onCreated }: {
  projectId: number;
  onOpenChange: (o: boolean) => void;
  onCreated: (svc: ProjectService) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const svc = await post<ProjectService>(`/projects/${projectId}/services`, {
        kind: "application", name: name.trim(), description: description.trim(), config: {},
      });
      toast.success("Aplicação criada");
      onCreated(svc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova aplicação</DialogTitle>
          <DialogDescription>Um serviço de aplicação dentro do projeto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">Nome</Label>
            <Input id="app-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="minha-app" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-desc">Descrição (opcional)</Label>
            <Textarea id="app-desc" value={description} rows={3}
              onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
