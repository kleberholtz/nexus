// Tipos e helpers do formulário de Janelas de Manutenção. O backend
// (api/maintenances.py) valida e normaliza tudo de novo.

export type MaintenanceStrategy =
  | "manual"
  | "single"
  | "recurring_interval"
  | "recurring_weekday"
  | "recurring_dayofmonth"
  | "cron";

export type MaintenanceState = "active" | "scheduled" | "ended" | "inactive";

export type MaintenanceConfig = {
  start?: string;
  end?: string;
  time_start?: string;
  time_end?: string;
  interval_days?: number;
  weekdays?: number[];
  days_of_month?: number[];
  cron?: string;
  duration_minutes?: number;
  effective_start?: string;
  effective_end?: string;
};

export type Maintenance = {
  id: number;
  title: string;
  description: string;
  monitor_ids: number[];
  strategy: MaintenanceStrategy;
  timezone: string;
  config: MaintenanceConfig;
  active: boolean;
  state: MaintenanceState;
  created_ts: number;
  updated_ts: number;
};

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "info" | "muted";

export const STRATEGY_OPTIONS: { value: MaintenanceStrategy; label: string; hint: string }[] = [
  { value: "manual", label: "Manual", hint: "Em manutenção enquanto estiver ativa (sem janela)" },
  { value: "single", label: "Janela única", hint: "Uma janela com início e fim definidos" },
  { value: "recurring_interval", label: "Recorrente · intervalo", hint: "A cada N dias, numa faixa de horário" },
  { value: "recurring_weekday", label: "Recorrente · dia da semana", hint: "Em dias da semana, numa faixa de horário" },
  { value: "recurring_dayofmonth", label: "Recorrente · dia do mês", hint: "Em dias do mês, numa faixa de horário" },
  { value: "cron", label: "Expressão cron", hint: "Cada disparo do cron abre uma janela de N minutos" },
];

export const RECURRING_STRATEGIES: MaintenanceStrategy[] = [
  "recurring_interval", "recurring_weekday", "recurring_dayofmonth", "cron",
];

// 0=domingo..6=sábado (mesma convenção do backend e do Date.getDay()).
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export const MAINTENANCE_STATE_META: Record<MaintenanceState, { label: string; variant: BadgeVariant }> = {
  active: { label: "Em manutenção", variant: "warning" },
  scheduled: { label: "Agendada", variant: "info" },
  ended: { label: "Encerrada", variant: "muted" },
  inactive: { label: "Inativa", variant: "secondary" },
};

/** Lista de fusos horários IANA (usa Intl.supportedValuesOf quando disponível). */
export function timezones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      return intl.supportedValuesOf("timeZone");
    } catch {
      /* fallthrough */
    }
  }
  return ["UTC", guessTimezone()].filter((v, i, a) => a.indexOf(v) === i);
}

export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export type MaintenanceForm = {
  title: string;
  description: string;
  monitor_ids: number[];
  timezone: string;
  strategy: MaintenanceStrategy;
  active: boolean;
  start: string;
  end: string;
  time_start: string;
  time_end: string;
  interval_days: number;
  weekdays: number[];
  days_of_month: number[];
  cron: string;
  duration_minutes: number;
  effective_start: string;
  effective_end: string;
};

export function emptyForm(): MaintenanceForm {
  return {
    title: "",
    description: "",
    monitor_ids: [],
    timezone: guessTimezone(),
    strategy: "single",
    active: true,
    start: "",
    end: "",
    time_start: "00:00",
    time_end: "23:59",
    interval_days: 1,
    weekdays: [],
    days_of_month: [],
    cron: "0 0 * * *",
    duration_minutes: 60,
    effective_start: "",
    effective_end: "",
  };
}

export function toForm(m: Maintenance): MaintenanceForm {
  const c = m.config || {};
  return {
    ...emptyForm(),
    title: m.title,
    description: m.description || "",
    monitor_ids: m.monitor_ids || [],
    timezone: m.timezone || guessTimezone(),
    strategy: m.strategy,
    active: m.active,
    start: c.start || "",
    end: c.end || "",
    time_start: c.time_start || "00:00",
    time_end: c.time_end || "23:59",
    interval_days: c.interval_days ?? 1,
    weekdays: c.weekdays || [],
    days_of_month: c.days_of_month || [],
    cron: c.cron || "0 0 * * *",
    duration_minutes: c.duration_minutes ?? 60,
    effective_start: c.effective_start || "",
    effective_end: c.effective_end || "",
  };
}

export type MaintenancePayload = {
  title: string;
  description: string;
  monitor_ids: number[];
  timezone: string;
  strategy: MaintenanceStrategy;
  active: boolean;
  config: MaintenanceConfig;
};

/** Monta o payload da API a partir do form ou retorna uma mensagem de erro. */
export function buildPayload(f: MaintenanceForm): { payload?: MaintenancePayload; error?: string } {
  if (!f.title.trim()) return { error: "Informe o título." };

  const config: MaintenanceConfig = {};
  const s = f.strategy;

  if (s === "single") {
    if (!f.start || !f.end) return { error: "Informe o início e o fim da janela." };
    if (f.end <= f.start) return { error: "O fim deve ser depois do início." };
    config.start = f.start;
    config.end = f.end;
  } else if (s === "cron") {
    if (!f.cron.trim()) return { error: "Informe a expressão cron." };
    if (f.cron.trim().split(/\s+/).length !== 5) return { error: "A expressão cron deve ter 5 campos." };
    if (f.duration_minutes < 1 || f.duration_minutes > 1440)
      return { error: "A duração deve estar entre 1 e 1440 minutos." };
    config.cron = f.cron.trim();
    config.duration_minutes = f.duration_minutes;
  } else if (s !== "manual") {
    // recorrentes com faixa de horário
    config.time_start = f.time_start;
    config.time_end = f.time_end;
    if (s === "recurring_interval") {
      if (f.interval_days < 1) return { error: "O intervalo de dias deve ser ≥ 1." };
      config.interval_days = f.interval_days;
    } else if (s === "recurring_weekday") {
      if (!f.weekdays.length) return { error: "Selecione ao menos um dia da semana." };
      config.weekdays = [...f.weekdays].sort((a, b) => a - b);
    } else if (s === "recurring_dayofmonth") {
      if (!f.days_of_month.length) return { error: "Selecione ao menos um dia do mês." };
      config.days_of_month = [...f.days_of_month].sort((a, b) => a - b);
    }
  }

  // faixa de vigência: só p/ recorrentes/cron
  if (RECURRING_STRATEGIES.includes(s)) {
    if (f.effective_start) config.effective_start = f.effective_start;
    if (f.effective_end) config.effective_end = f.effective_end;
  }

  return {
    payload: {
      title: f.title.trim(),
      description: f.description.trim(),
      monitor_ids: f.monitor_ids,
      timezone: f.timezone,
      strategy: s,
      active: f.active,
      config,
    },
  };
}
