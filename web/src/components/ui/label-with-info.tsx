import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function LabelWithInfo({ htmlFor, children, label, info }: {
  htmlFor?: string; children?: ReactNode; label?: ReactNode; info: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children ?? label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" tabIndex={-1} aria-label="Informação" className="text-muted-foreground/70 hover:text-foreground">
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-pretty leading-relaxed">{info}</TooltipContent>
      </Tooltip>
    </div>
  );
}
