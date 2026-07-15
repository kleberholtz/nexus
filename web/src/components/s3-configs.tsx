import { useEffect, useState } from "react";
import { CloudUpload, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { S3Config } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabelWithHelp } from "@/components/ui/label-with-help";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Esquema dos campos de uma config S3. Fica no front (é estático) para o
 * formulário sempre renderizar — antes vinha de GET /s3/fields e, se aquela
 * chamada falhasse, o dialog abria sem os campos de credencial (form quebrado). */
type S3FieldMeta = {
  key: string;
  title: string;
  help: string;
  placeholder?: string;
  secret?: boolean;
  required?: boolean;
};

const S3_FIELDS: S3FieldMeta[] = [
  {
    key: "bucket",
    title: "Bucket",
    required: true,
    help: "Nome do bucket de destino (só o nome, sem s3://). Ex.: meus-logs.",
    placeholder: "meus-logs",
  },
  {
    key: "region",
    title: "Região",
    required: true,
    help: "Região do bucket. AWS: us-east-1, eu-west-1, sa-east-1… Cloudflare R2: use 'auto'.",
    placeholder: "us-east-1",
  },
  {
    key: "endpoint",
    title: "Endpoint",
    help: "URL do serviço quando for S3-compatible (MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces). Deixe vazio para a AWS S3.",
    placeholder: "vazio = AWS S3 · ex.: https://<conta>.r2.cloudflarestorage.com",
  },
  {
    key: "access_key",
    title: "Access Key",
    required: true,
    help: "Access Key ID de uma credencial com permissão de escrita (PutObject) no bucket.",
    placeholder: "AKIA… / chave de acesso",
  },
  {
    key: "secret_key",
    title: "Secret Key",
    required: true,
    secret: true,
    help: "Secret Access Key correspondente. Guardada mascarada; ao editar, deixe vazio para manter a atual.",
  },
  {
    key: "prefix",
    title: "Prefixo",
    help: "Pasta dentro do bucket onde os logs são gravados (opcional). Ex.: nginx/prod.",
    placeholder: "nginx/prod (opcional)",
  },
];

const REQUIRED_KEYS = S3_FIELDS.filter((f) => f.required).map((f) => f.key);

export function S3ConfigsManager() {
  const [configs, setConfigs] = useState<S3Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<S3Config | "new" | null>(null);
  const [toDelete, setToDelete] = useState<S3Config | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  function load() {
    setLoading(true);
    get<S3Config[]>("/s3/configs")
      .then(setConfigs)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(c: S3Config) {
    try {
      await del(`/s3/configs/${c.id}`);
      toast.success("Configuração removida");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
      throw e;
    }
  }

  async function test(c: S3Config) {
    setTesting(c.id);
    try {
      await post(`/s3/configs/${c.id}/test`);
      toast.success(`Upload de teste OK em '${c.label}'`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setTesting(null);
    }
  }

  return (
    <TooltipProvider>
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Destinos S3</CardTitle>
          <CardDescription>
            Buckets S3 (AWS, MinIO, Cloudflare R2, Wasabi…) para envio dos logs rotacionados. Pode haver vários.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum destino S3.</p>
        ) : (
          configs.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <Badge variant="secondary">#{c.id}</Badge>
                <div>
                  <div className="font-medium">{c.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.config.bucket}
                    {c.config.region ? ` · ${c.config.region}` : ""}
                    {c.config.endpoint ? ` · ${c.config.endpoint}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => test(c)} disabled={testing === c.id}>
                      {testing === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-pretty leading-relaxed">
                    Testar upload: envia um objeto de teste (<code>nexus-test/&lt;timestamp&gt;.txt</code>) ao
                    bucket para validar as credenciais, o endpoint/região e a permissão de escrita (PutObject).
                    Se falhar, o motivo exato (ex.: região errada, acesso negado) aparece no aviso.
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setEditing(c)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Editar</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setToDelete(c)} aria-label="Remover">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remover</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </CardContent>

      {editing && (
        <S3Dialog
          config={editing === "new" ? null : editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      <ConfirmDelete
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Remover destino '${toDelete?.label}'?`}
        description="O destino S3 será apagado. Uploads já feitos permanecem no bucket."
        onConfirm={() => {
          if (toDelete) return remove(toDelete);
        }}
      />
    </Card>
    </TooltipProvider>
  );
}

function S3Dialog({
  config,
  onOpenChange,
  onSaved,
}: {
  config: S3Config | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = !!config;
  const [label, setLabel] = useState(config?.label || "");
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!config) return {};
    // Em edição, pré-preenche os não-secretos; secretos ficam vazios (= manter).
    const v: Record<string, string> = {};
    for (const f of S3_FIELDS) if (!f.secret) v[f.key] = config.config[f.key] || "";
    return v;
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!isEdit) {
      const missing = REQUIRED_KEYS.filter((k) => !values[k]?.trim());
      if (missing.length) {
        const titles = missing.map((k) => S3_FIELDS.find((f) => f.key === k)?.title ?? k);
        toast.error(`Preencha: ${titles.join(", ")}`);
        return;
      }
    }
    setBusy(true);
    try {
      if (isEdit) await put(`/s3/configs/${config!.id}`, { label, config: values });
      else await post("/s3/configs", { label, config: values });
      toast.success(isEdit ? "Destino atualizado" : "Destino criado");
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
          <DialogTitle>{isEdit ? "Editar destino S3" : "Novo destino S3"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Deixe a Secret Key em branco para mantê-la."
              : "Credenciais do bucket de destino. Use o botão de teste depois para validar."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <LabelWithHelp htmlFor="s3-label" help="Rótulo amigável para identificar este destino nas listas. Não é enviado ao S3.">
              Nome
            </LabelWithHelp>
            <Input id="s3-label" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="Meu bucket de logs" />
          </div>
          {S3_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <LabelWithHelp htmlFor={`s3-${f.key}`} help={f.help}>
                {f.title}
                {f.required && <span className="ml-0.5 text-destructive">*</span>}
              </LabelWithHelp>
              <Input
                id={`s3-${f.key}`}
                type={f.secret ? "password" : "text"}
                value={values[f.key] || ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={isEdit && f.secret ? "•••••• (deixe vazio para manter)" : f.placeholder}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
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
