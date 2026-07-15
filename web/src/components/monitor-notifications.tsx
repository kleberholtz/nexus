import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Loader2,
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
  NotificationForm,
  NotificationType,
  buildNotificationBody,
  emptyNotificationForm,
  parseNotificationForm,
  typeLabel,
  validateNotificationForm,
} from "@/lib/notification-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  webhook: Webhook, telegram: Send, discord: MessageCircle, email: Mail, slack: Slack, teams: Users,
};
const TYPE_OPTS = NOTIFICATION_TYPES.map((t) => ({ value: t.value, label: t.label }));
const METHOD_OPTS = ["POST", "GET", "PUT"].map((m) => ({ value: m, label: m }));

function IconBtn({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MonitorNotificationsDialog({ onOpenChange, initialEditing = null, formOnly = false }: { onOpenChange: (o: boolean) => void; initialEditing?: NotificationChannel | "new" | null; formOnly?: boolean }) {
  const { can } = useAuth();
  const writable = can("monitors", "write");
  const [channels, setChannels] = useState<NotificationChannel[] | null>(null);
  const [editing, setEditing] = useState<NotificationChannel | null | "new">(initialEditing);
  const [toDelete, setToDelete] = useState<NotificationChannel | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      setChannels(await get<NotificationChannel[]>("/monitors/notifications"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar canais");
    }
  }
  useEffect(() => { load(); }, []);

  async function toggle(ch: NotificationChannel) {
    setBusy(ch.id);
    try {
      await put(`/monitors/notifications/${ch.id}`, { enabled: !ch.enabled });
      setChannels((cur) => cur?.map((x) => (x.id === ch.id ? { ...x, enabled: !x.enabled } : x)) ?? cur);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar");
    } finally {
      setBusy(null);
    }
  }

  async function testChannel(ch: NotificationChannel) {
    setBusy(ch.id);
    try {
      await post(`/monitors/notifications/${ch.id}/test`);
      toast.success("Notificação de teste enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      await del(`/monitors/notifications/${toDelete.id}`);
      toast.success("Canal removido");
      setChannels((cur) => cur?.filter((x) => x.id !== toDelete.id) ?? cur);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setToDelete(null);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <TooltipProvider>
          {editing === null && !formOnly ? (
            <>
              <DialogHeader>
                <DialogTitle>Notificações</DialogTitle>
                <DialogDescription>
                  Canais que recebem alertas quando um monitor cai ou se recupera.
                </DialogDescription>
              </DialogHeader>

              {writable && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setEditing("new")}>
                    <Plus className="h-4 w-4" /> Novo canal
                  </Button>
                </div>
              )}

              {channels === null ? (
                <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : channels.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhum canal ainda. {writable && "Clique em “Novo canal”."}
                </p>
              ) : (
                <div className="space-y-2">
                  {channels.map((ch) => {
                    const Icon = TYPE_ICON[ch.type];
                    return (
                      <div key={ch.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{ch.name}</span>
                            <Badge variant="outline">{typeLabel(ch.type)}</Badge>
                            {!ch.enabled && <Badge variant="secondary">desativado</Badge>}
                          </div>
                        </div>
                        {writable && (
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span><Switch checked={ch.enabled} disabled={busy === ch.id}
                                  onCheckedChange={() => toggle(ch)} /></span>
                              </TooltipTrigger>
                              <TooltipContent>{ch.enabled ? "Desativar" : "Ativar"}</TooltipContent>
                            </Tooltip>
                            <IconBtn label="Testar" onClick={() => testChannel(ch)} disabled={busy === ch.id}>
                              <Bell className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn label="Editar" onClick={() => setEditing(ch)}>
                              <Pencil className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn label="Remover" onClick={() => setToDelete(ch)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </IconBtn>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <ChannelForm
              editing={editing === "new" || editing === null ? null : editing}
              onBack={() => formOnly ? onOpenChange(false) : setEditing(null)}
              onSaved={() => { if (formOnly) onOpenChange(false); else { setEditing(null); load(); } }}
            />
          )}

          <ConfirmDelete
            open={!!toDelete}
            onOpenChange={(o) => !o && setToDelete(null)}
            title="Remover canal"
            description={`Remover o canal “${toDelete?.name}”?`}
            confirmLabel="Remover"
            onConfirm={remove}
          />
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}

function ChannelForm({ editing, onBack, onSaved }: {
  editing: NotificationChannel | null; onBack: () => void; onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [form, setForm] = useState<NotificationForm>(
    () => (editing ? parseNotificationForm(editing) : emptyNotificationForm()));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const set = <K extends keyof NotificationForm>(k: K, v: NotificationForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function test() {
    const err = validateNotificationForm(form);
    if (err) return toast.error(err);
    setTesting(true);
    try {
      const body = buildNotificationBody(form);
      // Ao editar, envia o id p/ herdar segredos mascarados não alterados.
      await post("/monitors/notifications/test", isEdit ? { ...body, id: editing!.id } : body);
      toast.success("Notificação de teste enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste");
    } finally {
      setTesting(false);
    }
  }

  async function submit() {
    const err = validateNotificationForm(form);
    if (err) return toast.error(err);
    setBusy(true);
    try {
      const body = buildNotificationBody(form);
      if (isEdit) await put(`/monitors/notifications/${editing!.id}`, body);
      else await post("/monitors/notifications", body);
      toast.success(isEdit ? "Canal atualizado" : "Canal criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          {isEdit ? "Editar canal" : "Novo canal"}
        </DialogTitle>
        <DialogDescription>Configure o destino das notificações.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <LabelWithHelp help="Tipo de canal. Não muda depois de criado." required>Tipo</LabelWithHelp>
            <SelectWithSearch options={TYPE_OPTS} value={form.type} disabled={isEdit}
              onChange={(v) => set("type", v as NotificationType)} />
          </div>
          <div className="space-y-1.5">
            <LabelWithHelp help="Nome amigável do canal." required>Nome</LabelWithHelp>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)}
              placeholder="Alertas do time" spellCheck={false} />
          </div>
        </div>

        {form.type === "webhook" && (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <LabelWithHelp help="Endpoint que recebe o POST/GET/PUT com {subject, message}." required>URL</LabelWithHelp>
              <Input value={form.url} onChange={(e) => set("url", e.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Método HTTP da requisição.">Método</LabelWithHelp>
              <SelectWithSearch options={METHOD_OPTS} value={form.method} onChange={(v) => set("method", v)} />
            </div>
          </div>
        )}

        {form.type === "telegram" && (
          <>
            <div className="space-y-1.5">
              <LabelWithHelp help="Token do bot (via @BotFather). Fica mascarado após salvar." required>Bot token</LabelWithHelp>
              <Input value={form.botToken} onChange={(e) => set("botToken", e.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="ID do chat/canal/grupo de destino." required>Chat ID</LabelWithHelp>
              <Input value={form.chatId} onChange={(e) => set("chatId", e.target.value)} spellCheck={false} />
            </div>
          </>
        )}

        {form.type === "discord" && (
          <>
            <div className="space-y-1.5">
              <LabelWithHelp help="URL do webhook do canal do Discord. Fica mascarada após salvar." required>URL do webhook</LabelWithHelp>
              <Input value={form.webhookUrl} onChange={(e) => set("webhookUrl", e.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Nome exibido como autor (opcional).">Usuário (opcional)</LabelWithHelp>
              <Input value={form.username} onChange={(e) => set("username", e.target.value)} spellCheck={false} />
            </div>
          </>
        )}

        {form.type === "slack" && (
          <>
            <div className="space-y-1.5">
              <LabelWithHelp help="Incoming webhook do Slack. Fica mascarada após salvar." required>URL do webhook</LabelWithHelp>
              <Input value={form.webhookUrl} onChange={(e) => set("webhookUrl", e.target.value)} spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Canal alvo, ex.: #alertas (opcional).">Canal (opcional)</LabelWithHelp>
              <Input value={form.channel} onChange={(e) => set("channel", e.target.value)} spellCheck={false} />
            </div>
          </>
        )}

        {form.type === "teams" && (
          <div className="space-y-1.5">
            <LabelWithHelp help="Incoming webhook do canal do Teams. Fica mascarada após salvar." required>URL do webhook</LabelWithHelp>
            <Input value={form.webhookUrl} onChange={(e) => set("webhookUrl", e.target.value)} spellCheck={false} />
          </div>
        )}

        {form.type === "email" && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <LabelWithHelp help="Servidor SMTP." required>Servidor SMTP</LabelWithHelp>
                <Input value={form.host} onChange={(e) => set("host", e.target.value)}
                  placeholder="smtp.exemplo.com" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Porta SMTP (587 = STARTTLS).">Porta</LabelWithHelp>
                <Input inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <LabelWithHelp help="Usuário SMTP (opcional).">Usuário</LabelWithHelp>
                <Input value={form.emailUsername} onChange={(e) => set("emailUsername", e.target.value)} spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Senha SMTP. Fica mascarada após salvar.">Senha</LabelWithHelp>
                <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Endereço remetente (From)." required>Remetente</LabelWithHelp>
                <Input value={form.from} onChange={(e) => set("from", e.target.value)}
                  placeholder="alertas@exemplo.com" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <LabelWithHelp help="Destinatários separados por vírgula." required>Destinatário(s)</LabelWithHelp>
                <Input value={form.to} onChange={(e) => set("to", e.target.value)}
                  placeholder="ops@exemplo.com" spellCheck={false} />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <span className="text-sm">Usar STARTTLS</span>
              <Switch checked={form.tls} onCheckedChange={(v) => set("tls", v)} />
            </label>
          </>
        )}

        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm font-medium">Ativo</span>
          <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </label>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={test} disabled={busy || testing}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          Testar
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar" : "Criar canal"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
