"""Canais de notificação dos monitores (healthcheck).

Suporta: webhook, telegram, discord, email (SMTP), slack, microsoft teams.
Campos por tipo ficam no JSON `config`; segredos (tokens/senhas/URLs de webhook)
são **mascarados** nas respostas e um valor vazio/mascarado no PUT mantém o valor
salvo (mesmo padrão de `s3configs.py`).

Os envios usam só stdlib (`urllib` p/ HTTP, `smtplib` p/ e-mail).
"""
from __future__ import annotations

import json
import smtplib
import ssl
import time
from email.message import EmailMessage
import urllib.request

from .db import get_session
from .db.models import NotificationChannel

MASK = "********"
TYPES = ("webhook", "telegram", "discord", "email", "slack", "teams")

# Campos de segredo por tipo (mascarados nas respostas; vazio/mascarado mantém).
_SECRETS: dict[str, tuple[str, ...]] = {
    "telegram": ("bot_token",),
    "email": ("password",),
    "discord": ("webhook_url",),
    "slack": ("webhook_url",),
    "teams": ("webhook_url",),
    "webhook": (),
}

_HTTP_TIMEOUT = 10


class NotificationError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


# --- validação ---------------------------------------------------------------

def _req(cfg: dict, field: str, label: str) -> str:
    val = str(cfg.get(field, "")).strip()
    if not val:
        raise NotificationError(f"{label} é obrigatório")
    return val


def _url(cfg: dict, field: str, label: str) -> str:
    val = _req(cfg, field, label)
    if not (val.startswith("http://") or val.startswith("https://")):
        raise NotificationError(f"{label} deve começar com http:// ou https://")
    return val


def _keep_secret(field: str, incoming, prev: dict) -> str:
    val = "" if incoming is None else str(incoming)
    return str(prev.get(field, "")) if val in ("", MASK) else val


def _secret_url(cfg: dict, field: str, label: str, prev: dict) -> str:
    """Resolve um webhook_url secreto (mantém o anterior se vazio/mascarado) e valida."""
    url = _keep_secret(field, cfg.get(field), prev)
    if not url:
        raise NotificationError(f"{label} é obrigatório")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise NotificationError(f"{label} deve começar com http:// ou https://")
    return url


def _validate(ctype: str, cfg: dict, prev: dict | None) -> dict:
    prev = prev or {}
    if ctype == "webhook":
        method = str(cfg.get("method", "POST")).strip().upper()
        if method not in ("POST", "GET", "PUT"):
            raise NotificationError("método inválido (use POST, GET ou PUT)")
        return {"url": _url(cfg, "url", "URL"), "method": method}
    if ctype == "telegram":
        token = _keep_secret("bot_token", cfg.get("bot_token"), prev)
        if not token:
            raise NotificationError("Bot token é obrigatório")
        return {"bot_token": token, "chat_id": _req(cfg, "chat_id", "Chat ID")}
    if ctype == "discord":
        return {"webhook_url": _secret_url(cfg, "webhook_url", "URL do webhook", prev),
                "username": str(cfg.get("username", "")).strip()}
    if ctype == "slack":
        return {"webhook_url": _secret_url(cfg, "webhook_url", "URL do webhook", prev),
                "channel": str(cfg.get("channel", "")).strip()}
    if ctype == "teams":
        return {"webhook_url": _secret_url(cfg, "webhook_url", "URL do webhook", prev)}
    if ctype == "email":
        try:
            port = int(cfg.get("port", 587))
        except (TypeError, ValueError):
            raise NotificationError("porta deve ser inteiro")
        return {
            "host": _req(cfg, "host", "Servidor SMTP"),
            "port": port,
            "username": str(cfg.get("username", "")).strip(),
            "password": _keep_secret("password", cfg.get("password"), prev),
            "from": _req(cfg, "from", "Remetente"),
            "to": _req(cfg, "to", "Destinatário(s)"),
            "tls": bool(cfg.get("tls", True)),
        }
    raise NotificationError(f"tipo inválido (use: {', '.join(TYPES)})")


# --- máscara / serialização --------------------------------------------------

def _mask(ctype: str, config: dict) -> dict:
    cfg = dict(config)
    for field in _SECRETS.get(ctype, ()):
        if cfg.get(field):
            cfg[field] = MASK
    return cfg


def _json(row: NotificationChannel) -> dict:
    try:
        config = json.loads(row.config)
    except (TypeError, ValueError, json.JSONDecodeError):
        config = {}
    return {
        "id": row.id, "name": row.name, "type": row.type,
        "enabled": bool(row.enabled), "config": _mask(row.type, config),
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }


# --- CRUD --------------------------------------------------------------------

def list_channels(*, search="", type_filter="", page=None, limit=50):
    from .monitors import paginate
    with get_session() as s:
        rows = s.query(NotificationChannel).order_by(NotificationChannel.name.asc()).all()
        items = [_json(r) for r in rows]
    if type_filter:
        items = [c for c in items if c["type"] == type_filter]
    term = (search or "").strip().lower()
    if term:
        items = [c for c in items if term in f"{c['name']} {c['type']}".lower()]
    if page is None:
        return items
    return paginate(items, page, limit)


def get_channel(channel_id: int) -> dict:
    with get_session() as s:
        row = s.get(NotificationChannel, channel_id)
        if row is None:
            raise NotificationError("canal não encontrado", status=404)
        return _json(row)


