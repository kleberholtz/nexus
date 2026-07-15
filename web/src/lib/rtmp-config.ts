// Monta/parseia o corpo de um bloco `application {}` do módulo nginx-rtmp a
// partir do formulário de live streaming.

export type RtmpRecord = "off" | "all" | "video" | "audio" | "keyframes" | "manual";
export type RtmpAccess = "all" | "none";

export type RtmpForm = {
  name: string;
  port: string;
  key: string;
  live: boolean;
  hls: boolean;
  hlsPath: string;
  hlsFragment: string;
  hlsPlaylistLength: string;
  hlsNested: boolean;
  hlsCleanup: boolean;
  record: RtmpRecord;
  recordPath: string;
  publish: RtmpAccess;
  play: RtmpAccess;
  push: string[];
  pull: string[];
};

export const emptyRtmpForm: RtmpForm = {
  name: "",
  port: "1935",
  key: "",
  live: true,
  hls: false,
  hlsPath: "/var/www/hls",
  hlsFragment: "",
  hlsPlaylistLength: "",
  hlsNested: false,
  hlsCleanup: false,
  record: "off",
  recordPath: "/var/www/rec",
  publish: "all",
  play: "all",
  push: [],
  pull: [],
};

const TIME = /^\d+(ms|s|m|h)?$/;

export function validateRtmpForm(f: RtmpForm): string | null {
  const name = f.name.trim();
  if (!name) return "Nome da aplicação é obrigatório";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Nome só aceita letras, números, . _ -";
  const key = f.key.trim();
  if (key && !/^[A-Za-z0-9._-]+$/.test(key)) return "Chave só aceita letras, números, . _ -";
  const port = f.port.trim();
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    return "Porta deve ser 1–65535";
  if (f.hls) {
    if (!f.hlsPath.trim()) return "Informe o hls_path";
    if (f.hlsFragment.trim() && !TIME.test(f.hlsFragment.trim())) return "hls_fragment inválido (ex.: 4s)";
    if (f.hlsPlaylistLength.trim() && !TIME.test(f.hlsPlaylistLength.trim()))
      return "hls_playlist_length inválido (ex.: 12s)";
  }
  if (f.record !== "off" && !f.recordPath.trim()) return "Informe o record_path";
  for (const u of f.push) if (u.trim() && !/^rtmp:\/\//i.test(u.trim())) return `push inválido: ${u}`;
  for (const u of f.pull) if (u.trim() && !/^rtmp:\/\//i.test(u.trim())) return `pull inválido: ${u}`;
  return null;
}

// Prefixo do comentário que persiste a chave de transmissão no bloco application
// (o nginx-rtmp não tem diretiva de chave; guardamos como comentário).
const KEY_COMMENT = "# stream_key ";

/** Gera uma chave de transmissão aleatória (hex, boa entropia). */
export function randomStreamKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildRtmpBody(f: RtmpForm): string {
  const lines: string[] = [];
  if (f.key.trim()) lines.push(`${KEY_COMMENT}${f.key.trim()}`);
  lines.push(f.live ? "live on;" : "live off;");
  if (f.hls) {
    lines.push("hls on;");
    if (f.hlsPath.trim()) lines.push(`hls_path ${f.hlsPath.trim()};`);
    if (f.hlsFragment.trim()) lines.push(`hls_fragment ${f.hlsFragment.trim()};`);
    if (f.hlsPlaylistLength.trim()) lines.push(`hls_playlist_length ${f.hlsPlaylistLength.trim()};`);
    if (f.hlsNested) lines.push("hls_nested on;");
    if (f.hlsCleanup) lines.push("hls_cleanup on;");
  }
  if (f.record !== "off") {
    lines.push(`record ${f.record};`);
    if (f.recordPath.trim()) lines.push(`record_path ${f.recordPath.trim()};`);
  }
  lines.push(f.publish === "all" ? "allow publish all;" : "deny publish all;");
  lines.push(f.play === "all" ? "allow play all;" : "deny play all;");
  for (const u of f.push) if (u.trim()) lines.push(`push ${u.trim()};`);
  for (const u of f.pull) if (u.trim()) lines.push(`pull ${u.trim()};`);
  return lines.join("\n") + "\n";
}

type Node = { type?: string; name?: string; args?: string[]; text?: string };

export function parseRtmpForm(nodes: unknown[], port: string): RtmpForm {
  const f: RtmpForm = { ...emptyRtmpForm, port, key: "", push: [], pull: [], hlsPath: "", recordPath: "" };
  for (const raw of nodes as Node[]) {
    if (raw.type === "comment" && raw.text?.startsWith("stream_key ")) {
      f.key = raw.text.slice("stream_key ".length).trim();
      continue;
    }
    if (raw.type !== "directive" || !raw.name) continue;
    const a = raw.args ?? [];
    switch (raw.name) {
      case "live": f.live = a[0] === "on"; break;
      case "hls": f.hls = a[0] === "on"; break;
      case "hls_path": f.hlsPath = a[0] ?? ""; break;
      case "hls_fragment": f.hlsFragment = a[0] ?? ""; break;
      case "hls_playlist_length": f.hlsPlaylistLength = a[0] ?? ""; break;
      case "hls_nested": f.hlsNested = a[0] === "on"; break;
      case "hls_cleanup": f.hlsCleanup = a[0] === "on"; break;
      case "record": f.record = (a[0] as RtmpRecord) ?? "off"; break;
      case "record_path": f.recordPath = a[0] ?? ""; break;
      case "allow":
        if (a[0] === "publish") f.publish = "all";
        else if (a[0] === "play") f.play = "all";
        break;
      case "deny":
        if (a[0] === "publish") f.publish = "none";
        else if (a[0] === "play") f.play = "none";
        break;
      case "push": f.push.push(a.join(" ")); break;
      case "pull": f.pull.push(a.join(" ")); break;
    }
  }
  if (!f.hlsPath) f.hlsPath = emptyRtmpForm.hlsPath;
  if (!f.recordPath) f.recordPath = emptyRtmpForm.recordPath;
  return f;
}
