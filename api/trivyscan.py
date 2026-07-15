"""Scan de vulnerabilidades das imagens (trivy) com **fila + worker único**.

O trivy roda num container efêmero e só pode rodar **1x por vez**, então os
pedidos entram numa fila (tabela `image_scans`, status=queued) consumida por um
worker em thread. Cada scan expõe a **fase atual** (`phase`, persistida no banco)
para o painel acompanhar via SSE (na fila → subindo container → digitalizando…),
e o resultado (total + severidades) fica salvo no histórico com as datas de
solicitação (`created_ts`) e conclusão (`finished_ts`).
"""
from __future__ import annotations

import json
import threading
import time
import uuid

from . import appsettings
from . import dockerclient as D
from . import dockerimages
from .db import get_session
from .db.models import ImageScan

STATUS_FINAL = ("success", "failed", "canceled")
SEVERITIES = dockerimages.SEVERITIES
SEV_ORDER = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")
# Rótulos das fases (exibidos no painel).
PH_QUEUED = "na fila"
PH_PREPARING = "preparando"
PH_PULLING = "baixando scanner"
PH_STARTING = "subindo container"
PH_SCANNING = "digitalizando imagem"
PH_PARSING = "processando resultado"
PH_DONE = "concluído"
PH_FAILED = "falhou"
PH_CANCELED = "cancelado"


class ScanError(Exception):
    """Erro de domínio do scan (vira 4xx no router)."""


class RateLimited(ScanError):
    """Scan pedido cedo demais (limite de 1/min por imagem) — vira 429."""


ToolUnavailable = dockerimages.ToolUnavailable


def _now_ms() -> int:
    return int(time.time() * 1000)


def _rate_limit_seconds() -> int:
    return appsettings.get_int("docker_scan_rate_limit_seconds")


def _max_details() -> int:
    return appsettings.get_int("docker_scan_max_details")


def _scan_workers() -> int:
    return appsettings.get_int("docker_scan_workers")


# --- Serialização ------------------------------------------------------------

def serialize(row: ImageScan, details: bool = False) -> dict:
    try:
        sev = json.loads(row.severities) if row.severities else {}
    except (ValueError, TypeError):
        sev = {}
    out = {
        "id": row.id,
        "image_id": row.image_id,
        "image_ref": row.image_ref,
        "status": row.status,
        "phase": row.phase,
        "total": row.total,
        "severities": sev,
        "error": row.error,
        "user": row.user,
        "created_at": row.created_ts,
        "started_at": row.started_ts,
        "finished_at": row.finished_ts,
    }
    if details:  # lista de CVEs — só no GET de um scan específico (payload maior)
        try:
            out["details"] = json.loads(row.details) if row.details else []
        except (ValueError, TypeError):
            out["details"] = []
    return out


def get(scan_id: int, details: bool = False) -> dict | None:
    with get_session() as s:
        row = s.get(ImageScan, scan_id)
        return serialize(row, details=details) if row else None


def history(image_id: str | None = None, limit: int = 50) -> list[dict]:
    with get_session() as s:
        q = s.query(ImageScan)
        if image_id:
            q = q.filter(ImageScan.image_id == image_id)
        rows = q.order_by(ImageScan.id.desc()).limit(limit).all()
        return [serialize(r) for r in rows]


def latest_all() -> dict[str, dict]:
    """Mapa image_id → último scan **concluído com sucesso** (p/ os badges)."""
    with get_session() as s:
        rows = (s.query(ImageScan)
                .filter(ImageScan.status == "success")
                .order_by(ImageScan.id.desc()).all())
    out: dict[str, dict] = {}
    for r in rows:
        if r.image_id not in out:
            out[r.image_id] = serialize(r)
    return out


def active_all() -> dict[str, dict]:
    """Mapa image_id → scan **em andamento** (queued/running) — usado para
    restaurar o acompanhamento (fase + SSE) ao recarregar a tela."""
    with get_session() as s:
        rows = (s.query(ImageScan)
                .filter(ImageScan.status.in_(("queued", "running")))
                .order_by(ImageScan.id.desc()).all())
    out: dict[str, dict] = {}
    for r in rows:
        if r.image_id not in out:
            out[r.image_id] = serialize(r)
    return out


