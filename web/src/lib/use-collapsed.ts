import { useCallback, useState } from "react";

/** Conjunto de ids "recolhidos" (grupos ocultos visualmente), persistido no
 * localStorage sob `storageKey`. Preferência apenas visual. */
export function useCollapsed(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  const toggle = useCallback((id: string) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignora */
      }
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggle };
}
