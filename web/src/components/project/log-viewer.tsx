import { useEffect, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type LogViewerEntry = {
  id: string | number;
  timestamp?: number;
  level: "info" | "success" | "warn" | "error";
  context?: string;
  message: string;
};

const TONES = {
  info: { marker: "bg-blue-500", badge: "bg-blue-950 text-blue-200 ring-blue-800/80", text: "text-zinc-200" },
  success: { marker: "bg-emerald-500", badge: "bg-emerald-950 text-emerald-200 ring-emerald-800/80", text: "text-emerald-100" },
  warn: { marker: "bg-amber-500", badge: "bg-amber-950 text-amber-200 ring-amber-800/80", text: "text-amber-100" },
  error: { marker: "bg-red-500", badge: "bg-red-950 text-red-200 ring-red-800/80", text: "text-red-100" },
};

function shortTimestamp(timestamp?: number) {
  if (!timestamp) return "---";
  return new Intl.DateTimeFormat("pt-BR", {
    year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(timestamp));
}

export function LogViewer({ entries, emptyMessage, className }: {
  entries: LogViewerEntry[];
  emptyMessage: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries.length]);

  return (
    <div ref={ref} className={cn("overflow-auto rounded-md border border-zinc-800 bg-black px-4 py-3 font-mono text-xs leading-6 text-zinc-200", className)}>
      {entries.length > 0 ? entries.map((entry) => {
        const tone = TONES[entry.level];
        const timestamp = shortTimestamp(entry.timestamp);
        return (
          <div key={entry.id} className="grid min-w-max grid-cols-[10px_150px_58px_110px_minmax(320px,1fr)] items-center gap-3 whitespace-pre">
            <Tooltip>
              <TooltipTrigger asChild><span className={cn("h-5 w-2 rounded-sm", tone.marker)} /></TooltipTrigger>
              <TooltipContent>{entry.timestamp ? new Date(entry.timestamp).toISOString() : entry.level}</TooltipContent>
            </Tooltip>
            <span className="text-zinc-200">{timestamp}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-center text-[10px] font-semibold leading-4 ring-1", tone.badge)}>{entry.level}</span>
            <span className="truncate text-zinc-500">{entry.context || "-"}</span>
            <span className={tone.text}>{entry.message}</span>
          </div>
        );
      }) : <div className="text-zinc-500">{emptyMessage}</div>}
    </div>
  );
}
