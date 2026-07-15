import { Switch } from "@/components/ui/switch";

/** Bloco de formulário expansível controlado por um switch. */
export function SwitchBlock({ title, on, onToggle, children }: {
  title: string;
  on: boolean;
  onToggle: (value: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <Switch checked={on} onCheckedChange={onToggle} />
      </label>
      {on && children}
    </div>
  );
}
