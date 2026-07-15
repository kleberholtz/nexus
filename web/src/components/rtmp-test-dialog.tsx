import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react";
import { post } from "@/lib/api";
import { RtmpSummary } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HlsPlayer } from "@/components/hls-player";
import { toast } from "@/components/ui/sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TestResult = {
  listening: boolean;
  port: number;
  app: string;
  key: string;
  endpoint: string;
  publish_example: string;
  hls: boolean;
  hls_url: string;
  hls_notice: string;
  detail: string;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado");
  } catch {
    toast.error("Não foi possível copiar");
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs" title={value}>
          {value}
        </code>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyText(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Igual a CopyRow, mas para valores longos (ex.: comando ffmpeg): quebra em
 * várias linhas dentro de um textarea em vez de rolar horizontalmente. */
function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyText(value)}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <textarea
        readOnly
        value={value}
        rows={3}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-none rounded-md border bg-muted px-2 py-1.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

export function RtmpTestDialog({ app, onOpenChange }: {
  app: RtmpSummary;
  onOpenChange: (o: boolean) => void;
}) {
  const [res, setRes] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Substitui o placeholder <host> pelo host do painel para URLs copiáveis.
  const host = window.location.hostname || "localhost";
  const withHost = (s: string) => s.replaceAll("<host>", host);

  function run() {
    setLoading(true);
    post<TestResult>(`/rtmp/${encodeURIComponent(app.id)}/test`)
      .then((r) => {
        setRes(r);
        if (r.hls_notice) toast.warning(r.hls_notice);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao testar"))
      .finally(() => setLoading(false));
  }
  useEffect(run, [app.id]);

  const endpoint = res ? withHost(res.endpoint) : "";
  const streamKey = res?.key || "test";
  const hlsUrl = res?.hls_url ? withHost(res.hls_url) : "";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Testar live streaming — {app.name}</DialogTitle>
          <DialogDescription>
            Verifica se o nginx-rtmp está escutando e mostra os endpoints para publicar/reproduzir.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Testando porta {app.listen}…
          </div>
        ) : res ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {res.listening ? (
                <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> escutando</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> inacessível</Badge>
              )}
              <span className="text-sm text-muted-foreground">
                porta {res.port} {res.listening ? "aceitando conexões" : `(${res.detail || "sem conexão"})`}
              </span>
            </div>

            {res.hls && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">
                  Player (via HLS — precisa de um location servindo o hls_path)
                </div>
                <HlsPlayer key={hlsUrl} src={hlsUrl} />
              </div>
            )}

            <CopyRow label="Publicar (OBS/ffmpeg) — servidor" value={endpoint} />
            <CopyRow label="Chave de transmissão" value={streamKey} />
            <CopyRow label="Reproduzir (VLC/player)" value={`${endpoint}/${streamKey}`} />
            {res.hls && <CopyRow label="URL HLS" value={hlsUrl} />}
            <CopyBlock label="Publicar um vídeo de teste (ffmpeg)" value={withHost(res.publish_example)} />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={run} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Testar de novo
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