# --- Fila --------------------------------------------------------------------

_threads: list[threading.Thread] = []
_stop = threading.Event()
_wake = threading.Event()
_queue_lock = threading.Lock()


def _coalesce_queued(s, image_id: int) -> None:
    """Cancela scans `queued` da mesma imagem — basta scanear a versão mais nova."""
    for old in (s.query(ImageScan)
                .filter(ImageScan.image_id == image_id, ImageScan.status == "queued")
                .all()):
        old.status = "canceled"
        old.phase = PH_CANCELED
        old.error = "substituído por um scan mais novo"
        old.finished_ts = _now_ms()


def enqueue(image_id: str, image_ref: str, user: str) -> dict:
    """Enfileira um scan. Valida o toggle/Docker e o limite de 1/min antes de gravar."""
    if not dockerimages.scanner_enabled():
        raise ToolUnavailable(
            "scanner de vulnerabilidades desativado — ative em Configurações → Docker")
    if not D.available():
        raise D.DockerError("Docker indisponível para rodar o trivy")
    with get_session() as s:
        # Limite: 1 scan por minuto por imagem (evita rescans em sequência).
        last = (s.query(ImageScan).filter(ImageScan.image_id == image_id)
                .order_by(ImageScan.id.desc()).first())
        if last:
            elapsed = _now_ms() - last.created_ts
            limit_seconds = _rate_limit_seconds()
            if elapsed < limit_seconds * 1000:
                wait = (limit_seconds * 1000 - elapsed + 999) // 1000
                raise RateLimited(
                    f"aguarde {wait}s antes de escanear esta imagem novamente")
        _coalesce_queued(s, image_id)
        row = ImageScan(image_id=image_id, image_ref=image_ref, status="queued",
                        phase=PH_QUEUED, user=user, created_ts=_now_ms())
        s.add(row)
        s.commit()
        s.refresh(row)
        data = serialize(row)
    _wake.set()
    return data


# --- Execução ----------------------------------------------------------------

def _set(scan_id: int, *, phase: str | None = None, status: str | None = None,
         total: int | None = None, severities: dict | None = None,
         details: list | None = None,
         error: str | None = None, started: bool = False, finished: bool = False) -> None:
    with get_session() as s:
        row = s.get(ImageScan, scan_id)
        if not row:
            return
        if phase is not None:
            row.phase = phase
        if status is not None:
            row.status = status
        if total is not None:
            row.total = total
        if severities is not None:
            row.severities = json.dumps(severities)
        if details is not None:
            row.details = json.dumps(details)
        if error is not None:
            row.error = error
        if started:
            row.started_ts = _now_ms()
        if finished:
            row.finished_ts = _now_ms()
        s.commit()


