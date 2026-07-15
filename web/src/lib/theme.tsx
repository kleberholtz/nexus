// Tema: "auto" (padrão, segue o SO), "dark" ou "light". Aplica a classe no
// <html>, persiste no navegador e reage à mudança do SO quando em "auto".
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "auto" | "dark" | "light";
export type Resolved = "dark" | "light";
const KEY = "nexus.theme";

/** Tema salvo (auto/dark/light) → auto (padrão). */
export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "auto" || saved === "dark" || saved === "light") return saved;
  return "auto";
}

function systemTheme(): Resolved {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Tema efetivo aplicado na tela (auto vira a preferência do SO). */
export function resolveTheme(theme: Theme): Resolved {
  return theme === "auto" ? systemTheme() : theme;
}

export function applyTheme(resolved: Resolved) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
}

type Ctx = { theme: Theme; resolved: Resolved; setTheme: (t: Theme) => void };
const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolved, setResolved] = useState<Resolved>(() => resolveTheme(initialTheme()));

  useEffect(() => {
    const r = resolveTheme(theme);
    setResolved(r);
    applyTheme(r);
    if (theme !== "auto") return;
    // Em "auto", acompanha a troca de tema do SO em tempo real.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const nr = systemTheme();
      setResolved(nr);
      applyTheme(nr);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function setTheme(t: Theme) {
    localStorage.setItem(KEY, t);
    setThemeState(t);
  }
  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme fora do ThemeProvider");
  return ctx;
}
