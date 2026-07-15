import { useMemo, useState } from "react";
import { post, put } from "@/lib/api";
import { Monitor } from "@/lib/monitor-config";
import {
  Maintenance,
  MaintenanceForm,
  MaintenanceStrategy,
  RECURRING_STRATEGIES,
  STRATEGY_OPTIONS,
  WEEKDAYS,
  buildPayload,
  emptyForm,
  timezones,
  toForm,
} from "@/lib/maintenance-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DOM_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function Field({ label, help, required, children }: {
  label: string; help?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <LabelWithHelp help={help ?? ""} required={required}>{label}</LabelWithHelp>
      {children}
    </div>
  );
}

export function MaintenanceFormDialog({ maintenance, monitors, onOpenChange, onSaved }: {
  maintenance: Maintenance | null;
  monitors: Monitor[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!maintenance;
  const [form, setForm] = useState<MaintenanceForm>(() => maintenance ? toForm(maintenance) : emptyForm());
  const [showEffective, setShowEffective] = useState(
    !!(maintenance && (maintenance.config?.effective_start || maintenance.config?.effective_end)));
  const [monitorSearch, setMonitorSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const tzOptions = useMemo(() => timezones().map((t) => ({ value: t, label: t })), []);
  const filteredMonitors = useMemo(() => {
    const term = monitorSearch.trim().toLowerCase();
    return term ? monitors.filter((m) => m.name.toLowerCase().includes(term)) : monitors;
  }, [monitors, monitorSearch]);

  function set<K extends keyof MaintenanceForm>(key: K, value: MaintenanceForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function toggleMonitor(id: number) {
    setForm((f) => ({
      ...f,
      monitor_ids: f.monitor_ids.includes(id)
        ? f.monitor_ids.filter((x) => x !== id)
        : [...f.monitor_ids, id],
    }));
  }
  function toggleNum(key: "weekdays" | "days_of_month", value: number) {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
    }));
  }

  const strategy = form.strategy;
  const isRecurring = RECURRING_STRATEGIES.includes(strategy);
  const hasDailyWindow = strategy === "recurring_interval"
    || strategy === "recurring_weekday" || strategy === "recurring_dayofmonth";

  async function submit() {
    const { payload, error } = buildPayload({
      ...form,
      effective_start: showEffective ? form.effective_start : "",
      effective_end: showEffective ? form.effective_end : "",
    });
    if (error || !payload) return toast.error(error ?? "Formulário inválido.");
    setBusy(true);
    try {
      if (isEdit) await put(`/monitors/maintenances/${maintenance!.id}`, payload);
      else await post("/monitors/maintenances", payload);
      toast.success(isEdit ? "Manutenção atualizada" : "Manutenção criada");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar manutenção" : "Nova manutenção"}</DialogTitle>
          <DialogDescription>
            Enquanto ativa, os monitores afetados não são checados (sem falsos alertas).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Título" required help="Identifica a janela de manutenção.">
            <Input value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder="Atualização do banco de dados" />
          </Field>

          <Field label="Descrição" help="Detalhes da manutenção (opcional).">
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>

          <Field label={`Monitoramentos afetados (${form.monitor_ids.length})`}
            help="Heartbeats/monitores que ficam pausados durante a janela.">
            <Input placeholder="Filtrar monitores…" value={monitorSearch}
              onChange={(e) => setMonitorSearch(e.target.value)} className="mb-2" />
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border p-1">
              {filteredMonitors.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Nenhum monitor.</p>
              ) : filteredMonitors.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
                  <Checkbox checked={form.monitor_ids.includes(m.id)} onCheckedChange={() => toggleMonitor(m.id)} />
                  <span className="flex-1 truncate text-sm">{m.name}</span>
                  <Badge variant="muted">{m.type}</Badge>
                </label>
              ))}
            </div>
          </Field>

          {/* Bloco data e horário */}
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fuso horário" required help="Fuso usado para interpretar datas e horários.">
                <SelectWithSearch options={tzOptions} value={form.timezone}
                  onChange={(v) => set("timezone", v)} placeholder="Selecione o fuso" />
              </Field>
              <Field label="Estratégia" required
                help={STRATEGY_OPTIONS.find((o) => o.value === strategy)?.hint}>
                <SelectWithSearch
                  options={STRATEGY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  value={strategy} onChange={(v) => set("strategy", v as MaintenanceStrategy)} />
              </Field>
            </div>

            {strategy === "manual" && (
              <p className="text-sm text-muted-foreground">
                Sem janela: os monitores ficam em manutenção enquanto esta entrada estiver <b>ativa</b>.
              </p>
            )}

            {strategy === "single" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Início" required>
                  <DateTimePicker value={form.start} onChange={(v) => set("start", v)} placeholder="Início da janela" />
                </Field>
                <Field label="Fim" required>
                  <DateTimePicker value={form.end} onChange={(v) => set("end", v)} placeholder="Fim da janela" />
                </Field>
              </div>
            )}

            {strategy === "recurring_interval" && (
              <Field label="Repetir a cada (dias)" required help="1 = todo dia; 7 = a cada 7 dias.">
                <Input type="number" min={1} value={form.interval_days}
                  onChange={(e) => set("interval_days", Number(e.target.value))} className="max-w-[140px]" />
              </Field>
            )}

            {strategy === "recurring_weekday" && (
              <Field label="Dias da semana" required>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d) => {
                    const on = form.weekdays.includes(d.value);
                    return (
                      <button key={d.value} type="button" onClick={() => toggleNum("weekdays", d.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm ${on
                          ? "border-primary bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            {strategy === "recurring_dayofmonth" && (
              <Field label="Dias do mês" required>
                <div className="grid grid-cols-7 gap-1.5">
                  {DOM_DAYS.map((d) => {
                    const on = form.days_of_month.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => toggleNum("days_of_month", d)}
                        className={`rounded-md border py-1.5 text-sm ${on
                          ? "border-primary bg-primary/15 text-primary" : "hover:bg-muted"}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            {strategy === "cron" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Expressão cron" required help="5 campos: min hora dia mês dia-semana.">
                  <Input value={form.cron} onChange={(e) => set("cron", e.target.value)}
                    placeholder="0 2 * * *" spellCheck={false} className="font-mono" />
                </Field>
                <Field label="Duração (minutos)" required help="Tamanho da janela a cada disparo (máx. 1440).">
                  <Input type="number" min={1} max={1440} value={form.duration_minutes}
                    onChange={(e) => set("duration_minutes", Number(e.target.value))} />
                </Field>
              </div>
            )}

            {hasDailyWindow && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Início do horário" required help="Faixa de horário da manutenção no dia.">
                  <TimePicker value={form.time_start} onChange={(v) => set("time_start", v)} />
                </Field>
                <Field label="Fim do horário" required help="Se for menor que o início, vira o dia (overnight).">
                  <TimePicker value={form.time_end} onChange={(v) => set("time_end", v)} />
                </Field>
              </div>
            )}
          </div>

          {/* Vigência: só p/ recorrentes e cron */}
          {isRecurring && (
            <div className="space-y-3 rounded-lg border p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <b>Definir vigência</b>
                  <span className="block text-xs text-muted-foreground">
                    Sem início: começa agora. Sem fim: não sai de manutenção.
                  </span>
                </span>
                <Switch checked={showEffective} onCheckedChange={setShowEffective} />
              </label>
              {showEffective && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Data de início" help="Opcional. Sem valor, começa agora.">
                    <DateTimePicker value={form.effective_start}
                      onChange={(v) => set("effective_start", v)} placeholder="Começa agora" />
                  </Field>
                  <Field label="Data de fim" help="Opcional. Sem valor, não sai de manutenção.">
                    <DateTimePicker value={form.effective_end}
                      onChange={(v) => set("effective_end", v)} placeholder="Sem fim" />
                  </Field>
                </div>
              )}
            </div>
          )}

          <label className="flex items-center justify-between gap-3 rounded-lg border p-4">
            <span className="text-sm">
              <b>Ativa</b>
              <span className="block text-xs text-muted-foreground">Desative para suspender esta janela sem apagá-la.</span>
            </span>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>{isEdit ? "Salvar" : "Criar manutenção"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