def create_channel(payload: dict) -> dict:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise NotificationError("nome é obrigatório")
    ctype = str(payload.get("type", "")).strip().lower()
    if ctype not in TYPES:
        raise NotificationError(f"tipo inválido (use: {', '.join(TYPES)})")
    config = _validate(ctype, payload.get("config") or {}, None)
    now = _now_ms()
    with get_session() as s:
        row = NotificationChannel(name=name, type=ctype, config=json.dumps(config),
                                  enabled=bool(payload.get("enabled", True)),
                                  created_ts=now, updated_ts=now)
        s.add(row)
        s.commit()
        s.refresh(row)
        return _json(row)


def update_channel(channel_id: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(NotificationChannel, channel_id)
        if row is None:
            raise NotificationError("canal não encontrado", status=404)
        try:
            prev = json.loads(row.config)
        except (TypeError, ValueError, json.JSONDecodeError):
            prev = {}
        if payload.get("name") is not None:
            name = str(payload["name"]).strip()
            if not name:
                raise NotificationError("nome é obrigatório")
            row.name = name
        if payload.get("config") is not None:
            row.config = json.dumps(_validate(row.type, payload["config"] or {}, prev))
        if payload.get("enabled") is not None:
            row.enabled = bool(payload["enabled"])
        row.updated_ts = _now_ms()
        s.commit()
        s.refresh(row)
        return _json(row)


def delete_channel(channel_id: int) -> None:
    with get_session() as s:
        row = s.get(NotificationChannel, channel_id)
        if row is None:
            raise NotificationError("canal não encontrado", status=404)
        s.delete(row)
        s.commit()


# --- envio -------------------------------------------------------------------

def _post_json(url: str, payload: dict, method: str = "POST") -> None:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT):
        pass


def _send(ctype: str, config: dict, subject: str, message: str) -> None:
    text = f"{subject}\n{message}" if subject else message
    if ctype == "webhook":
        _post_json(config["url"], {"subject": subject, "message": message},
                   method=config.get("method", "POST"))
    elif ctype == "telegram":
        url = f"https://api.telegram.org/bot{config['bot_token']}/sendMessage"
        _post_json(url, {"chat_id": config["chat_id"], "text": text})
    elif ctype == "discord":
        body: dict = {"content": text}
        if config.get("username"):
            body["username"] = config["username"]
        _post_json(config["webhook_url"], body)
    elif ctype == "slack":
        body = {"text": text}
        if config.get("channel"):
            body["channel"] = config["channel"]
        _post_json(config["webhook_url"], body)
    elif ctype == "teams":
        _post_json(config["webhook_url"], {
            "@type": "MessageCard", "@context": "https://schema.org/extensions",
            "summary": subject or "Monitor", "title": subject, "text": message,
        })
    elif ctype == "email":
        _send_email(config, subject, message)
    else:
        raise NotificationError(f"tipo não suportado: {ctype}")


def _send_email(config: dict, subject: str, message: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject or "Monitor"
    msg["From"] = config["from"]
    recipients = [a.strip() for a in str(config["to"]).split(",") if a.strip()]
    msg["To"] = ", ".join(recipients)
    msg.set_content(message)
    with smtplib.SMTP(config["host"], int(config.get("port", 587)), timeout=_HTTP_TIMEOUT) as smtp:
        if config.get("tls", True):
            smtp.starttls(context=ssl.create_default_context())
        if config.get("username"):
            smtp.login(config["username"], config.get("password", ""))
        smtp.send_message(msg, to_addrs=recipients)


_TEST_SUBJECT = "🔔 Teste de notificação"
_TEST_BODY = "Este é um teste do canal de notificação do Holtz Nexus."


def test_channel(channel_id: int) -> None:
    """Envia uma mensagem de teste pelo canal (levanta NotificationError se falhar)."""
    with get_session() as s:
        row = s.get(NotificationChannel, channel_id)
        if row is None:
            raise NotificationError("canal não encontrado", status=404)
        ctype, config = row.type, json.loads(row.config)
    _try_send(ctype, config)


def test_config(payload: dict) -> None:
    """Testa uma configuração ainda não salva (ou em edição). Se `id` vier no
    payload, segredos vazios/mascarados herdam do canal existente."""
    ctype = str(payload.get("type", "")).strip().lower()
    if ctype not in TYPES:
        raise NotificationError(f"tipo inválido (use: {', '.join(TYPES)})")
    prev: dict = {}
    cid = payload.get("id")
    if cid:
        with get_session() as s:
            row = s.get(NotificationChannel, int(cid))
            if row is not None:
                try:
                    prev = json.loads(row.config)
                except (TypeError, ValueError, json.JSONDecodeError):
                    prev = {}
    config = _validate(ctype, payload.get("config") or {}, prev)
    _try_send(ctype, config)


def _try_send(ctype: str, config: dict) -> None:
    try:
        _send(ctype, config, _TEST_SUBJECT, _TEST_BODY)
    except NotificationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise NotificationError(f"falha ao enviar: {exc}", status=502)


def broadcast(subject: str, message: str, channel_ids: list[int] | None = None) -> None:
    """Envia a mensagem aos canais habilitados (best-effort).

    `channel_ids=None` → todos os canais habilitados. Uma **lista** restringe aos
    canais informados (lista vazia = não envia — monitor sem canal vinculado).
    """
    if channel_ids is not None and not channel_ids:
        return
    with get_session() as s:
        q = s.query(NotificationChannel).filter(NotificationChannel.enabled == True)  # noqa: E712
        if channel_ids is not None:
            q = q.filter(NotificationChannel.id.in_(channel_ids))
        rows = q.all()
        targets = [(r.id, r.type, r.config) for r in rows]
    for cid, ctype, raw in targets:
        try:
            _send(ctype, json.loads(raw), subject, message)
        except Exception as exc:  # noqa: BLE001 — uma notificação nunca derruba o motor
            print(f"notifications: falha no canal {cid} ({ctype}): {exc}", flush=True)
