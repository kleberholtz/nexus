import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Ca, Certificate, DnsProvider, SettingsData } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { CaManager } from "@/components/ca-manager";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function typeBadge(t: Certificate["type"]) {
  if (t === "letsencrypt") return <Badge>Let's Encrypt</Badge>;
  if (t === "self-signed") return <Badge variant="secondary">self-signed</Badge>;
  return <Badge variant="muted">{t}</Badge>;
}

function expiryBadge(days: number, expired: boolean) {
  if (expired) return <Badge variant="destructive">expirado</Badge>;
  const v = days <= 15 ? "destructive" : days <= 30 ? "muted" : "default";
  return <Badge variant={v}>{days} dias</Badge>;
}

export function CertificatesPage() {
  const { data, loading, error, reload } = useData<Certificate[]>(() => get("/certificates"), []);
  const [genOpen, setGenOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Certificate | null>(null);
  const [togglingAuto, setTogglingAuto] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filteredCertificates = (data ?? []).filter((cert) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;

    return [cert.name, cert.common_name, cert.type, cert.issuer, ...cert.domains]
      .some((value) => value.toLowerCase().includes(term));
  });

  async function remove(cert: Certificate) {
    try {
      await del(`/certificates/${encodeURIComponent(cert.name)}`);
      toast.success(`Certificado '${cert.name}' removido`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  async function toggleAuto(cert: Certificate, value: boolean) {
    setTogglingAuto(cert.name);
    try {
      await put(`/certificates/${encodeURIComponent(cert.name)}/auto-renew`, { auto_renew: value });
      toast.success(`Auto-renovação ${value ? "ativada" : "desativada"} para '${cert.name}'`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar auto-renovação");
    } finally {
      setTogglingAuto(null);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="h-6 w-6 text-primary" /> Certificados
            </h1>
            <p className="text-sm text-muted-foreground">
              Gerencie certificados TLS/SSL para seus servidores.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Importar
            </Button>
            <Button size="sm" onClick={() => setGenOpen(true)}>
              <Plus className="h-4 w-4" /> Gerar certificado
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={reload} disabled={loading} aria-label="Recarregar certificados">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar certificados</TooltipContent>
          </Tooltip>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar por nome, domínio ou emissor"
              className="pl-9"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Domínios</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Expira</TableHead>
                <TableHead>Auto-renew</TableHead>
                <TableHead className="w-16 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data ? (
                [...Array(4)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-56" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-8" /></TableCell>
                  </TableRow>
                ))
              ) : filteredCertificates.length > 0 ? (
                filteredCertificates.map((cert) => (
                  <TableRow key={cert.name}>
                    <TableCell className="font-medium">{cert.name}</TableCell>
                    <TableCell className="text-muted-foreground">{cert.domains.join(", ") || "—"}</TableCell>
                    <TableCell>{typeBadge(cert.type)}</TableCell>
                    <TableCell>{expiryBadge(cert.days_left, cert.expired)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Switch
                          checked={cert.auto_renew}
                          disabled={togglingAuto === cert.name}
                          onCheckedChange={(v) => toggleAuto(cert, v)}
                          aria-label="Auto-renovação"
                        />
                        {cert.auto_renew ? "ativo" : "inativo"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={cert.in_use ? 0 : -1}>
                            <Button variant="ghost" size="icon" disabled={cert.in_use}
                              onClick={() => setToDelete(cert)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {cert.in_use ? `Em uso por: ${cert.used_by.join(", ")}` : "Excluir"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {query.trim() ? "Nenhum certificado encontrado." : "Nenhum certificado."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <CaManager onChange={reload} />

        <GenerateDialog open={genOpen} onOpenChange={setGenOpen} onDone={reload} />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={reload} />
        <ConfirmDelete
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
          title={`Excluir certificado '${toDelete?.name}'?`}
          description="Remove o .crt e o .key. Servers que o referenciam deixarão de subir até apontar outro."
          onConfirm={() => {
            if (toDelete) return remove(toDelete);
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function GenerateDialog({ open, onOpenChange, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  // Self-signed
  const [ssDomains, setSsDomains] = useState("");
  const [ssIps, setSsIps] = useState("");
  const [ssDays, setSsDays] = useState("365");
  const [ssRsa, setSsRsa] = useState(false);
  const [ssAuto, setSsAuto] = useState(true);
  // Let's Encrypt
  const [leDomains, setLeDomains] = useState("");
  const [leProvider, setLeProvider] = useState("");
  const [leStaging, setLeStaging] = useState(true);
  const [leAuto, setLeAuto] = useState(true);
  const [providers, setProviders] = useState<DnsProvider[]>([]);
  const [acmeEmail, setAcmeEmail] = useState<string>("");
  // CA-signed
  const [caList, setCaList] = useState<Ca[]>([]);
  const [caName, setCaName] = useState("");
  const [caDomains, setCaDomains] = useState("");
  const [caIps, setCaIps] = useState("");
  const [caDays, setCaDays] = useState("365");
  const [caRsa, setCaRsa] = useState(false);
  const [caAuto, setCaAuto] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSsDomains(""); setSsIps(""); setSsDays("365"); setSsRsa(false); setSsAuto(true);
    setLeDomains(""); setLeStaging(true); setLeAuto(true);
    setCaDomains(""); setCaIps(""); setCaDays("365"); setCaRsa(false); setCaAuto(true);
    get<DnsProvider[]>("/dns/providers").then((p) => {
      setProviders(p);
      setLeProvider(p[0] ? String(p[0].id) : "");
    }).catch(() => setProviders([]));
    get<Ca[]>("/certificates/ca").then((cas) => {
      setCaList(cas);
      setCaName(cas[0] ? cas[0].name : "");
    }).catch(() => setCaList([]));
    get<SettingsData & { values: { acme_email?: string } }>("/settings")
      .then((d) => setAcmeEmail((d.values as any).acme_email || ""))
      .catch(() => setAcmeEmail(""));
  }, [open]);

  function split(s: string) {
    return s.trim().split(/[\s,]+/).filter(Boolean);
  }

  async function submitSelfSigned() {
    const domains = split(ssDomains);
    const ips = split(ssIps);
    if (!domains.length && !ips.length) return toast.error("Informe ao menos um domínio ou IP");
    const days = Number(ssDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return toast.error("Dias deve ser 1–3650");
    setBusy(true);
    try {
      await post("/certificates/self-signed", { domains, ips, days, rsa: ssRsa, auto_renew: ssAuto });
      toast.success("Certificado self-signed emitido");
      onOpenChange(false); onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao emitir");
    } finally { setBusy(false); }
  }

  async function submitCaSigned() {
    const domains = split(caDomains);
    const ips = split(caIps);
    if (!caName) return toast.error("Crie/selecione uma CA");
    if (!domains.length && !ips.length) return toast.error("Informe ao menos um domínio ou IP");
    const days = Number(caDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) return toast.error("Dias deve ser 1–3650");
    setBusy(true);
    try {
      await post("/certificates/ca-signed", {
        ca_name: caName, domains, ips, days, rsa: caRsa, auto_renew: caAuto,
      });
      toast.success("Certificado assinado pela CA emitido");
      onOpenChange(false); onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao emitir");
    } finally { setBusy(false); }
  }

  async function submitLetsEncrypt() {
    const domains = split(leDomains);
    if (!domains.length) return toast.error("Informe ao menos um domínio");
    if (!acmeEmail) return toast.error("Configure o e-mail ACME em Configurações");
    if (!leProvider) return toast.error("Selecione um provedor DNS (cadastre em Configurações)");
    setBusy(true);
    try {
      await post("/certificates/letsencrypt", {
        domains, provider_id: Number(leProvider), staging: leStaging, auto_renew: leAuto,
      });
      toast.success("Certificado Let's Encrypt emitido");
      onOpenChange(false); onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na emissão");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar certificado</DialogTitle>
          <DialogDescription>Escolha entre self-signed (local) ou Let's Encrypt (ACME DNS-01).</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="self">
          <TabsList>
            <TabsTrigger value="self">Self-signed</TabsTrigger>
            <TabsTrigger value="ca">CA própria</TabsTrigger>
            <TabsTrigger value="le">Let's Encrypt</TabsTrigger>
          </TabsList>

          <TabsContent value="self" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ss-domains">Domínios</Label>
              <Input id="ss-domains" value={ssDomains} onChange={(e) => setSsDomains(e.target.value)}
                placeholder="exemplo.com www.exemplo.com" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ss-ips">IPs (opcional)</Label>
              <Input id="ss-ips" value={ssIps} onChange={(e) => setSsIps(e.target.value)}
                placeholder="127.0.0.1 10.0.0.1" spellCheck={false} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-32 space-y-1.5">
                <Label htmlFor="ss-days">Validade (dias)</Label>
                <Input id="ss-days" type="number" value={ssDays} onChange={(e) => setSsDays(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={ssRsa} onCheckedChange={(v) => setSsRsa(!!v)} /> RSA
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={ssAuto} onCheckedChange={(v) => setSsAuto(!!v)} /> Auto-renovar
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={submitSelfSigned} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Emitir
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="ca" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ca-sel">CA assinante</Label>
              <Select id="ca-sel" value={caName} onChange={(e) => setCaName(e.target.value)}>
                {caList.length === 0 && <option value="">nenhuma — crie uma CA abaixo</option>}
                {caList.map((ca) => (
                  <option key={ca.name} value={ca.name}>{ca.common_name} ({ca.name})</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-domains">Domínios</Label>
              <Input id="ca-domains" value={caDomains} onChange={(e) => setCaDomains(e.target.value)}
                placeholder="exemplo.com www.exemplo.com" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-ips">IPs (opcional)</Label>
              <Input id="ca-ips" value={caIps} onChange={(e) => setCaIps(e.target.value)}
                placeholder="127.0.0.1 10.0.0.1" spellCheck={false} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-32 space-y-1.5">
                <Label htmlFor="ca-signed-days">Validade (dias)</Label>
                <Input id="ca-signed-days" type="number" value={caDays} onChange={(e) => setCaDays(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={caRsa} onCheckedChange={(v) => setCaRsa(!!v)} /> RSA
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={caAuto} onCheckedChange={(v) => setCaAuto(!!v)} /> Auto-renovar
              </label>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              O certificado é gravado como <b>fullchain</b> (folha + CA). Gerencie as CAs na
              tabela “Autoridades certificadoras” abaixo.
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={submitCaSigned} disabled={busy || !caName}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Emitir
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="le" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="le-domains">Domínios (suporta wildcard)</Label>
              <Input id="le-domains" value={leDomains} onChange={(e) => setLeDomains(e.target.value)}
                placeholder="exemplo.com *.exemplo.com" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="le-prov">Provedor DNS</Label>
              <Select id="le-prov" value={leProvider} onChange={(e) => setLeProvider(e.target.value)}>
                {providers.length === 0 && <option value="">nenhum — cadastre em Configurações</option>}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label} ({p.type})</option>
                ))}
              </Select>
            </div>
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Validade fixa de <b>90 dias</b>. E-mail da conta ACME:{" "}
              {acmeEmail ? <b className="text-foreground">{acmeEmail}</b> : <span className="text-destructive">não configurado (defina em Configurações)</span>}.
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={leStaging} onCheckedChange={(v) => setLeStaging(!!v)} /> Staging (teste)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={leAuto} onCheckedChange={(v) => setLeAuto(!!v)} /> Auto-renovar
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={submitLetsEncrypt} disabled={busy || !acmeEmail}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Emitir
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange, onDone }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [cert, setCert] = useState("");
  const [key, setKey] = useState("");
  const [chain, setChain] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(""); setCert(""); setKey(""); setChain(""); setAuto(false);
  }, [open]);

  async function submit() {
    if (!cert.trim() || !key.trim()) return toast.error("Informe o certificado e a chave (PEM)");
    setBusy(true);
    try {
      await post("/certificates/import", {
        name: name.trim() || undefined, cert, key,
        chain: chain.trim() || undefined, auto_renew: auto,
      });
      toast.success("Certificado importado");
      onOpenChange(false); onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar certificado</DialogTitle>
          <DialogDescription>
            Envie um certificado de servidor + chave já existentes (PEM). Para importar
            uma CA, use “Importar CA” na tabela de autoridades certificadoras.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="imp-name">Nome (opcional)</Label>
            <Input id="imp-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="deriva do CN/domínio se vazio" spellCheck={false} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-cert">Certificado (PEM) *</Label>
            <Textarea id="imp-cert" value={cert} onChange={(e) => setCert(e.target.value)}
              rows={5} spellCheck={false} className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE-----" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-key">Chave privada (PEM) *</Label>
            <Textarea id="imp-key" value={key} onChange={(e) => setKey(e.target.value)}
              rows={5} spellCheck={false} className="font-mono text-xs"
              placeholder="-----BEGIN PRIVATE KEY-----" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-chain">Cadeia / intermediários (PEM, opcional)</Label>
            <Textarea id="imp-chain" value={chain} onChange={(e) => setChain(e.target.value)}
              rows={4} spellCheck={false} className="font-mono text-xs"
              placeholder="-----BEGIN CERTIFICATE----- (CA intermediária)" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={auto} onCheckedChange={(v) => setAuto(!!v)} /> Auto-renovar
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
