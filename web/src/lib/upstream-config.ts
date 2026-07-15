// Monta o corpo de um bloco upstream a partir do formulário.

export type UpstreamServer = {
  address: string;
  weight: string;
  maxFails: string;
  failTimeout: string;
  maxConns: string;
  slowStart: string;
  backup: boolean;
  down: boolean;
};

export type UpstreamForm = {
  name: string;
  method: "" | "least_conn" | "ip_hash" | "random" | "hash";
  hashKey: string;
  hashConsistent: boolean;
  randomTwo: boolean;
  zoneEnabled: boolean;
  zoneSize: string;
  servers: UpstreamServer[];
  keepalive: string;
  keepaliveRequests: string;
  keepaliveTime: string;
  keepaliveTimeout: string;
};

export const emptyUpstreamServer: UpstreamServer = {
  address: "",
  weight: "",
  maxFails: "",
  failTimeout: "",
  maxConns: "",
  slowStart: "",
  backup: false,
  down: false,
};

export const emptyUpstreamForm: UpstreamForm = {
  name: "",
  method: "",
  hashKey: "",
  hashConsistent: false,
  randomTwo: false,
  zoneEnabled: false,
  zoneSize: "64k",
  servers: [{ ...emptyUpstreamServer }],
  keepalive: "",
  keepaliveRequests: "",
  keepaliveTime: "",
  keepaliveTimeout: "",
};

const TIME = /^\d+(ms|s|m|h)?$/;
const ADDR = /^[A-Za-z0-9_.:[\]-]+$/; // host, host:port, ipv6, unix: (simplificado)
const SIZE = /^\d+[kKmM]?$/;

export function validateUpstreamForm(f: UpstreamForm): string | null {
  const name = f.name.trim();
  if (!name) return "Nome do upstream é obrigatório";
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return "Nome só aceita letras, números, . _ -";

  const active = f.servers.filter((s) => s.address.trim());
  if (active.length < 1) return "Adicione ao menos 1 server";
  for (const s of active) {
    const a = s.address.trim();
    if (!ADDR.test(a) && !a.startsWith("unix:")) return `Endereço inválido: ${a}`;
    if (s.weight.trim() && !/^\d+$/.test(s.weight.trim())) return "weight deve ser inteiro";
    if (s.maxFails.trim() && !/^\d+$/.test(s.maxFails.trim())) return "max_fails deve ser inteiro";
    if (s.failTimeout.trim() && !TIME.test(s.failTimeout.trim()))
      return "fail_timeout inválido (ex.: 30s)";
    if (s.maxConns.trim() && !/^\d+$/.test(s.maxConns.trim())) return "max_conns deve ser inteiro";
    if (s.slowStart.trim() && !TIME.test(s.slowStart.trim()))
      return "slow_start inválido (ex.: 30s)";
  }
  if (f.method === "hash" && !f.hashKey.trim()) return "hash: informe a chave (ex.: $remote_addr)";
  if (f.zoneEnabled && f.zoneSize.trim() && !SIZE.test(f.zoneSize.trim()))
    return "zone: tamanho inválido (ex.: 64k)";
  if (f.keepalive.trim() && !/^\d+$/.test(f.keepalive.trim()))
    return "keepalive deve ser inteiro";
  if (f.keepaliveRequests.trim() && !/^\d+$/.test(f.keepaliveRequests.trim()))
    return "keepalive_requests deve ser inteiro";
  if (f.keepaliveTime.trim() && !TIME.test(f.keepaliveTime.trim()))
    return "keepalive_time inválido (ex.: 1h)";
  if (f.keepaliveTimeout.trim() && !TIME.test(f.keepaliveTimeout.trim()))
    return "keepalive_timeout inválido (ex.: 60s)";
  return null;
}

type Node = { type?: string; name?: string; args?: string[] };
const METHODS = ["least_conn", "ip_hash"];

/** Parseia os nós de um bloco upstream em UpstreamForm. `faithful=false` quando
 * há diretivas que o formulário não representa (o chamador abre em modo raw). */
