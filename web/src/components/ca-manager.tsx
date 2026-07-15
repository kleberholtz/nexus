import { useState } from "react";
import { Download, Landmark, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { del, get, post } from "@/lib/api";
import { Ca } from "@/lib/types";
import { useData } from "@/lib/use-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function downloadPem(name: string, pem: string) {
  const blob = new Blob([pem], { type: "application/x-pem-file" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.crt`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Gestão de CAs próprias: usada na página de Certificados; `onChange` avisa
 * o pai para recarregar a lista de certificados quando algo muda. */
export function CaManager({ onChange }: { onChange?: () => void }) {
  const { data, loading, reload } = useData<Ca[]>(() => get("/certificates/ca"), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Ca | null>(null);

  async function remove(ca: Ca) {
    try {
      await del(`/certificates/ca/${encodeURIComponent(ca.name)}`);
      toast.success(`CA '${ca.name}' removida`);
      reload();
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-medium">Autoridades certificadoras (CA)</h2>
            <p className="text-xs text-muted-foreground">
              Crie uma CA própria e assine certificados com ela.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Importar CA
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Nova CA
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Common Name</TableHead>
            <TableHead>Expira</TableHead>
            <TableHead className="w-24 text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && !data ? (
            <TableRow>
              <TableCell colSpan={4}><Skeleton className="h-5 w-full" /></TableCell>
            </TableRow>
          ) : data && data.length > 0 ? (
            data.map((ca) => (
              <TableRow key={ca.name}>
                <TableCell className="font-medium">{ca.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {ca.common_name}
                  {ca.org && <span className="text-xs"> · {ca.org}</span>}
                </TableCell>
                <TableCell>
                  {ca.expired ? (
                    <Badge variant="destructive">expirada</Badge>
                  ) : (
                    <Badge variant={ca.days_left <= 30 ? "muted" : "default"}>{ca.days_left} dias</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={!ca.cert_pem}
                          onClick={() => ca.cert_pem && downloadPem(ca.name, ca.cert_pem)}>
                          <Download className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Baixar certificado da CA</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={ca.in_use ? 0 : -1}>
                          <Button variant="ghost" size="icon" disabled={ca.in_use}
                            onClick={() => setToDelete(ca)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {ca.in_use ? `Em uso por: ${ca.used_by.join(", ")}` : "Excluir"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                Nenhuma CA. Crie uma para assinar certificados localmente.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <CaDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={() => {
          reload();
          onChange?.();
        }}
      />
      <CaImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => {
          reload();
          onChange?.();
        }}
      />
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Excluir CA '${toDelete?.name}'?`}
        description="Remove a CA (chave + certificado). Certificados já assinados continuam válidos até vencer."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </Card>
  );
}

function CaDialog({ open, onOpenChange, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [cn, setCn] = useState("");
  const [org, setOrg] = useState("Holtz Nexus");
  const [days, setDays] = useState("3650");
  const [rsa, setRsa] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!cn.trim()) return toast.error("Informe o Common Name da CA");
    const d = Number(days);
    if (!Number.isInteger(d) || d < 1 || d > 7300) return toast.error("Dias deve ser 1–7300");
    setBusy(true);
    try {
      await post("/certificates/ca", { cn: cn.trim(), org: org.trim() || "Holtz Nexus", days: d, rsa });
      toast.success("CA criada");
      setCn(""); setOrg("Holtz Nexus"); setDays("3650"); setRsa(false);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar CA");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova CA</DialogTitle>
          <DialogDescription>Autoridade certificadora raiz para assinar certificados.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ca-cn">Common Name *</Label>
            <Input id="ca-cn" value={cn} onChange={(e) => setCn(e.target.value)}
              placeholder="Holtz Nexus Root CA" spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-org">Organização</Label>
            <Input id="ca-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Holtz Nexus" />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-32 space-y-1.5">
              <Label htmlFor="ca-days">Validade (dias)</Label>
              <Input id="ca-days" type="number" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={rsa} onCheckedChange={(v) => setRsa(!!v)} /> RSA
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Criar CA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CaImportDialog({ open, onOpenChange, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!cert.trim() || !key.trim()) return toast.error("Informe o certificado e a chave da CA (PEM)");
    setBusy(true);
    try {
      await post("/certificates/ca/import", { name: name.trim() || undefined, cert, key });
      toast.success("CA importada");
      setName(""); setCert(""); setKey("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar CA");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar CA</DialogTitle>
          <DialogDescription>Envie uma CA existente (certificado + chave) em formato PEM.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ca-imp-name">Nome (opcional)</Label>
            <Input id="ca-imp-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="deriva do CN se vazio" spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-imp-cert">Certificado da CA (PEM) *</Label>
            <Textarea id="ca-imp-cert" value={cert} onChange={(e) => setCert(e.target.value)}
              rows={5} spellCheck={false} className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE-----" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ca-imp-key">Chave privada da CA (PEM) *</Label>
            <Textarea id="ca-imp-key" value={key} onChange={(e) => setKey(e.target.value)}
              rows={5} spellCheck={false} className="font-mono text-xs"
              placeholder="-----BEGIN PRIVATE KEY-----" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Importar CA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
