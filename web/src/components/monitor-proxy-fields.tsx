import { Copy, Loader2, MoreVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ProxyProtocol = "http" | "https" | "socks4" | "socks5" | "socks5h";
export type ProxyMode = "round_robin" | "all";

export const PROXY_PROTOCOLS: ProxyProtocol[] = ["http", "https", "socks4", "socks5", "socks5h"];
/** Placeholder de senha mascarada devolvido pela API (igual ao backend). */
export const PROXY_MASK = "********";

export type ProxyDraft = {
  id?: number;
  /** Identidade estável no cliente (seleção/keys), independente do id do servidor. */
  uid?: string;
  copyFromId?: number;
  protocol: ProxyProtocol;
  server: string;
  port: string;
  auth: boolean;
  username: string;
  password: string;
  enabled: boolean;
};

let _uidSeq = 0;
export function newUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `proxy-${Date.now()}-${_uidSeq++}`;
}

export const emptyProxy = (): ProxyDraft => ({
  uid: newUid(),
  protocol: "http",
  server: "",
  port: "",
  auth: false,
  username: "",
  password: "",
  enabled: true,
});

export function proxyPayload(proxy: ProxyDraft) {
  return {
    id: proxy.id,
    copy_from_id: proxy.copyFromId,
    protocol: proxy.protocol,
    server: proxy.server.trim(),
    port: Number(proxy.port),
    username: proxy.auth ? proxy.username : "",
    password: proxy.auth ? proxy.password : "",
    enabled: proxy.enabled,
  };
}

/** Chave de unicidade: protocolo + servidor + porta (igual ao backend: server so trim). */
export function proxyEndpointKey(p: { protocol: string; server: string; port: string | number }): string {
  return `${p.protocol} ${String(p.server).trim()} ${Number(p.port)}`;
}

export function validateProxies(proxies: ProxyDraft[]): string | null {
  for (const [index, proxy] of proxies.entries()) {
    if (!proxy.server.trim()) {
      return `Informe o servidor do proxy ${index + 1}.`;
    }
    const port = Number(proxy.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return `Porta inválida no proxy ${index + 1}.`;
    }
  }
  return null;
}

/** Duplica um proxy numa lista, logo após o índice dado (nova entrada, sem id). */
export function duplicateProxyAt(proxies: ProxyDraft[], index: number): ProxyDraft[] {
  const proxy = proxies[index];
  return [
    ...proxies.slice(0, index + 1),
    { ...proxy, id: undefined, uid: newUid(), copyFromId: proxy.id ?? proxy.copyFromId },
    ...proxies.slice(index + 1),
  ];
}

// --- Importação / exportação -------------------------------------------------
// Formatos aceitos por linha (com ou sem prefixo scheme:// ∈ PROXY_PROTOCOLS —
// http/https/socks4/socks5/socks5h; sem prefixo usa o tipo padrão escolhido):
//   host:porta
//   host:porta:user:pass
//   scheme://host:porta
//   scheme://host:porta:user:pass
//   scheme://user:pass@host:porta

type Authority = { host: string; port: string; username: string; password: string };

function parseAuthority(rest: string): Authority | string {
  let username = "";
  let password = "";
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    const creds = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const ci = creds.indexOf(":");
    if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1); }
    else username = creds;
    const parts = rest.split(":");
    if (parts.length !== 2) return "esperado host:porta após as credenciais";
    return { host: parts[0], port: parts[1], username, password };
  }
  const parts = rest.split(":");
  if (parts.length === 2) return { host: parts[0], port: parts[1], username, password };
  if (parts.length === 4) return { host: parts[0], port: parts[1], username: parts[2], password: parts[3] };
  return "esperado host:porta ou host:porta:user:pass";
}

// Aliases de scheme → protocolo suportado (ex.: `socks://` = SOCKS5 por convenção).
const PROTO_ALIASES: Record<string, ProxyProtocol> = { socks: "socks5" };

