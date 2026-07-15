import { cn } from "@/lib/utils";

/** Iniciais a partir do nome (1ª+última palavra) ou fallback (username). */
export function initialsOf(nameOrUser: string): string {
  const parts = (nameOrUser || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Paleta derivada dos tokens do tema (funciona em claro/escuro).
const PALETTE = [
  "bg-primary/15 text-primary",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
  "bg-warning/15 text-warning",
  "bg-secondary/20 text-secondary",
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Avatar só com iniciais (sem upload de imagem). */
export function Avatar({
  name,
  seed,
  className,
}: {
  name: string;
  seed?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase",
        colorFor(seed || name),
        className,
      )}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
