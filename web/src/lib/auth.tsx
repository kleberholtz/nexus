import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, login as apiLogin, post, setToken } from "./api";
import { Identity } from "./types";

const IDENTITY_KEY = "nexus.identity";

type AuthState = {
  authenticated: boolean;
  ready: boolean;
  identity: Identity | null;
  isMaster: boolean;
  /** Verifica permissão `<resource>:<action>` na identidade atual. */
  can: (resource: string, action: "read" | "write") => boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Recarrega a identidade do servidor (ex.: após editar o próprio perfil). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

function storeIdentity(id: Identity | null) {
  if (id) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
    localStorage.setItem("nexus.user", id.username);
  } else {
    localStorage.removeItem(IDENTITY_KEY);
    localStorage.removeItem("nexus.user");
  }
}

/** Payload de identidade vindo de /auth/login e /auth/verify. */
type IdentityPayload = {
  user: string; name?: string; email?: string;
  role: string; is_master: boolean; permissions: string[];
};
function toIdentity(p: IdentityPayload): Identity {
  return {
    username: p.user, name: p.name ?? "", email: p.email ?? "",
    role: p.role, isMaster: p.is_master, permissions: p.permissions ?? [],
  };
}

export function hasPermission(id: Identity | null, resource: string, action: string): boolean {
  if (!id) return false;
  return id.permissions.includes("*") || id.permissions.includes(`${resource}:${action}`);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(loadIdentity);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Restaura a sessão: valida o token salvo contra /auth/verify e atualiza a
    // identidade (papel/permissões podem ter mudado desde o último login).
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    api<IdentityPayload & { valid: boolean }>("/auth/verify")
      .then((r) => {
        const id = toIdentity(r.data);
        storeIdentity(id);
        setIdentity(id);
      })
      .catch(() => {
        setToken(null);
        storeIdentity(null);
        setIdentity(null);
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      authenticated: identity !== null,
      ready,
      identity,
      isMaster: identity?.isMaster ?? false,
      can: (resource, action) => hasPermission(identity, resource, action),
      async signIn(username, password) {
        const res = await apiLogin(username, password);
        setToken(res.token);
        const id = toIdentity({
          user: res.user, name: res.name, email: res.email,
          role: res.role, is_master: res.is_master, permissions: res.permissions,
        });
        storeIdentity(id);
        setIdentity(id);
      },
      signOut() {
        // Invalida a sessão no servidor (best-effort) e limpa o estado local.
        post("/auth/logout").catch(() => {});
        setToken(null);
        storeIdentity(null);
        setIdentity(null);
      },
      async refresh() {
        const r = await api<IdentityPayload & { valid: boolean }>("/auth/verify");
        const id = toIdentity(r.data);
        storeIdentity(id);
        setIdentity(id);
      },
    }),
    [identity, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
