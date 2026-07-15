import { MonitorTag } from "@/lib/monitor-config";
import { Badge } from "@/components/ui/badge";

function colorWithAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return `rgb(100 116 139 / ${alpha})`;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}

export function MonitorTagBadge({ tag, showValue = false }: { tag: MonitorTag; showValue?: boolean }) {
  return (
    <Badge
      className="max-w-full border px-2 py-0.5 font-medium"
      style={{
        backgroundColor: colorWithAlpha(tag.color, 0.16),
        borderColor: colorWithAlpha(tag.color, 0.55),
        color: tag.color,
      }}
      title={tag.value ? `${tag.name}: ${tag.value}` : tag.name}
    >
      <span className="truncate">
        {tag.name}{showValue && tag.value ? `: ${tag.value}` : ""}
      </span>
    </Badge>
  );
}
