import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { MetricChartProps } from "@/components/metric-chart";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const MetricChart = lazy(async () => ({ default: (await import("@/components/metric-chart")).MetricChart }));

function ChartSkeleton() {
  return <Card className="space-y-4 p-5"><Skeleton className="h-5 w-36" /><Skeleton className="h-[180px] w-full" /></Card>;
}

export function LazyMetricChart(props: MetricChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return <div ref={ref}>{visible ? <Suspense fallback={<ChartSkeleton />}><MetricChart {...props} /></Suspense> : <ChartSkeleton />}</div>;
}
