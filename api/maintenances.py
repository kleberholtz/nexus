"""Store/lógica das Janelas de Manutenção (Uptime).

Uma manutenção agenda uma janela em que os monitores selecionados **não são
checados** pelo motor (`api/monitorworker.py`), evitando falsos down e
notificações. As estratégias (`strategy`) e seus campos (no JSON `config`):

- ``manual``            — ativo enquanto `active` estiver ligado (sem janela).
- ``single``            — janela única ``{start, end}`` (datetime no fuso).
- ``recurring_interval``— a cada ``interval_days`` dias, na faixa de horário
                          ``{time_start, time_end}`` do dia.
- ``recurring_weekday`` — nos dias da semana ``weekdays[]`` (0=domingo..6=sábado),
                          na faixa de horário do dia.
- ``recurring_dayofmonth`` — nos dias do mês ``days_of_month[]``, na faixa do dia.
- ``cron``              — ``{cron, duration_minutes}``: cada disparo do cron abre
                          uma janela de ``duration_minutes``.

Estratégias recorrentes/cron aceitam ``effective_start``/``effective_end``
(datetimes, opcionais): fora dessa faixa a recorrência não vale. Datas/horas são
interpretadas no fuso ``timezone`` (IANA, ex.: ``America/Sao_Paulo``).
"""
from __future__ import annotations

import json
import time
from datetime import datetime, time as dtime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .db import get_session
from .db.models import Maintenance, Monitor

STRATEGIES = (
    "manual", "single", "recurring_interval",
    "recurring_weekday", "recurring_dayofmonth", "cron",
)
RECURRING = ("recurring_interval", "recurring_weekday", "recurring_dayofmonth", "cron")
CRON_MAX_DURATION_MIN = 1440  # 24h (limita o scan de minutos do matcher)


class MaintenanceError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


# --------------------------------------------------------------------------- #
# Parsing de fuso/data/hora
# --------------------------------------------------------------------------- #
def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise MaintenanceError(f"fuso horário inválido: {name!r}")


def _parse_dt(value, tz: ZoneInfo) -> datetime | None:
    """`YYYY-MM-DD HH:MM` (ou com `T`) → datetime aware no fuso. Vazio → None."""
    value = str(value or "").strip().replace("T", " ")
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=tz)
        except ValueError:
            continue
    raise MaintenanceError(f"data/hora inválida: {value!r} (use YYYY-MM-DD HH:MM)")


def _parse_time(value) -> dtime:
    value = str(value or "").strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            t = datetime.strptime(value, fmt).time()
            return t
        except ValueError:
            continue
    raise MaintenanceError(f"horário inválido: {value!r} (use HH:MM)")


# --------------------------------------------------------------------------- #
# Cron (matcher stdlib: * , - / ; dow 0/7=domingo)
# --------------------------------------------------------------------------- #
def _field_match(field: str, value: int, lo: int, hi: int) -> bool:
    for part in str(field).split(","):
        part = part.strip()
        if not part:
            continue
        step = 1
        rng = part
        if "/" in part:
            rng, step_s = part.split("/", 1)
            step = int(step_s)
            if step <= 0:
                raise ValueError("passo inválido")
        if rng == "*":
            start, end = lo, hi
        elif "-" in rng:
            a, b = rng.split("-", 1)
            start, end = int(a), int(b)
        else:
            v = int(rng)
            start = end = v
        if value < start or value > end:
            continue
        if (value - start) % step == 0:
            return True
    return False


def _cron_matches(cron: str, dt: datetime) -> bool:
    parts = str(cron).split()
    if len(parts) != 5:
        raise ValueError("cron deve ter 5 campos (min hora dia mês dia-semana)")
    minute, hour, dom, month, dow = parts
    sun0 = (dt.weekday() + 1) % 7  # Mon=0..Sun=6 → 0=domingo..6=sábado
    if not _field_match(minute, dt.minute, 0, 59):
        return False
    if not _field_match(hour, dt.hour, 0, 23):
        return False
    if not _field_match(month, dt.month, 1, 12):
        return False
    dom_ok = _field_match(dom, dt.day, 1, 31)
    dow_ok = _field_match(dow, sun0, 0, 7) or (sun0 == 0 and _field_match(dow, 7, 0, 7))
    if dom.strip() == "*" or dow.strip() == "*":
        return dom_ok and dow_ok
    return dom_ok or dow_ok


