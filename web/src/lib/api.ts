// Client da API. Todas as respostas usam o envelope {success, data, messages}.
// Conexão DIRETA com a API (sem proxy, sem prefixo /api). A base é sempre a
// própria API; o padrão é http://127.0.0.1:3001 (a API roda em HTTP por padrão;
// com API_TLS=on use https://…). Sobrescrevível na tela de Configurações e no
// login (salvo localmente no navegador).

const TOKEN_KEY = "nexus.token";
const BASE_KEY = "nexus.apiBase";

/** Base padrão da API: a própria API (loopback, porta 3001, HTTP). */
export const DEFAULT_API_BASE = "http://127.0.0.1:3001";

/** Só aceitamos base absoluta http(s):// (a conexão é direta, sem proxy). */
function validBase(v: string | null | undefined): string | null {
  return v && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
}

/** Base da API: override salvo (tela de Configurações) → VITE_API_URL → padrão. */
export function getApiBase(): string {
  // Migração: descarta bases legadas relativas (ex.: "/api") salvas antes da
  // conexão direta — hoje uma base assim quebraria o login (bate no :3000).
  const saved = localStorage.getItem(BASE_KEY);
  if (saved && !validBase(saved)) localStorage.removeItem(BASE_KEY);
  return (
    validBase(saved) ||
    validBase(import.meta.env.VITE_API_URL) ||
    DEFAULT_API_BASE
  );
}
export function setApiBase(base: string | null) {
  if (base) localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ""));
  else localStorage.removeItem(BASE_KEY);
}

/** URL do stream SSE (EventSource não envia header; token vai na query). */
export function streamUrl(path: string): string {
  const token = getToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${getApiBase()}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}

/** URL WebSocket (ws://|wss://) com o token na query (terminal TTY). */
export function wsUrl(path: string): string {
  const base = getApiBase().replace(/^http/, "ws");
  const token = getToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${base}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}

export type Message = { type: "warn" | "error" | "success"; message: string };
export type Envelope<T> = { success: boolean; data: T; messages: Message[] };

export class ApiError extends Error {
  status: number;
  messages: Message[];
  constructor(status: number, messages: Message[]) {
    super(messages[0]?.message || `Erro ${status}`);
    this.status = status;
    this.messages = messages;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

type Options = { method?: string; body?: unknown; form?: FormData; auth?: boolean };

export async function api<T = unknown>(
  path: string,
  { method = "GET", body, form, auth = true }: Options = {},
): Promise<Envelope<T>> {
  const headers: Record<string, string> = {};
  // multipart (form): sem Content-Type manual — o browser define o boundary.
  if (form === undefined && body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;
  // Identifica o usuário logado para o registro de auditoria.
  const user = localStorage.getItem("nexus.user");
  if (auth && user) headers["X-User"] = user;

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, [{ type: "error", message: "Falha de rede — a API está no ar?" }]);
  }

  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, [
      { type: "error", message: `Resposta inválida (${res.status})` },
    ]);
  }

  if (!res.ok || !json.success) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, json.messages ?? []);
  }
  return json;
}

// Helpers tipados ------------------------------------------------------------
export const get = <T>(p: string) => api<T>(p).then((r) => r.data);
export const del = <T>(p: string) => api<T>(p, { method: "DELETE" }).then((r) => r.data);
export const post = <T>(p: string, body?: unknown) =>
  api<T>(p, { method: "POST", body }).then((r) => r.data);
export const put = <T>(p: string, body?: unknown) =>
  api<T>(p, { method: "PUT", body }).then((r) => r.data);
export const postForm = <T>(p: string, form: FormData) =>
  api<T>(p, { method: "POST", form }).then((r) => r.data);

/** Upload multipart com progresso (XHR — o fetch não expõe upload progress). */
export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (loaded: number, total: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", `${getApiBase()}${path}`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    const user = localStorage.getItem("nexus.user");
    if (user) xhr.setRequestHeader("X-User", user);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onload = () => {
      let json: Envelope<T> | null = null;
      try { json = JSON.parse(xhr.responseText) as Envelope<T>; } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && json?.success) {
        resolve(json.data);
      } else {
        if (xhr.status === 401) setToken(null);
        reject(new ApiError(xhr.status, json?.messages ?? [{ type: "error", message: `Erro ${xhr.status}` }]));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, [{ type: "error", message: "Falha de rede no upload" }]));
    xhr.onabort = () => reject(new ApiError(0, [{ type: "error", message: "Upload cancelado" }]));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export type LoginResult = {
  token: string;
  user: string;
  name: string;
  email: string;
  role: string;
  is_master: boolean;
  permissions: string[];
};

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await api<LoginResult>("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  return res.data;
}
