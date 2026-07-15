import type React from "react";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

function maskValue(value: string): string {
  return value.length ? "•".repeat(Math.min(Math.max(value.length, 6), 32)) : "";
}

function highlight(line: string, revealValues: boolean): React.ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed === "") {
    return <span className="text-muted-foreground">{line || " "}</span>;
  }
  const eq = line.indexOf("=");
  if (eq === -1) return <span className="text-destructive">{line}</span>;
  return (
    <>
      <span className="text-info">{line.slice(0, eq)}</span>
      <span className="text-muted-foreground">=</span>
      <span className="text-success">{revealValues ? line.slice(eq + 1) : maskValue(line.slice(eq + 1))}</span>
    </>
  );
}

export function EnvEditor({ value, onChange, disabled, revealValues }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  revealValues?: boolean;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split("\n"), [value]);

  function syncScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    const t = e.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = t.scrollTop;
      preRef.current.scrollLeft = t.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = t.scrollTop;
  }

  const font = "font-mono text-[13px] leading-6";

  return (
    <div>
      <div className="flex overflow-hidden rounded-md border bg-card">
        <div ref={gutterRef}
          className={cn("select-none overflow-hidden bg-muted/40 py-2 pl-3 pr-2 text-right text-muted-foreground", font)}>
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="relative flex-1">
          <pre ref={preRef} aria-hidden
            className={cn("pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre px-3 py-2", font)}>
            {lines.map((l, i) => <div key={i}>{highlight(l, !!revealValues)}</div>)}
          </pre>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            disabled={disabled}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="KEY=value"
            className={cn(
              "relative block h-64 w-full resize-y overflow-auto whitespace-pre bg-transparent px-3 py-2 text-transparent caret-foreground outline-none",
              font,
            )}
          />
        </div>
      </div>
    </div>
  );
}
