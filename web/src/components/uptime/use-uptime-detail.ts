import { useCallback, useEffect, useRef, useState } from "react";
import { del, get, post, streamUrl } from "@/lib/api";
import {
  Monitor,
  MonitorChart,
  MonitorEvent,
  MonitorIncident,
  MonitorUptime,
} from "@/lib/monitor-config";
import { toast } from "@/components/ui/sonner";

type UseUptimeDetailOptions = {
  id?: string;
  onDeleted: () => void;
};

/** Estado e sincronização compartilhados pelas duas páginas de detalhe. */
export function useUptimeDetail({ id, onDeleted }: UseUptimeDetailOptions) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [uptime, setUptime] = useState<MonitorUptime | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [incidents, setIncidents] = useState<MonitorIncident[]>([]);
  const [range, setRange] = useState("24h");
  const [chart, setChart] = useState<MonitorChart | null>(null);
  const [checking, setChecking] = useState(false);
  const [paused, setPaused] = useState(false);

  const loadCore = useCallback(async () => {
    if (!id) return;
    try {
      const [nextMonitor, nextUptime, nextEvents, nextIncidents] = await Promise.all([
        get<Monitor>(`/monitors/${id}`),
        get<MonitorUptime>(`/monitors/${id}/uptime`),
        get<MonitorEvent[]>(`/monitors/${id}/events?limit=100`),
        get<MonitorIncident[]>(`/monitors/${id}/incidents`),
      ]);
      setMonitor(nextMonitor);
      setUptime(nextUptime);
      setEvents(nextEvents);
      setIncidents(nextIncidents);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar");
    }
  }, [id]);

  const loadChart = useCallback(async () => {
    if (!id) return;
    try {
      setChart(await get<MonitorChart>(`/monitors/${id}/chart?range=${range}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar gráfico");
    }
  }, [id, range]);

  const reload = useCallback(async () => {
    await Promise.all([loadCore(), loadChart()]);
  }, [loadChart, loadCore]);

  const checkNow = useCallback(async () => {
    if (!id) return;
    setChecking(true);
    try {
      await post(`/monitors/${id}/check`);
      await reload();
      toast.success("Checagem executada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao checar");
    } finally {
      setChecking(false);
    }
  }, [id, reload]);

  const clearEvents = useCallback(async () => {
    if (!id) return;
    try {
      await del(`/monitors/${id}/events`);
      toast.success("Eventos removidos");
      await loadCore();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao limpar eventos");
    }
  }, [id, loadCore]);

  const clearHeartbeats = useCallback(async () => {
    if (!id) return;
    try {
      await del(`/monitors/${id}/heartbeats`);
      toast.success("Heartbeats removidos");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao limpar heartbeats");
    }
  }, [id, reload]);

  useEffect(() => { void loadChart(); }, [loadChart]);

  const loadChartRef = useRef(loadChart);
  useEffect(() => { loadChartRef.current = loadChart; }, [loadChart]);

  const onDeletedRef = useRef(onDeleted);
  useEffect(() => { onDeletedRef.current = onDeleted; }, [onDeleted]);

  // Carga inicial ao trocar de monitor.
  useEffect(() => {
    if (!id) return;
    setMonitor(null);
    setChart(null);
    void loadCore();
  }, [id, loadCore]);

  // Stream ao vivo (pausável): fechar/reabrir conforme `paused`.
  useEffect(() => {
    if (!id || paused) return;
    const stream = new EventSource(streamUrl(`/monitors/${id}/stream`));
    stream.addEventListener("snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          monitor: Monitor;
          uptime: MonitorUptime;
          events: MonitorEvent[];
          incidents: MonitorIncident[];
        };
        setMonitor(data.monitor);
        setUptime(data.uptime);
        setEvents(data.events);
        setIncidents(data.incidents ?? []);
        void loadChartRef.current();
      } catch {
        // Ignora snapshots inválidos; o EventSource continuará conectado.
      }
    });
    stream.addEventListener("deleted", () => {
      stream.close();
      onDeletedRef.current();
    });
    stream.onerror = () => { /* EventSource reconecta sozinho. */ };
    return () => stream.close();
  }, [id, paused]);

  return {
    monitor,
    uptime,
    events,
    incidents,
    chart,
    range,
    setRange,
    checking,
    paused,
    setPaused,
    loadCore,
    reload,
    checkNow,
    clearEvents,
    clearHeartbeats,
  };
}
