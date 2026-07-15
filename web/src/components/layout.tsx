import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  Boxes,
  ChevronRight,
  Container,
  FileText,
  FolderGit2,
  Gauge,
  Globe,
  HardDrive,
  HeartPulse,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Network,
  Radar,
  RadioTower,
  ScrollText,
  Server,
  Settings2,
  ShieldCheck,
  Siren,
  Wrench,
  SlidersHorizontal,
  Tags,
  Users,
  Waypoints,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDelete } from "@/components/confirm-delete";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { PageSkeleton } from "@/components/skeletons";

type NavItemDef = {
  to: string;
  key: string;
  icon: React.ElementType;
  resource: string;
  end?: boolean;
  children?: NavItemDef[];   // item composto (menu expansível)
};

function RouteLoadingFallback({ onLoadingChange, pathname }: { onLoadingChange: (loading: boolean) => void; pathname: string }) {
  useEffect(() => {
    onLoadingChange(true);
    return () => onLoadingChange(false);
  }, [onLoadingChange]);
  return <div aria-hidden="true"><PageSkeleton pathname={pathname} /></div>;
}

// Navegação agrupada por área. `resource` liga cada item à permissão
// `<resource>:read`; grupos sem itens visíveis são omitidos.
const navGroups: { labelKey: string; items: NavItemDef[] }[] = [
  {
    labelKey: "nav.groupOverview",
    items: [
      { to: "/", key: "nav.dashboard", icon: LayoutDashboard, end: true, resource: "system" },
      { to: "/metrics", key: "nav.metrics", icon: Gauge, resource: "system" },
    ],
  },
  {
    labelKey: "nav.groupNginx",
    items: [
      { to: "/servers", key: "nav.servers", icon: Server, resource: "servers" },
      { to: "/upstreams", key: "nav.upstreams", icon: Network, resource: "upstreams" },
      { to: "/streams", key: "nav.streams", icon: Waypoints, resource: "streams" },
      { to: "/rtmp", key: "nav.rtmp", icon: RadioTower, resource: "rtmp" },
      { to: "/certificates", key: "nav.certificates", icon: ShieldCheck, resource: "certificates" },
      { to: "/dns", key: "nav.dns", icon: Globe, resource: "dns" },
    ],
  },
  {
    labelKey: "nav.groupCicd",
    items: [
      { to: "/projects", key: "nav.projects", icon: FolderGit2, resource: "projects" },
      {
        to: "/docker", key: "nav.docker", icon: Container, resource: "docker",
        children: [
          { to: "/docker/containers", key: "nav.dockerContainers", icon: Container, resource: "docker" },
          { to: "/docker/images", key: "nav.dockerImages", icon: Layers, resource: "docker" },
          { to: "/docker/volumes", key: "nav.dockerVolumes", icon: HardDrive, resource: "docker" },
          { to: "/docker/networks", key: "nav.dockerNetworks", icon: Network, resource: "docker" },
        ],
      },
      { to: "/cicd/settings", key: "nav.cicdSettings", icon: SlidersHorizontal, resource: "deploy" },
    ],
  },
  {
    labelKey: "nav.groupObservability",
    items: [
      {
        to: "/uptime", key: "nav.uptime", icon: Activity, resource: "monitors",
        children: [
          { to: "/tags", key: "nav.tags", icon: Tags, resource: "monitors" },
          { to: "/monitors", key: "nav.monitors", icon: Radar, resource: "monitors" },
          { to: "/heartbeats", key: "nav.heartbeats", icon: HeartPulse, resource: "monitors" },
          { to: "/notifications", key: "nav.notifications", icon: Bell, resource: "monitors" },
          { to: "/incidents", key: "nav.incidents", icon: Siren, resource: "monitors" },
          { to: "/maintenances", key: "nav.maintenances", icon: Wrench, resource: "monitors" },
          { to: "/proxies", key: "nav.proxies", icon: Network, resource: "monitors" },
          { to: "/status-pages", key: "nav.statusPages", icon: LayoutTemplate, resource: "monitors" },
        ],
      },
      { to: "/logs", key: "nav.logs", icon: FileText, resource: "logs" },
      { to: "/audit", key: "nav.audit", icon: ScrollText, resource: "audit" },
    ],
  },
  {
    labelKey: "nav.groupAdmin",
    items: [
      {
        to: "/users", key: "nav.users", icon: Users, resource: "users",
        children: [
          { to: "/users", key: "nav.users", icon: Users, resource: "users", end: true },
          { to: "/users/roles", key: "nav.roles", icon: ShieldCheck, resource: "users" },
        ],
      },
      { to: "/settings", key: "nav.settings", icon: Settings2, resource: "settings" },
    ],
  },
];

