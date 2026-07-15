import { useEffect, useState } from "react";
import { ExternalLink, Globe2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import type { Ca, DnsProvider } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LabelWithInfo } from "@/components/ui/label-with-info";

type Domain = {
  id: string; host: string; path: string; container_port: number | null; https: boolean;
  internal_path?: string;
  dns_link?: boolean; dns_provider_id?: number | null; dns_record_id?: string;
  dns_status?: "" | "created" | "exists";
  app_type?: "spa" | "container";
  provider: "" | "self-signed" | "ca-signed" | "letsencrypt"; cert_name: string;
};

export function DomainsTab({ base, canWrite, isSpa, running }: { base: string; canWrite: boolean; isSpa: boolean; running: boolean }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  function load() {
    setLoading(true);
    get<Domain[]>(`${base}/domains`).then(setDomains)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar domínios"))
      .finally(() => setLoading(false));
  }
  useEffect(load, [base]);

  async function remove(item: Domain) {
    try {
      await del(`${base}/domains/${item.id}`);
      toast.success("Domínio removido");
      load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao remover domínio"); }
  }

  async function applyChanges() {
    setApplying(true);
    try {
      const result = await post<{ output?: string }>("/nginx/reload");
      toast.success(result.output || "Alterações aplicadas");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao aplicar alterações");
    } finally { setApplying(false); }
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Globe2 className="h-5 w-5" /> Domains</h2>
          <p className="text-sm text-muted-foreground">Vincule domínios ao container usando o proxy reverso do Nginx.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canWrite || applying} onClick={applyChanges}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Aplicar alterações
          </Button>
          <Button disabled={!canWrite} onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Adicionar domain</Button>
        </div>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Host</TableHead><TableHead>Path</TableHead><TableHead>{isSpa ? "Origem" : "Container port"}</TableHead><TableHead>HTTPS</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
        <TableBody>
          {domains.map((item) => {
            const url = `${item.https ? "https" : "http"}://${item.host}${item.path === "/" ? "" : item.path}`;
            return <TableRow key={item.id}>
              <TableCell><div className="space-y-1"><a className="inline-flex items-center gap-1 font-medium hover:underline" href={url} target="_blank" rel="noreferrer">{item.host}<ExternalLink className="h-3 w-3" /></a>
                {item.dns_status && <div><Badge variant={item.dns_status === "created" ? "success" : "info"}>{item.dns_status === "created" ? "DNS criado" : "DNS já existia · IP atualizado"}</Badge></div>}
              </div></TableCell>
              <TableCell className="font-mono text-xs">{item.path}</TableCell>
              <TableCell className="font-mono text-xs">{item.app_type === "spa" ? item.internal_path || "/" : item.container_port}</TableCell>
              <TableCell>{item.https ? <Badge variant="success">{item.provider}</Badge> : <Badge variant="muted">HTTP</Badge>}</TableCell>
              <TableCell><div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon" disabled={!canWrite} onClick={() => setEditing(item)}><Pencil className="h-4 w-4" /></Button>
                <Tooltip><TooltipTrigger asChild><span className="inline-flex"><Button variant="ghost" size="icon" disabled={!canWrite || running} onClick={() => remove(item)}><Trash2 className="h-4 w-4 text-destructive" /></Button></span></TooltipTrigger>
                  <TooltipContent>{running ? "Pare o serviço antes de remover o domain" : "Remover domain"}</TooltipContent></Tooltip>
              </div></TableCell>
            </TableRow>;
          })}
          {!loading && domains.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhum domínio vinculado.</TableCell></TableRow>}
          {loading && <TableRow><TableCell colSpan={5} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>}
        </TableBody>
      </Table>
      {open && <AddDomainDialog base={base} isSpa={isSpa} onOpenChange={setOpen} onSaved={() => { setOpen(false); load(); }} />}
      {editing && <AddDomainDialog base={base} isSpa={isSpa} initial={editing}
        onOpenChange={(value) => !value && setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

function AddDomainDialog({ base, isSpa, initial, onOpenChange, onSaved }: { base: string; isSpa: boolean; initial?: Domain; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [host, setHost] = useState(initial?.host ?? "");
  const [path, setPath] = useState(initial?.path ?? "/");
  const [internalPath, setInternalPath] = useState(initial?.internal_path ?? "/");
  const [port, setPort] = useState(String(initial?.container_port ?? 3000));
  const [https, setHttps] = useState(initial?.https ?? false);
  const [provider, setProvider] = useState<"self-signed" | "ca-signed" | "letsencrypt">(initial?.provider || "self-signed");
  const [dnsProviders, setDnsProviders] = useState<DnsProvider[]>([]);
  const [dnsProviderId, setDnsProviderId] = useState("");
  const [linkDns, setLinkDns] = useState(initial?.dns_link ?? false);
  const [linkDnsProviderId, setLinkDnsProviderId] = useState(String(initial?.dns_provider_id ?? ""));
  const [cas, setCas] = useState<Ca[]>([]);
  const [caName, setCaName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([get<DnsProvider[]>("/dns/providers"), get<Ca[]>("/certificates/ca")]).then(([dns, ca]) => {
      setDnsProviders(dns); setDnsProviderId(dns[0] ? String(dns[0].id) : "");
      setLinkDnsProviderId((current) => current || (dns[0] ? String(dns[0].id) : ""));
      setCas(ca); setCaName(ca[0]?.name ?? "");
    }).catch(() => undefined);
  }, []);

  async function save() {
    if (!host.trim()) return toast.error("Informe o host");
    const containerPort = isSpa ? null : Number(port);
    if (!isSpa && (!Number.isInteger(containerPort) || Number(containerPort) < 1 || Number(containerPort) > 65535)) return toast.error("Informe uma porta válida");
    setBusy(true);
    try {
      let certName = "";
      if (https && initial?.https && initial.host === host.trim().toLowerCase() && initial.provider === provider && initial.cert_name) {
        certName = initial.cert_name;
      } else if (https) {
        let cert: { name: string };
        if (provider === "self-signed") cert = await post("/certificates/self-signed", { domains: [host], days: 365, auto_renew: true });
        else if (provider === "ca-signed") {
          if (!caName) throw new Error("Selecione uma CA");
          cert = await post("/certificates/ca-signed", { ca_name: caName, domains: [host], days: 365, auto_renew: true });
        } else {
          if (!dnsProviderId) throw new Error("Selecione um provedor DNS");
          cert = await post("/certificates/letsencrypt", { domains: [host], provider_id: Number(dnsProviderId), staging: false, auto_renew: true });
        }
        certName = cert.name;
      }
      if (linkDns && !linkDnsProviderId) throw new Error("Selecione um DNS provider");
      const payload = { host, path, internal_path: isSpa ? internalPath : "", container_port: containerPort,
        https, provider, cert_name: certName, dns_link: linkDns,
        dns_provider_id: linkDns ? Number(linkDnsProviderId) : null };
      if (initial) await put(`${base}/domains/${initial.id}`, payload);
      else await post(`${base}/domains`, payload);
      toast.success(initial ? "Domínio atualizado" : "Domínio vinculado");
      onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao vincular domínio"); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{initial ? "Editar domain" : "Adicionar domain"}</DialogTitle><DialogDescription>{initial ? "Atualiza" : "Cria"} um server Nginx controlado por este serviço.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5"><Label>Host</Label><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="app.exemplo.com" autoFocus /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">{isSpa ? <LabelWithInfo label="Path" info="Rota pública do domain. Ex.: / faz a SPA abrir na raiz; /painel publica em dominio.com/painel." /> : <Label>Path</Label>}<Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/" /></div>
          {isSpa && <div className="space-y-1.5"><LabelWithInfo label="Path interno" info="Pasta onde está o index.html dentro dos arquivos enviados. Ex.: /build ou /dist. Não altera a URL pública." /><Input value={internalPath} onChange={(event) => setInternalPath(event.target.value)} placeholder="/build" /></div>}
          {!isSpa && <div className="space-y-1.5"><Label>Container port</Label><Input type="number" value={port} onChange={(event) => setPort(event.target.value)} /></div>}
        </div>
        <div className="rounded-md border p-4">
          <div className="flex items-center justify-between"><div><Label>Usar HTTPS</Label><p className="text-xs text-muted-foreground">Emite e vincula um certificado ao domain.</p></div><Switch checked={https} onCheckedChange={setHttps} /></div>
          {https && <div className="mt-4 space-y-3 border-t pt-4">
            <div className="space-y-1.5"><Label>Provider</Label><Select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="self-signed">Self-signed</option><option value="ca-signed">CA</option><option value="letsencrypt">Let's Encrypt</option></Select></div>
            {provider === "ca-signed" && <div className="space-y-1.5"><Label>CA</Label><Select value={caName} onChange={(event) => setCaName(event.target.value)}><option value="">Selecione uma CA</option>{cas.map((ca) => <option key={ca.name} value={ca.name}>{ca.common_name || ca.name}</option>)}</Select></div>}
            {provider === "letsencrypt" && <div className="space-y-1.5"><Label>Provedor DNS</Label><Select value={dnsProviderId} onChange={(event) => setDnsProviderId(event.target.value)}><option value="">Selecione um provedor</option>{dnsProviders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div>}
          </div>}
        </div>
        <div className="rounded-md border p-4">
          <div className="flex items-center justify-between gap-3"><div><Label>Vincular ao DNS provider</Label><p className="text-xs text-muted-foreground">Cria um registro A para o host ou atualiza o IP quando ele já existir.</p></div><Switch checked={linkDns} onCheckedChange={setLinkDns} /></div>
          {linkDns && <div className="mt-4 space-y-1.5 border-t pt-4"><Label>DNS provider</Label><Select value={linkDnsProviderId} onChange={(event) => setLinkDnsProviderId(event.target.value)}><option value="">Selecione um provider</option>{dnsProviders.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div>}
        </div>
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {initial ? "Salvar" : "Adicionar domain"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
