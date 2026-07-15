import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Dropdown leve (sem dependência extra): um gatilho e um menu ancorado à direita.
 * Fecha ao clicar fora ou em um item. Suficiente para menus de ação simples.
 */
type Ctx = { open: boolean; setOpen: (o: boolean) => void };
const DropdownCtx = React.createContext<Ctx | null>(null);

function useDropdown() {
  const ctx = React.useContext(DropdownCtx);
  if (!ctx) throw new Error("DropdownMenu components must be used within <DropdownMenu>");
  return ctx;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <DropdownCtx.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block">{children}</div>
    </DropdownCtx.Provider>
  );
}

export function DropdownMenuTrigger({ children }: { children: React.ReactElement }) {
  const { open, setOpen } = useDropdown();
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      setOpen(!open);
    },
  });
}

export function DropdownMenuContent({ className, children, align = "end" }: {
  className?: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const { open } = useDropdown();
  if (!open) return null;
  return (
    <div
      className={cn(
        "absolute z-50 mt-1 min-w-44 overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-md",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ className, onSelect, children }: {
  className?: string;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const { setOpen } = useDropdown();
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={() => {
        setOpen(false);
        onSelect?.();
      }}
    >
      {children}
    </button>
  );
}
