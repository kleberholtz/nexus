import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Save } from "lucide-react";
import { get, getApiBase, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Monitor } from "@/lib/monitor-config";
import { StatusPage, StatusPageForm, emptyStatusPage } from "@/lib/status-page-config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { SelectWithSearch } from "@/components/ui/select-with-search";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";

type Cert = { name: string };

function Row({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <LabelWithHelp help={help ?? ""}>{label}</LabelWithHelp>
      {children}
    </div>
  );
}

function ToggleRow({ label, help, checked, onChange }: {
  label: string; help: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <LabelWithHelp help={help}>{label}</LabelWithHelp>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function StatusPageEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const navigate = useNavigate();
  const { can } = useAuth();
  const writable = can("monitors", "write");

  const [form, setForm] = useState<StatusPageForm | null>(isNew ? emptyStatusPage() : null);
  const [saved, setSaved] = useState<StatusPage | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [monitorSearch, setMonitorSearch] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof StatusPageForm>(key: K, value: StatusPageForm[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  useEffect(() => {
    get<Monitor[]>("/monitors").then(setMonitors).catch(() => {});
    get<Cert[]>("/certificates").then(setCerts).catch(() => {});
    if (!isNew) {
      get<StatusPage>(`/monitors/status-pages/${id}`)
        .then((p) => { setSaved(p); setForm(p); })
        .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"));
    }
  }, [id, isNew]);

  const filteredMonitors = useMemo(() => {
    const q = monitorSearch.trim().toLowerCase();
    return q ? monitors.filter((m) => m.name.toLowerCase().includes(q)) : monitors;
  }, [monitors, monitorSearch]);

  function toggleMonitor(mid: number) {
    setForm((f) => {
      if (!f) return f;
      const has = f.monitor_ids.includes(mid);
      return { ...f, monitor_ids: has ? f.monitor_ids.filter((x) => x !== mid) : [...f.monitor_ids, mid] };
    });
  }

  async function save() {
    if (!form) return;
    if (!form.title.trim()) return toast.error("Informe o título da página.");
    if (form.cert_name && !form.domain) return toast.error("Cert exige um domínio.");
    setBusy(true);
    try {
      const res = isNew
        ? await post<StatusPage>("/monitors/status-pages", form)
        : await put<StatusPage>(`/monitors/status-pages/${id}`, form);
      toast.success("Página salva");
      setSaved(res);
      setForm(res);
      if (isNew) navigate(`/status-pages/${res.id}`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  if (!form) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  }

  const publicUrl = saved
    ? (saved.domain ? `https://${saved.domain}/` : `${getApiBase()}${saved.public_path}`)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => navigate("/status-pages")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{isNew ? "Nova status page" : (saved?.title || "Editar página")}</h1>
            {publicUrl && (
              <a href={publicUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {publicUrl}
              </a>
            )}
          </div>
        </div>
        {writable && (
          <Button onClick={save} disabled={busy}><Save className="h-4 w-4" /> Salvar</Button>
        )}
      </div>

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="monitores">Monitores ({form.monitor_ids.length})</TabsTrigger>
          <TabsTrigger value="aparencia">Aparência</TabsTrigger>
          <TabsTrigger value="avancado">Avançado</TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <Card><CardContent className="space-y-4 p-5">
            <Row label="Título" help="Nome exibido no topo da página pública.">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Status da Empresa" />
            </Row>
            <Row label="Slug (URL)" help="Segmento da URL pública (/status/<slug>). Gerado do título se vazio.">
              <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="minha-empresa" spellCheck={false} />
            </Row>
            <Row label="Descrição" help="Subtítulo/descrição opcional.">
              <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Row>
            <ToggleRow label="Mostrar incidentes" help="Exibe os incidentes (não-manutenção) dos monitores selecionados."
              checked={form.show_incidents} onChange={(v) => set("show_incidents", v)} />
            <ToggleRow label="Mostrar manutenções" help="Exibe os incidentes de severidade Manutenção separadamente."
              checked={form.show_maintenance} onChange={(v) => set("show_maintenance", v)} />
            <ToggleRow label="Publicada" help="Quando desligada, a página pública responde 404 (rascunho)."
              checked={form.published} onChange={(v) => set("published", v)} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="monitores">
          <Card><CardContent className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">
              Selecione os monitores a exibir. A página só mostra <b>nome, status e uptime</b> — nunca o alvo/config.
            </p>
            <Input placeholder="Filtrar monitores…" value={monitorSearch} onChange={(e) => setMonitorSearch(e.target.value)} />
            <div className="max-h-[420px] space-y-1 overflow-y-auto rounded-lg border p-1">
              {filteredMonitors.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Nenhum monitor.</p>
              ) : filteredMonitors.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
                  <Checkbox checked={form.monitor_ids.includes(m.id)} onCheckedChange={() => toggleMonitor(m.id)} />
                  <span className="flex-1 truncate text-sm">{m.name}</span>
                  <Badge variant="muted">{m.type}</Badge>
                </label>
              ))}
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="aparencia">
          <Card><CardContent className="space-y-4 p-5">
            <Row label="Logo (URL)" help="URL (ou data: URI) da imagem exibida no topo.">
              <Input value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://…/logo.svg" spellCheck={false} />
            </Row>
            <Row label="Banner" help="Aviso destacado no topo (texto). Vazio = sem banner.">
              <Textarea rows={2} value={form.banner} onChange={(e) => set("banner", e.target.value)} placeholder="Manutenção programada no domingo às 02h." />
            </Row>
            <Row label="Cor de destaque" help="Hex, ex.: #2563eb. Vazio usa o padrão.">
              <div className="flex items-center gap-2">
                <input type="color" value={form.accent_color || "#2563eb"}
                  onChange={(e) => set("accent_color", e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border bg-transparent" />
                <Input value={form.accent_color} onChange={(e) => set("accent_color", e.target.value)}
                  placeholder="#2563eb" spellCheck={false} className="max-w-[160px]" />
              </div>
            </Row>
            <Row label="CSS custom" help="Injetado após o CSS base (sobrescreve). Cuidado: a página é pública.">
              <Textarea rows={8} value={form.custom_css} onChange={(e) => set("custom_css", e.target.value)}
                spellCheck={false} className="font-mono text-xs" placeholder=".overall{border-radius:0}" />
            </Row>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="avancado">
          <Card><CardContent className="space-y-4 p-5">
            <Row label="Domínio (nginx)" help="Se preenchido, gera um server block nginx dedicado (proxy_pass p/ a página). Vazio = só o caminho /status/<slug> da API.">
              <Input value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="status.exemplo.com" spellCheck={false} />
            </Row>
            <Row label="Certificado TLS" help="Cert para servir o domínio em 443. Vazio = só HTTP (porta 80).">
              <SelectWithSearch
                options={[{ value: "", label: "— sem TLS (HTTP) —" }, ...certs.map((c) => ({ value: c.name, label: c.name }))]}
                value={form.cert_name} onChange={(v) => set("cert_name", v)} disabled={!form.domain} />
            </Row>
            <Row label="JS custom" help="Injetado no fim da página pública. Executa no browser dos visitantes — use com cautela.">
              <Textarea rows={8} value={form.custom_js} onChange={(e) => set("custom_js", e.target.value)}
                spellCheck={false} className="font-mono text-xs" placeholder="console.log('status')" />
            </Row>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
