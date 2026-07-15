import { Skeleton } from "@/components/ui/skeleton";

function PageHeading({ actions = 1 }: { actions?: number }) {
  return <div className="flex flex-wrap items-start justify-between gap-4">
    <div className="space-y-2"><Skeleton className="h-8 w-56 max-w-[70vw]" /><Skeleton className="h-4 w-80 max-w-[80vw]" /></div>
    <div className="flex gap-2">{Array.from({ length: actions }, (_, index) => <Skeleton key={index} className="h-9 w-32" />)}</div>
  </div>;
}

function TableCard({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return <div className="overflow-hidden rounded-xl border bg-card">
    <div className="grid gap-4 border-b bg-muted/30 p-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-4 w-20 max-w-full" />)}
    </div>
    {Array.from({ length: rows }, (_, row) => <div key={row} className="grid gap-4 border-b p-4 last:border-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={`h-5 ${column === 0 ? "w-32" : "w-full"} max-w-full`} />)}
    </div>)}
  </div>;
}

export function DashboardSkeleton() {
  return <div className="space-y-6"><PageHeading actions={0} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div>
    <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
  </div>;
}

export function TablePageSkeleton() {
  return <div className="space-y-6"><PageHeading actions={2} />
    <div className="flex gap-3"><Skeleton className="h-10 flex-1" /><Skeleton className="h-10 w-40" /></div>
    <TableCard />
  </div>;
}

export function CardsPageSkeleton() {
  return <div className="space-y-6"><PageHeading actions={1} /><Skeleton className="h-10 w-full" />
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-44" />)}</div>
  </div>;
}

export function DetailPageSkeleton() {
  return <div className="space-y-6">
    <Skeleton className="h-5 w-40" /><PageHeading actions={2} />
    <div className="flex gap-2 border-b pb-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-24" />)}</div>
    <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-48 lg:col-span-2" /><Skeleton className="h-48" /></div>
    <Skeleton className="h-64" />
  </div>;
}

export function MetricsPageSkeleton() {
  return <div className="space-y-6"><PageHeading actions={1} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div>
    <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-72" />)}</div>
  </div>;
}

export function SettingsPageSkeleton() {
  return <div className="space-y-6"><PageHeading actions={1} />
    <div className="flex gap-2 border-b pb-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-28" />)}</div>
    <div className="space-y-4 rounded-xl border bg-card p-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="grid gap-3 sm:grid-cols-[220px_1fr]"><Skeleton className="h-5 w-40" /><Skeleton className="h-10 w-full" /></div>)}</div>
  </div>;
}

export function PageSkeleton({ pathname }: { pathname: string }) {
  if (pathname === "/") return <DashboardSkeleton />;
  if (pathname === "/metrics") return <MetricsPageSkeleton />;
  if (/^\/(settings|cicd\/settings|profile)$/.test(pathname)) return <SettingsPageSkeleton />;
  if (/^\/projects\/\d+(?:\/services\/\d+)?/.test(pathname)
      || /^\/docker\/(container|image|volume|network)\//.test(pathname)
      || /^\/monitors\//.test(pathname)) return <DetailPageSkeleton />;
  if (pathname === "/projects") return <CardsPageSkeleton />;
  return <TablePageSkeleton />;
}