def _validate_cron(cron: str) -> None:
    try:
        _cron_matches(cron, datetime(2000, 1, 1, 0, 0))
    except ValueError as exc:
        raise MaintenanceError(f"expressão cron inválida: {exc}")


# --------------------------------------------------------------------------- #
# Janela ativa
# --------------------------------------------------------------------------- #
def _in_effective(cfg: dict, tz: ZoneInfo, now: datetime) -> bool:
    start = _parse_dt(cfg.get("effective_start"), tz)
    end = _parse_dt(cfg.get("effective_end"), tz)
    if start and now < start:
        return False
    if end and now >= end:
        return False
    return True


def _in_daily_window(now: datetime, t_start: dtime, t_end: dtime, day_matches) -> bool:
    """`now` está numa janela diária [t_start, t_end] cujo dia de início casa com
    `day_matches(date)`? Suporta janela que vira o dia (t_end <= t_start)."""
    overnight = (t_end <= t_start)
    for base in (now.date(), now.date() - timedelta(days=1)):
        if not day_matches(base):
            continue
        start_dt = datetime.combine(base, t_start, tzinfo=now.tzinfo)
        end_dt = datetime.combine(base, t_end, tzinfo=now.tzinfo)
        if overnight:
            end_dt += timedelta(days=1)
        if start_dt <= now < end_dt:
            return True
    return False


def _is_active(row: Maintenance, now: datetime) -> bool:
    strategy = row.strategy
    if strategy == "manual":
        return True
    cfg = _config(row)
    tz = now.tzinfo
    if strategy == "single":
        start = _parse_dt(cfg.get("start"), tz)
        end = _parse_dt(cfg.get("end"), tz)
        return bool(start and end and start <= now < end)

    if not _in_effective(cfg, tz, now):
        return False

    if strategy == "cron":
        cron = str(cfg.get("cron", "")).strip()
        if not cron:
            return False
        duration = int(cfg.get("duration_minutes") or 0)
        duration = max(1, min(duration, CRON_MAX_DURATION_MIN))
        anchor = now.replace(second=0, microsecond=0)
        for i in range(duration):
            if _cron_matches(cron, anchor - timedelta(minutes=i)):
                return True
        return False

    t_start = _parse_time(cfg.get("time_start", "00:00"))
    t_end = _parse_time(cfg.get("time_end", "23:59"))

    if strategy == "recurring_weekday":
        days = {int(d) for d in cfg.get("weekdays", [])}
        return _in_daily_window(now, t_start, t_end,
                                lambda d: (d.weekday() + 1) % 7 in days)
    if strategy == "recurring_dayofmonth":
        days = {int(d) for d in cfg.get("days_of_month", [])}
        return _in_daily_window(now, t_start, t_end, lambda d: d.day in days)
    if strategy == "recurring_interval":
        interval = max(1, int(cfg.get("interval_days") or 1))
        anchor = _parse_dt(cfg.get("effective_start"), tz)
        anchor_date = anchor.date() if anchor else _created_date(row, tz)
        return _in_daily_window(
            now, t_start, t_end,
            lambda d: d >= anchor_date and (d - anchor_date).days % interval == 0)
    return False


def _created_date(row: Maintenance, tz: ZoneInfo):
    ts = row.created_ts or _now_ms()
    return datetime.fromtimestamp(ts / 1000, tz).date()


def _now_in_tz(row: Maintenance, now_ms: int) -> datetime:
    return datetime.fromtimestamp(now_ms / 1000, _tz(row.timezone))