def _run_trivy(name: str, on_phase) -> tuple[int, dict, list]:
    """Roda o trivy num container efêmero e devolve (total, contagem, CVEs)."""
    D.ensure_volume(dockerimages.TRIVY_CACHE_VOLUME)
    if D.inspect_image(dockerimages.TRIVY_IMAGE) is None:  # 1ª vez: puxa o scanner
        on_phase(PH_PULLING)
        D.pull_image(dockerimages.TRIVY_IMAGE, timeout=dockerimages.TRIVY_TIMEOUT)

    spec = {
        "Image": dockerimages.TRIVY_IMAGE,
        "Cmd": ["image", "--quiet", "--format", "json", "--scanners", "vuln", name],
        "Tty": False,
        "HostConfig": {
            "Binds": [
                f"{dockerimages.DOCKER_SOCKET}:/var/run/docker.sock:ro",
                f"{dockerimages.TRIVY_CACHE_VOLUME}:/root/.cache/trivy",
            ],
            "NetworkMode": "bridge",  # trivy baixa a base de vulnerabilidades da internet
        },
        "Labels": {"nexus.managed": "true", "nexus.trivy": "true"},
    }
    on_phase(PH_STARTING)
    cid = D.create_container(f"nexus-trivy-{uuid.uuid4().hex[:12]}", spec)
    try:
        D.start_container(cid)
        on_phase(PH_SCANNING)
        code = D.wait_container(cid, timeout=dockerimages.TRIVY_TIMEOUT)
        stdout, stderr = D.container_logs(cid)
    finally:
        D.remove_container(cid, force=True, missing_ok=True)

    on_phase(PH_PARSING)
    if code != 0:
        msg = stderr.decode("utf-8", "replace")[-400:].strip() or f"exit {code}"
        raise D.DockerError(f"trivy falhou: {msg}")
    try:
        data = json.loads(stdout.decode("utf-8", "replace") or "{}")
    except json.JSONDecodeError:
        raise D.DockerError("saída do trivy inválida")
    counts = {sev: 0 for sev in SEVERITIES}
    details: list[dict] = []
    for result in data.get("Results") or []:
        for vuln in result.get("Vulnerabilities") or []:
            sev = str(vuln.get("Severity") or "UNKNOWN").upper()
            counts[sev] = counts.get(sev, 0) + 1
            details.append({
                "id": vuln.get("VulnerabilityID", ""),
                "pkg": vuln.get("PkgName", ""),
                "severity": sev,
                "installed": vuln.get("InstalledVersion", ""),
                "fixed": vuln.get("FixedVersion", ""),
                "title": vuln.get("Title", ""),
                "url": vuln.get("PrimaryURL", ""),
            })
    # ordena por severidade (mais grave primeiro) e limita o volume guardado.
    rank = {s: i for i, s in enumerate(SEV_ORDER)}
    details.sort(key=lambda v: (rank.get(v["severity"], 99), v["pkg"], v["id"]))
    return sum(counts.values()), counts, details[:_max_details()]


def _run(scan_id: int) -> None:
    with get_session() as s:
        row = s.get(ImageScan, scan_id)
        if not row:
            return
        name = row.image_ref or row.image_id
    _set(scan_id, status="running", phase=PH_PREPARING, started=True)
    try:
        if not dockerimages.scanner_enabled():
            raise ScanError("scanner desativado em Configurações → Docker")
        total, counts, details = _run_trivy(name, lambda ph: _set(scan_id, phase=ph))
        _set(scan_id, status="success", phase=PH_DONE, total=total,
             severities=counts, details=details, finished=True)
    except Exception as exc:  # noqa: BLE001 — registra a falha no histórico
        _set(scan_id, status="failed", phase=PH_FAILED, error=str(exc), finished=True)


def _claim_next_queued() -> int | None:
    with _queue_lock:
        with get_session() as s:
            row = (s.query(ImageScan).filter(ImageScan.status == "queued")
                   .order_by(ImageScan.id.asc()).first())
            if not row:
                return None
            row.status = "running"
            row.phase = PH_PREPARING
            row.started_ts = _now_ms()
            s.commit()
            return row.id


def _recover_orphans() -> None:
    """Scans `running` de uma execução anterior da API viram failed."""
    with get_session() as s:
        rows = s.query(ImageScan).filter(ImageScan.status == "running").all()
        for row in rows:
            row.status = "failed"
            row.phase = PH_FAILED
            row.error = "interrompido por reinício da API"
            row.finished_ts = _now_ms()
        if rows:
            s.commit()
            print(f"trivyscan: {len(rows)} scan(s) órfão(s) marcados como failed", flush=True)


def _loop() -> None:
    _recover_orphans()
    while not _stop.is_set():
        try:
            scan_id = _claim_next_queued()
            if scan_id is not None:
                _run(scan_id)
                continue  # pode haver mais na fila
        except Exception as exc:  # noqa: BLE001 — o worker nunca deve morrer
            print(f"trivyscan: erro no worker: {exc}", flush=True)
        _wake.wait(2.0)
        _wake.clear()


def start() -> None:
    global _threads
    _threads = [thread for thread in _threads if thread.is_alive()]
    if _threads:
        return
    _stop.clear()
    for index in range(_scan_workers()):
        thread = threading.Thread(target=_loop, name=f"trivy-scan-worker-{index + 1}", daemon=True)
        thread.start()
        _threads.append(thread)
