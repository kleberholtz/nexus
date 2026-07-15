"""Catálogo global de proxies reutilizáveis pelos monitores HTTP."""
from __future__ import annotations
import json
import time
from .db import get_session
from .db.models import Monitor, MonitorProxy
from .monitors import MASK, MonitorError, paginate

PROTOCOLS = ("http", "https", "socks4", "socks5", "socks5h")

def _now_ms(): return int(time.time() * 1000)

def _json(row: MonitorProxy, reveal=False):
    return {"id": row.id, "protocol": row.protocol, "server": row.server, "port": row.port,
            "username": row.username, "password": row.password if reveal or not row.password else MASK,
            "enabled": row.enabled, "created_ts": row.created_ts, "updated_ts": row.updated_ts}

def _fields(payload, previous=None):
    protocol = str(payload.get("protocol", previous.protocol if previous else "http")).lower().strip()
    if protocol not in PROTOCOLS: raise MonitorError(f"protocolo inválido (use: {', '.join(PROTOCOLS)})")
    server = str(payload.get("server", previous.server if previous else "")).strip()
    if not server: raise MonitorError("servidor proxy é obrigatório")
    try: port = int(payload.get("port", previous.port if previous else 0))
    except (TypeError, ValueError): raise MonitorError("porta do proxy deve ser inteira")
    if not 1 <= port <= 65535: raise MonitorError("porta do proxy deve estar entre 1 e 65535")
    password = str(payload.get("password", previous.password if previous else ""))
    if previous and password == MASK: password = previous.password
    return {"protocol": protocol, "server": server, "port": port,
            "username": str(payload.get("username", previous.username if previous else "")),
            "password": password, "enabled": bool(payload.get("enabled", previous.enabled if previous else True))}

def _ensure_unique(s, fields, exclude_id=None):
    """O trio (protocolo, servidor, porta) é único no catálogo."""
    q = s.query(MonitorProxy.id).filter(
        MonitorProxy.protocol == fields["protocol"],
        MonitorProxy.server == fields["server"],
        MonitorProxy.port == fields["port"])
    if exclude_id is not None:
        q = q.filter(MonitorProxy.id != exclude_id)
    if q.first():
        raise MonitorError(
            f"proxy duplicado: {fields['protocol']}://{fields['server']}:{fields['port']} já existe",
            status=409)

def list_all(reveal=False, *, search="", page=None, limit=50):
    with get_session() as s:
        items = [_json(r, reveal) for r in s.query(MonitorProxy).order_by(MonitorProxy.id).all()]
    term = (search or "").strip().lower()
    if term:
        items = [p for p in items if term in f"{p['protocol']} {p['server']}:{p['port']} {p['username']}".lower()]
    if page is None:
        return items
    return paginate(items, page, limit)

def create(payload):
    with get_session() as s:
        previous = s.get(MonitorProxy, int(payload["copy_from_id"])) if payload.get("copy_from_id") else None
        if payload.get("copy_from_id") and previous is None: raise MonitorError("proxy original não encontrado", status=404)
        fields = _fields(payload, previous)
        _ensure_unique(s, fields)
        now = _now_ms(); row = MonitorProxy(created_ts=now, updated_ts=now, **fields); s.add(row); s.commit(); s.refresh(row); return _json(row)

def update(proxy_id, payload):
    with get_session() as s:
        row = s.get(MonitorProxy, proxy_id)
        if not row: raise MonitorError("proxy não encontrado", status=404)
        fields = _fields(payload, row)
        _ensure_unique(s, fields, exclude_id=proxy_id)
        for k,v in fields.items(): setattr(row,k,v)
        row.updated_ts=_now_ms(); s.commit(); s.refresh(row); return _json(row)

def delete(proxy_id):
    with get_session() as s:
        row=s.get(MonitorProxy,proxy_id)
        if not row: raise MonitorError("proxy não encontrado",status=404)
        s.delete(row)
        for monitor in s.query(Monitor).all():
            try: config=json.loads(monitor.config)
            except (TypeError,ValueError,json.JSONDecodeError): continue
            ids=config.get("proxy_ids",[])
            if proxy_id in ids:
                config["proxy_ids"]=[value for value in ids if value != proxy_id]
                monitor.config=json.dumps(config,ensure_ascii=False)
        s.commit()

def test_config(payload):
    proxy_payload=payload.get("proxy") or {}; previous=None
    source_id = proxy_payload.get("id") or proxy_payload.get("copy_from_id")
    if source_id:
        with get_session() as s:
            previous=s.get(MonitorProxy,int(source_id))
            if not previous: raise MonitorError("proxy não encontrado",status=404)
            s.expunge(previous)
    proxy=_fields(proxy_payload,previous); config=payload.get("config") or {}
    try: timeout=float(payload.get("timeout_seconds",10))
    except (TypeError,ValueError): timeout=10
    from .monitorworker import check_http
    result=check_http({**config,"_proxy":proxy},timeout)
    if result.get("reason")=="proxy_failure": raise MonitorError(f"teste do proxy falhou: {result.get('message') or 'sem resposta'}",status=400)
    return {"ok":True,"target_ok":bool(result.get("ok")),"code":result.get("code",""),"latency_ms":result.get("latency_ms",0),"message":result.get("message","")}
