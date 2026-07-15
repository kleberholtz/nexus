import { useState } from "react";
import { post, put } from "@/lib/api";
import { MonitorGroup } from "@/lib/monitor-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Diálogo de criar/editar grupo de monitores (compartilhado por Monitores e Heartbeats). */
export function GroupDialog({ group, onOpenChange, onSaved }: {
  group: MonitorGroup | null; onOpenChange: (o: boolean) => void; onSaved: () => void;
}) {
  const isEdit = !!group;
  const [name, setName] = useState(group?.name ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Informe o nome do grupo.");
    setBusy(true);
    try {
      if (isEdit) await put(`/monitors/groups/${group!.id}`, { name });
      else await post("/monitors/groups", { name });
      toast.success(isEdit ? "Grupo atualizado" : "Grupo criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <TooltipProvider>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar grupo" : "Novo grupo"}</DialogTitle>
            <DialogDescription>Agrupa monitores relacionados.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="grp-name" help="Nome do grupo de monitores." required>Nome</LabelWithHelp>
            <Input id="grp-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Produção" spellCheck={false} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} disabled={busy}>{isEdit ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
