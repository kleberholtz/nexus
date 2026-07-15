import { useState } from "react";
import { Check, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Switch } from "@/components/ui/switch";
import { ConfirmDelete } from "@/components/confirm-delete";
import { BlockHeader } from "../block-header";

function AddItemButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex w-fit items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
      onClick={onClick}
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function CommandBlock({ cfg, set }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void }) {
  const args = (cfg.command_args ?? []) as Pair[];
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Comando</Label>
        <Input value={String(cfg.command ?? "")} className="font-mono text-xs"
          onChange={(e) => set({ command: e.target.value })} placeholder="ex.: redis-server" />
      </div>
      <div className="space-y-2">
        <div className="space-y-2">
          {args.map((arg, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input value={arg.value ?? ""} className="font-mono text-xs" placeholder="ex.: --appendonly yes"
                onChange={(e) => set({ command_args: args.map((item, i) => i === index ? { value: e.target.value } : item) })} />
              <Button variant="ghost" size="icon" onClick={() => set({ command_args: args.filter((_, i) => i !== index) })}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {args.length === 0 && (
            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
              Nenhum argumento adicionado.
            </div>
          )}
        </div>
        <AddItemButton label="Adicionar argumento" onClick={() => set({ command_args: [...args, { value: "" }] })} />
      </div>
    </div>
  );
}

function ResourcesBlock({ cfg, set }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void }) {
  const r = (cfg.resources ?? {}) as Record<string, number | string | undefined>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5"><LabelWithHelp label="CPU reservation" help="Reserva relativa de CPU. No Docker vira CpuShares, útil para priorização quando há contenção." />
        <Input type="number" step="0.1" value={String(r.cpu_reservation ?? "")}
          onChange={(e) => set({ resources: { ...r, cpu_reservation: Number(e.target.value) } })} placeholder="0.25" /></div>
      <div className="space-y-1.5"><LabelWithHelp label="CPU limit" help="Limite máximo de CPU em cores. Ex.: 1 permite até um core; no Docker vira NanoCpus." />
        <Input type="number" step="0.1" value={String(r.cpu_limit ?? r.cpu ?? "")}
          onChange={(e) => set({ resources: { ...r, cpu_limit: Number(e.target.value) } })} placeholder="1" /></div>
      <div className="space-y-1.5"><LabelWithHelp label="Memory reservation (MB)" help="Memória reservada em MB. O Docker tenta manter essa quantidade disponível para o container." />
        <Input type="number" value={String(r.memory_reservation_mb ?? "")}
          onChange={(e) => set({ resources: { ...r, memory_reservation_mb: Number(e.target.value) } })} placeholder="256" /></div>
      <div className="space-y-1.5"><LabelWithHelp label="Memory limit (MB)" help="Limite máximo de memória em MB. Se ultrapassar, o container pode sofrer OOM kill." />
        <Input type="number" value={String(r.memory_limit_mb ?? r.memory_mb ?? "")}
          onChange={(e) => set({ resources: { ...r, memory_limit_mb: Number(e.target.value) } })} placeholder="1024" /></div>
    </div>
  );
}

