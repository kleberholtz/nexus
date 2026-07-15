import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Slack,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationType,
  typeLabel,
} from "@/lib/notification-config";
import { MonitorNotificationsDialog } from "@/components/monitor-notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { PageToolbar, Pagination, Paged, pagedQuery, useDebounced, useUrlPagination } from "@/components/uptime/list";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";

const ICON: Record<NotificationType, React.ElementType> = {
  webhook: Webhook,
  telegram: Send,
  discord: MessageCircle,
  email: Mail,
  slack: Slack,
  teams: Users,
};

export function NotificationsPage() {
  const { can } = useAuth();
  const writable = can("monitors", "write");

  const [data, setData] = useState<Paged<NotificationChannel> | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<NotificationChannel | "new" | null>(null);
  const [removing, setRemoving] = useState<NotificationChannel | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const debounced = useDebounced(query);
  const { page, setPage } = useUrlPagination(`${debounced}|${type}`);

  const load = useCallback(async () => {
    try {
      setData(await get<Paged<NotificationChannel>>(`/monitors/notifications?${pagedQuery(page, debounced, { type })}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar canais");
    }
  }, [page, debounced, type]);
  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];

  async function toggle(ch: NotificationChannel) {
    setBusy(ch.id);
    try {
      await put(`/monitors/notifications/${ch.id}`, { enabled: !ch.enabled });
      setData((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === ch.id ? { ...x, enabled: !x.enabled } : x)) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar canal");
    } finally {
      setBusy(null);
    }
  }

  async function test(ch: NotificationChannel) {
    setBusy(ch.id);
    try {
      await post(`/monitors/notifications/${ch.id}/test`);
      toast.success("Notificação de teste enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar canal");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await del(`/monitors/notifications/${removing.id}`);
      await load();
      toast.success("Canal removido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover canal");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bell className="h-6 w-6" /> Notificações
        </h1>
        <p className="text-sm text-muted-foreground">
          Canais que recebem alertas dos monitores.
        </p>
      </div>

      <PageToolbar onRefresh={load} search={query} onSearch={setQuery} placeholder="Pesquisar notificações">
        <div className="w-44">
          <SelectWithSearch
            value={type}
            onChange={setType}
            options={[
              { value: "", label: "Todos os tipos" },
              ...NOTIFICATION_TYPES.map((item) => ({ value: item.value, label: item.label })),
            ]}
            placeholder="Filtrar por tipo"
            searchPlaceholder="Pesquisar tipo"
          />
        </div>
        {writable && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> Novo canal
          </Button>
        )}
      </PageToolbar>

      {data === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhum canal encontrado.
        </Card>
      ) : (
        <>
        <div className="space-y-2">
          {items.map((ch) => {
            const Icon = ICON[ch.type];
            return (
              <Card key={ch.id} className="flex items-center gap-3 p-3">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{ch.name}</span>
                    <Badge variant="outline">{typeLabel(ch.type)}</Badge>
                    {!ch.enabled && <Badge variant="secondary">desativado</Badge>}
                  </div>
                </div>
                {writable && (
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={ch.enabled}
                      disabled={busy === ch.id}
                      onCheckedChange={() => toggle(ch)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Testar"
                      disabled={busy === ch.id}
                      onClick={() => test(ch)}
                    >
                      <Bell className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() => setEditing(ch)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover"
                      onClick={() => setRemoving(ch)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        <Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} />
        </>
      )}

      {editing && (
        <MonitorNotificationsDialog
          formOnly
          initialEditing={editing}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              load();
            }
          }}
        />
      )}

      <ConfirmDelete
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover canal"
        description={`Remover o canal “${removing?.name}”?`}
        onConfirm={remove}
      />
    </div>
  );
}