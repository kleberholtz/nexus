// i18n leve (pt/en): t("chave.aninhada") resolve no dicionário; persiste o
// idioma no navegador. Sem dependência externa.
import { createContext, useContext, useState, ReactNode } from "react";
import { dict, Lang } from "./locales";

const KEY = "nexus.lang";

/** Idioma salvo → idioma do navegador (pt* → pt) → en. */
export function initialLang(): Lang {
  const saved = localStorage.getItem(KEY);
  if (saved === "pt" || saved === "en") return saved;
  return navigator.language?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

function lookup(lang: Lang, key: string): string {
  let cur: unknown = dict[lang];
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return key; // chave ausente: devolve a própria chave (fica visível)
    }
  }
  return typeof cur === "string" ? cur : key;
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string };
const I18nContext = createContext<Ctx | null>(null);

export function applyLang(lang: Lang) {
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  function setLang(l: Lang) {
    localStorage.setItem(KEY, l);
    applyLang(l);
    setLangState(l);
  }
  const t = (key: string) => lookup(lang, key);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n fora do I18nProvider");
  return ctx;
}
