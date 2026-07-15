import { useEffect, useState } from "react";
import { Code2, Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  UpstreamForm,
  buildUpstreamBody,
  emptyUpstreamForm,
  emptyUpstreamServer,
  parseUpstreamForm,
  validateUpstreamForm,
} from "@/lib/upstream-config";
import { validateConfig } from "@/lib/validate";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (name: string, raw: string, context: "http" | "stream") => Promise<void>;
  /** Presente = edição (nome/contexto fixos; popula o formulário da config existente). */
  initial?: { name: string; context: "http" | "stream"; raw: string; nodes: unknown[] } | null;
};

export function UpstreamFormDialog({ open, onOpenChange, onSubmit, initial }: Props) {
  const isEdit = !!initial;
  const [form, setForm] = useState<UpstreamForm>(emptyUpstreamForm);
  const [context, setContext] = useState<"http" | "stream">("http");
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState("");
  const [warn, setWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setRawMode(false); // edição e criação abrem no formulário
    if (initial) {
      const { form: parsed, faithful } = parseUpstreamForm(initial.nodes);
      setForm({ ...parsed, name: initial.name });
      setContext(initial.context);
      setRaw(initial.raw);
      setWarn(!faithful);
    } else {
      setForm({ ...emptyUpstreamForm, servers: [{ ...emptyUpstreamServer }] });
      setContext("http");
      setRaw("");
      setWarn(false);
    }
  }, [open, initial]);

  const set = <K extends keyof UpstreamForm>(k: K, v: UpstreamForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function setServer(i: number, patch: Partial<UpstreamForm["servers"][number]>) {
    setForm((f) => ({
      ...f,
      servers: f.servers.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }));
  }
  function addServer() {
    setForm((f) => ({ ...f, servers: [...f.servers, { ...emptyUpstreamServer }] }));
  }
  function removeServer(i: number) {
    setForm((f) => ({ ...f, servers: f.servers.filter((_, idx) => idx !== i) }));
  }

  function toggleRaw() {
    if (!rawMode) {
      const err = validateUpstreamForm(form);
      if (err) return setError(err);
      setRaw(buildUpstreamBody(form));
    }
    setError(null);
    setRawMode((v) => !v);
  }

  async function submit() {
    const name = form.name.trim();
    let body: string;
    if (rawMode) {
      if (!name) return setError("Nome do upstream é obrigatório");
      if (!/^[A-Za-z0-9._-]+$/.test(name)) return setError("Nome inválido");
      const err = validateConfig(raw, "Configuração");
      if (err) return setError(err);
      body = raw;
    } else {
      const err = validateUpstreamForm(form);
      if (err) return setError(err);
      body = buildUpstreamBody(form);
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(name, body, context);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar upstream" : "Novo upstream"}</DialogTitle>
          <DialogDescription>Grupo de backends para balanceamento de carga.</DialogDescription>
        </DialogHeader>

        {warn && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            Esta config tem diretivas que o formulário não mostra. Use o <b>modo raw</b> para
            editá-las sem perdê-las.
          </p>
        )}

        {rawMode ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="up-name-raw">Nome do upstream *</Label>
                <Input id="up-name-raw" value={form.name} onChange={(e) => set("name", e.target.value)}
                  disabled={isEdit} placeholder="meu_upstream" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-ctx-raw">Contexto</Label>
                <Select id="up-ctx-raw" value={context} disabled={isEdit}
                  onChange={(e) => setContext(e.target.value as "http" | "stream")}>
                  <option value="http">http (padrão)</option>
                  <option value="stream">stream</option>
                </Select>
              </div>
            </div>
            <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false}
              className="min-h-[240px] font-mono text-xs leading-relaxed" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="up-name">Nome do upstream *</Label>
                <Input id="up-name" value={form.name} onChange={(e) => set("name", e.target.value)}
                  disabled={isEdit} placeholder="meu_upstream" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-ctx">Contexto</Label>
                <Select id="up-ctx" value={context} disabled={isEdit}
                  onChange={(e) => setContext(e.target.value as "http" | "stream")}>
                  <option value="http">http (padrão)</option>
                  <option value="stream">stream</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-method">Balanceamento</Label>
                <Select id="up-method" value={form.method}
                  onChange={(e) => set("method", e.target.value as UpstreamForm["method"])}>
                  <option value="">round-robin (padrão)</option>
                  <option value="least_conn">least_conn</option>
                  <option value="ip_hash">ip_hash</option>
                  <option value="random">random</option>
                  <option value="hash">hash</option>
                </Select>
              </div>
            </div>

            {form.method === "hash" && (
              <div className="grid gap-4 sm:grid-cols-2 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="up-hash-key">hash (chave)</Label>
                  <Input id="up-hash-key" value={form.hashKey} placeholder="$remote_addr"
                    onChange={(e) => set("hashKey", e.target.value)} spellCheck={false} />
                </div>
                <label className="flex items-center gap-1.5 self-end pb-2 text-sm">
                  <Checkbox checked={form.hashConsistent}
                    onCheckedChange={(v) => set("hashConsistent", !!v)} /> consistent (ketama)
                </label>
              </div>
            )}
            {form.method === "random" && (
              <div className="rounded-md border p-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={form.randomTwo} onCheckedChange={(v) => set("randomTwo", !!v)} />
                  two (escolhe 2 servers aleatórios e usa o menos carregado)
                </label>
              </div>
            )}

            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={form.zoneEnabled} onCheckedChange={(v) => set("zoneEnabled", !!v)} />
                zone (memória compartilhada, permite reconfig dinâmica)
              </label>
              {form.zoneEnabled && (
                <div className="space-y-1.5 sm:max-w-[220px]">
                  <Label htmlFor="up-zone-size">Tamanho</Label>
                  <Input id="up-zone-size" value={form.zoneSize} placeholder="64k"
                    onChange={(e) => set("zoneSize", e.target.value)} />
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Servers *
                </p>
                <Button variant="outline" size="sm" onClick={addServer}>
                  <Plus className="h-4 w-4" /> Adicionar server
                </Button>
              </div>
              {form.servers.map((s, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input value={s.address} onChange={(e) => setServer(i, { address: e.target.value })}
                      placeholder="10.0.0.1:8080" spellCheck={false} className="flex-1" />
                    <Button variant="ghost" size="icon" onClick={() => removeServer(i)}
                      disabled={form.servers.length === 1}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Input value={s.weight} onChange={(e) => setServer(i, { weight: e.target.value })}
                      placeholder="weight" inputMode="numeric" className="h-8" />
                    <Input value={s.maxFails} onChange={(e) => setServer(i, { maxFails: e.target.value })}
                      placeholder="max_fails" inputMode="numeric" className="h-8" />
                    <Input value={s.failTimeout} onChange={(e) => setServer(i, { failTimeout: e.target.value })}
                      placeholder="fail_timeout" className="h-8" />
                    <Input value={s.maxConns} onChange={(e) => setServer(i, { maxConns: e.target.value })}
                      placeholder="max_conns" inputMode="numeric" className="h-8" />
                    <Input value={s.slowStart} onChange={(e) => setServer(i, { slowStart: e.target.value })}
                      placeholder="slow_start" className="h-8" />
                    <div className="flex items-center gap-3 text-sm">
                      <label className="flex items-center gap-1.5">
                        <Checkbox checked={s.backup} onCheckedChange={(v) => setServer(i, { backup: !!v })} /> backup
                      </label>
                      <label className="flex items-center gap-1.5">
                        <Checkbox checked={s.down} onCheckedChange={(v) => setServer(i, { down: !!v })} /> down
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="up-keepalive">keepalive</Label>
                <Input id="up-keepalive" value={form.keepalive} inputMode="numeric"
                  onChange={(e) => set("keepalive", e.target.value)} placeholder="32" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-keepalive-requests">keepalive_requests</Label>
                <Input id="up-keepalive-requests" value={form.keepaliveRequests} inputMode="numeric"
                  onChange={(e) => set("keepaliveRequests", e.target.value)} placeholder="100" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-keepalive-time">keepalive_time</Label>
                <Input id="up-keepalive-time" value={form.keepaliveTime}
                  onChange={(e) => set("keepaliveTime", e.target.value)} placeholder="1h" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="up-keepalive-timeout">keepalive_timeout</Label>
                <Input id="up-keepalive-timeout" value={form.keepaliveTimeout}
                  onChange={(e) => set("keepaliveTimeout", e.target.value)} placeholder="60s" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={toggleRaw} disabled={submitting}>
            <Code2 className="h-4 w-4" />
            {rawMode ? "Voltar ao formulário" : "Modo avançado (raw)"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancelar</Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Salvar" : "Criar upstream"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
