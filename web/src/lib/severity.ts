/** Estilos/rótulos das severidades de vulnerabilidade (trivy), compartilhados
 * entre a lista de imagens e a tela de detalhe. */
export const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export const SEV: Record<string, { label: string; text: string; badge: string; bar: string }> = {
  CRITICAL: { label: "Crítica", text: "text-red-600 dark:text-red-400", badge: "bg-red-500/15 text-red-600 dark:text-red-400", bar: "bg-red-500" },
  HIGH: { label: "Alta", text: "text-orange-600 dark:text-orange-400", badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400", bar: "bg-orange-500" },
  MEDIUM: { label: "Média", text: "text-amber-600 dark:text-amber-400", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  LOW: { label: "Baixa", text: "text-zinc-600 dark:text-zinc-400", badge: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400", bar: "bg-zinc-400" },
  UNKNOWN: { label: "Desconhecida", text: "text-muted-foreground", badge: "bg-zinc-500/15 text-muted-foreground", bar: "bg-muted-foreground/40" },
};

/** Severidade dominante (topo do SEV_ORDER com contagem > 0). */
export function topSeverity(sev: Record<string, number>): string | null {
  return SEV_ORDER.find((s) => sev[s] > 0) ?? null;
}

export type Vuln = {
  id: string; pkg: string; severity: string;
  installed: string; fixed: string; title: string; url: string;
};

export type ScanRecord = {
  id: number; image_id: string; image_ref: string;
  status: "queued" | "running" | "success" | "failed" | "canceled";
  phase: string; total: number; severities: Record<string, number>;
  details?: Vuln[];
  error: string | null; created_at: number; started_at: number; finished_at: number; user: string;
};
