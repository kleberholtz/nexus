import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SelectWithSearchOption = {
  value: string;
  label: string;
  group?: string;
  searchText?: string;
  disabled?: boolean;
};

type SelectWithSearchProps = {
  options: SelectWithSearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  optionPrefix?: string;
};

export function SelectWithSearch({
  options,
  value,
  onChange,
  placeholder = "Selecione",
  searchPlaceholder = "Pesquisar",
  emptyMessage = "Nenhum item encontrado.",
  disabled = false,
  className,
  optionPrefix = "",
}: SelectWithSearchProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.value} ${option.group ?? ""} ${option.searchText ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [options, search]);

  const groupedOptions = React.useMemo(() => {
    const groups: Array<{ label: string; options: SelectWithSearchOption[] }> = [];
    const indexes = new Map<string, number>();

    filtered.forEach((option) => {
      const label = option.group ?? "";
      let index = indexes.get(label);
      if (index === undefined) {
        index = groups.length;
        indexes.set(label, index);
        groups.push({ label, options: [] });
      }
      groups[index].options.push(option);
    });

    return groups;
  }, [filtered]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function select(next: string) {
    onChange(next);
    setOpen(false);
    setSearch("");
  }

  const selected = options.find((option) => option.value === value);

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className="h-9 w-full justify-between px-3 font-normal"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">{selected ? `${optionPrefix}${selected.label}` : placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Button>
      {open && (
        <div className="absolute left-0 z-50 mt-1 w-full overflow-hidden rounded-md border bg-card text-card-foreground shadow-md">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-8"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-56 overflow-auto p-1">
            {groupedOptions.map((group, index) => (
              <div key={group.label || "__ungrouped"} role={group.label ? "group" : undefined}
                aria-label={group.label || undefined}>
                {group.label && (
                  <div className={cn(
                    "px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                    index > 0 && "mt-1 border-t",
                  )}>
                    {group.label}
                  </div>
                )}
                {group.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => select(option.value)}
                  >
                    <span className="min-w-0 truncate">{optionPrefix}{option.label}</span>
                    {value === option.value && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