function parseProxyLine(line: string, defaultProtocol: ProxyProtocol): ProxyDraft | string {
  let protocol = defaultProtocol;
  let rest = line;

  const scheme = line.match(/^([a-z0-9]+):\/\/(.*)$/i);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    const resolved = PROTO_ALIASES[proto] ?? proto;
    if (!(PROXY_PROTOCOLS as string[]).includes(resolved)) return `protocolo inválido "${scheme[1]}"`;
    protocol = resolved as ProxyProtocol;
    rest = scheme[2];
  }

  const authority = parseAuthority(rest);
  if (typeof authority === "string") return authority;

  const host = authority.host.trim();
  if (!host) return "host vazio";
  const portNum = Number(authority.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return `porta inválida "${authority.port}"`;

  return {
    uid: newUid(),
    protocol,
    server: host,
    port: String(portNum),
    auth: !!(authority.username || authority.password),
    username: authority.username,
    password: authority.password,
    enabled: true,
  };
}

/** Há linhas sem prefixo `scheme://`? (o tipo delas precisa ser perguntado). */
export function hasSchemelessLines(text: string): boolean {
  return text.split(/\r?\n/).some((raw) => {
    const line = raw.trim();
    return !!line && !line.startsWith("#") && !/^[a-z0-9]+:\/\//i.test(line);
  });
}

export function parseProxyLines(
  text: string,
  defaultProtocol: ProxyProtocol = "http",
): { proxies: ProxyDraft[]; errors: string[] } {
  const proxies: ProxyDraft[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parsed = parseProxyLine(line, defaultProtocol);
    if (typeof parsed === "string") errors.push(`Linha ${i + 1}: ${parsed}`);
    else proxies.push(parsed);
  });
  return { proxies, errors };
}

function exportPassword(proxy: ProxyDraft): string {
  // senhas mascaradas não podem ser reveladas no cliente — exporta vazio.
  return proxy.auth && proxy.password && proxy.password !== PROXY_MASK ? proxy.password : "";
}

export function exportProxiesTxt(proxies: ProxyDraft[]): string {
  return proxies
    .map((p) => {
      const pass = exportPassword(p);
      const creds = p.auth && (p.username || pass) ? `${p.username}:${pass}@` : "";
      return `${p.protocol}://${creds}${p.server}:${p.port}`;
    })
    .join("\n");
}

export function exportProxiesJson(proxies: ProxyDraft[]): string {
  return JSON.stringify(
    proxies.map((p) => ({
      protocol: p.protocol,
      server: p.server,
      port: Number(p.port),
      username: p.auth ? p.username : "",
      password: exportPassword(p),
      enabled: p.enabled,
    })),
    null,
    2,
  );
}

// --- Card de um proxy --------------------------------------------------------

