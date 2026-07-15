import { useEffect, useRef, useState } from "react";
import { streamUrl } from "./api";
import { MetricPoint, SystemOverview } from "./types";

/** Conecta ao SSE /system/stream: `overview` inicial + métricas ao vivo. */
export function useMetricsStream() {
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [live, setLive] = useState<MetricPoint | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(streamUrl("/system/stream"));
    esRef.current = es;

    es.addEventListener("overview", (e) => {
      try {
        setOverview(JSON.parse((e as MessageEvent).data));
        setConnected(true);
      } catch {
        /* ignora payload malformado */
      }
    });
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        setLive(JSON.parse(e.data));
        setConnected(true);
      } catch {
        /* ignora */
      }
    };
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  return { overview, live, connected };
}
