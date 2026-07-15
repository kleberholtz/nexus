import { useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode, UIEvent } from "react";
import { cn } from "@/lib/utils";

function highlightCode(rawLine: string): ReactNode {
  if (!rawLine) return " ";
  const commentIndex = rawLine.indexOf("#");
  const code = commentIndex >= 0 ? rawLine.slice(0, commentIndex) : rawLine;
  const comment = commentIndex >= 0 ? rawLine.slice(commentIndex) : "";
  const parts = code.split(/(\s+|[{};()]|"[^"]*"|'[^']*'|\$[A-Za-z0-9_]+|[0-9]+[a-zA-Z%]*|[A-Za-z_][A-Za-z0-9_.-]*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        if (/^\s+$/.test(part)) return <span key={index}>{part}</span>;
        if (/^[{};()]$/.test(part)) return <span key={index} className="text-muted-foreground">{part}</span>;
        if (/^["']/.test(part)) return <span key={index} className="text-success">{part}</span>;
        if (/^\$/.test(part)) return <span key={index} className="text-info">{part}</span>;
        if (/^[0-9]/.test(part)) return <span key={index} className="text-warning">{part}</span>;
        if (/^[A-Za-z_]/.test(part)) return <span key={index} className="text-primary">{part}</span>;
        return <span key={index}>{part}</span>;
      })}
      {comment && <span className="text-muted-foreground">{comment}</span>}
    </>
  );
}

function replaceRange(value: string, start: number, end: number, insert: string) {
  return value.slice(0, start) + insert + value.slice(end);
}

export function NginxRawEditor({ value, onChange, disabled, minHeight = 420 }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  minHeight?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split("\n"), [value]);
  const font = "font-mono text-[13px] leading-6";

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop;
      preRef.current.scrollLeft = target.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop;
  }

  function updateWithSelection(next: string, start: number, end: number) {
    onChange(next);
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(start, end);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const indent = "  ";

    if (start === end) {
      const next = replaceRange(value, start, end, indent);
      updateWithSelection(next, start + indent.length, start + indent.length);
      return;
    }

    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const selected = value.slice(lineStart, end);
    if (event.shiftKey) {
      let removedBeforeStart = 0;
      let removedTotal = 0;
      const unindented = selected.replace(/(^|\n)( {1,2}|\t)/g, (_match, prefix, removed) => {
        if (lineStart + removedTotal < start) removedBeforeStart += removed.length;
        removedTotal += removed.length;
        return prefix;
      });
      const next = replaceRange(value, lineStart, end, unindented);
      updateWithSelection(next, Math.max(lineStart, start - removedBeforeStart), Math.max(lineStart, end - removedTotal));
      return;
    }

    const indented = selected.replace(/^/gm, indent);
    const lineCount = selected.split("\n").length;
    const next = replaceRange(value, lineStart, end, indented);
    updateWithSelection(next, start + indent.length, end + lineCount * indent.length);
  }

  return (
    <div className="flex overflow-hidden rounded-md border bg-card">
      <div
        ref={gutterRef}
        className={cn("select-none overflow-hidden bg-muted/40 py-3 pl-3 pr-2 text-right text-muted-foreground", font)}
        style={{ minHeight }}
      >
        {lines.map((_, index) => <div key={index}>{index + 1}</div>)}
      </div>
      <div className="relative min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre px-3 py-3", font)}
          style={{ minHeight, tabSize: 2 }}
        >
          {lines.map((line, index) => <div key={index}>{highlightCode(line)}</div>)}
        </pre>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(
            "relative block w-full resize-y overflow-auto whitespace-pre bg-transparent px-3 py-3 text-transparent caret-foreground outline-none selection:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-60",
            font,
          )}
          style={{ minHeight, tabSize: 2 }}
        />
      </div>
    </div>
  );
}
