import { useEffect, useState } from "react";
import { del, get, post, put } from "@/lib/api";
import {
  MonitorProxyFields,
  ProxyDraft,
  ProxyMode,
  proxyPayload,
  validateProxies,
} from "@/components/monitor-proxy-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

type ProxyRow = {
  id: number;
  protocol: ProxyDraft["protocol"];
  server: string;
  port: number;
  username: string;
  password: string;
  enabled: boolean;
};

export function MonitorProxiesDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [proxies, setProxies] = useState<ProxyDraft[]>([]);
  const [originalIds, setOriginalIds] = useState<number[]>([]);
  const [testing, setTesting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Array<ProxyRow>>("/monitors/proxies")
      .then((rows) => {
        setOriginalIds(rows.map((r) => r.id));
        setProxies(
          rows.map((r) => ({
            ...r,
            port: String(r.port),
            auth: !!(r.username || r.password),
          }))
        );
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Falha ao carregar proxies")
      );
  }, []);

  async function test(proxy: ProxyDraft, index: number) {
    const error = validateProxies([proxy]);
    if (error) return toast.error(error);
    
    setTesting(index);
    try {
      const r = await post<{ latency_ms: number }>("/monitors/proxies/test", {
        proxy: proxyPayload(proxy),
        config: {
          url: "https://example.com",
          method: "HEAD",
          accepted_codes: "200-399",
          ssl: {},
        },
        timeout_seconds: 10,
      });
      toast.success(`Proxy funcionando · ${r.latency_ms} ms`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar proxy");
    } finally {
      setTesting(null);
    }
  }

  async function testAll() {
    const active = proxies
      .map((proxy, index) => ({ proxy, index }))
      .filter(({ proxy }) => proxy.enabled);

    if (!active.length) {
      return toast.error("Não há proxies ativos para testar.");
    }

    const error = validateProxies(active.map(({ proxy }) => proxy));
    if (error) return toast.error(error);

    setTesting(-1);
    
    const results = await Promise.allSettled(
      active.map(({ proxy }) =>
        post<{ latency_ms: number }>("/monitors/proxies/test", {
          proxy: proxyPayload(proxy),
          config: {
            url: "https://example.com",
            method: "HEAD",
            accepted_codes: "200-399",
            ssl: {},
          },
          timeout_seconds: 10,
        })
      )
    );

    const passed = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - passed;

    if (failed) {
      const names = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [`${active[index].proxy.server}:${active[index].proxy.port}`]
          : []
      );
      toast.error(
        `${passed}/${results.length} proxies funcionando. Falharam: ${names.join(", ")}`
      );
    } else {
      toast.success(`${passed} proxies testados com sucesso.`);
    }
    
    setTesting(null);
  }

  async function save() {
    const error = validateProxies(proxies);
    if (error) return toast.error(error);

    setBusy(true);
    try {
      const kept = new Set(proxies.flatMap((p) => (p.id ? [p.id] : [])));
      
      for (const id of originalIds) {
        if (!kept.has(id)) await del(`/monitors/proxies/${id}`);
      }

      for (const proxy of proxies) {
        const body = proxyPayload(proxy);
        if (proxy.id) {
          await put(`/monitors/proxies/${proxy.id}`, body);
        } else {
          await post("/monitors/proxies", body);
        }
      }

      toast.success("Proxies salvos");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar proxies");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proxies</DialogTitle>
          <DialogDescription>
            Catálogo global de proxies reutilizáveis por vários monitores.
          </DialogDescription>
        </DialogHeader>

        <MonitorProxyFields
          proxies={proxies}
          mode={"round_robin" as ProxyMode}
          showMode={false}
          testing={testing}
          onChange={setProxies}
          onModeChange={() => {}}
          onTest={test}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            disabled={busy || testing !== null}
            onClick={testAll}
          >
            Testar proxies ativos
          </Button>
          <Button disabled={busy || testing !== null} onClick={save}>
            Salvar proxies
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}