export function parseUpstreamForm(nodes: unknown[]): { form: UpstreamForm; faithful: boolean } {
  const f: UpstreamForm = { ...emptyUpstreamForm, servers: [] };
  let faithful = true;
  for (const raw of nodes as Node[]) {
    if (raw.type === "comment") continue;
    if (raw.type !== "directive" || !raw.name) { faithful = false; continue; }
    const a = raw.args ?? [];
    if (raw.name === "hash") {
      f.method = "hash";
      f.hashKey = a[0] ?? "";
      f.hashConsistent = a.includes("consistent");
    } else if (raw.name === "random") {
      f.method = "random";
      f.randomTwo = a.includes("two");
      if (a.some((x) => x !== "two")) faithful = false; // método de 2º nível (plus-only)
    } else if (METHODS.includes(raw.name)) {
      f.method = raw.name as UpstreamForm["method"];
    } else if (raw.name === "zone") {
      f.zoneEnabled = true;
      f.zoneSize = a[1] ?? "";
    } else if (raw.name === "server") {
      const s = { ...emptyUpstreamServer, address: a[0] ?? "" };
      for (const opt of a.slice(1)) {
        if (opt === "backup") s.backup = true;
        else if (opt === "down") s.down = true;
        else if (opt.startsWith("weight=")) s.weight = opt.slice(7);
        else if (opt.startsWith("max_fails=")) s.maxFails = opt.slice(10);
        else if (opt.startsWith("fail_timeout=")) s.failTimeout = opt.slice(13);
        else if (opt.startsWith("max_conns=")) s.maxConns = opt.slice(10);
        else if (opt.startsWith("slow_start=")) s.slowStart = opt.slice(11);
        else faithful = false; // opção que o form não conhece
      }
      f.servers.push(s);
    } else if (raw.name === "keepalive") {
      f.keepalive = a[0] ?? "";
    } else if (raw.name === "keepalive_requests") {
      f.keepaliveRequests = a[0] ?? "";
    } else if (raw.name === "keepalive_time") {
      f.keepaliveTime = a[0] ?? "";
    } else if (raw.name === "keepalive_timeout") {
      f.keepaliveTimeout = a[0] ?? "";
    } else {
      faithful = false; // diretiva desconhecida
    }
  }
  if (f.servers.length === 0) f.servers = [{ ...emptyUpstreamServer }];
  return { form: f, faithful };
}

export function buildUpstreamBody(f: UpstreamForm): string {
  const lines: string[] = [];
  if (f.zoneEnabled) lines.push(`zone ${f.name.trim() || "upstream"}_zone ${f.zoneSize.trim() || "64k"};`);
  if (f.method === "hash") {
    lines.push(`hash ${f.hashKey.trim() || "$remote_addr"}${f.hashConsistent ? " consistent" : ""};`);
  } else if (f.method === "random") {
    lines.push(`random${f.randomTwo ? " two" : ""};`);
  } else if (f.method) {
    lines.push(`${f.method};`);
  }
  for (const s of f.servers) {
    const addr = s.address.trim();
    if (!addr) continue;
    const parts = [`server ${addr}`];
    if (s.weight.trim()) parts.push(`weight=${s.weight.trim()}`);
    if (s.maxFails.trim()) parts.push(`max_fails=${s.maxFails.trim()}`);
    if (s.failTimeout.trim()) parts.push(`fail_timeout=${s.failTimeout.trim()}`);
    if (s.maxConns.trim()) parts.push(`max_conns=${s.maxConns.trim()}`);
    if (s.slowStart.trim()) parts.push(`slow_start=${s.slowStart.trim()}`);
    if (s.backup) parts.push("backup");
    if (s.down) parts.push("down");
    lines.push(parts.join(" ") + ";");
  }
  if (f.keepalive.trim()) lines.push(`keepalive ${f.keepalive.trim()};`);
  if (f.keepaliveRequests.trim()) lines.push(`keepalive_requests ${f.keepaliveRequests.trim()};`);
  if (f.keepaliveTime.trim()) lines.push(`keepalive_time ${f.keepaliveTime.trim()};`);
  if (f.keepaliveTimeout.trim()) lines.push(`keepalive_timeout ${f.keepaliveTimeout.trim()};`);
  return lines.join("\n") + "\n";
}
