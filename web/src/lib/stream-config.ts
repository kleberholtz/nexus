// Monta/parseia um server block do contexto `stream {}` (proxy TCP/UDP) a partir
// do formulário. Segue o mesmo padrão de upstream-config/server-config.

export type StreamForm = {
  listen: string; // porta ou host:porta
  udp: boolean;
  proxyPass: string; // upstream (stream) ou host:porta
  proxyConnectTimeout: string;
  proxyTimeout: string;
};

export const emptyStreamForm: StreamForm = {
  listen: "",
  udp: false,
  proxyPass: "",
  proxyConnectTimeout: "",
  proxyTimeout: "",
};

const TIME = /^\d+(ms|s|m|h)?$/;

export function validateStreamForm(f: StreamForm): string | null {
  const listen = f.listen.trim();
  if (!listen) return "listen é obrigatório";
  if (!/^(\d+|[A-Za-z0-9_.:[\]-]+:\d+)$/.test(listen))
    return "listen inválido (ex.: 5432 ou 127.0.0.1:5432)";
  if (!f.proxyPass.trim()) return "proxy_pass (destino) é obrigatório";
  if (f.proxyConnectTimeout.trim() && !TIME.test(f.proxyConnectTimeout.trim()))
    return "proxy_connect_timeout inválido (ex.: 10s)";
  if (f.proxyTimeout.trim() && !TIME.test(f.proxyTimeout.trim()))
    return "proxy_timeout inválido (ex.: 60s)";
  return null;
}

export function buildStreamConfig(f: StreamForm): string {
  const out: string[] = ["server {"];
  const p = (s: string) => out.push(`  ${s}`);
  p(`listen ${f.listen.trim()}${f.udp ? " udp" : ""};`);
  p(`proxy_pass ${f.proxyPass.trim()};`);
  if (f.proxyConnectTimeout.trim()) p(`proxy_connect_timeout ${f.proxyConnectTimeout.trim()};`);
  if (f.proxyTimeout.trim()) p(`proxy_timeout ${f.proxyTimeout.trim()};`);
  out.push("}");
  return out.join("\n") + "\n";
}

type Node = { type?: string; name?: string; args?: string[] };

/** Parseia os nós do server block em StreamForm. `faithful=false` quando há
 * diretivas que o formulário não representa (o chamador abre em modo raw). */
export function parseStreamForm(nodes: unknown[]): { form: StreamForm; faithful: boolean } {
  const f: StreamForm = { ...emptyStreamForm };
  let faithful = true;
  for (const raw of nodes as Node[]) {
    if (raw.type === "comment") continue;
    if (raw.type !== "directive" || !raw.name) { faithful = false; continue; }
    const a = raw.args ?? [];
    switch (raw.name) {
      case "listen":
        f.listen = a[0] ?? "";
        f.udp = a.includes("udp");
        // qualquer flag além de udp (ssl, proxy_protocol, so_keepalive…) → raw
        if (a.slice(1).some((x) => x !== "udp")) faithful = false;
        break;
      case "proxy_pass": f.proxyPass = a.join(" "); break;
      case "proxy_connect_timeout": f.proxyConnectTimeout = a[0] ?? ""; break;
      case "proxy_timeout": f.proxyTimeout = a[0] ?? ""; break;
      default: faithful = false;
    }
  }
  return { form: f, faithful };
}
