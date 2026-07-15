import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type ComboboxMultipleProps = {
  options: string[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  allowCustom?: boolean;
  showClear?: boolean;
  labelByValue?: Record<string, string>;
  colorByValue?: Record<string, string>;
  contentSide?: "top" | "bottom";
  className?: string;
};

const normalize = (value: string) => value.trim();

function colorWithAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return `rgb(100 116 139 / ${alpha})`;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}

/** Combobox múltiplo no padrão shadcn: chips, pesquisa, criação e limpar. */
export function ComboboxMultiple({
  options,
  value,
  onValueChange,
  placeholder = "Selecione ou adicione",
  emptyMessage = "Nenhum item encontrado.",
  allowCustom = false,
  showClear = false,
  labelByValue = {},
  colorByValue = {},
  contentSide = "bottom",
  className,
}: ComboboxMultipleProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const optionLabel = React.useCallback(
    (option: string) => labelByValue[option] ?? option,
    [labelByValue],
  );

  const allOptions = React.useMemo(() =>
    Array.from(new Set([...options, ...value].map(normalize).filter(Boolean)))
      .sort((a, b) => optionLabel(a).localeCompare(optionLabel(b), "pt-BR")),
  [options, value, optionLabel]);
  const filtered = React.useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return term
      ? allOptions.filter((option) => optionLabel(option).toLocaleLowerCase("pt-BR").includes(term))
      : allOptions;
  }, [allOptions, optionLabel, query]);
  const customValue = normalize(query);
  const canCreate = allowCustom && customValue
    && !allOptions.some((option) => option.toLocaleLowerCase("pt-BR") === customValue.toLocaleLowerCase("pt-BR"));

  React.useEffect(() => {
    if (!open) return;
    function closeOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  function toggle(option: string) {
    onValueChange(value.includes(option)
      ? value.filter((item) => item !== option)
      : [...value, option]);
    setQuery("");
    inputRef.current?.focus();
  }

  function addCustom() {
    if (!canCreate) return;
    onValueChange([...value, customValue]);
    setQuery("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "Enter" || event.key === ",") && customValue) {
      event.preventDefault();
      const existing = allOptions.find((option) =>
        option.toLocaleLowerCase("pt-BR") === customValue.toLocaleLowerCase("pt-BR"));
      if (existing && !value.includes(existing)) toggle(existing);
      else if (existing) setQuery("");
      else addCustom();
    } else if (event.key === "Backspace" && !query && value.length > 0) {
      onValueChange(value.slice(0, -1));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div
        className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((item) => (
          <Badge key={item} variant="secondary" className="gap-1 rounded-full border px-2 py-0.5 text-xs"
            style={colorByValue[item] ? {
              backgroundColor: colorWithAlpha(colorByValue[item], 0.16),
              borderColor: colorWithAlpha(colorByValue[item], 0.55),
              color: colorByValue[item],
            } : undefined}>
            {optionLabel(item)}
            <button type="button" className="rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
              onClick={(event) => { event.stopPropagation(); toggle(item); }} aria-label={`Remover ${optionLabel(item)}`}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : "Adicionar"}
          className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        {showClear && value.length > 0 && (
          <button type="button" className="rounded-sm p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => { event.stopPropagation(); onValueChange([]); setQuery(""); inputRef.current?.focus(); }}
            aria-label="Limpar seleção">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div id={listId} role="listbox" aria-multiselectable="true"
          className={cn(
            "absolute left-0 z-50 max-h-56 w-full overflow-y-auto rounded-md border bg-card p-1 text-card-foreground shadow-md",
            contentSide === "top" ? "bottom-full mb-1" : "mt-1",
          )}>
          {canCreate && (
            <button type="button" role="option" aria-selected="false"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(event) => event.preventDefault()} onClick={addCustom}>
              Adicionar “{customValue}”
            </button>
          )}
          {filtered.map((option) => {
            const selected = value.includes(option);
            return (
              <button key={option} type="button" role="option" aria-selected={selected}
                className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()} onClick={() => toggle(option)}>
                <span className="flex min-w-0 items-center gap-2 truncate">
                  {colorByValue[option] && <span className="h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: colorByValue[option] }} />}
                  {optionLabel(option)}
                </span>
                <Check className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
              </button>
            );
          })}
          {!canCreate && filtered.length === 0 && (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
