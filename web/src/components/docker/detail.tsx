import { Link } from "react-router-dom";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export function copyText(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success("Copiado"),
    () => toast.error("Falha ao copiar"),
  );
}

export const isDockerDate = (s?: string) => !!s && !s.startsWith("0001-");
export const fmtDockerDate = (s?: string) => (isDockerDate(s) ? new Date(s as string).toLocaleString() : "—");
export const shortId = (id?: string) => (id ? id.replace(/^sha256:/, "").slice(0, 12) : "—");

export function DetailBack({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}

export function Section({ icon: Icon, title, children, action }: {
  icon: React.ElementType; title: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value === "" || value === null || value === undefined ? "—" : value}
      </div>
    </div>
  );
}

export function Flag({ on }: { on: boolean }) {
  return <Badge variant={on ? "success" : "muted"}>{on ? "sim" : "não"}</Badge>;
}

export function CopyId({ id }: { id?: string }) {
  return (
    <button className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
      onClick={() => copyText(id || "")}>
      {shortId(id)} <Copy className="h-3 w-3" />
    </button>
  );
}

export function KeyValueSection({ entries, empty }: { entries: [string, string][]; empty: string }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <Table>
        <TableBody>
          {entries.map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="w-1/3 break-all font-mono text-xs font-medium">{k}</TableCell>
              <TableCell className="break-all font-mono text-xs text-muted-foreground">{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function RawJson({ data }: { data: unknown }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Ver inspect bruto</summary>
      <pre className="mt-2 max-h-[32rem] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}
