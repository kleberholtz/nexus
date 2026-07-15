import { useEffect, useState } from "react";
import { Dices, Loader2, Plus, Trash2 } from "lucide-react";
import { get, post, put } from "@/lib/api";
import { RtmpDetail, RtmpSummary } from "@/lib/types";
import {
  RtmpForm,
  buildRtmpBody,
  emptyRtmpForm,
  parseRtmpForm,
  randomStreamKey,
  validateRtmpForm,
} from "@/lib/rtmp-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  editing: RtmpSummary | null; // null = criar
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
};

export function RtmpFormDialog({ editing, onOpenChange, onSaved }: Props) {
  const isEdit = !!editing;
  const [form, setForm] = useState<RtmpForm>(emptyRtmpForm);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) {
      setForm({ ...emptyRtmpForm });
      return;
    }
    setLoading(true);
    get<RtmpDetail>(`/rtmp/${encodeURIComponent(editing.id)}`)
      // O nome da aplicação é o arg do bloco (não vem nos nós filhos) — vem de d.name.
      .then((d) => setForm({
        ...parseRtmpForm(d.nodes, d.listen.split(":").pop() || "1935"),
        name: d.name,
      }))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [editing]);

  const set = <K extends keyof RtmpForm>(k: K, v: RtmpForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function setList(key: "push" | "pull", i: number, v: string) {
    setForm((f) => ({ ...f, [key]: f[key].map((x, idx) => (idx === i ? v : x)) }));
  }
  function addList(key: "push" | "pull") {
    setForm((f) => ({ ...f, [key]: [...f[key], ""] }));
  }
  function removeList(key: "push" | "pull", i: number) {
    setForm((f) => ({ ...f, [key]: f[key].filter((_, idx) => idx !== i) }));
  }

  async function submit() {
    const err = validateRtmpForm(form);
    if (err) return toast.error(err);
    const body = buildRtmpBody(form);
    const q = `name=${encodeURIComponent(form.name.trim())}&listen=${encodeURIComponent(form.port.trim())}`;
    setBusy(true);
    try {
      if (isEdit) {
        await put(`/rtmp/${encodeURIComponent(editing!.id)}?${q}`, { raw: body });
        toast.success("Aplicação RTMP atualizada");
      } else {
        await post(`/rtmp?${q}`, { raw: body });
        toast.success("Aplicação RTMP criada");
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar aplicação RTMP" : "Nova aplicação RTMP"}</DialogTitle>
          <DialogDescription>
            Live streaming (nginx-rtmp). Publique em <code>rtmp://host:porta/{form.name || "app"}/chave</code>.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground">Carregando…</div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rt-name">Nome da aplicação *</Label>
                <Input id="rt-name" value={form.name} onChange={(e) => set("name", e.target.value)}
                  placeholder="live" spellCheck={false} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-port">Porta (listen)</Label>
                <Input id="rt-port" value={form.port} onChange={(e) => set("port", e.target.value)}
                  inputMode="numeric" placeholder="1935" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rt-key">Chave de transmissão</Label>
              <div className="flex items-center gap-2">
                <Input id="rt-key" value={form.key} onChange={(e) => set("key", e.target.value)}
                  placeholder="opcional — deixe em branco para chave livre" spellCheck={false} className="flex-1" />
                <Button type="button" variant="outline" size="icon" title="Gerar chave aleatória"
                  onClick={() => set("key", randomStreamKey())}>
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Publique em <code>rtmp://host:{form.port || "1935"}/{form.name || "app"}/{form.key || "<chave>"}</code>.
              </p>
            </div>

            <div className="flex flex-wrap gap-6 rounded-lg border p-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.live} onCheckedChange={(v) => set("live", !!v)} /> Live (publicação ao vivo)
              </label>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Publicação</span>
                <Select value={form.publish} onChange={(e) => set("publish", e.target.value as RtmpForm["publish"])} className="h-8 w-32">
                  <option value="all">liberada</option>
                  <option value="none">bloqueada</option>
                </Select>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Reprodução</span>
                <Select value={form.play} onChange={(e) => set("play", e.target.value as RtmpForm["play"])} className="h-8 w-32">
                  <option value="all">liberada</option>
                  <option value="none">bloqueada</option>
                </Select>
              </div>
            </div>

            {/* HLS */}
            <div className="space-y-3 rounded-lg border p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={form.hls} onCheckedChange={(v) => set("hls", !!v)} /> HLS (HTTP Live Streaming)
              </label>
              {form.hls && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="rt-hlspath">hls_path *</Label>
                    <Input id="rt-hlspath" value={form.hlsPath} onChange={(e) => set("hlsPath", e.target.value)}
                      placeholder="/var/www/hls" spellCheck={false} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rt-frag">hls_fragment</Label>
                    <Input id="rt-frag" value={form.hlsFragment} onChange={(e) => set("hlsFragment", e.target.value)} placeholder="4s" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rt-pl">hls_playlist_length</Label>
                    <Input id="rt-pl" value={form.hlsPlaylistLength} onChange={(e) => set("hlsPlaylistLength", e.target.value)} placeholder="12s" />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.hlsNested} onCheckedChange={(v) => set("hlsNested", !!v)} /> hls_nested
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.hlsCleanup} onCheckedChange={(v) => set("hlsCleanup", !!v)} /> hls_cleanup
                  </label>
                </div>
              )}
            </div>

            {/* Gravação */}
            <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rt-rec">Gravação (record)</Label>
                <Select id="rt-rec" value={form.record} onChange={(e) => set("record", e.target.value as RtmpForm["record"])}>
                  <option value="off">desligada</option>
                  <option value="all">all (vídeo + áudio)</option>
                  <option value="video">video</option>
                  <option value="audio">audio</option>
                  <option value="keyframes">keyframes</option>
                  <option value="manual">manual</option>
                </Select>
              </div>
              {form.record !== "off" && (
                <div className="space-y-1.5">
                  <Label htmlFor="rt-recpath">record_path *</Label>
                  <Input id="rt-recpath" value={form.recordPath} onChange={(e) => set("recordPath", e.target.value)}
                    placeholder="/var/www/rec" spellCheck={false} />
                </div>
              )}
            </div>

            {/* Push / Pull */}
            {(["push", "pull"] as const).map((key) => (
              <div key={key} className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {key} (relay {key === "push" ? "para" : "de"} outro servidor)
                  </p>
                  <Button variant="outline" size="sm" onClick={() => addList(key)}>
                    <Plus className="h-4 w-4" /> Adicionar
                  </Button>
                </div>
                {form[key].map((u, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={u} onChange={(e) => setList(key, i, e.target.value)}
                      placeholder="rtmp://outro-host/app" spellCheck={false} className="flex-1" />
                    <Button variant="ghost" size="icon" onClick={() => removeList(key, i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={busy || loading}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar" : "Criar aplicação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
