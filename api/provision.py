"""Provisionamento de serviços via Docker Engine (usa api/dockerclient.py).

Fase atual: **banco de dados** é o caminho completo (pull → create → start,
com volume/rede/bind externo/recursos/env). application/compose ficam para a
fase seguinte (levantam DockerError claro por enquanto).

As funções recebem o `ProjectService` (dentro de uma sessão aberta) e devolvem o
`container_id`; a transição de `status` fica a cargo do router.
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

from . import dockerclient as D
from . import projects as P
from .db import get_session
from .db.models import GitProviderRow, ProjectService

# Portas internas por engine (reusa o mapa de projects).
DB_PORTS = P.DB_PORTS

COMPOSE_DIR = Path(os.environ.get("COMPOSE_STATE_DIR", "/var/lib/nexus/compose"))
COMPOSE_TIMEOUT = int(os.environ.get("COMPOSE_TIMEOUT", "600"))

# Aplicações: raiz dos arquivos estáticos (compartilhada com deploy.py), timeouts
# de clone/build e diretório de contexto dos builds docker.
APPS_DIR = P.APPS_DIR
BUILD_DIR = Path(os.environ.get("DEPLOY_STATE_DIR", "/var/lib/nexus/deploy")) / "builds"
GIT_CLONE_TIMEOUT = int(os.environ.get("DEPLOY_GIT_CLONE_TIMEOUT", "300"))
DOCKER_BUILD_TIMEOUT = int(os.environ.get("DEPLOY_DOCKER_BUILD_TIMEOUT", "1800"))


def compose_project(row: ProjectService) -> str:
    return P.container_name(row)


def _compose_file(row: ProjectService, content: str) -> Path:
    d = COMPOSE_DIR / compose_project(row)
    d.mkdir(parents=True, exist_ok=True)
    f = d / "docker-compose.yml"
    f.write_text(content, encoding="utf-8")
    return f


def _run_compose(args: list[str], on_line=None) -> None:
    if shutil.which("docker") is None:
        raise D.DockerError("docker CLI ausente (adicione ao Dockerfile do runtime)")
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=COMPOSE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise D.DockerError(f"compose excedeu o timeout ({COMPOSE_TIMEOUT}s)")
    if on_line:
        for line in (proc.stdout + proc.stderr).splitlines():
            on_line(line)
    if proc.returncode != 0:
        raise D.DockerError(f"compose falhou: {(proc.stderr or proc.stdout)[-500:].strip()}")


def deploy_compose(row: ProjectService, on_line=None) -> str:
    if shutil.which("docker") is None:
        raise D.DockerError("docker CLI ausente (adicione ao Dockerfile do runtime)")
    cfg = P._config(row)
    content = str(cfg.get("content") or "")
    if not content.strip():
        raise D.DockerError("conteúdo do compose vazio")
    f = _compose_file(row, content)
    project = compose_project(row)
    mode = cfg.get("mode") or "compose"
    if mode == "stack":
        _run_compose(["docker", "stack", "deploy", "-c", str(f), project], on_line)
    else:
        _run_compose(["docker", "compose", "-p", project, "-f", str(f), "up", "-d"], on_line)
    return ""  # múltiplos containers: sem um id único


def _compose_lifecycle(row: ProjectService, action: str) -> None:
    cfg = P._config(row)
    f = COMPOSE_DIR / compose_project(row) / "docker-compose.yml"
    project = compose_project(row)
    if (cfg.get("mode") or "compose") == "stack":
        if action in ("stop", "remove"):
            _run_compose(["docker", "stack", "rm", project])
        else:
            _run_compose(["docker", "stack", "deploy", "-c", str(f), project])
        return
    verb = {"start": "start", "stop": "stop", "restart": "restart", "remove": "down"}[action]
    _run_compose(["docker", "compose", "-p", project, "-f", str(f), verb])


def _env_pairs(env_text: str) -> list[str]:
    """Converte o texto do editor (KEY=VALUE por linha) em lista `["K=V"]`."""
    out = []
    for raw in (env_text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        out.append(line)
    return out


def image_for(cfg: dict) -> str:
    """Imagem docker do banco: `config.image` custom ou `<image>:<version>`."""
    if cfg.get("image"):
        return str(cfg["image"]).strip()
    engine = cfg.get("engine")
    meta = P.DB_ENGINES.get(engine, {})
    version = (cfg.get("version") or meta.get("versions", ["latest"])[0])
    return f"{meta.get('image', engine)}:{version}"


def _db_env(cfg: dict) -> tuple[list[str], list[str] | None]:
    """Env + Cmd específicos do engine. Cmd = None usa o default da imagem."""
    engine = cfg.get("engine")
    user = (cfg.get("user") or "").strip()
    password = cfg.get("password") or ""
    database = (cfg.get("database") or user or "app").strip()
    env: list[str] = []
    cmd: list[str] | None = None
    if engine == "postgres":
        env = [f"POSTGRES_USER={user or 'postgres'}", f"POSTGRES_PASSWORD={password}",
               f"POSTGRES_DB={database}"]
    elif engine in ("mysql", "mariadb"):
        env = [f"MYSQL_ROOT_PASSWORD={password}", f"MYSQL_DATABASE={database}"]
        if user and user != "root":
            env += [f"MYSQL_USER={user}", f"MYSQL_PASSWORD={password}"]
    elif engine == "mongodb":
        env = [f"MONGO_INITDB_ROOT_USERNAME={user or 'root'}",
               f"MONGO_INITDB_ROOT_PASSWORD={password}", f"MONGO_INITDB_DATABASE={database}"]
    elif engine == "redis":
        cmd = ["redis-server", "--requirepass", password]
    elif engine == "cassandra":
        env = [f"CASSANDRA_CLUSTER_NAME={database}"]
    return env, cmd


def _host_config(row: ProjectService, cfg: dict, internal_port: int) -> tuple[dict, dict]:
    """Monta HostConfig + ExposedPorts (rede, volume, bind externo, recursos)."""
    host: dict = {
        "RestartPolicy": {"Name": "unless-stopped"},
        "NetworkMode": P.network_name(),
        "Binds": [f"{P.volume_name(row)}:{_data_dir(cfg)}"],
    }
    exposed: dict = {}
    if cfg.get("expose") and internal_port:
        ext = int(cfg.get("external_port") or internal_port)
        host["PortBindings"] = {f"{internal_port}/tcp": [{"HostPort": str(ext)}]}
        exposed[f"{internal_port}/tcp"] = {}
    res = cfg.get("resources") or {}
    cpu_limit = float(res.get("cpu_limit") or res.get("cpu") or 0)
    cpu_reservation = float(res.get("cpu_reservation") or 0)
    memory_limit = int(res.get("memory_limit_mb") or res.get("memory_mb") or 0)
    memory_reservation = int(res.get("memory_reservation_mb") or 0)
    if cpu_limit:
        host["NanoCpus"] = int(cpu_limit * 1_000_000_000)
    if cpu_reservation:
        host["CpuShares"] = max(int(cpu_reservation * 1024), 2)
    if memory_limit:
        host["Memory"] = memory_limit * 1024 * 1024
    if memory_reservation:
        host["MemoryReservation"] = memory_reservation * 1024 * 1024
    ulimits = cfg.get("ulimits") or []
    if ulimits:
        host["Ulimits"] = [
            {"Name": str(u["name"]), "Soft": int(u.get("soft") or 0), "Hard": int(u.get("hard") or u.get("soft") or 0)}
            for u in ulimits
            if u.get("name")
        ]
    # Volumes extras definidos pelo usuário.
    for v in cfg.get("volumes") or []:
        src, tgt = (v.get("source") or "").strip(), (v.get("target") or "").strip()
        if src and tgt:
            host["Binds"].append(f"{src}:{tgt}")
    return host, exposed


def _data_dir(cfg: dict) -> str:
    """Diretório de dados padrão por engine (destino do volume nomeado)."""
    return {
        "postgres": "/var/lib/postgresql/data", "mysql": "/var/lib/mysql",
        "mariadb": "/var/lib/mysql", "mongodb": "/data/db",
        "redis": "/data", "cassandra": "/var/lib/cassandra",
    }.get(cfg.get("engine"), "/data")


def deploy_database(row: ProjectService, on_line=None) -> str:
    """Pull + (re)cria + inicia o container do banco. Retorna o container_id."""
    cfg = P._config(row)
    image = image_for(cfg)
    internal_port = DB_PORTS.get(cfg.get("engine"), 0)
    log = on_line or (lambda _l: None)

    log(f"Puxando imagem {image}…")
    D.pull_image(image, on_line=on_line)
    D.ensure_network(P.network_name())
    D.ensure_volume(P.volume_name(row))

    env, cmd = _db_env(cfg)
    env += _env_pairs(str(cfg.get("env") or ""))
    host_config, exposed = _host_config(row, cfg, internal_port)
    spec: dict = {
        "Image": image, "Env": env, "HostConfig": host_config,
        "ExposedPorts": exposed,
        "Labels": {"nexus.service": str(row.id), "nexus.managed": "true"},
    }
    # Command custom sobrepõe o default do engine.
    custom = (cfg.get("command") or "").strip()
    if custom:
        args = [
            str(item.get("value") or "").strip()
            for item in (cfg.get("command_args") or [])
            if isinstance(item, dict) and str(item.get("value") or "").strip()
        ]
        spec["Cmd"] = [*custom.split(), *args]
    elif cmd:
        spec["Cmd"] = cmd

    name = P.container_name(row)
    log(f"Criando container {name}…")
    cid = D.create_container(name, spec)
    log("Iniciando…")
    D.start_container(cid)
    log("Container em execução.")
    return cid


# --- Application -------------------------------------------------------------

def _app_provider(provider_type: str) -> GitProviderRow | None:
    """Primeiro git provider do tipo pedido (p/ URL de clone autenticada)."""
    if provider_type not in P.CONFIGURED_APP_PROVIDERS:
        return None
    with get_session() as s:
        return s.query(GitProviderRow).filter(GitProviderRow.type == provider_type).first()


def _app_clone_url(cfg: dict) -> str:
    """URL de clone autenticada da aplicação.

    O `git_url` do serviço tem prioridade; se estiver vazio (o form guardou só o
    `github_repo` = owner/name), deriva a partir do `base_url` do provider. Para
    GitHub App, usa o `github_installation_id` do serviço.
    """
    from . import gitproviders
    provider_type = str(cfg.get("provider") or "")
    provider_row = _app_provider(provider_type)
    provider_id = provider_row.id if provider_row else None
    git_url = str(cfg.get("git_url") or "").strip()
    if not git_url:
        repo = str(cfg.get("github_repo") or "").strip().strip("/")
        if repo:
            base = ((provider_row.base_url if provider_row else "") or "https://github.com").rstrip("/")
            git_url = f"{base}/{repo}.git"
    if not git_url:
        raise D.DockerError(
            "repositório da aplicação não configurado (defina o git_url ou selecione o repositório)")
    installation_id = str(cfg.get("github_installation_id") or "").strip()
    return gitproviders.build_clone_url(provider_id, git_url, installation_id)


def _clone_app(cfg: dict, dest: Path, log) -> None:
    """Clona o repositório da aplicação no branch pedido (default se vazio).

    Mesma abordagem de deploy.py::_clone — `--depth 1`, timeout obrigatório
    (único subprocess exposto a rede externa) e remoção do `.git`.
    """
    if shutil.which("git") is None:
        raise D.DockerError("binário 'git' não encontrado (adicione ao Dockerfile do runtime)")
    url = _app_clone_url(cfg)
    branch = str(cfg.get("branch") or "").strip()
    args = ["git", "clone", "--depth", "1"]
    if branch:
        args += ["--branch", branch]
    args += [url, str(dest)]
    log(f"git clone --depth 1{f' --branch {branch}' if branch else ''} {url} → {dest}")
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=GIT_CLONE_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise D.DockerError(f"clone excedeu o timeout ({GIT_CLONE_TIMEOUT}s)")
    if proc.returncode != 0:
        raise D.DockerError(f"git clone falhou: {proc.stderr[-500:].strip()}")
    shutil.rmtree(dest / ".git", ignore_errors=True)
    log("clone concluído")


def _context_tar(root: Path, log) -> bytes:
    """Empacota o diretório clonado num tar (contexto de build docker), pulando
    `.git` e rejeitando symlinks que escapem da árvore."""
    root_resolved = root.resolve()
    buf = io.BytesIO()
    # GNU_FORMAT evita as entradas `././@PaxHeader` que o formato PAX (default)
    # emite p/ mtime sub-segundo — o BuildKit as lê como se fossem o Dockerfile
    # ("unknown instruction: ././@PaxHeader").
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if rel.parts and rel.parts[0] == ".git":
                continue
            if path.is_symlink() and not path.resolve().is_relative_to(root_resolved):
                raise D.DockerError(f"symlink escapando o contexto de build: {rel}")
            tar.add(path, arcname=str(rel), recursive=False)
    log(f"contexto de build empacotado ({buf.tell() // 1024} KiB)")
    return buf.getvalue()


def _app_host_config(row: ProjectService, cfg: dict) -> tuple[dict, dict]:
    """HostConfig + ExposedPorts da aplicação (rede/portas/volumes/recursos).

    Reusa `_host_config` (recursos/ulimits/volumes extras) mas sem o volume de
    dados nomeado do banco e mapeando as `ports` ({host, container}) do serviço.
    """
    host, exposed = _host_config(row, cfg, 0)
    host["Binds"] = [b for b in host.get("Binds", [])
                     if not b.startswith(f"{P.volume_name(row)}:")]
    bindings: dict = {}
    for p in cfg.get("ports") or []:
        container_port = str(p.get("container") or "").strip()
        host_port = str(p.get("host") or "").strip()
        if not container_port:
            continue
        key = container_port if "/" in container_port else f"{container_port}/tcp"
        exposed[key] = {}
        if host_port:
            bindings[key] = [{"HostPort": host_port}]
    if bindings:
        host["PortBindings"] = bindings
    return host, exposed


def deploy_application_static(row: ProjectService, cfg: dict, on_line=None) -> str:
    """SPA/estático: clona o repositório e publica os arquivos em APPS_DIR/<slug>
    (troca do diretório de forma quase atômica). Não sobe container."""
    log = on_line or (lambda _l: None)
    dest = P.app_static_dir(row)
    APPS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = APPS_DIR / f".{dest.name}.{row.id}.tmp"
    old = APPS_DIR / f".{dest.name}.{row.id}.old"
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(old, ignore_errors=True)
    _clone_app(cfg, tmp, log)
    if dest.exists():
        os.rename(dest, old)
    try:
        os.rename(tmp, dest)
    except OSError:
        if old.exists():  # restaura a versão anterior se a troca falhar
            os.rename(old, dest)
        raise
    shutil.rmtree(old, ignore_errors=True)
    log(f"arquivos publicados em {dest}")
    return ""  # sem container


def deploy_application_docker(row: ProjectService, cfg: dict, on_line=None) -> str:
    """Build type dockerfile: clona → docker build → cria/inicia o container
    `app-<slug>-<id>`. Retorna o container_id."""
    log = on_line or (lambda _l: None)
    clone_dir = BUILD_DIR / P.container_name(row)
    shutil.rmtree(clone_dir, ignore_errors=True)
    clone_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        _clone_app(cfg, clone_dir, log)
        context_rel = (cfg.get("docker_context") or ".").strip() or "."
        context_dir = (clone_dir / context_rel).resolve()
        if not context_dir.is_relative_to(clone_dir.resolve()) or not context_dir.is_dir():
            raise D.DockerError(f"contexto de build inválido: {context_rel}")
        dockerfile = (cfg.get("dockerfile") or "Dockerfile").strip() or "Dockerfile"
        build_cache = cfg.get("docker_build_cache") is not False
        tar = _context_tar(context_dir, log)
        tag = f"{P.container_name(row)}:latest"

        no_cache_arg = "" if build_cache else " --no-cache"
        log(f"docker build{no_cache_arg} -t {tag} -f {dockerfile} {context_rel}")
        D.build_image(tag, tar, dockerfile=dockerfile, on_line=on_line,
                      timeout=DOCKER_BUILD_TIMEOUT, no_cache=not build_cache)
    finally:
        shutil.rmtree(clone_dir, ignore_errors=True)

    D.ensure_network(P.network_name())
    env = _env_pairs(str(cfg.get("env") or ""))
    host_config, exposed = _app_host_config(row, cfg)
    spec: dict = {
        "Image": tag, "Env": env, "HostConfig": host_config,
        "ExposedPorts": exposed,
        "Labels": {"nexus.service": str(row.id), "nexus.managed": "true"},
    }
    command = (cfg.get("command") or "").strip()
    if command:
        args = [
            str(item.get("value") or "").strip()
            for item in (cfg.get("command_args") or [])
            if isinstance(item, dict) and str(item.get("value") or "").strip()
        ]
        spec["Cmd"] = [*command.split(), *args]

    name = P.container_name(row)
    log(f"Criando container {name}…")
    cid = D.create_container(name, spec)
    log("Iniciando…")
    D.start_container(cid)
    log("Container em execução.")
    return cid


def deploy_application_spa(row: ProjectService, on_line=None) -> str:
    """Provider `spa`: sem repositório — os arquivos vivem em APPS_DIR/<slug> e
    são geridos manualmente pelo file manager. O deploy só garante o diretório."""
    log = on_line or (lambda _l: None)
    dest = P.app_static_dir(row)
    dest.mkdir(parents=True, exist_ok=True)
    log(f"SPA servida de {dest} (arquivos geridos manualmente pelo gerenciador de arquivos)")
    return ""


def deploy_application(row: ProjectService, on_line=None) -> str:
    """Dispatch por build type: static publica arquivos, dockerfile sobe container.

    O provider `spa` é um static sem repo (arquivos manuais) — não clona nada."""
    cfg = P._config(row)
    if cfg.get("build_type") == "static":
        if cfg.get("provider") == "spa":
            return deploy_application_spa(row, on_line=on_line)
        return deploy_application_static(row, cfg, on_line=on_line)
    return deploy_application_docker(row, cfg, on_line=on_line)


def deploy(row: ProjectService, on_line=None) -> str:
    """Dispatch por tipo (database, compose e application)."""
    if row.kind == "database":
        return deploy_database(row, on_line=on_line)
    if row.kind == "compose":
        return deploy_compose(row, on_line=on_line)
    if row.kind == "application":
        return deploy_application(row, on_line=on_line)
    raise D.DockerError(f"provisionamento de '{row.kind}' ainda não implementado")


def start(row: ProjectService) -> None:
    if row.kind == "compose":
        return _compose_lifecycle(row, "start")
    if P.is_static_app(row):
        return  # arquivos estáticos não têm processo p/ iniciar
    D.start_container(P.container_name(row))


def stop(row: ProjectService) -> None:
    if row.kind == "compose":
        return _compose_lifecycle(row, "stop")
    if P.is_static_app(row):
        return  # nada a parar num app estático
    D.stop_container(P.container_name(row))


def restart(row: ProjectService) -> None:
    if row.kind == "compose":
        return _compose_lifecycle(row, "restart")
    if P.is_static_app(row):
        return  # sem processo; um novo deploy republica os arquivos
    D.restart_container(P.container_name(row))


def remove(row: ProjectService, *, with_volume: bool = False) -> None:
    if row.kind == "compose":
        try:
            _compose_lifecycle(row, "remove")
        except D.DockerError:
            pass
        return
    if P.is_static_app(row):
        shutil.rmtree(P.app_static_dir(row), ignore_errors=True)  # apaga os arquivos publicados
        return
    D.remove_container(P.container_name(row), force=True, volumes=False, missing_ok=True)
    if with_volume:
        # remove_container(v=1) só apaga volumes anônimos; o nosso é nomeado.
        D._ok(*D._request("DELETE", f"/volumes/{P.volume_name(row)}"), ok=(204, 404))


def rebuild_database(row: ProjectService, on_line=None) -> str:
    """Danger zone: destrói o volume de dados e recria o container do zero."""
    remove(row, with_volume=True)
    return deploy_database(row, on_line=on_line)


def live_state(row: ProjectService) -> str:
    """Estado real do container (running|exited|absent|…)."""
    try:
        return D.container_state(P.container_name(row))
    except D.DockerError:
        return "unknown"
