import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { TimeColumns } from "@/components/ui/time-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const pad = (n: number) => String(n).padStart(2, "0");

/** Interpreta "YYYY-MM-DD[ T]HH:MM" como hora de parede (sem conversão de fuso). */
function parseValue(value: string): { date: Date | undefined; time: string } {
  const m = (value || "").trim().replace(" ", "T").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return { date: undefined, time: "" };
  const [, y, mo, d, hh, mm] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), hh ? Number(hh) : 0, mm ? Number(mm) : 0);
  return { date, time: hh && mm ? `${hh}:${mm}` : "" };
}

function toValue(date: Date, time: string): string {
  const [hh = "00", mm = "00"] = (time || "00:00").split(":");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${hh}:${mm}`;
}

function display(date: Date, time: string): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${time || "00:00"}`;
}

/** Seletor de data + hora (estilo shadcn): calendário + campo de horário. */
export function DateTimePicker({ value, onChange, placeholder = "Selecionar data e hora", disabled }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = parseValue(value);
  const timeVal = time || "00:00";

  function pickDate(d: Date | undefined) {
    if (!d) return;
    onChange(toValue(d, timeVal));
  }
  function pickTime(t: string) {
    onChange(toValue(date ?? new Date(), t));
  }

  return (
    // `modal` é essencial p/ o popover funcionar dentro de um Dialog: sem isso o
    // Dialog põe pointer-events:none no body e os cliques no calendário (portalado)
    // não registram.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}
          className={cn("w-full justify-start gap-2 font-normal", !date && "text-muted-foreground")}>
          <CalendarClock className="h-4 w-4 shrink-0" />
          {date ? display(date, timeVal) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <div className="flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0">
          <Calendar mode="single" selected={date} onSelect={pickDate} defaultMonth={date} />
          <TimeColumns value={timeVal} onChange={pickTime} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
