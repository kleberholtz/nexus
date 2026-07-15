import { ComponentType, Suspense, lazy } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Layout } from "@/components/layout";

function lazyPage<T extends Record<string, ComponentType<object>>>(
  importer: () => Promise<T>,
  exportName: keyof T,
) {
  return lazy(async () => ({ default: (await importer())[exportName] }));
}

const LoginPage = lazyPage(() => import("@/pages/login"), "LoginPage");
const DashboardPage = lazyPage(() => import("@/pages/dashboard"), "DashboardPage");
const ServersPage = lazyPage(() => import("@/pages/web-server/servers"), "ServersPage");
const UpstreamsPage = lazyPage(() => import("@/pages/web-server/upstreams"), "UpstreamsPage");
const StreamsPage = lazyPage(() => import("@/pages/web-server/streams"), "StreamsPage");
const RtmpPage = lazyPage(() => import("@/pages/web-server/rtmp"), "RtmpPage");
const DockerPage = lazyPage(() => import("@/pages/docker/docker"), "DockerPage");
const DockerImagesPage = lazyPage(() => import("@/pages/docker/docker-images"), "DockerImagesPage");
const DockerVolumesPage = lazyPage(() => import("@/pages/docker/docker-volumes"), "DockerVolumesPage");
const DockerNetworksPage = lazyPage(() => import("@/pages/docker/docker-networks"), "DockerNetworksPage");
const DockerContainerPage = lazyPage(() => import("@/pages/docker/docker-container"), "DockerContainerPage");
const DockerImageDetailPage = lazyPage(() => import("@/pages/docker/docker-image"), "DockerImageDetailPage");
const DockerVolumeDetailPage = lazyPage(() => import("@/pages/docker/docker-volume"), "DockerVolumeDetailPage");
const DockerNetworkDetailPage = lazyPage(() => import("@/pages/docker/docker-network"), "DockerNetworkDetailPage");
const CicdSettingsPage = lazyPage(() => import("@/pages/cicd-settings"), "CicdSettingsPage");
const ProjectsPage = lazyPage(() => import("@/pages/projects"), "ProjectsPage");
const ProjectDetailPage = lazyPage(() => import("@/pages/project-detail"), "ProjectDetailPage");
const ServiceDetailPage = lazyPage(() => import("@/pages/service-detail"), "ServiceDetailPage");
const AuditPage = lazyPage(() => import("@/pages/audit"), "AuditPage");
const SettingsPage = lazyPage(() => import("@/pages/settings"), "SettingsPage");
const CertificatesPage = lazyPage(() => import("@/pages/general/certificates"), "CertificatesPage");
const DnsPage = lazyPage(() => import("@/pages/general/dns"), "DnsPage");
const LogsPage = lazyPage(() => import("@/pages/web-server/logs"), "LogsPage");
const MetricsPage = lazyPage(() => import("@/pages/metrics"), "MetricsPage");
const MonitorsPage = lazyPage(() => import("@/pages/uptime/monitors"), "MonitorsPage");
const MonitorDetailPage = lazyPage(() => import("@/pages/uptime/monitor-detail"), "MonitorDetailPage");
const HeartbeatDetailPage = lazyPage(() => import("@/pages/uptime/heartbeat-detail"), "HeartbeatDetailPage");
const IncidentsPage = lazyPage(() => import("@/pages/uptime/incidents"), "IncidentsPage");
const HeartbeatsPage = lazyPage(() => import("@/pages/uptime/heartbeats"), "HeartbeatsPage");
const TagsPage = lazyPage(() => import("@/pages/uptime/tags"), "TagsPage");
const StatusPagesPage = lazyPage(() => import("@/pages/uptime/status-pages"), "StatusPagesPage");
const StatusPageEditorPage = lazyPage(() => import("@/pages/uptime/status-page-editor"), "StatusPageEditorPage");
const ProxiesPage = lazyPage(() => import("@/pages/uptime/proxies"), "ProxiesPage");
const MaintenancesPage = lazyPage(() => import("@/pages/uptime/maintenances"), "MaintenancesPage");
const NotificationsPage = lazyPage(() => import("@/pages/uptime/notifications"), "NotificationsPage");
const UsersPage = lazyPage(() => import("@/pages/users"), "UsersPage");
const RolesPage = lazyPage(() => import("@/pages/roles"), "RolesPage");
const ProfilePage = lazyPage(() => import("@/pages/profile"), "ProfilePage");

function PageFallback() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
      {t("app.loading")}
    </div>
  );
}

function ProtectedRoute() {
  const { authenticated, ready } = useAuth();
  const { t } = useI18n();
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t("app.loading")}
      </div>
    );
  }
  return authenticated ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Guarda de rota por permissão: sem o acesso exigido, volta para a home. */
function PermRoute({ resource, action }: { resource: string; action: "read" | "write" }) {
  const { can } = useAuth();
  return can(resource, action) ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="servers" element={<ServersPage />} />
            <Route path="upstreams" element={<UpstreamsPage />} />
            <Route path="streams" element={<StreamsPage />} />
            <Route path="rtmp" element={<RtmpPage />} />
            <Route element={<PermRoute resource="deploy" action="read" />}>
              {/* deployments migraram p/ a aba dentro do serviço (/projects/:id/services/:sid) */}
              <Route path="deploy" element={<Navigate to="/projects" replace />} />
              <Route path="deployments" element={<Navigate to="/projects" replace />} />
              <Route path="git-providers" element={<Navigate to="/cicd/settings" replace />} />
              <Route path="cicd/settings" element={<CicdSettingsPage />} />
            </Route>
            <Route element={<PermRoute resource="docker" action="read" />}>
              <Route path="docker" element={<Navigate to="/docker/containers" replace />} />
              <Route path="docker/containers" element={<DockerPage />} />
              <Route path="docker/images" element={<DockerImagesPage />} />
              <Route path="docker/volumes" element={<DockerVolumesPage />} />
              <Route path="docker/networks" element={<DockerNetworksPage />} />
              <Route path="docker/container/:name" element={<DockerContainerPage />} />
              <Route path="docker/image/:id" element={<DockerImageDetailPage />} />
              <Route path="docker/volume/:name" element={<DockerVolumeDetailPage />} />
              <Route path="docker/network/:name" element={<DockerNetworkDetailPage />} />
            </Route>
            <Route element={<PermRoute resource="projects" action="read" />}>
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="projects/:id/services/:sid/*" element={<ServiceDetailPage />} />
            </Route>
            <Route element={<PermRoute resource="monitors" action="read" />}>
              <Route path="uptime" element={<Navigate to="/monitors" replace />} />
              <Route path="monitors" element={<MonitorsPage />} />
              <Route path="monitors/:id" element={<MonitorDetailPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="heartbeats" element={<HeartbeatsPage />} />
              <Route path="heartbeats/:id" element={<HeartbeatDetailPage />} />
              <Route path="tags" element={<TagsPage />} />
              <Route path="status-pages" element={<StatusPagesPage />} />
              <Route path="status-pages/:id" element={<StatusPageEditorPage />} />
              <Route path="proxies" element={<ProxiesPage />} />
              <Route path="maintenances" element={<MaintenancesPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
            <Route path="certificates" element={<CertificatesPage />} />
            <Route path="dns" element={<DnsPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route element={<PermRoute resource="users" action="read" />}>
              <Route path="users" element={<UsersPage />} />
              <Route path="users/roles" element={<RolesPage />} />
            </Route>
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