function UlimitsBlock({ cfg, set }: { cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void }) {
  const items = (cfg.ulimits ?? []) as UlimitItem[];
  const selected = new Set(items.map((item) => item.name));
  function update(items: UlimitItem[]) {
    set({ ulimits: items });
  }
  function add(name: string) {
    if (items.some((item) => item.name === name)) return;
    const defaults = ULIMIT_DEFAULTS[name] ?? { soft: "", hard: "" };
    update([...items, { name, ...defaults }]);
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ULIMIT_META.map(([name, description]) => {
          const exists = selected.has(name);
          return (
            <button
              key={name}
              type="button"
              disabled={exists}
              className="group flex min-h-28 flex-col justify-between gap-3 rounded-md border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted/40 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/30 disabled:text-muted-foreground"
              onClick={() => add(name)}
            >
              <span className="min-w-0 space-y-1">
                <span className="block font-mono text-sm font-medium">{name}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </span>
              {exists ? (
                <span className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  <Check className="h-3.5 w-3.5" /> Adicionado
                </span>
              ) : (
                <span className="inline-flex w-fit items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground transition group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary">
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const meta = ULIMIT_META.find(([name]) => name === item.name);
          return (
            <div key={`${item.name}-${index}`} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
              <div>
                <div className="font-mono text-sm font-medium">{item.name || "ulimit"}</div>
                <div className="text-xs text-muted-foreground">{meta?.[1] ?? "Limite customizado do Docker."}</div>
              </div>
              <div className="space-y-1.5">
                <Label>Soft</Label>
                <Input type="number" value={String(item.soft ?? "")} placeholder="soft"
                  onChange={(e) => update(items.map((it, i) => i === index ? { ...it, soft: e.target.value } : it))} />
              </div>
              <div className="space-y-1.5">
                <Label>Hard</Label>
                <Input type="number" value={String(item.hard ?? "")} placeholder="hard"
                  onChange={(e) => update(items.map((it, i) => i === index ? { ...it, hard: e.target.value } : it))} />
              </div>
              <Button variant="ghost" size="icon" onClick={() => update(items.filter((_, i) => i !== index))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum ulimit configurado. Clique em um tipo acima para adicionar.
          </div>
        )}
      </div>
    </div>
  );
}

type Pair = Record<string, string>;
type UlimitItem = { name: string; soft: number | string; hard: number | string };
const ULIMIT_META = [
  ["nofile", "Número máximo de arquivos abertos por processo."],
  ["nproc", "Número máximo de processos disponíveis para o container."],
  ["memlock", "Memória que pode ser bloqueada em RAM."],
  ["stack", "Tamanho máximo da pilha do processo."],
  ["core", "Tamanho máximo de arquivos core dump."],
  ["cpu", "Tempo máximo de CPU permitido."],
  ["data", "Tamanho máximo do segmento de dados."],
  ["fsize", "Tamanho máximo de arquivo que pode ser criado."],
  ["locks", "Quantidade máxima de locks de arquivo."],
  ["msgqueue", "Tamanho máximo de filas de mensagens POSIX."],
  ["nice", "Prioridade nice máxima permitida."],
  ["rtprio", "Prioridade de tempo real máxima."],
  ["sigpending", "Quantidade máxima de sinais pendentes."],
] as const;
const ULIMIT_DEFAULTS: Record<string, { soft: number | string; hard: number | string }> = {
  nofile: { soft: 1024, hard: 65535 },
  nproc: { soft: 1024, hard: 4096 },
  memlock: { soft: 65536, hard: 65536 },
  stack: { soft: 8192, hard: 8192 },
  core: { soft: 0, hard: 0 },
  cpu: { soft: 0, hard: 0 },
  data: { soft: 0, hard: 0 },
  fsize: { soft: 0, hard: 0 },
  locks: { soft: 1024, hard: 1024 },
  msgqueue: { soft: 819200, hard: 819200 },
  nice: { soft: 0, hard: 0 },
  rtprio: { soft: 0, hard: 0 },
  sigpending: { soft: 1024, hard: 4096 },
};

function PairListBlock({ label, items, keys, placeholders, onChange }: {
  label: string; items: Pair[]; keys: [string, string]; placeholders: [string, string];
  onChange: (items: Pair[]) => void;
}) {
  const actionLabel = label.toLowerCase() === "ports" ? "Adicionar porta" : `Adicionar ${label.toLowerCase()}`;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={it[keys[0]] ?? ""} placeholder={placeholders[0]}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, [keys[0]]: e.target.value } : x))} />
            <Input value={it[keys[1]] ?? ""} placeholder={placeholders[1]}
              onChange={(e) => onChange(items.map((x, j) => j === i ? { ...x, [keys[1]]: e.target.value } : x))} />
            <Button variant="ghost" size="icon" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Nenhum item adicionado.
          </div>
        )}
      </div>
      <AddItemButton label={actionLabel} onClick={() => onChange([...items, { [keys[0]]: "", [keys[1]]: "" }])} />
    </div>
  );
}