def state(row: Maintenance, now_ms: int | None = None) -> str:
    """`active` (em manutenção agora), `scheduled` (janela futura), `ended`
    (encerrada) ou `inactive` (toggle desligado)."""
    if not row.active:
        return "inactive"
    now_ms = now_ms if now_ms is not None else _now_ms()
    now = _now_in_tz(row, now_ms)
    try:
        if _is_active(row, now):
            return "active"
        cfg = _config(row)
        tz = now.tzinfo
        if row.strategy == "single":
            end = _parse_dt(cfg.get("end"), tz)
            return "ended" if (end and now >= end) else "scheduled"
        if row.strategy in RECURRING:
            end = _parse_dt(cfg.get("effective_end"), tz)
            return "ended" if (end and now >= end) else "scheduled"
    except MaintenanceError:
        return "scheduled"
    return "scheduled"


def active_monitor_ids(now_ms: int | None = None) -> set[int]:
    """Ids dos monitores sob manutenção ativa agora (união de todas as janelas)."""
    now_ms = now_ms if now_ms is not None else _now_ms()
    ids: set[int] = set()
    with get_session() as s:
        rows = s.query(Maintenance).filter(Maintenance.active == True).all()  # noqa: E712
    for row in rows:
        try:
            if _is_active(row, _now_in_tz(row, now_ms)):
                ids.update(_monitor_ids(row))
        except MaintenanceError:
            continue
    return ids


# --------------------------------------------------------------------------- #
# Serialização + CRUD
# --------------------------------------------------------------------------- #
def _monitor_ids(row: Maintenance) -> list[int]:
    try:
        return [int(i) for i in json.loads(row.monitor_ids or "[]")]
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


def _config(row: Maintenance) -> dict:
    try:
        cfg = json.loads(row.config or "{}")
        return cfg if isinstance(cfg, dict) else {}
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}


def _serialize(row: Maintenance, now_ms: int | None = None) -> dict:
    return {
        "id": row.id, "title": row.title, "description": row.description,
        "monitor_ids": _monitor_ids(row), "strategy": row.strategy,
        "timezone": row.timezone, "config": _config(row),
        "active": bool(row.active), "state": state(row, now_ms),
        "created_ts": row.created_ts, "updated_ts": row.updated_ts,
    }


def list_maintenances(*, search: str = "") -> list[dict]:
    now_ms = _now_ms()
    with get_session() as s:
        rows = s.query(Maintenance).order_by(Maintenance.created_ts.desc()).all()
        items = [_serialize(r, now_ms) for r in rows]
    term = (search or "").strip().lower()
    if term:
        items = [m for m in items if term in f"{m['title']} {m['description']}".lower()]
    return items


def get_maintenance(mid: int) -> dict:
    with get_session() as s:
        row = s.get(Maintenance, mid)
        if row is None:
            raise MaintenanceError("manutenção não encontrada", status=404)
        return _serialize(row)


# --- validação ---------------------------------------------------------------
def _valid_ids(payload: dict, s) -> str:
    raw = payload.get("monitor_ids", [])
    if not isinstance(raw, list):
        raise MaintenanceError("monitor_ids deve ser uma lista")
    ids: list[int] = []
    for i in raw:
        try:
            ids.append(int(i))
        except (TypeError, ValueError):
            raise MaintenanceError("monitor_ids inválido")
    if ids:
        found = {m.id for m in s.query(Monitor.id).filter(Monitor.id.in_(ids)).all()}
        missing = [i for i in ids if i not in found]
        if missing:
            raise MaintenanceError(f"monitor(es) inexistente(s): {missing}")
    seen: set[int] = set()
    return json.dumps([i for i in ids if not (i in seen or seen.add(i))])


