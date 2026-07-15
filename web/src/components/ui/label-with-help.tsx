import * as React from "react";
import { Asterisk, HelpCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type LabelWithHelpProps = {
  htmlFor?: string;
  children?: React.ReactNode;
  label?: React.ReactNode;
  help?: string;
  required?: boolean;
  className?: string;
};

export function LabelWithHelp({ htmlFor, children, label, help, required, className }: LabelWithHelpProps) {
  return (
    <div className={className ?? "flex items-center gap-1.5"}>
      <Label htmlFor={htmlFor}>{children ?? label}</Label>
      {required && (
        <Asterisk className="h-3.5 w-3.5 text-destructive" aria-label="obrigatório" />
      )}
      {help && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Ajuda"
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-pre-line text-pretty leading-relaxed">{help}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