export function AdvancedTab({ kind, cfg, set, canWrite, onSave, onSaveAdvanced, onRebuild, rebuilding }: {
  kind: string; cfg: Record<string, unknown>; set: (p: Record<string, unknown>) => void;
  canWrite: boolean; onSave: (patch: Record<string, unknown>, msg?: string) => void;
  onSaveAdvanced: (path: string, payload: Record<string, unknown>, msg: string) => void;
  onRebuild: () => void; rebuilding: boolean;
}) {
  const volumes = (cfg.volumes ?? []) as Pair[];
  const ports = (cfg.ports ?? []) as Pair[];
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  if (kind === "database") {
    return (
      <>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Comando customizado" description="Sobrescreve o comando padrão da imagem e permite argumentos extras." />
          <CommandBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite} onClick={() => onSaveAdvanced("command", {
              command: cfg.command,
              command_args: cfg.command_args
            }, "Comando salvo")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Volumes" description="Monte volumes ou paths do host dentro do container." />
          <PairListBlock label="Volumes" items={volumes} keys={["source", "target"]}
            placeholders={["volume/host", "/caminho/no/container"]}
            onChange={(v) => set({ volumes: v })} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite}
              onClick={() => onSaveAdvanced("volumes", {
                volumes: cfg.volumes
              }, "Volumes salvos")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Recursos" description="Defina reservas e limites usados na criação do container Docker." />
          <ResourcesBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite}
              onClick={() => onSaveAdvanced("resources", {
                resources: cfg.resources
              }, "Recursos salvos")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Ulimits" description="Ajuste limites do kernel aplicados ao processo do container." />
          <UlimitsBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite}
              onClick={() => onSaveAdvanced("ulimits", {
                ulimits: cfg.ulimits
              }, "Ulimits salvos")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-3 border-destructive/40 p-5">
          <h2 className="font-semibold text-destructive">Zona de Perigo</h2>
          <p className="text-sm text-muted-foreground">
            Reconstruir o banco destrói o volume de dados e recria o container do zero.
          </p>
          <div className="flex justify-end border-t pt-4">
            <Button variant="outline" className="border-destructive/50 text-destructive"
              disabled={!canWrite || rebuilding} onClick={() => setConfirmRebuild(true)}>
              {rebuilding ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Reconstruir banco
            </Button>
            <ConfirmDelete open={confirmRebuild} onOpenChange={setConfirmRebuild}
              title="Reconstruir o banco?" confirmLabel="Reconstruir"
              description="Isso APAGA todos os dados (volume) e recria o container. Irreversível."
              onConfirm={onRebuild} />
          </div>
        </Card>
      </>
    );
  }
  if (kind === "application") {
    return (
      <>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Run command" description="Sobrescreve o comando padrão da imagem e permite argumentos extras." />
          <CommandBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite} onClick={() => onSaveAdvanced("command", { command: cfg.command, command_args: cfg.command_args }, "Comando salvo")}>
              Salvar
            </Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Recursos" description="Defina reservas e limites usados na criação do container Docker." />
          <ResourcesBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite} onClick={() => onSaveAdvanced("resources", { resources: cfg.resources }, "Recursos salvos")}>
              Salvar
            </Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Volumes" description="Monte volumes ou paths do host dentro do container." />
          <PairListBlock label="Volumes" items={volumes} keys={["source", "target"]}
            placeholders={["volume/host", "/caminho/no/container"]}
            onChange={(v) => set({ volumes: v })} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite}
              onClick={() => onSaveAdvanced("volumes", { volumes: cfg.volumes }, "Volumes salvos")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Ulimits" description="Ajuste limites do kernel aplicados ao processo do container." />
          <UlimitsBlock cfg={cfg} set={set} />
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite}
              onClick={() => onSaveAdvanced("ulimits", { ulimits: cfg.ulimits }, "Ulimits salvos")}>Salvar</Button>
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <BlockHeader title="Portas e nginx" description="Publique portas e opcionalmente crie um server block para a aplicação." />
          <PairListBlock label="Ports" items={ports} keys={["host", "container"]}
            placeholders={["8080", "80"]} onChange={(p) => set({ ports: p })} />
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Adicionar ao nginx</Label>
              <p className="text-xs text-muted-foreground">Cria um server block apontando para a aplicação.</p>
            </div>
            <Switch checked={!!cfg.nginx} onCheckedChange={(v) => set({ nginx: v })} />
          </div>
          {!!cfg.nginx && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>server_name</Label>
                <Input value={String(cfg.nginx_server_name ?? "")}
                  onChange={(e) => set({ nginx_server_name: e.target.value })} placeholder="app.exemplo.com" /></div>
              <div className="space-y-1.5"><Label>Porta interna</Label>
                <Input type="number" value={String(cfg.nginx_port ?? "")}
                  onChange={(e) => set({ nginx_port: Number(e.target.value) })} placeholder="3000" /></div>
            </div>
          )}
          <div className="flex justify-end border-t pt-4">
            <Button disabled={!canWrite} onClick={() => onSave({
              ports: cfg.ports,
              nginx: cfg.nginx,
              nginx_server_name: cfg.nginx_server_name,
              nginx_port: cfg.nginx_port,
            })}>Salvar</Button>
          </div>
        </Card>
      </>
    );
  }
  return <p className="text-sm text-muted-foreground">Sem opções avançadas para este tipo.</p>;
}
