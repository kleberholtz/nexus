export type StatusPage = {
  id: number;
  slug: string;
  title: string;
  description: string;
  logo_url: string;
  banner: string;
  accent_color: string;
  custom_css: string;
  custom_js: string;
  monitor_ids: number[];
  show_incidents: boolean;
  show_maintenance: boolean;
  published: boolean;
  domain: string;
  cert_name: string;
  server_file: string;
  public_path: string;
  created_ts: number;
  updated_ts: number;
};

export type StatusPageForm = Omit<
  StatusPage,
  "id" | "server_file" | "public_path" | "created_ts" | "updated_ts"
>;

export function emptyStatusPage(): StatusPageForm {
  return {
    slug: "",
    title: "",
    description: "",
    logo_url: "",
    banner: "",
    accent_color: "",
    custom_css: "",
    custom_js: "",
    monitor_ids: [],
    show_incidents: true,
    show_maintenance: true,
    published: true,
    domain: "",
    cert_name: "",
  };
}