interface ProxyCardProps {
  proxy: ProxyDraft;
  index: number;
  testing: number | null;
  saving?: boolean;
  /** Quando presente, mostra a checkbox de seleção (massa). */
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
  onPatch: (value: Partial<ProxyDraft>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onTest: () => void;
  /** Quando presente, mostra o botão Salvar (uso na página de catálogo). */
  onSave?: () => void;
}

/** Bloco de um único proxy (campos + ações). Reutilizável fora do agrupador. */
export function ProxyCard({
  proxy,
  index,
  testing,
  saving = false,
  selected = false,
  onSelectedChange,
  onPatch,
  onDuplicate,
  onRemove,
  onTest,
  onSave,
}: ProxyCardProps) {
  const busy = testing !== null || saving;
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      {/* título: (checkbox) + Switch (ativo) com tooltip + dropdown de ações */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onSelectedChange && (
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onSelectedChange(v === true)}
              aria-label="Selecionar proxy"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              {/* o span (não o Switch) é o alvo do tooltip: envolver o Switch
                  direto faria o onClick injetado sobrescrever o toggle. */}
              <span className="flex items-center gap-2">
                <Switch
                  checked={proxy.enabled}
                  onCheckedChange={(enabled) => onPatch({ enabled })}
                  aria-label={proxy.enabled ? "Ativo" : "Inativo"}
                />
                <span className="text-sm font-medium">Proxy {index + 1}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {proxy.enabled ? "Ativo — disponível aos monitores" : "Inativo — ignorado pelos monitores"}
            </TooltipContent>
          </Tooltip>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button type="button" variant="ghost" size="icon" aria-label="Ações do proxy">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="h-4 w-4" /> Duplicar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove} className="text-destructive">
              <Trash2 className="h-4 w-4" /> Deletar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* protocolo / servidor / porta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <LabelWithHelp help="SOCKS v5 + DNS resolve o hostname pelo proxy.">Protocolo</LabelWithHelp>
          <Select value={proxy.protocol} onChange={(e) => onPatch({ protocol: e.target.value as ProxyProtocol })}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks4">SOCKS v4</option>
            <option value="socks5">SOCKS v5</option>
            <option value="socks5h">SOCKS v5 + DNS</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <LabelWithHelp help="Hostname ou IP do proxy." required>Servidor</LabelWithHelp>
          <Input value={proxy.server} onChange={(e) => onPatch({ server: e.target.value })} placeholder="proxy.exemplo.com" />
        </div>
        <div className="space-y-1.5">
          <LabelWithHelp help="Porta TCP do proxy." required>Porta</LabelWithHelp>
          <Input
            type="number"
            min={1}
            max={65535}
            value={proxy.port}
            onChange={(e) => onPatch({ port: e.target.value })}
            placeholder="8080"
          />
        </div>
      </div>

      {/* autenticação: usuário e senha ficam dentro do bloco */}
      <div className="rounded-md border">
        <label className="flex cursor-pointer items-center justify-between px-3 py-2">
          <span className="text-sm">
            Autenticação do proxy <span className="text-xs text-muted-foreground">(opcional)</span>
          </span>
          <Switch checked={proxy.auth} onCheckedChange={(auth) => onPatch({ auth })} />
        </label>
        {proxy.auth && (
          <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <LabelWithHelp help="Usuário enviado ao proxy.">Usuário</LabelWithHelp>
              <Input value={proxy.username} autoComplete="off" onChange={(e) => onPatch({ username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <LabelWithHelp help="Senha enviada ao proxy; permanece mascarada ao editar.">Senha</LabelWithHelp>
              <Input
                type="password"
                value={proxy.password}
                autoComplete="new-password"
                onChange={(e) => onPatch({ password: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ações: Testar (esquerda) · Salvar (direita) */}
      <div className="flex items-center justify-between">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onTest}>
          {testing === index && <Loader2 className="h-4 w-4 animate-spin" />}
          Testar
        </Button>
        {onSave && (
          <Button type="button" size="sm" disabled={busy} onClick={onSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Agrupador (usado no formulário do monitor) ------------------------------

interface MonitorProxyFieldsProps {
  proxies: ProxyDraft[];
  mode: ProxyMode;
  testing: number | null;
  showMode?: boolean;
  onChange: (proxies: ProxyDraft[]) => void;
  onModeChange: (mode: ProxyMode) => void;
  onTest: (proxy: ProxyDraft, index: number) => void;
}

export function MonitorProxyFields({
  proxies,
  mode,
  testing,
  showMode = true,
  onChange,
  onModeChange,
  onTest,
}: MonitorProxyFieldsProps) {
  const patch = (index: number, value: Partial<ProxyDraft>) =>
    onChange(proxies.map((proxy, i) => (i === index ? { ...proxy, ...value } : proxy)));

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proxies</p>
          <p className="text-xs text-muted-foreground">Rotas de saída usadas pelos heartbeats deste monitor.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...proxies, emptyProxy()])}>
          <Plus className="h-4 w-4" /> Adicionar proxy
        </Button>
      </div>

      {showMode && proxies.length > 1 && (
        <div className="space-y-1.5">
          <LabelWithHelp
            htmlFor="monitor-proxy-mode"
            help="Round-robin alterna um proxy por heartbeat. Todos executa por cada proxy e exige sucesso de todos."
          >
            Como usar vários proxies
          </LabelWithHelp>
          <Select id="monitor-proxy-mode" value={mode} onChange={(e) => onModeChange(e.target.value as ProxyMode)}>
            <option value="round_robin">Load balance (round-robin)</option>
            <option value="all">Usar todos em conjunto</option>
          </Select>
        </div>
      )}

      {proxies.length === 0 && (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Sem proxy: o monitor acessará o destino diretamente.
        </p>
      )}

      {proxies.map((proxy, index) => (
        <ProxyCard
          key={proxy.id ?? `new-${index}`}
          proxy={proxy}
          index={index}
          testing={testing}
          onPatch={(value) => patch(index, value)}
          onDuplicate={() => onChange(duplicateProxyAt(proxies, index))}
          onRemove={() => onChange(proxies.filter((_, i) => i !== index))}
          onTest={() => onTest(proxy, index)}
        />
      ))}
    </div>
  );
}
