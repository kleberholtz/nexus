"""Deployment de aplicações: static (upload de ZIP), git (clone) e docker
(clone + build de imagem).

Pipeline: fila (tabela `deploys`, status=queued) → worker único em thread →
release em `releases/<id>` (extraído do ZIP ou clonado do git) → troca do
symlink `current` atomicamente (exceto docker, que só builda/tageia a imagem,
sem servir arquivos). Logs de cada deploy vão para arquivo (replay no SSE) +
ring buffer em memória enquanto roda. Rollback só reaponta o symlink e
registra um novo deploy `source="rollback"` no histórico.

Layout em disco (APPS_DIR, volume persistente):

    /var/www/apps/<slug>/releases/<deploy_id>/...
    /var/www/apps/<slug>/current -> releases/<deploy_id>   (symlink relativo)

Estado interno (STATE_DIR, no volume `data`):

    /var/lib/nexus/deploy/uploads/<deploy_id>.zip   zip pendente (fila retomável)
    /var/lib/nexus/deploy/logs/<deploy_id>.log      log completo do deploy
"""
from __future__ import annotations

import fnmatch
import json
import os
import shutil
import stat
import subprocess
import tarfile
import threading
import time
import zipfile
from collections import deque
from io import BytesIO
from pathlib import Path

from . import dockerclient
from . import gitproviders
from .db import get_session
from .db.models import Deploy, DeployApp

APPS_DIR = Path(os.environ.get("DEPLOY_APPS_DIR", "/var/www/apps"))
STATE_DIR = Path(os.environ.get("DEPLOY_STATE_DIR", "/var/lib/nexus/deploy"))
MAX_UPLOAD_MB = int(os.environ.get("DEPLOY_MAX_UPLOAD_MB", "512"))
MAX_UNPACKED_MB = int(os.environ.get("DEPLOY_MAX_UNPACKED_MB", str(MAX_UPLOAD_MB * 4)))
MAX_ENTRIES = int(os.environ.get("DEPLOY_MAX_ENTRIES", "20000"))
GIT_CLONE_TIMEOUT = int(os.environ.get("DEPLOY_GIT_CLONE_TIMEOUT", "300"))
DOCKER_BUILD_TIMEOUT = int(os.environ.get("DEPLOY_DOCKER_BUILD_TIMEOUT", "1800"))

STATUS_FINAL = ("success", "failed", "canceled")


class DeployError(Exception):
    """Erro de domínio do deploy (vira 4xx no router)."""


def _now_ms() -> int:
    return int(time.time() * 1000)


def uploads_dir() -> Path:
    d = STATE_DIR / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def logs_dir() -> Path:
    d = STATE_DIR / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Log por deploy: arquivo (fonte de verdade p/ replay) + ring em memória.
# ---------------------------------------------------------------------------

