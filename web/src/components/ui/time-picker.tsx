import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function Column({ label, items, selected, onSelect }: {
  label: string; items: number[]; selected: number; onSelect: (v: number) => void;
}) {
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selRef.current?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div className="flex flex-col">
      <div className="border-b px-2 py-1 text-center text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex w-16 flex-col gap-1 overflow-y-auto p-2" style={{ maxHeight: "13rem" }}>
        {items.map((v) => (
          <button
            key={v}
            ref={v === selected ? selRef : undefined}
            type="button"
            onClick={() => onSelect(v)}
            className={cn(
              "rounded-md px-2 py-1 text-center text-sm tabular-nums",
              v === selected ? "bg-primary text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {pad(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Colunas de hora/minuto (uso inline, ex.: ao lado do calendário). */
export function TimeColumns({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [hh, mm] = (value || "00:00").split(":");
  return (
    <div className="flex divide-x">
      <Column label="Hora" items={HOURS} selected={Number(hh) || 0}
        onSelect={(h) => onChange(`${pad(h)}:${mm ?? "00"}`)} />
      <Column label="Min" items={MINUTES} selected={Number(mm) || 0}
        onSelect={(m) => onChange(`${hh ?? "00"}:${pad(m)}`)} />
    </div>
  );
}

/** Seletor de horário (popover) — value/onChange no formato "HH:MM". */
export function TimePicker({ value, onChange, disabled, placeholder = "Selecionar horário" }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    // `modal` p/ funcionar dentro de um Dialog (ver date-picker.tsx).
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}
          className={cn("w-full justify-start gap-2 font-normal", !value && "text-muted-foreground")}>
          <Clock className="h-4 w-4 shrink-0" />
          {value || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <TimeColumns value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
