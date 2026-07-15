import { useEffect, useState } from "react";
import { Code2, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  StreamForm,
  buildStreamConfig,
  emptyStreamForm,
  parseStreamForm,
  validateStreamForm,
} from "@/lib/stream-config";
import { validateConfig } from "@/lib/validate";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (raw: string) => Promise<void>;
  /** Presente = edição (popula o formulário a partir da config existente). */
  initial?: { raw: string; nodes: unknown[] } | null;
};

export function StreamFormDialog({ open, onOpenChange, onSubmit, initial }: Props) {
  const isEdit = !!initial;
  const [form, setForm] = useState<StreamForm>(emptyStreamForm);
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
      const { form: parsed, faithful } = parseStreamForm(initial.nodes);
      setForm(parsed);
      setRaw(initial.raw);
      // Config com diretivas que o form não mostra → avisa (use o raw p/ não perder).
      setWarn(!faithful);
    } else {
      setForm({ ...emptyStreamForm });
      setRaw("");
      setWarn(false);
    }
  }, [open, initial]);

  const set = <K extends keyof StreamForm>(k: K, v: StreamForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function toggleRaw() {
    if (!rawMode) {
      const err = validateStreamForm(form);
      if (err) return setError(err);
      setRaw(buildStreamConfig(form));
    }
    setError(null);
    setRawMode((v) => !v);
  }

  async function submit() {
    let body: string;
    if (rawMode) {
      const err = validateConfig(raw, "Configuração");
      if (err) return setError(err);
      body = raw;
    } else {
      const err = validateStreamForm(form);
      if (err) return setError(err);
      body = buildStreamConfig(form);
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(body);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar stream" : "Novo stream"}</DialogTitle>
          <DialogDescription>Proxy TCP/UDP (server block do contexto stream).</DialogDescription>
        </DialogHeader>

        {warn && (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            Esta config tem diretivas que o formulário não mostra. Use o <b>modo raw</b> para
            editá-las sem perdê-las.
          </p>
        )}

        {rawMode ? (
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false}
            className="min-h-[240px] font-mono text-xs leading-relaxed" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-listen">listen (porta ou host:porta) *</Label>
                <Input id="st-listen" value={form.listen} onChange={(e) => set("listen", e.target.value)}
                  placeholder="5432" spellCheck={false} />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.udp} onCheckedChange={(v) => set("udp", !!v)} /> UDP
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-pass">proxy_pass (upstream ou host:porta) *</Label>
              <Input id="st-pass" value={form.proxyPass} onChange={(e) => set("proxyPass", e.target.value)}
                placeholder="pg_backend  ou  10.0.0.1:5432" spellCheck={false} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="st-ct">proxy_connect_timeout</Label>
                <Input id="st-ct" value={form.proxyConnectTimeout}
                  onChange={(e) => set("proxyConnectTimeout", e.target.value)} placeholder="10s" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-t">proxy_timeout</Label>
                <Input id="st-t" value={form.proxyTimeout}
                  onChange={(e) => set("proxyTimeout", e.target.value)} placeholder="60s" />
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
              {isEdit ? "Salvar" : "Criar stream"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