class _LogBuffer:
    def __init__(self, deploy_id: int):
        self.path = logs_dir() / f"{deploy_id}.log"
        self._ring: deque[tuple[int, str]] = deque(maxlen=2000)  # (seq, linha)
        self._seq = 0
        self._lock = threading.Lock()
        self._fh = open(self.path, "a", encoding="utf-8")

    def log(self, line: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        text = f"{stamp} {line}"
        with self._lock:
            self._seq += 1
            self._ring.append((self._seq, text))
            self._fh.write(text + "\n")
            self._fh.flush()

    def tail(self, n: int = 50) -> list[str]:
        with self._lock:
            return [line for _, line in list(self._ring)[-n:]]

    def close(self) -> None:
        with self._lock:
            self._fh.close()


_buffers: dict[int, _LogBuffer] = {}
_buffers_lock = threading.Lock()


def _open_buffer(deploy_id: int) -> _LogBuffer:
    buf = _LogBuffer(deploy_id)
    with _buffers_lock:
        _buffers[deploy_id] = buf
    return buf


def _close_buffer(deploy_id: int) -> None:
    with _buffers_lock:
        buf = _buffers.pop(deploy_id, None)
    if buf:
        buf.close()


def buffer_tail(deploy_id: int, n: int = 50) -> list[str] | None:
    """Últimas linhas do deploy em execução (None se não está rodando)."""
    with _buffers_lock:
        buf = _buffers.get(deploy_id)
    return buf.tail(n) if buf else None


def log_path(deploy_id: int) -> Path:
    return logs_dir() / f"{deploy_id}.log"


# ---------------------------------------------------------------------------
# Paths e helpers de filesystem.
# ---------------------------------------------------------------------------

def app_dir(app: DeployApp) -> Path:
    return Path(app.root)


def releases_dir(app: DeployApp) -> Path:
    return app_dir(app) / "releases"


def current_release(app: DeployApp) -> str | None:
    """Nome (deploy_id) da release apontada por `current`, ou None."""
    link = app_dir(app) / "current"
    try:
        target = os.readlink(link)
    except OSError:
        return None
    return Path(target).name


def list_releases(app: DeployApp) -> list[str]:
    base = releases_dir(app)
    if not base.is_dir():
        return []
    out = [p.name for p in base.iterdir() if p.is_dir() and not p.name.endswith(".tmp")]
    return sorted(out, key=lambda n: (base / n).stat().st_mtime, reverse=True)


def _switch_current(app: DeployApp, release_name: str) -> None:
    """Troca o symlink `current` atomicamente (symlink tmp + rename)."""
    base = app_dir(app)
    tmp = base / ".current.tmp"
    try:
        tmp.unlink()
    except FileNotFoundError:
        pass
    os.symlink(f"releases/{release_name}", tmp)
    os.replace(tmp, base / "current")


def ensure_app_dirs(app: DeployApp) -> None:
    releases_dir(app).mkdir(parents=True, exist_ok=True)


def purge_app(app: DeployApp) -> None:
    """Apaga os arquivos da app (releases + symlink)."""
    shutil.rmtree(app_dir(app), ignore_errors=True)


# ---------------------------------------------------------------------------
# Unzip seguro (zip-slip, symlinks, zip bomb).
# ---------------------------------------------------------------------------

def _zip_roots(names: list[str]) -> set[str]:
    return {n.split("/", 1)[0] for n in names if n.strip("/")}


def _extract(zf: zipfile.ZipFile, dest: Path, deploy_id: int, log) -> None:
    infos = [i for i in zf.infolist() if i.filename.strip("/")]
    if not infos:
        raise DeployError("zip vazio")
    if len(infos) > MAX_ENTRIES:
        raise DeployError(f"zip com entradas demais ({len(infos)} > {MAX_ENTRIES})")

    declared = sum(i.file_size for i in infos)
    max_bytes = MAX_UNPACKED_MB * 1024 * 1024
    if declared > max_bytes:
        raise DeployError(
            f"conteúdo descompactado excede o limite ({declared // (1024*1024)}MB > {MAX_UNPACKED_MB}MB)")

    # Zip-slip: valida os nomes ORIGINAIS antes de qualquer normalização
    # (o flatten abaixo não pode mascarar um "../" na raiz).
    for info in infos:
        parts = info.filename.replace("\\", "/").split("/")
        if info.filename.startswith(("/", "\\")) or ".." in parts:
            raise DeployError(f"entrada insegura no zip: {info.filename}")

    # Se o zip tem um único diretório na raiz (padrão de zips de build),
    # usa o conteúdo dele como raiz da release.
    roots = _zip_roots([i.filename for i in infos])
    strip = ""
    if len(roots) == 1:
        only = next(iter(roots))
        if all(i.filename.startswith(only + "/") for i in infos):
            strip = only + "/"
            log(f"raiz única '{only}/' detectada — extraindo o conteúdo dela")

    dest_resolved = dest.resolve()
    total = 0
    for n, info in enumerate(infos):
        if n % 200 == 0 and _is_canceled(deploy_id):
            raise _Canceled()
        name = info.filename[len(strip):] if strip else info.filename
        if not name.strip("/"):
            continue
        # Zip-slip: nada de paths absolutos ou "..".
        target = (dest / name).resolve()
        if not target.is_relative_to(dest_resolved):
            raise DeployError(f"entrada insegura no zip: {info.filename}")
        # Symlinks (e outros tipos especiais) dentro do zip não são permitidos.
        mode = (info.external_attr >> 16) & 0o170000
        if mode and mode != stat.S_IFREG and mode != stat.S_IFDIR:
            raise DeployError(f"entrada não suportada (symlink/especial): {info.filename}")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(target, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:  # metadado mentiroso (zip bomb)
                    raise DeployError(f"conteúdo descompactado excede o limite ({MAX_UNPACKED_MB}MB)")
                dst.write(chunk)
    log(f"{len(infos)} entradas extraídas ({total // 1024} KiB)")


# ---------------------------------------------------------------------------
# Cancelamento.
# ---------------------------------------------------------------------------

class _Canceled(Exception):
    pass


_cancel: set[int] = set()
_cancel_lock = threading.Lock()


def _is_canceled(deploy_id: int) -> bool:
    with _cancel_lock:
        return deploy_id in _cancel


def _clear_cancel(deploy_id: int) -> None:
    with _cancel_lock:
        _cancel.discard(deploy_id)


def cancel(deploy_id: int) -> str:
    """Cancela um deploy. queued → cancela direto; running → best-effort."""
    with get_session() as s:
        dep = s.get(Deploy, deploy_id)
        if not dep:
            raise KeyError(deploy_id)
        if dep.status in STATUS_FINAL:
            raise DeployError(f"deploy já finalizado ({dep.status})")
        if dep.status == "queued":
            dep.status = "canceled"
            dep.finished_ts = _now_ms()
            dep.error = "cancelado antes de iniciar"
            s.commit()
            (uploads_dir() / f"{deploy_id}.zip").unlink(missing_ok=True)
            return "canceled"
    # running: sinaliza; o worker finaliza o status.
    with _cancel_lock:
        _cancel.add(deploy_id)
    return "canceling"


# ---------------------------------------------------------------------------
# Fila + worker.
# ---------------------------------------------------------------------------

_thread: threading.Thread | None = None
_stop = threading.Event()
_wake = threading.Event()


def _coalesce_queued(s, app_id: int) -> None:
    """Cancela deploys `queued` da app — só faz sentido deployar a versão mais
    nova (coalescing), evitando a fila crescer sem limite."""
    stale = (s.query(Deploy)
             .filter(Deploy.app_id == app_id, Deploy.status == "queued")
             .all())
    for old in stale:
        old.status = "canceled"
        old.finished_ts = _now_ms()
        old.error = "substituído por um deploy mais novo"
        (uploads_dir() / f"{old.id}.zip").unlink(missing_ok=True)


def enqueue(app: DeployApp, zip_tmp: Path, ref: str, user: str) -> Deploy:
    """Enfileira um deploy a partir de um upload de ZIP (app static)."""
    with get_session() as s:
        _coalesce_queued(s, app.id)
        dep = Deploy(app_id=app.id, status="queued", source="upload",
                     ref=ref or zip_tmp.name, user=user, created_ts=_now_ms())
        s.add(dep)
        s.commit()
        dep_id = dep.id
        dest = uploads_dir() / f"{dep_id}.zip"
        shutil.move(str(zip_tmp), dest)
        dep.logs_path = str(log_path(dep_id))
        s.commit()
        s.refresh(dep)
    _wake.set()
    return dep


def enqueue_git(app: DeployApp, ref: str, user: str) -> Deploy:
    """Enfileira um deploy git/docker (sem upload — o clone acontece no worker)."""
    with get_session() as s:
        _coalesce_queued(s, app.id)
        dep = Deploy(app_id=app.id, status="queued", source="git",
                     ref=ref, user=user, created_ts=_now_ms())
        s.add(dep)
        s.commit()
        dep.logs_path = str(log_path(dep.id))
        s.commit()
        s.refresh(dep)
    _wake.set()
    return dep


def branch_allowed(filter_str: str, ref: str) -> bool:
    """`filter_str` é uma lista de padrões glob separados por vírgula; vazio
    aceita qualquer ref."""
    patterns = [p.strip() for p in (filter_str or "").split(",") if p.strip()]
    if not patterns:
        return True
    return any(fnmatch.fnmatchcase(ref, p) for p in patterns)


def rollback(app: DeployApp, to_deploy_id: int | None, user: str) -> Deploy:
    """Reaponta `current` para uma release anterior e registra no histórico."""
    with get_session() as s:
        cur = current_release(app)
        if to_deploy_id is not None:
            target = s.get(Deploy, to_deploy_id)
            if not target or target.app_id != app.id:
                raise KeyError(to_deploy_id)
            if target.status != "success" or not target.release_dir:
                raise DeployError("o deploy alvo não gerou release utilizável")
        else:
            # Padrão: o deploy success mais recente cuja release não é a atual
            # e ainda existe em disco.
            candidates = (s.query(Deploy)
                          .filter(Deploy.app_id == app.id, Deploy.status == "success",
                                  Deploy.release_dir != "")
                          .order_by(Deploy.id.desc())
                          .all())
            target = next((d for d in candidates
                           if Path(d.release_dir).name != cur
                           and Path(d.release_dir).is_dir()), None)
            if not target:
                raise DeployError("nenhuma release anterior disponível para rollback")
        rel = Path(target.release_dir)
        if not rel.is_dir():
            raise DeployError(f"release do deploy #{target.id} não existe mais em disco (podada)")
        if rel.name == cur:
            raise DeployError(f"o deploy #{target.id} já é a release ativa")

        _switch_current(app, rel.name)

        now = _now_ms()
        dep = Deploy(app_id=app.id, status="success", source="rollback",
                     ref=f"rollback para o deploy #{target.id}", user=user,
                     release_dir=str(rel), created_ts=now, started_ts=now,
                     finished_ts=now)
        s.add(dep)
        s.commit()
        s.refresh(dep)

    buf = _open_buffer(dep.id)
    try:
        buf.log(f"rollback: current → releases/{rel.name} (deploy #{target.id})")
        with get_session() as s:
            row = s.get(Deploy, dep.id)
            row.logs_path = str(buf.path)
            s.commit()
            s.refresh(row)
            dep = row
    finally:
        _close_buffer(dep.id)
    return dep


def has_active(app_id: int) -> bool:
    with get_session() as s:
        return (s.query(Deploy)
                .filter(Deploy.app_id == app_id,
                        Deploy.status.in_(("queued", "running")))
                .count()) > 0


def _prune_releases(app: DeployApp, log) -> None:
    keep = max(1, app.keep_releases or 5)
    cur = current_release(app)
    names = list_releases(app)  # mais novas primeiro
    victims = [n for n in names if n != cur][max(0, keep - 1):]
    for name in victims:
        shutil.rmtree(releases_dir(app) / name, ignore_errors=True)
        log(f"release antiga removida: releases/{name}")


def _run_static(dep_id: int) -> None:
    buf = _open_buffer(dep_id)
    zip_path = uploads_dir() / f"{dep_id}.zip"
    release_tmp: Path | None = None
    try:
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            app = s.get(DeployApp, dep.app_id)
            if not app:
                raise DeployError("aplicação não existe mais")
            dep.status = "running"
            dep.started_ts = _now_ms()
            dep.logs_path = str(buf.path)
            s.commit()

        buf.log(f"deploy #{dep_id} iniciado (app: {app.slug}, ref: {dep.ref})")
        if not zipfile.is_zipfile(zip_path):
            raise DeployError("arquivo enviado não é um zip válido")
        with zipfile.ZipFile(zip_path) as zf:
            bad = zf.testzip()
            if bad:
                raise DeployError(f"zip corrompido (falha em: {bad})")
            buf.log("zip validado")

            ensure_app_dirs(app)
            release_dir = releases_dir(app) / str(dep_id)
            release_tmp = releases_dir(app) / f"{dep_id}.tmp"
            shutil.rmtree(release_tmp, ignore_errors=True)
            release_tmp.mkdir(parents=True)
            buf.log(f"extraindo para releases/{dep_id} ...")
            _extract(zf, release_tmp, dep_id, buf.log)

        if _is_canceled(dep_id):
            raise _Canceled()
        os.rename(release_tmp, release_dir)
        release_tmp = None
        _switch_current(app, str(dep_id))
        buf.log(f"current → releases/{dep_id} (switch atômico)")
        _prune_releases(app, buf.log)

        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "success"
            dep.release_dir = str(release_dir)
            dep.finished_ts = _now_ms()
            s.commit()
        buf.log("deploy concluído com sucesso")
    except _Canceled:
        buf.log("deploy cancelado")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "canceled"
            dep.error = "cancelado durante a execução"
            dep.finished_ts = _now_ms()
            s.commit()
    except Exception as exc:  # noqa: BLE001 - registra a falha no histórico
        buf.log(f"ERRO: {exc}")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "failed"
            dep.error = str(exc)
            dep.finished_ts = _now_ms()
            s.commit()
    finally:
        if release_tmp:
            shutil.rmtree(release_tmp, ignore_errors=True)
        zip_path.unlink(missing_ok=True)
        _clear_cancel(dep_id)
        _close_buffer(dep_id)


def _sanitize_tag(ref: str) -> str:
    """Docker tags só aceitam [a-zA-Z0-9_.-]; troca o resto por '-'."""
    safe = "".join(c if c.isalnum() or c in "_.-" else "-" for c in ref)
    return safe.strip("-.") or "latest"


def _clone(app: DeployApp, ref: str, dest: Path, log) -> None:
    """Clona o repositório da app no ref pedido (compartilhado por git/docker).

    Sem cap de bytes (não dá pra inspecionar tamanho antes de um clone) — o
    único limite é o timeout e o `--depth 1`, que na prática restringe bastante
    o volume baixado (só o último commit do ref).
    """
    if shutil.which("git") is None:
        raise DeployError("binário 'git' não encontrado (adicione ao Dockerfile do runtime)")
    url = gitproviders.build_clone_url(app.provider_id, app.git_url)
    log(f"git clone --depth 1 --branch {ref} {url} → {dest}")
    try:
        proc = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, url, str(dest)],
            capture_output=True, text=True, timeout=GIT_CLONE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise DeployError(f"clone excedeu o timeout ({GIT_CLONE_TIMEOUT}s)")
    if proc.returncode != 0:
        raise DeployError(f"git clone falhou: {proc.stderr[-500:].strip()}")
    shutil.rmtree(dest / ".git", ignore_errors=True)
    log("clone concluído")


def _run_git(dep_id: int) -> None:
    """Pipeline git: clona o ref recebido e troca a release (mesma lógica de
    releases/symlink/poda do static, só muda a origem do conteúdo)."""
    buf = _open_buffer(dep_id)
    clone_tmp: Path | None = None
    try:
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            app = s.get(DeployApp, dep.app_id)
            if not app:
                raise DeployError("aplicação não existe mais")
            dep.status = "running"
            dep.started_ts = _now_ms()
            dep.logs_path = str(buf.path)
            s.commit()

        buf.log(f"deploy #{dep_id} iniciado (app: {app.slug}, ref: {dep.ref})")
        ensure_app_dirs(app)
        release_dir = releases_dir(app) / str(dep_id)
        clone_tmp = releases_dir(app) / f"{dep_id}.tmp"
        shutil.rmtree(clone_tmp, ignore_errors=True)
        _clone(app, dep.ref, clone_tmp, buf.log)

        if _is_canceled(dep_id):
            raise _Canceled()
        os.rename(clone_tmp, release_dir)
        clone_tmp = None
        _switch_current(app, str(dep_id))
        buf.log(f"current → releases/{dep_id} (switch atômico)")
        _prune_releases(app, buf.log)

        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "success"
            dep.release_dir = str(release_dir)
            dep.finished_ts = _now_ms()
            s.commit()
        buf.log("deploy concluído com sucesso")
    except _Canceled:
        buf.log("deploy cancelado")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "canceled"
            dep.error = "cancelado durante a execução"
            dep.finished_ts = _now_ms()
            s.commit()
    except Exception as exc:  # noqa: BLE001 - registra a falha no histórico
        buf.log(f"ERRO: {exc}")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "failed"
            dep.error = str(exc)
            dep.finished_ts = _now_ms()
            s.commit()
    finally:
        if clone_tmp:
            shutil.rmtree(clone_tmp, ignore_errors=True)
        _clear_cancel(dep_id)
        _close_buffer(dep_id)


def _build_context_tar(root: Path, log) -> bytes:
    """Empacota o diretório clonado num tar (contexto de build), excluindo
    `.git` e rejeitando symlinks que escapem da árvore (defesa em profundidade
    — o clone é local e controlado pela própria API, mas o repositório em si
    pode conter um symlink malicioso)."""
    root_resolved = root.resolve()
    buf = BytesIO()
    # GNU_FORMAT evita as entradas `././@PaxHeader` do formato PAX (default), que
    # o BuildKit interpreta como o Dockerfile ("unknown instruction: @PaxHeader").
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if rel.parts and rel.parts[0] == ".git":
                continue
            if path.is_symlink():
                target = path.resolve()
                if not target.is_relative_to(root_resolved):
                    raise DeployError(f"symlink escapando o contexto de build: {rel}")
            tar.add(path, arcname=str(rel), recursive=False)
    size = buf.tell()
    log(f"contexto de build empacotado ({size // 1024} KiB)")
    return buf.getvalue()


def _run_docker(dep_id: int) -> None:
    """Pipeline docker: clona o ref, builda e tageia a imagem via a Docker
    Engine API (unix socket). Não roda o container (fase futura)."""
    buf = _open_buffer(dep_id)
    clone_tmp: Path | None = None
    try:
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            app = s.get(DeployApp, dep.app_id)
            if not app:
                raise DeployError("aplicação não existe mais")
            dep.status = "running"
            dep.started_ts = _now_ms()
            dep.logs_path = str(buf.path)
            s.commit()

        buf.log(f"deploy #{dep_id} iniciado (app: {app.slug}, ref: {dep.ref})")
        clone_tmp = STATE_DIR / "builds" / f"{dep_id}"
        shutil.rmtree(clone_tmp, ignore_errors=True)
        clone_tmp.parent.mkdir(parents=True, exist_ok=True)
        _clone(app, dep.ref, clone_tmp, buf.log)

        if _is_canceled(dep_id):
            raise _Canceled()

        context_dir = (clone_tmp / app.build_context).resolve()
        if not context_dir.is_relative_to(clone_tmp.resolve()) or not context_dir.is_dir():
            raise DeployError(f"contexto de build inválido: {app.build_context}")
        context_tar = _build_context_tar(context_dir, buf.log)

        tag = f"{app.slug}:{_sanitize_tag(dep.ref)}"
        try:
            build_args = json.loads(app.build_args or "{}")
        except json.JSONDecodeError:
            build_args = {}
        buf.log(f"docker build --progress=plain -t {tag} -f {app.dockerfile_path} {app.build_context}")
        dockerclient.build_image(tag, context_tar, dockerfile=app.dockerfile_path,
                                 buildargs=build_args, on_line=buf.log,
                                 timeout=DOCKER_BUILD_TIMEOUT)

        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "success"
            dep.image = tag
            dep.finished_ts = _now_ms()
            s.commit()
        buf.log(f"build concluído com sucesso — imagem {tag}")
    except _Canceled:
        buf.log("deploy cancelado")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "canceled"
            dep.error = "cancelado durante a execução"
            dep.finished_ts = _now_ms()
            s.commit()
    except Exception as exc:  # noqa: BLE001 - registra a falha no histórico
        buf.log(f"ERRO: {exc}")
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            dep.status = "failed"
            dep.error = str(exc)
            dep.finished_ts = _now_ms()
            s.commit()
    finally:
        if clone_tmp:
            shutil.rmtree(clone_tmp, ignore_errors=True)
        _clear_cancel(dep_id)
        _close_buffer(dep_id)


def _run(dep_id: int) -> None:
    """Dispatcher: escolhe o pipeline pelo `type` da app."""
    with get_session() as s:
        dep = s.get(Deploy, dep_id)
        app = s.get(DeployApp, dep.app_id) if dep else None
    if app is None:
        with get_session() as s:
            dep = s.get(Deploy, dep_id)
            if dep:
                dep.status = "failed"
                dep.error = "aplicação não existe mais"
                dep.finished_ts = _now_ms()
                s.commit()
        return
    if app.type == "git":
        _run_git(dep_id)
    elif app.type == "docker":
        _run_docker(dep_id)
    else:
        _run_static(dep_id)


def _recover_orphans() -> None:
    """Deploys `running` de uma execução anterior da API viram failed."""
    with get_session() as s:
        rows = s.query(Deploy).filter(Deploy.status == "running").all()
        for dep in rows:
            dep.status = "failed"
            dep.error = "interrompido por reinício da API"
            dep.finished_ts = _now_ms()
        if rows:
            s.commit()
            print(f"deploy: {len(rows)} deploy(s) órfão(s) marcados como failed", flush=True)


def _next_queued() -> int | None:
    with get_session() as s:
        dep = (s.query(Deploy).filter(Deploy.status == "queued")
               .order_by(Deploy.id.asc()).first())
        return dep.id if dep else None


def _loop() -> None:
    _recover_orphans()
    while not _stop.is_set():
        try:
            dep_id = _next_queued()
            if dep_id is not None:
                _run(dep_id)
                continue  # pode haver mais na fila
        except Exception as exc:  # noqa: BLE001 - o worker nunca deve morrer
            print(f"deploy: erro no worker: {exc}", flush=True)
        _wake.wait(2.0)
        _wake.clear()


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="deploy-worker", daemon=True)
    _thread.start()
