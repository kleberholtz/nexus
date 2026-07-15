/** Popover aberto no **hover** (estilo shadcn), portado ao body para escapar de
 * containers com overflow (ex.: tabelas roláveis). Aceita conteúdo interativo
 * (botões) — mantém aberto enquanto o mouse está no gatilho ou no cartão. */
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function HoverPopover({ trigger, children, width = 256, className }: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const show = () => {
    cancelClose();
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    setPos({ top: rect.bottom + gap, left });
    setOpen(true);
  };

  React.useEffect(() => () => cancelClose(), []);

  return (
    <>
      <span ref={anchorRef} className="inline-flex" onMouseEnter={show} onMouseLeave={scheduleClose}>
        {trigger}
      </span>
      {open && createPortal(
        <div
          role="dialog"
          style={{ position: "fixed", top: pos.top, left: pos.left, width }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={cn(
            "z-50 rounded-md border bg-card p-4 text-card-foreground shadow-md outline-none " +
              "animate-in fade-in-0 zoom-in-95",
            className,
          )}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
