"""Status pages: páginas públicas de status (Uptime).

Cada página é renderizada como **HTML self-contained** numa rota pública
(`GET /status/{slug}`, sem auth — ver `api/routers/statuspages.py` +
`api/authz.py::_PUBLIC_PREFIXES`). A página só expõe dados **não sensíveis** dos
monitores selecionados (nome de exibição, status atual, uptime% e histórico
up/down) — nunca o target/host/config/auth do monitor.

Opcionalmente gera um **server block nginx próprio** (padrão available/enabled,
arquivo `statuspage-<id>-<slug>.conf`) que faz `proxy_pass` para a rota pública,
tornando a página acessível num domínio dedicado (com TLS se um cert for escolhido).
"""
from __future__ import annotations

import html
import json
import os
import re
import secrets
import time

from . import certs, monitors
from .config import store as config_store
from .config.parser import parse
from .db import get_session
from .db.models import Monitor, MonitorIncident, MonitorIncidentUpdate, StatusPage

API_PORT = os.environ.get("API_PORT", "3001")

_MANAGED_RE = re.compile(r"^statuspage-(\d+)-[a-z0-9-]+\.conf$")
_SLUG_RE = re.compile(r"[^a-z0-9-]+")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")


class StatusPageError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


def slugify(value: str) -> str:
    slug = _SLUG_RE.sub("-", (value or "").strip().lower()).strip("-")
    return slug[:80] or secrets.token_hex(4)


# --- serialização (admin) ----------------------------------------------------

def _monitor_ids(row: StatusPage) -> list[int]:
    try:
        ids = json.loads(row.monitor_ids or "[]")
        return [int(i) for i in ids]
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


def _page_json(row: StatusPage) -> dict:
    return {
        "id": row.id, "slug": row.slug, "title": row.title,
        "description": row.description, "logo_url": row.logo_url,
        "banner": row.banner, "accent_color": row.accent_color,
        "custom_css": row.custom_css, "custom_js": row.custom_js,
        "monitor_ids": _monitor_ids(row),
        "show_incidents": bool(row.show_incidents),
        "show_maintenance": bool(row.show_maintenance),
        "published": bool(row.published),
        "domain": row.domain, "cert_name": row.cert_name,
        "server_file": row.server_file,
        "public_path": f"/status/{row.slug}",
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }


def list_pages(*, search="", page=None, limit=50):
    with get_session() as s:
        rows = s.query(StatusPage).order_by(StatusPage.title.asc(), StatusPage.slug.asc()).all()
        items = [_page_json(r) for r in rows]
    term = (search or "").strip().lower()
    if term:
        items = [p for p in items if term in f"{p['title']} {p['slug']} {p['domain']}".lower()]
    if page is None:
        return items
    return monitors.paginate(items, page, limit)


def get_page(page_id: int) -> dict:
    with get_session() as s:
        row = s.get(StatusPage, page_id)
        if row is None:
            raise StatusPageError("página não encontrada", status=404)
        return _page_json(row)


# --- validação / persistência ------------------------------------------------

def _valid_ids(payload: dict, s) -> str:
    raw = payload.get("monitor_ids", [])
    if not isinstance(raw, list):
        raise StatusPageError("monitor_ids deve ser uma lista")
    ids: list[int] = []
    for i in raw:
        try:
            ids.append(int(i))
        except (TypeError, ValueError):
            raise StatusPageError("monitor_ids inválido")
    if ids:
        found = {m.id for m in s.query(Monitor.id).filter(Monitor.id.in_(ids)).all()}
        missing = [i for i in ids if i not in found]
        if missing:
            raise StatusPageError(f"monitor(es) inexistente(s): {missing}")
    # remove duplicados preservando ordem
    seen: set[int] = set()
    return json.dumps([i for i in ids if not (i in seen or seen.add(i))])


def _accent(value: str) -> str:
    value = str(value or "").strip()
    if value and not _HEX_RE.fullmatch(value):
        raise StatusPageError("accent_color deve ser um hex (ex.: #2563eb)")
    return value