function NavItem({ to, end, icon: Icon, label }: {
  to: string;
  end?: boolean;
  icon: React.ElementType;
  label: string;
}) {
  const match = useMatch({ path: to, end: !!end });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={!!match} tooltip={label}>
        <NavLink to={to} end={end}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** Item composto (submenu colapsável), no padrão shadcn:
 * Collapsible > SidebarMenuItem > SidebarMenuButton + CollapsibleContent > SidebarMenuSub. */
function CompositeNavItem({ item, t }: { item: NavItemDef; t: (k: string) => string }) {
  const { pathname } = useLocation();
  const children = item.children ?? [];
  const anyActive = children.some((c) =>
    c.end ? pathname === c.to : (pathname === c.to || pathname.startsWith(c.to + "/")));
  const [open, setOpen] = useState(anyActive);
  const Icon = item.icon;
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <SidebarMenuButton isActive={anyActive} tooltip={t(item.key)} onClick={() => setOpen((v) => !v)}>
          <Icon />
          <span>{t(item.key)}</span>
          <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map((c) => <SubNavItem key={c.to} item={c} label={t(c.key)} />)}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function SubNavItem({ item, label }: { item: NavItemDef; label: string }) {
  const match = useMatch({ path: item.to, end: !!item.end });
  const Icon = item.icon;
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={!!match}>
        <NavLink to={item.to} end={item.end}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

export function Layout() {
  const { signOut, can, identity } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const profileMatch = useMatch({ path: "/profile", end: true });
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);

  // Cada grupo mostra só os itens cujo recurso o usuário pode ler. Itens
  // compostos filtram os filhos e somem se nenhum filho ficar visível.
  const groups = navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .map((it) => it.children
          ? { ...it, children: it.children.filter((c) => can(c.resource, "read")) }
          : it)
        .filter((it) => it.children ? it.children.length > 0 : can(it.resource, "read")),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
              <Boxes className="size-5" />
            </div>
            <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">
              {t("app.brand")}
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.labelKey}>
              <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((it) => it.children
                    ? <CompositeNavItem key={it.key} item={it} t={t} />
                    : <NavItem key={it.to} to={it.to} end={it.end} icon={it.icon} label={t(it.key)} />)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            {identity && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!!profileMatch}
                  tooltip={t("nav.profile")}
                  onClick={() => navigate("/profile")}
                  className="h-auto py-2"
                >
                  <Avatar name={identity.name || identity.username} seed={identity.username} className="size-7 text-[0.65rem]" />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{identity.name || identity.username}</span>
                    <span className="truncate text-xs capitalize text-muted-foreground">{identity.role}</span>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t("app.signOut")}
                onClick={() => setConfirmSignOut(true)}
              >
                <LogOut />
                <span>{t("app.signOut")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 overflow-hidden border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <span className="text-sm font-medium text-muted-foreground md:hidden">{t("app.brand")}</span>
          {routeLoading && (
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15" role="progressbar" aria-label={t("app.loading")}>
              <div className="route-loading-bar h-full w-full bg-primary" />
            </div>
          )}
        </header>
        <div className="mx-auto w-full p-4 md:p-8">
          <Suspense fallback={<RouteLoadingFallback onLoadingChange={setRouteLoading} pathname={pathname} />}>
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>

      <ConfirmDelete
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title={t("app.signOut")}
        description={t("app.signOutConfirm")}
        confirmLabel={t("app.signOut")}
        onConfirm={() => {
          signOut();
          navigate("/login");
        }}
      />
    </SidebarProvider>
  );
}
