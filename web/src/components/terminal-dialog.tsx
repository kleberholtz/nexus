import { useEffect, useState } from "react";
import { RotateCw, Terminal as TerminalIcon } from "lucide-react";
import { get } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { toast } from "@/components/ui/sonner";
import { XtermTerminal } from "@/components/project/xterm-terminal";

export type TerminalContainer = { id: string; name: string; state: string };

export function TerminalDialog({ containers: providedContainers, containersUrl, description,
  terminalPath, onOpenChange }: {
  containers?: TerminalContainer[];
  containersUrl?: string;
  description: string;
  terminalPath: (container: TerminalContainer, shell: "bash" | "sh") => string;
  onOpenChange: (open: boolean) => void;
}) {
  const [shell, setShell] = useState<"bash" | "sh">("bash");
  const [nonce, setNonce] = useState(0);
  const [loadedContainers, setLoadedContainers] = useState<TerminalContainer[]>(providedContainers ?? []);
  const containers = providedContainers ?? loadedContainers;
  const [containerName, setContainerName] = useState("");

  useEffect(() => {
    if (!containersUrl) return;
    get<TerminalContainer[]>(containersUrl)
      .then(setLoadedContainers)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar containers"));
  }, [containersUrl]);

  useEffect(() => {
    setContainerName((current) => {
      if (containers.some((item) => item.name === current)) return current;
      return (containers.find((item) => item.state === "running") ?? containers[0])?.name ?? "";
    });
  }, [containers]);

  const selected = containers.find((item) => item.name === containerName);
  const running = selected?.state === "running";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}
        className="h-[min(92vh,820px)] w-[min(96vw,1280px)] max-w-none grid-rows-[auto_1fr_auto] overflow-hidden p-6">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <TerminalIcon className="h-4 w-4" /> Terminal
            </DialogTitle>
            <Button type="button" size="sm" variant="outline" disabled={!running}
              onClick={() => setNonce((value) => value + 1)}>
              <RotateCw className="h-4 w-4" /> Reconectar
            </Button>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label>Container</Label>
              <SelectWithSearch value={containerName} onChange={(value) => {
                setContainerName(value);
                setNonce((current) => current + 1);
              }} disabled={containers.length === 0}
                options={containers.map((item) => ({
                  value: item.name,
                  label: `${item.name} (${item.state || "unknown"})`,
                  searchText: `${item.name} ${item.id} ${item.state}`,
                }))}
                placeholder="Selecione um container" searchPlaceholder="Pesquisar container"
                emptyMessage={containers.length === 0 ? "Carregando containers..." : "Nenhum container encontrado."}
              />
            </div>
            <div className="inline-flex rounded-md border bg-muted/30 p-1">
              <Button type="button" size="sm" variant={shell === "bash" ? "secondary" : "ghost"}
                className="h-8" onClick={() => setShell("bash")}>Bash</Button>
              <Button type="button" size="sm" variant={shell === "sh" ? "secondary" : "ghost"}
                className="h-8" onClick={() => setShell("sh")}>/bin/sh</Button>
            </div>
          </div>

          {running && selected ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-black p-2">
              <XtermTerminal key={`${selected.id}-${shell}-${nonce}`} path={terminalPath(selected, shell)} />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border bg-black text-sm text-zinc-500">
              {selected ? "Container parado — inicie-o para abrir o terminal." : "Selecione um container para abrir o terminal."}
            </div>
          )}
        </div>

        <DialogFooter className="-mx-6 -mb-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