def _unique_slug(s, slug: str, exclude_id: int | None = None) -> str:
    base = slug
    n = 1
    while True:
        q = s.query(StatusPage.id).filter(StatusPage.slug == slug)
        if exclude_id is not None:
            q = q.filter(StatusPage.id != exclude_id)
        if q.first() is None:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _apply_fields(row: StatusPage, payload: dict, s) -> None:
    if "title" in payload:
        row.title = str(payload["title"]).strip()[:200]
    if "description" in payload:
        row.description = str(payload["description"]).strip()
    if "logo_url" in payload:
        row.logo_url = str(payload["logo_url"]).strip()
    if "banner" in payload:
        row.banner = str(payload["banner"]).strip()
    if "accent_color" in payload:
        row.accent_color = _accent(payload["accent_color"])
    if "custom_css" in payload:
        row.custom_css = str(payload["custom_css"])
    if "custom_js" in payload:
        row.custom_js = str(payload["custom_js"])
    if "monitor_ids" in payload:
        row.monitor_ids = _valid_ids(payload, s)
    if "show_incidents" in payload:
        row.show_incidents = bool(payload["show_incidents"])
    if "show_maintenance" in payload:
        row.show_maintenance = bool(payload["show_maintenance"])
    if "published" in payload:
        row.published = bool(payload["published"])
    if "cert_name" in payload:
        row.cert_name = str(payload["cert_name"]).strip()


def create_page(payload: dict) -> dict:
    title = str(payload.get("title", "")).strip()
    if not title:
        raise StatusPageError("título é obrigatório")
    now = _now_ms()
    with get_session() as s:
        slug = slugify(str(payload.get("slug") or title))
        slug = _unique_slug(s, slug)
        row = StatusPage(slug=slug, created_ts=now, updated_ts=now)
        _apply_fields(row, payload, s)
        row.domain = str(payload.get("domain", "")).strip().lower()
        s.add(row)
        s.flush()
        _sync_server(row)
        s.commit()
        s.refresh(row)
        return _page_json(row)


