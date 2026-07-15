import { useState } from "react";
import { Loader2 } from "lucide-react";
import { post } from "@/lib/api";
import type { ProjectService } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ComposeDialog({ projectId, onOpenChange, onCreated }: {
  projectId: number;
  onOpenChange: (o: boolean) => void;
  onCreated: (svc: ProjectService) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"compose" | "stack">("compose");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const svc = await post<ProjectService>(`/projects/${projectId}/services`, {
        kind: "compose", name: name.trim(), config: { mode },
      });
      toast.success("Serviço compose criado");
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
          <DialogTitle>Novo compose</DialogTitle>
          <DialogDescription>Serviço baseado em Docker Compose ou Stack.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cmp-name">Nome</Label>
            <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmp-mode">Tipo</Label>
            <Select id="cmp-mode" value={mode}
              onChange={(e) => setMode(e.target.value as "compose" | "stack")}>
              <option value="compose">Compose</option>
              <option value="stack">Stack</option>
            </Select>
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