def _validate_config(strategy: str, cfg: dict, tz: ZoneInfo) -> dict:
    """Valida e normaliza o `config` conforme a estratégia. Levanta em erro."""
    if not isinstance(cfg, dict):
        raise MaintenanceError("config deve ser um objeto")
    out: dict = {}
    if strategy == "manual":
        return out
    if strategy == "single":
        start = _parse_dt(cfg.get("start"), tz)
        end = _parse_dt(cfg.get("end"), tz)
        if not start or not end:
            raise MaintenanceError("informe início e fim da janela")
        if end <= start:
            raise MaintenanceError("o fim deve ser depois do início")
        out["start"] = start.strftime("%Y-%m-%d %H:%M")
        out["end"] = end.strftime("%Y-%m-%d %H:%M")
        return out
    # recorrentes / cron: faixa de vigência opcional
    for key in ("effective_start", "effective_end"):
        dt = _parse_dt(cfg.get(key), tz)
        if dt:
            out[key] = dt.strftime("%Y-%m-%d %H:%M")
    if strategy == "cron":
        cron = str(cfg.get("cron", "")).strip()
        if not cron:
            raise MaintenanceError("expressão cron é obrigatória")
        _validate_cron(cron)
        duration = int(cfg.get("duration_minutes") or 0)
        if duration < 1 or duration > CRON_MAX_DURATION_MIN:
            raise MaintenanceError(f"duração deve estar entre 1 e {CRON_MAX_DURATION_MIN} minutos")
        out["cron"] = cron
        out["duration_minutes"] = duration
        return out
    # recurring_interval / weekday / dayofmonth têm faixa de horário
    out["time_start"] = _parse_time(cfg.get("time_start", "00:00")).strftime("%H:%M")
    out["time_end"] = _parse_time(cfg.get("time_end", "23:59")).strftime("%H:%M")
    if strategy == "recurring_interval":
        interval = int(cfg.get("interval_days") or 0)
        if interval < 1:
            raise MaintenanceError("intervalo de dias deve ser ≥ 1")
        out["interval_days"] = interval
    elif strategy == "recurring_weekday":
        days = sorted({int(d) for d in cfg.get("weekdays", [])})
        if not days or any(d < 0 or d > 6 for d in days):
            raise MaintenanceError("selecione ao menos um dia da semana (0..6)")
        out["weekdays"] = days
    elif strategy == "recurring_dayofmonth":
        days = sorted({int(d) for d in cfg.get("days_of_month", [])})
        if not days or any(d < 1 or d > 31 for d in days):
            raise MaintenanceError("selecione ao menos um dia do mês (1..31)")
        out["days_of_month"] = days
    return out


def _apply(row: Maintenance, payload: dict, s) -> None:
    if "title" in payload:
        title = str(payload["title"]).strip()
        if not title:
            raise MaintenanceError("título é obrigatório")
        row.title = title[:200]
    if "description" in payload:
        row.description = str(payload["description"]).strip()
    if "monitor_ids" in payload:
        row.monitor_ids = _valid_ids(payload, s)
    if "active" in payload:
        row.active = bool(payload["active"])
    if "timezone" in payload:
        _tz(payload["timezone"])  # valida
        row.timezone = str(payload["timezone"]).strip()[:64] or "UTC"
    # strategy + config são validados juntos (config depende da strategy e do tz)
    strategy = str(payload.get("strategy", row.strategy)).strip()
    if strategy not in STRATEGIES:
        raise MaintenanceError(f"estratégia inválida (use: {', '.join(STRATEGIES)})")
    if "strategy" in payload or "config" in payload or "timezone" in payload:
        cfg = payload.get("config", _config(row))
        row.strategy = strategy
        row.config = json.dumps(_validate_config(strategy, cfg or {}, _tz(row.timezone)))


def create_maintenance(payload: dict) -> dict:
    title = str(payload.get("title", "")).strip()
    if not title:
        raise MaintenanceError("título é obrigatório")
    now = _now_ms()
    with get_session() as s:
        row = Maintenance(title=title[:200], description="", monitor_ids="[]",
                          strategy="manual", timezone="UTC", config="{}",
                          active=True, created_ts=now, updated_ts=now)
        payload.setdefault("strategy", "single")
        _apply(row, payload, s)
        s.add(row)
        s.commit()
        return _serialize(row)


def update_maintenance(mid: int, payload: dict) -> dict:
    with get_session() as s:
        row = s.get(Maintenance, mid)
        if row is None:
            raise MaintenanceError("manutenção não encontrada", status=404)
        _apply(row, payload, s)
        row.updated_ts = _now_ms()
        s.commit()
        return _serialize(row)


def set_active(mid: int, active: bool) -> dict:
    return update_maintenance(mid, {"active": active})


def delete_maintenance(mid: int) -> None:
    with get_session() as s:
        row = s.get(Maintenance, mid)
        if row is None:
            raise MaintenanceError("manutenção não encontrada", status=404)
        s.delete(row)
        s.commit()
