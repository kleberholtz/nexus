// Tipos e helpers dos canais de notificação dos monitores.

export type NotificationType = "webhook" | "telegram" | "discord" | "email" | "slack" | "teams";

export type NotificationChannel = {
  id: number;
  name: string;
  type: NotificationType;
  enabled: boolean;
  config: Record<string, unknown>;   // segredos mascarados no GET
  created_ts: number;
  updated_ts: number;
};

export const NOTIFICATION_TYPES: { value: NotificationType; label: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "email", label: "E-mail (SMTP)" },
  { value: "slack", label: "Slack" },
  { value: "teams", label: "Microsoft Teams" },
];

export function typeLabel(t: NotificationType): string {
  return NOTIFICATION_TYPES.find((x) => x.value === t)?.label ?? t;
}

export type NotificationForm = {
  type: NotificationType;
  name: string;
  enabled: boolean;
  // webhook
  url: string;
  method: string;
  // telegram
  botToken: string;
  chatId: string;
  // discord / slack / teams
  webhookUrl: string;
  username: string;   // discord
  channel: string;    // slack
  // email
  host: string;
  port: string;
  emailUsername: string;
  password: string;
  from: string;
  to: string;
  tls: boolean;
};

export function emptyNotificationForm(): NotificationForm {
  return {
    type: "webhook",
    name: "",
    enabled: true,
    url: "https://",
    method: "POST",
    botToken: "",
    chatId: "",
    webhookUrl: "https://",
    username: "",
    channel: "",
    host: "",
    port: "587",
    emailUsername: "",
    password: "",
    from: "",
    to: "",
    tls: true,
  };
}

export function parseNotificationForm(ch: NotificationChannel): NotificationForm {
  const f = emptyNotificationForm();
  const c = ch.config as Record<string, string | boolean | number>;
  const s = (k: string) => (c[k] != null ? String(c[k]) : "");
  return {
    ...f,
    type: ch.type,
    name: ch.name,
    enabled: ch.enabled,
    url: s("url") || "https://",
    method: s("method") || "POST",
    botToken: s("bot_token"),
    chatId: s("chat_id"),
    webhookUrl: s("webhook_url") || "https://",
    username: s("username"),
    channel: s("channel"),
    host: s("host"),
    port: s("port") || "587",
    emailUsername: s("username"),
    password: s("password"),
    from: s("from"),
    to: s("to"),
    tls: c.tls != null ? Boolean(c.tls) : true,
  };
}

export function buildNotificationBody(f: NotificationForm): Record<string, unknown> {
  let config: Record<string, unknown> = {};
  switch (f.type) {
    case "webhook":
      config = { url: f.url.trim(), method: f.method };
      break;
    case "telegram":
      config = { bot_token: f.botToken, chat_id: f.chatId.trim() };
      break;
    case "discord":
      config = { webhook_url: f.webhookUrl.trim(), username: f.username.trim() };
      break;
    case "slack":
      config = { webhook_url: f.webhookUrl.trim(), channel: f.channel.trim() };
      break;
    case "teams":
      config = { webhook_url: f.webhookUrl.trim() };
      break;
    case "email":
      config = {
        host: f.host.trim(), port: Number(f.port) || 587,
        username: f.emailUsername.trim(), password: f.password,
        from: f.from.trim(), to: f.to.trim(), tls: f.tls,
      };
      break;
  }
  return { name: f.name.trim(), type: f.type, enabled: f.enabled, config };
}

export function validateNotificationForm(f: NotificationForm): string | null {
  if (!f.name.trim()) return "Informe o nome do canal.";
  const httpish = (v: string) => /^https?:\/\//i.test(v.trim());
  switch (f.type) {
    case "webhook":
      if (!httpish(f.url)) return "A URL deve começar com http:// ou https://.";
      break;
    case "telegram":
      if (!f.botToken.trim()) return "Informe o bot token.";
      if (!f.chatId.trim()) return "Informe o chat ID.";
      break;
    case "discord":
    case "slack":
    case "teams":
      if (!httpish(f.webhookUrl)) return "A URL do webhook deve começar com http:// ou https://.";
      break;
    case "email":
      if (!f.host.trim()) return "Informe o servidor SMTP.";
      if (!f.from.trim()) return "Informe o remetente.";
      if (!f.to.trim()) return "Informe ao menos um destinatário.";
      break;
  }
  return null;
}
