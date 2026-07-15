import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type PlayerState = "loading" | "playing" | "error";

/** Player HLS (hls.js com fallback nativo p/ Safari) usado para testar a
 * transmissão ao vivo direto no navegador — RTMP não é reproduzível nativamente
 * em `<video>`, mas o output HLS do nginx-rtmp é. */
export function HlsPlayer({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const videoEl = video;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setState("loading");

    async function attach() {
      if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = src;
        const onLoaded = () => {
          setState("playing");
          videoEl.play().catch(() => {});
        };
        const onError = () => setState("error");
        videoEl.addEventListener("loadedmetadata", onLoaded);
        videoEl.addEventListener("error", onError);
        cleanup = () => {
          videoEl.removeEventListener("loadedmetadata", onLoaded);
          videoEl.removeEventListener("error", onError);
        };
        return;
      }

      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setState("error");
        return;
      }
      const hls = new Hls({ manifestLoadingMaxRetry: 2, manifestLoadingRetryDelay: 1500 });
      hls.loadSource(src);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setState("playing");
        videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setState("error");
      });
      cleanup = () => hls.destroy();
    }

    attach().catch(() => setState("error"));
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [src, attempt]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
      <video ref={videoRef} className="h-full w-full" controls muted playsInline />
      {state !== "playing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-sm text-white">
          {state === "loading" ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Aguardando o stream…</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <span>Sem sinal (publique com o ffmpeg/OBS acima, ou o location do HLS não existe)</span>
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="h-4 w-4" /> Tentar de novo
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