def update_page(page_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(StatusPage, page_id)
        if row is None:
            raise StatusPageError("página não encontrada", status=404)
        if payload.get("slug"):
            new_slug = _unique_slug(s, slugify(payload["slug"]), exclude_id=row.id)
            row.slug = new_slug
        _apply_fields(row, payload, s)
        if "domain" in payload:
            row.domain = str(payload["domain"]).strip().lower()
        row.updated_ts = _now_ms()
        _sync_server(row)
        s.commit()
        s.refresh(row)
        return _page_json(row)


def delete_page(page_id: int) -> None:
    with get_session() as s:
        row = s.get(StatusPage, page_id)
        if row is None:
            raise StatusPageError("página não encontrada", status=404)
        old = row.server_file
        s.delete(row)
        s.commit()
    if old:
        _remove_server(old)


# --- vínculo com o nginx (server block dedicado) -----------------------------

def _server_filename(row: StatusPage) -> str:
    return f"statuspage-{row.id}-{slugify(row.slug)}.conf"


def _build_server_conf(row: StatusPage) -> str:
    listen = "listen 80;"
    ssl_lines = ""
    if row.cert_name:
        cert = next((c for c in certs.list_certs() if c["name"] == row.cert_name), None)
        if cert is None:
            raise StatusPageError(f"certificado '{row.cert_name}' não encontrado")
        listen = "listen 80;\n    listen 443 ssl;"
        ssl_lines = (f"ssl_certificate {cert['cert_path']};\n"
                     f"    ssl_certificate_key {cert['key_path']};\n    ")
    target = f"http://127.0.0.1:{API_PORT}/status/{row.slug}"
    return (f"# nexus-managed-statuspage: {row.id}\n"
            f"server {{\n"
            f"    {listen}\n"
            f"    server_name {row.domain};\n"
            f"    {ssl_lines}location / {{\n"
            f"        proxy_pass {target};\n"
            f"        proxy_set_header Host $host;\n"
            f"        proxy_set_header X-Real-IP $remote_addr;\n"
            f"        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
            f"        proxy_set_header X-Forwarded-Proto $scheme;\n"
            f"    }}\n"
            f"}}\n")


def _sync_server(row: StatusPage) -> None:
    """Cria/atualiza/remove o server block conforme `domain`. Atualiza `server_file`."""
    old = row.server_file
    if not row.domain:
        row.server_file = ""
        if old:
            _remove_server(old)
        return
    filename = _server_filename(row)
    prefix = config_store.ConfigStore().prefix
    raw = _build_server_conf(row)
    target = prefix / "http-available" / filename
    conf = config_store.ConfFile(path=target, root=parse(raw), root_context="http")
    try:
        config_store.save_and_enable(prefix, "http", filename, conf)
    except config_store.ConfigError as exc:
        raise StatusPageError(str(exc), status=409) from exc
    row.server_file = filename
    if old and old != filename:
        _remove_server(old)
    _reload()


def _remove_server(filename: str) -> None:
    if not filename or not _MANAGED_RE.fullmatch(filename):
        return
    prefix = config_store.ConfigStore().prefix
    config_store.disable_resource(prefix, "http", filename)
    (prefix / "http-available" / filename).unlink(missing_ok=True)
    ok, output = config_store.nginx_test()
    if not ok:
        raise StatusPageError(f"nginx -t rejeitou a remoção:\n{output}", status=409)
    _reload()


def _reload() -> None:
    try:
        from . import nginxctl
        nginxctl.reload()
    except Exception:
        pass  # best-effort; o nginx -t já validou a config


# --- dados públicos (não sensíveis) ------------------------------------------

# nº de baldes do sparkline público (histórico up/down das últimas 24h).
_PUBLIC_POINTS = 40

_STATUS_RANK = {"down": 5, "degraded": 4, "maintenance": 3, "pending": 2, "up": 1, "": 0, None: 0}


def _public_monitor(mid: int) -> dict | None:
    with get_session() as s:
        row = s.get(Monitor, mid)
        if row is None or not row.active:
            return None
        name, status = row.name, row.status
    up = monitors.uptime(mid)
    chart = monitors.chart(mid, "24h")
    # só o status por balde — sem mensagens/latência (evita vazar erro interno).
    bars = [p["status"] for p in chart.get("points", [])][-_PUBLIC_POINTS:]
    return {"id": mid, "name": name, "status": status, "uptime": up, "bars": bars}


def _incident_public(row: MonitorIncident, updates: list[dict]) -> dict:
    return {
        "id": row.id, "title": row.title, "status": row.status,
        "severity": row.severity, "created_ts": row.created_ts,
        "resolved_ts": row.resolved_ts or None, "updates": updates,
    }


def _incidents_for(monitor_ids: list[int], maintenance: bool, limit: int = 20) -> list[dict]:
    """Incidentes das monitores selecionados. `maintenance=True` traz só os de
    severidade `maintenance`; `False` traz os demais."""
    if not monitor_ids:
        return []
    with get_session() as s:
        q = (s.query(MonitorIncident)
             .filter(MonitorIncident.monitor_id.in_(monitor_ids)))
        if maintenance:
            q = q.filter(MonitorIncident.severity == "maintenance")
        else:
            q = q.filter(MonitorIncident.severity != "maintenance")
        rows = q.order_by(MonitorIncident.created_ts.desc()).limit(limit).all()
        out = []
        for r in rows:
            ups = (s.query(MonitorIncidentUpdate)
                   .filter(MonitorIncidentUpdate.incident_id == r.id)
                   .order_by(MonitorIncidentUpdate.created_ts.desc()).all())
            out.append(_incident_public(r, [
                {"status": u.status, "message": u.message, "created_ts": u.created_ts}
                for u in ups]))
        return out


def public_data(slug: str) -> dict:
    with get_session() as s:
        row = s.query(StatusPage).filter(StatusPage.slug == slug).first()
        if row is None or not row.published:
            raise StatusPageError("página não encontrada", status=404)
        page = row
        mids = _monitor_ids(row)
        show_incidents = bool(row.show_incidents)
        show_maintenance = bool(row.show_maintenance)
    mons = [m for m in (_public_monitor(mid) for mid in mids) if m is not None]
    worst = max((_STATUS_RANK.get(m["status"], 0) for m in mons), default=0)
    overall = {5: "down", 4: "degraded", 3: "maintenance", 2: "pending", 1: "up", 0: "unknown"}[worst]
    return {
        "title": page.title or "Status", "description": page.description,
        "logo_url": page.logo_url, "banner": page.banner,
        "accent_color": page.accent_color,
        "overall": overall, "monitors": mons,
        "incidents": _incidents_for(mids, False) if show_incidents else [],
        "maintenance": _incidents_for(mids, True) if show_maintenance else [],
        "custom_css": page.custom_css, "custom_js": page.custom_js,
        "generated_ts": _now_ms(),
    }


# --- render HTML público -----------------------------------------------------

_SEVERITY_LABEL = {
    "operational": "Operacional", "degraded": "Desempenho degradado",
    "partial": "Interrupção parcial", "major": "Interrupção grave",
    "maintenance": "Manutenção",
}
_STATUS_LABEL = {
    "investigating": "Investigando", "identified": "Identificado",
    "monitoring": "Monitorando", "resolved": "Resolvido",
}
_OVERALL = {
    "up": ("Todos os sistemas operacionais", "#16a34a"),
    "degraded": ("Desempenho degradado", "#d97706"),
    "maintenance": ("Em manutenção", "#2563eb"),
    "down": ("Interrupção em andamento", "#dc2626"),
    "pending": ("Verificando…", "#d97706"),
    "unknown": ("Sem dados", "#6b7280"),
}
_MON_COLOR = {"up": "#16a34a", "degraded": "#d97706", "maintenance": "#2563eb",
              "down": "#dc2626", "pending": "#d97706", "partial": "#d97706",
              "": "#9ca3af", None: "#9ca3af"}


def _e(v) -> str:
    return html.escape(str(v or ""), quote=True)


def _css_safe(v: str) -> str:
    # impede quebrar do <style>/injeção acidental (não é fronteira contra o dono).
    return re.sub(r"</\s*style", "<\\/style", str(v or ""), flags=re.IGNORECASE)


def _js_safe(v: str) -> str:
    return re.sub(r"</\s*script", "<\\/script", str(v or ""), flags=re.IGNORECASE)


def _fmt_ts(ts: int) -> str:
    if not ts:
        return ""
    return time.strftime("%d/%m/%Y %H:%M", time.localtime(ts / 1000))


def _bars_html(bars: list[str]) -> str:
    cells = "".join(
        f'<span class="bar" style="background:{_MON_COLOR.get(b, "#9ca3af")}"></span>'
        for b in bars)
    return f'<div class="bars">{cells}</div>'


def _uptime_html(up: dict) -> str:
    def pct(v):
        return f"{v:.2f}%" if isinstance(v, (int, float)) else "—"
    return (f'<div class="uptimes">'
            f'<span title="24h">{pct(up.get("h24"))}</span>'
            f'<span title="30d">{pct(up.get("d30"))}</span>'
            f'<span title="1a">{pct(up.get("y1"))}</span></div>')


def _incidents_html(items: list[dict], heading: str) -> str:
    if not items:
        return ""
    rows = []
    for it in items:
        ups = "".join(
            f'<li><span class="u-status">{_e(_STATUS_LABEL.get(u["status"], u["status"]))}</span>'
            f'<span class="u-time">{_e(_fmt_ts(u["created_ts"]))}</span>'
            f'{("<p>" + _e(u["message"]) + "</p>") if u["message"] else ""}</li>'
            for u in it.get("updates", []))
        resolved = it["status"] == "resolved"
        rows.append(
            f'<article class="incident {"resolved" if resolved else "open"}">'
            f'<header><span class="sev sev-{_e(it["severity"])}">{_e(_SEVERITY_LABEL.get(it["severity"], it["severity"]))}</span>'
            f'<h3>{_e(it["title"])}</h3>'
            f'<span class="i-status">{_e(_STATUS_LABEL.get(it["status"], it["status"]))}</span></header>'
            f'<ol class="timeline">{ups}</ol></article>')
    return f'<section class="incidents"><h2>{_e(heading)}</h2>{"".join(rows)}</section>'


def render_html(slug: str) -> str:
    data = public_data(slug)
    accent = data["accent_color"] if _HEX_RE.fullmatch(data["accent_color"] or "") else "#2563eb"
    overall_label, overall_color = _OVERALL.get(data["overall"], _OVERALL["unknown"])

    logo = (f'<img class="logo" src="{_e(data["logo_url"])}" alt="logo">'
            if data["logo_url"] else "")
    banner = (f'<div class="banner">{_e(data["banner"])}</div>'
              if data["banner"] else "")

    mon_rows = "".join(
        f'<div class="monitor">'
        f'<div class="m-head"><span class="dot" style="background:{_MON_COLOR.get(m["status"], "#9ca3af")}"></span>'
        f'<span class="m-name">{_e(m["name"])}</span>'
        f'{_uptime_html(m["uptime"])}</div>'
        f'{_bars_html(m["bars"])}</div>'
        for m in data["monitors"])
    if not data["monitors"]:
        mon_rows = '<p class="empty">Nenhum monitor selecionado.</p>'

    incidents = _incidents_html(data["incidents"], "Incidentes")
    maintenance = _incidents_html(data["maintenance"], "Manutenções")

    base_css = """
:root{--accent:%(accent)s;--bg:#f8fafc;--card:#fff;--fg:#0f172a;--muted:#64748b;--border:#e2e8f0}
@media(prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--fg:#e5e7eb;--muted:#94a3b8;--border:#1f2937}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5}
.wrap{max-width:820px;margin:0 auto;padding:2rem 1rem}
header.top{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem}
.logo{height:40px;width:auto}h1{font-size:1.4rem;margin:0}
.banner{background:color-mix(in srgb,var(--accent) 12%%,transparent);border:1px solid var(--accent);color:var(--fg);padding:.75rem 1rem;border-radius:.6rem;margin-bottom:1.25rem}
.overall{display:flex;align-items:center;gap:.6rem;background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem 1.25rem;margin-bottom:1.5rem;font-weight:600}
.overall .pill{width:12px;height:12px;border-radius:50%%}
.monitor{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:.9rem 1.1rem;margin-bottom:.6rem}
.m-head{display:flex;align-items:center;gap:.6rem}.m-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:10px;height:10px;border-radius:50%%;flex:none}
.uptimes{display:flex;gap:.6rem;font-size:.8rem;color:var(--muted)}
.bars{display:flex;gap:2px;margin-top:.6rem;height:26px;align-items:flex-end}
.bar{flex:1;min-width:2px;height:100%%;border-radius:2px;opacity:.85}
.empty{color:var(--muted);text-align:center;padding:2rem}
h2{font-size:1.05rem;margin:1.75rem 0 .75rem}
.incident{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:.6rem;padding:.85rem 1rem;margin-bottom:.7rem}
.incident.resolved{border-left-color:#16a34a;opacity:.85}
.incident header{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}.incident h3{font-size:1rem;margin:0;flex:1}
.sev{font-size:.72rem;font-weight:600;padding:.1rem .5rem;border-radius:1rem;background:color-mix(in srgb,var(--accent) 15%%,transparent)}
.sev-major{background:#fee2e2;color:#b91c1c}.sev-partial,.sev-degraded{background:#fef3c7;color:#92400e}
.sev-operational{background:#dcfce7;color:#166534}.sev-maintenance{background:#dbeafe;color:#1e40af}
.i-status{font-size:.78rem;color:var(--muted)}
.timeline{list-style:none;margin:.6rem 0 0;padding:0;border-left:2px solid var(--border)}
.timeline li{padding:.15rem 0 .5rem .8rem;position:relative}
.timeline li:before{content:"";position:absolute;left:-5px;top:.5rem;width:8px;height:8px;border-radius:50%%;background:var(--accent)}
.u-status{font-weight:600;font-size:.85rem;margin-right:.5rem}.u-time{font-size:.75rem;color:var(--muted)}
.timeline p{margin:.2rem 0 0;font-size:.88rem;color:var(--muted);white-space:pre-wrap}
footer{margin-top:2.5rem;text-align:center;color:var(--muted);font-size:.75rem}
""" % {"accent": accent}

    html_doc = f"""<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>{_e(data["title"])}</title>
<style>{base_css}</style>
<style>{_css_safe(data["custom_css"])}</style>
</head>
<body>
<div class="wrap">
<header class="top">{logo}<h1>{_e(data["title"])}</h1></header>
{banner}
<div class="overall"><span class="pill" style="background:{overall_color}"></span>{_e(overall_label)}</div>
<section class="monitors">{mon_rows}</section>
{incidents}
{maintenance}
<footer>Atualizado em {_e(_fmt_ts(data["generated_ts"]))}</footer>
</div>
<script>setTimeout(function(){{location.reload()}},60000);</script>
<script>{_js_safe(data["custom_js"])}</script>
</body>
</html>"""
    return html_doc
