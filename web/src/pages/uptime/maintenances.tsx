import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { del, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Monitor } from "@/lib/monitor-config";
import {
  MAINTENANCE_STATE_META,
  Maintenance,
  STRATEGY_OPTIONS,
} from "@/lib/maintenance-config";
import { MaintenanceFormDialog } from "@/components/maintenance-form-dialog";
import { PageToolbar, useDebounced } from "@/components/uptime/list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";

function strategyLabel(value: string): string {
  return STRATEGY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MaintenancesPage() {
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const [items, setItems] = useState<Maintenance[] | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [dialog, setDialog] = useState<Maintenance | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Maintenance | null>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const load = useCallback(async () => {
    try {
      const [list, mons] = await Promise.all([
        get<Maintenance[]>(`/monitors/maintenances?search=${encodeURIComponent(debounced)}`),
        get<Monitor[]>("/monitors"),
      ]);
      setItems(list);
      setMonitors(mons);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar manutenções");
      setItems([]);
    }
  }, [debounced]);

  useEffect(() => { void load(); }, [load]);

  const monitorNames = useMemo(() => {
    const m = new Map<number, string>();
    monitors.forEach((x) => m.set(x.id, x.name));
    return m;
  }, [monitors]);

  async function toggleActive(m: Maintenance) {
    try {
      await post(`/monitors/maintenances/${m.id}/${m.active ? "disable" : "enable"}`);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar");
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/maintenances/${toDelete.id}`);
      toast.success("Manutenção removida");
      setToDelete(null);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Wrench className="h-6 w-6" /> Manutenções
            </h1>
            <p className="text-sm text-muted-foreground">
              Janelas em que os monitores afetados ficam pausados (sem falsos alertas).
            </p>
          </div>
        </div>

        <PageToolbar onRefresh={() => void load()} search={search} onSearch={setSearch}
          placeholder="Pesquisar manutenções…">
          {writable && (
            <Button onClick={() => setDialog("new")}>
              <Plus className="h-4 w-4" /> Nova manutenção
            </Button>
          )}
        </PageToolbar>

        {items === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
            <CalendarClock className="h-8 w-8" />
            <p>Nenhuma janela de manutenção.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {items.map((m) => {
              const meta = MAINTENANCE_STATE_META[m.state];
              const names = m.monitor_ids.map((id) => monitorNames.get(id) ?? `#${id}`);
              return (
                <Card key={m.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 py-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{m.title}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <Badge variant="outline">{strategyLabel(m.strategy)}</Badge>
                      </div>
                      {m.description && (
                        <p className="truncate text-sm text-muted-foreground">{m.description}</p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {m.timezone} · {names.length
                          ? `${names.length} monitor(es): ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}`
                          : "nenhum monitor"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {writable && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span><Switch checked={m.active} onCheckedChange={() => void toggleActive(m)} /></span>
                          </TooltipTrigger>
                          <TooltipContent>{m.active ? "Ativa" : "Inativa"}</TooltipContent>
                        </Tooltip>
                      )}
                      {writable && <IconBtn label="Editar" onClick={() => setDialog(m)}><Pencil className="h-4 w-4" /></IconBtn>}
                      {writable && <IconBtn label="Remover" onClick={() => setToDelete(m)}><Trash2 className="h-4 w-4" /></IconBtn>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {dialog && (
          <MaintenanceFormDialog
            maintenance={dialog === "new" ? null : dialog}
            monitors={monitors}
            onOpenChange={() => setDialog(null)}
            onSaved={() => { setDialog(null); void load(); }}
          />
        )}

        <ConfirmDelete
          open={!!toDelete}
          onOpenChange={(o) => !o && setToDelete(null)}
          onConfirm={remove}
          title="Remover manutenção"
          description={`Remover "${toDelete?.title}"? Esta ação não pode ser desfeita.`}
        />
      </div>
    </TooltipProvider>
  );
}
