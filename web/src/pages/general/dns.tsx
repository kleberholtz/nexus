import { useEffect, useMemo, useState } from "react";
import { Ban, Cloud, CloudOff, Globe, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { del, get, post, put } from "@/lib/api";
import { DnsProvider, DnsRecord, DnsZone } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Pagination, useUrlPagination } from "@/components/docker/list";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const RTYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS", "CAA", "SRV"];
const CLOUDFLARE_PROXIABLE_TYPES = new Set(["A", "AAAA", "CNAME"]);
const PAGE_SIZE = 50;

export function DnsPage() {
  const [providers, setProviders] = useState<DnsProvider[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [zones, setZones] = useState<DnsZone[]>([]);
  const [zoneId, setZoneId] = useState<string>("");
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [editing, setEditing] = useState<DnsRecord | "new" | null>(null);
  const [toDelete, setToDelete] = useState<DnsRecord | null>(null);
  const selectedProvider = providers.find((provider) => String(provider.id) === providerId);
  const isCloudflare = selectedProvider?.type === "cloudflare";
  const { page, setPage } = useUrlPagination(`${providerId}|${zoneId}`);
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const providerOptions = useMemo(
    () => providers.map((provider) => ({
      value: String(provider.id),
      label: provider.label,
      searchText: provider.type,
    })),
    [providers]
  );
  const zoneOptions = useMemo(
    () => zones.map((zone) => ({
      value: zone.id,
      label: zone.name,
    })),
    [zones]
  );
  const visibleRecords = useMemo(
    () => records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, records]
  );

  useEffect(() => {
    get<DnsProvider[]>("/dns/providers")
      .then((p) => {
        setProviders(p);
        if (p[0]) setProviderId(String(p[0].id));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar provedores"))
      .finally(() => setProvidersLoading(false));
  }, []);

  // Carrega zonas ao trocar de provedor.
  useEffect(() => {
    if (!providerId) return;
    setZones([]);
    setZoneId("");
    setRecords([]);
    setLoading(true);
    get<DnsZone[]>(`/dns/providers/${providerId}/zones`)
      .then((z) => {
        setZones(z);
        if (z[0]) setZoneId(z[0].id);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao listar zonas"))
      .finally(() => setLoading(false));
  }, [providerId]);

  function loadRecords() {
    if (!providerId || !zoneId) return;
    setLoading(true);
    get<DnsRecord[]>(`/dns/providers/${providerId}/records?zone_id=${encodeURIComponent(zoneId)}`)
      .then(setRecords)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao listar registros"))
      .finally(() => setLoading(false));
  }
  useEffect(loadRecords, [providerId, zoneId]);

  async function remove(r: DnsRecord) {
    try {
      await del(`/dns/providers/${providerId}/records/${encodeURIComponent(r.id)}?zone_id=${encodeURIComponent(zoneId)}`);
      toast.success("Registro removido");
      loadRecords();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  if (providersLoading) return <DnsPageSkeleton />;

  if (providers.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Globe className="h-6 w-6 text-primary" /> DNS
        </h1>
        <Card className="p-8 text-center text-muted-foreground">
          Nenhum provedor DNS configurado.{" "}
          <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
            Configure em Configurações → DNS Providers
          </Link>
          .
        </Card>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Globe className="h-6 w-6 text-primary" /> DNS
            </h1>
            <p className="text-sm text-muted-foreground">
              Gerencie registros DNS por provedor e zona.
            </p>
          </div>

          <SelectWithSearch
            value={providerId}
            onChange={setProviderId}
            options={providerOptions}
            placeholder="Selecione um provedor"
            searchPlaceholder="Pesquisar provedor"
            className="w-64"
          />
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={loadRecords}
                disabled={loading}
                aria-label="Recarregar registros"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recarregar registros</TooltipContent>
          </Tooltip>

          <div className="flex items-center gap-3">
            <SelectWithSearch
              value={zoneId}
              onChange={setZoneId}
              options={zoneOptions}
              placeholder="Selecione uma zona"
              searchPlaceholder="Pesquisar zona"
              emptyMessage="Nenhuma zona encontrada."
              disabled={!zones.length}
              className="w-64"
            />
            <Button size="sm" onClick={() => setEditing("new")} disabled={!zoneId}>
              <Plus className="h-4 w-4" /> Novo registro
            </Button>
          </div>
        </div>

        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Tipo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Conteúdo</TableHead>
                {isCloudflare && <TableHead className="w-24">Proxy</TableHead>}
                <TableHead className="w-20">TTL</TableHead>
                <TableHead className="w-24 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(4)].map((_, index) => (
                  <TableRow key={index}>
                    <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-full max-w-72" /></TableCell>
                    {isCloudflare && <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>}
                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-16" /></TableCell>
                  </TableRow>
                ))
              ) : visibleRecords.length > 0 ? (
                visibleRecords.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Badge variant="secondary">{r.type}</Badge></TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="max-w-[360px] truncate font-mono text-xs text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block truncate">{r.content}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-md break-all font-mono">{r.content}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    {isCloudflare && (
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              tabIndex={0}
                              aria-label={r.proxiable ? (r.proxied ? "Proxy ativo" : "Proxy desativado") : "Proxy indisponível"}
                              className="inline-flex"
                            >
                              {r.proxiable
                                ? r.proxied
                                  ? <Cloud className="h-4 w-4 text-emerald-500" />
                                  : <CloudOff className="h-4 w-4 text-amber-500" />
                                : <Ban className="h-4 w-4 text-destructive" />}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {r.proxiable ? (r.proxied ? "Proxy ativo" : "Proxy desativado") : "Proxy indisponível"}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">{r.ttl}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label="Editar">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Editar</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setToDelete(r)} aria-label="Excluir">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={isCloudflare ? 6 : 5} className="py-8 text-center text-muted-foreground">Nenhum registro.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        <Pagination page={currentPage} pages={pages} total={records.length} onPage={setPage} />

        {editing && (
          <RecordDialog
            providerId={providerId}
            providerType={selectedProvider?.type || ""}
            zoneId={zoneId}
            record={editing === "new" ? null : editing}
            onOpenChange={(o) => !o && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              loadRecords();
            }}
          />
        )}
        <ConfirmDelete
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
          title="Excluir registro?"
          description={`${toDelete?.type} ${toDelete?.name} → ${toDelete?.content}`}
          onConfirm={() => {
            if (toDelete) return remove(toDelete);
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function DnsPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-9" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <Card className="p-4">
        <div className="space-y-4">
          {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-8 w-full" />)}
        </div>
      </Card>
    </div>
  );
}

function RecordDialog({
  providerId,
  providerType,
  zoneId,
  record,
  onOpenChange,
  onSaved,
}: {
  providerId: string;
  providerType: string;
  zoneId: string;
  record: DnsRecord | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!record;
  const [type, setType] = useState(record?.type || "A");
  const [name, setName] = useState(record?.name || "");
  const [content, setContent] = useState(record?.content || "");
  const [ttl, setTtl] = useState(String(record?.ttl ?? 300));
  const [proxied, setProxied] = useState(!!record?.proxied);
  const [busy, setBusy] = useState(false);
  const isCloudflare = providerType === "cloudflare";
  const isProxiable = isCloudflare && (record?.proxiable ?? CLOUDFLARE_PROXIABLE_TYPES.has(type));

  async function save() {
    if (!name.trim()) return toast.error("Informe o nome");
    if (!content.trim()) return toast.error("Informe o conteúdo");
    const ttlN = Number(ttl);
    if (!Number.isInteger(ttlN) || ttlN < 1 || ttlN > 604800)
      return toast.error("TTL deve ser 1–604800");
    setBusy(true);
    const body = {
      zone_id: zoneId,
      type,
      name: name.trim(),
      content: content.trim(),
      ttl: ttlN,
      ...(isProxiable ? { proxied } : {}),
    };
    try {
      if (isEdit) {
        await put(`/dns/providers/${providerId}/records/${encodeURIComponent(record!.id)}`, body);
      } else {
        await post(`/dns/providers/${providerId}/records`, body);
      }
      toast.success(isEdit ? "Registro atualizado" : "Registro criado");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar registro" : "Novo registro"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)} disabled={isEdit}>
                {RTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="rec-name">Nome</Label>
              <Input id="rec-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="sub.exemplo.com" spellCheck={false} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rec-content">Conteúdo</Label>
            <Input id="rec-content" value={content} onChange={(e) => setContent(e.target.value)}
              placeholder={type === "A" ? "1.2.3.4" : type === "CNAME" ? "destino.exemplo.com" : "valor"}
              spellCheck={false} />
          </div>
          <div className="space-y-1.5 w-32">
            <Label htmlFor="rec-ttl">TTL (s)</Label>
            <Input id="rec-ttl" type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
          {isProxiable && (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div>
                <Label>Proxy Cloudflare</Label>
                <p className="text-xs text-muted-foreground">Ativa ou desativa o proxy laranja para este registro.</p>
              </div>
              <Switch checked={proxied} onCheckedChange={setProxied} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
