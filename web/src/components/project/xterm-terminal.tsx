import { useEffect, useRef } from "react";
import { wsUrl } from "@/lib/api";
import "@xterm/xterm/css/xterm.css";

export function XtermTerminal({ path, className }: { path: string; className?: string }) {
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const target = holder;
    let cancelled = false;
    let dispose: (() => void) | undefined;

    async function mount() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"),
      ]);
      if (cancelled) return;
      const term = new Terminal({
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        cursorBlink: true,
        theme: { background: "#000000", foreground: "#e5e5e5" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(target);
      const enc = new TextEncoder();
      let ws: WebSocket | null = null;
      function sendResize() {
        try { fit.fit(); } catch { /* container ainda sem tamanho */ }
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
      const raf = requestAnimationFrame(() => {
        if (cancelled) return;
        try { fit.fit(); } catch { /* */ }
        ws = new WebSocket(wsUrl(path));
        ws.binaryType = "arraybuffer";
        ws.onopen = () => { sendResize(); term.focus(); };
        ws.onmessage = (event) => typeof event.data === "string" ? term.write(event.data) : term.write(new Uint8Array(event.data as ArrayBuffer));
        ws.onclose = () => term.write("\r\n\x1b[90m[conexão encerrada]\x1b[0m\r\n");
        ws.onerror = () => term.write("\r\n\x1b[31m[erro de conexão]\x1b[0m\r\n");
        term.onData((data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(enc.encode(data)); });
      });
      const observer = new ResizeObserver(sendResize);
      observer.observe(target);
      window.addEventListener("resize", sendResize);
      dispose = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", sendResize);
        observer.disconnect();
        ws?.close();
        term.dispose();
      };
    }
    void mount();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [path]);

  return <div ref={holderRef} className={className ?? "h-full w-full"} />;
}
