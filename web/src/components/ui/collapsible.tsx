import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

// Collapsible leve (mesma API do shadcn/@radix-ui/react-collapsible: `open`/
// `defaultOpen`/`onOpenChange`, `asChild` e `data-state`), sem a dependência
// extra do radix — o projeto mantém as deps enxutas.

type CollapsibleContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled?: boolean;
};

const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

function useCollapsible(): CollapsibleContextValue {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) throw new Error("Collapsible.* deve ser usado dentro de <Collapsible>");
  return ctx;
}

export const Collapsible = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    disabled?: boolean;
    asChild?: boolean;
  }
>(({ open: openProp, defaultOpen = false, onOpenChange, disabled, asChild = false, children, ...props }, ref) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setUncontrolled(next);
    },
    [onOpenChange, openProp],
  );
  const value = React.useMemo(() => ({ open, setOpen, disabled }), [open, setOpen, disabled]);
  const Comp = asChild ? Slot : "div";
  return (
    <CollapsibleContext.Provider value={value}>
      <Comp ref={ref} data-state={open ? "open" : "closed"} {...props}>
        {children}
      </Comp>
    </CollapsibleContext.Provider>
  );
});
Collapsible.displayName = "Collapsible";

export const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ asChild = false, onClick, ...props }, ref) => {
  const { open, setOpen, disabled } = useCollapsible();
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-state={open ? "open" : "closed"}
      aria-expanded={open}
      disabled={disabled}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (!disabled) setOpen(!open);
      }}
      {...props}
    />
  );
});
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export const CollapsibleContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  ({ children, ...props }, ref) => {
    const { open } = useCollapsible();
    if (!open) return null;
    return (
      <div ref={ref} data-state="open" {...props}>
        {children}
      </div>
    );
  },
);
CollapsibleContent.displayName = "CollapsibleContent";
