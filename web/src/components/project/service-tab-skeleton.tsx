import { Skeleton } from "@/components/ui/skeleton";

export type ServiceTabSkeletonKind = "general" | "deployments" | "environment" | "logs" | "backups" | "snapshots" | "advanced";

function Heading({ action = true }: { action?: boolean }) {
  return <div className="flex items-center justify-between gap-4"><div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-80" /></div>{action && <Skeleton className="h-9 w-28" />}</div>;
}

export function ServiceTabSkeleton({ tab }: { tab: ServiceTabSkeletonKind }) {
  if (tab === "deployments") return <div className="space-y-4"><Heading /><Skeleton className="h-11 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (tab === "environment") return <div className="space-y-4"><Heading action={false} /><Skeleton className="h-72 w-full" /><div className="flex justify-end"><Skeleton className="h-9 w-20" /></div></div>;
  if (tab === "logs") return <div className="space-y-5"><Heading action={false} /><Skeleton className="h-10 w-full" /><div className="flex gap-3"><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-28" /><Skeleton className="h-9 flex-1" /></div><Skeleton className="h-96 w-full" /></div>;
  if (tab === "backups" || tab === "snapshots") return <div className="space-y-6"><Heading /><Skeleton className="h-60 w-full" /><Skeleton className="h-44 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (tab === "advanced") return <div className="space-y-6"><Heading action={false} /><Skeleton className="h-44 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-40 w-full" /></div>;
  return <div className="space-y-6"><Heading /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-40 w-full" /></div>;
}
