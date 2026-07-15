"""Imagens Docker: listagem enriquecida, histórico de camadas, checagem de
atualização no registry (digest) e scan de vulnerabilidades (trivy, best-effort).

Tudo sobre o `dockerclient` (Engine API via unix socket). As partes que dependem
de rede/ferramenta externa (updates, scan) degradam com clareza quando não há
credencial/binário disponível.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from . import appsettings
from . import dockerclient as D

TRIVY_TIMEOUT = int(os.environ.get("TRIVY_TIMEOUT", "300"))
REGISTRY_TIMEOUT = 8
SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")

# Trivy roda num container efêmero (não é instalado na imagem da API). O toggle
# vive nas configurações (aba Docker, `docker_scan_enabled`); imagem/cache/timeout
# seguem no .env (infra). O default do toggle herda de TRIVY_ENABLED por compat.
TRIVY_IMAGE = os.environ.get("TRIVY_IMAGE", "aquasec/trivy:latest").strip()
TRIVY_CACHE_VOLUME = os.environ.get("TRIVY_CACHE_VOLUME", "nexus-trivy-cache").strip()
DOCKER_SOCKET = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")


def scanner_enabled() -> bool:
    return appsettings.get_bool("docker_scan_enabled")

_MANIFEST_ACCEPT = ", ".join([
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
])


class ToolUnavailable(Exception):
    """Ferramenta externa ausente (ex.: trivy não instalado)."""


def _short_id(image_id: str) -> str:
    return image_id.split(":", 1)[-1][:12] if image_id else ""


# --- Listagem ----------------------------------------------------------------

def list_images() -> list[dict]:
    """Imagens locais com uso por containers, tamanho e data de criação."""
    images = D.list_images(all_=False)
    used: dict[str, list[dict]] = {}
    for c in D.list_containers(all_=True):
        used.setdefault(c.get("image_id", ""), []).append(
            {"name": c.get("name", ""), "state": c.get("state", "")})
    out = []
    for im in images:
        image_id = im.get("Id", "")
        repo_tags = [t for t in (im.get("RepoTags") or []) if t and t != "<none>:<none>"]
        containers = used.get(image_id, [])
        name = repo_tags[0].rsplit(":", 1)[0] if repo_tags else "<none>"
        out.append({
            "id": image_id,
            "short_id": _short_id(image_id),
            "name": name,
            "tags": repo_tags,
            "repo_digests": [d for d in (im.get("RepoDigests") or []) if d],
            "size": int(im.get("Size", 0) or 0),
            "created": int(im.get("Created", 0) or 0) * 1000,
            "containers": containers,
            "in_use": bool(containers),
            "dangling": len(repo_tags) == 0,
        })
    out.sort(key=lambda i: (not i["in_use"], i["name"]))
    return out


def summary(images: list[dict]) -> dict:
    return {"total": len(images), "size": sum(i["size"] for i in images)}


# --- Histórico de camadas ("imagem da tag") ----------------------------------

def history(name: str) -> list[dict]:
    return [{
        "id": h.get("Id", ""),
        "created": int(h.get("Created", 0) or 0) * 1000,
        "created_by": h.get("CreatedBy", ""),
        "size": int(h.get("Size", 0) or 0),
        "comment": h.get("Comment", ""),
        "tags": [t for t in (h.get("Tags") or []) if t],
    } for h in D.image_history(name)]


# --- Atualizações (digest no registry) ---------------------------------------

def _parse_ref(ref: str) -> tuple[str, str, str]:
    """(registry, repositório, tag) de uma referência `repo:tag`."""
    ref = ref.split("@", 1)[0]
    name, sep, tag = ref.rpartition(":")
    if not sep or "/" in tag:  # ':' fazia parte de um host:porta, não de uma tag
        name, tag = ref, "latest"
    first = name.split("/", 1)[0]
    if "." in first or ":" in first or first == "localhost":
        registry, repo = first, name.split("/", 1)[1]
    else:
        registry = "docker.io"
        repo = name if "/" in name else f"library/{name}"
    return registry, repo, tag


def _registry_host(registry: str) -> str:
    return "registry-1.docker.io" if registry == "docker.io" else registry


def _bearer_token(www_authenticate: str) -> str:
    """Resolve um token anônimo a partir do desafio `WWW-Authenticate: Bearer …`."""
    if not www_authenticate.lower().startswith("bearer "):
        return ""
    params: dict[str, str] = {}
    for part in www_authenticate[7:].split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k.strip()] = v.strip().strip('"')
    realm = params.get("realm")
    if not realm:
        return ""
    query = urllib.parse.urlencode(
        {k: params[k] for k in ("service", "scope") if params.get(k)})
    url = f"{realm}?{query}" if query else realm
    try:
        with urllib.request.urlopen(url, timeout=REGISTRY_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        return str(data.get("token") or data.get("access_token") or "")
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return ""


def _remote_digest(registry: str, repo: str, tag: str) -> str:
    host = _registry_host(registry)
    url = f"https://{host}/v2/{repo}/manifests/{tag}"

    def head(token: str):
        req = urllib.request.Request(url, method="HEAD")
        req.add_header("Accept", _MANIFEST_ACCEPT)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        return urllib.request.urlopen(req, timeout=REGISTRY_TIMEOUT)

    try:
        resp = head("")
        return resp.headers.get("Docker-Content-Digest", "")
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            token = _bearer_token(exc.headers.get("WWW-Authenticate", ""))
            if not token:
                return ""
            try:
                resp = head(token)
                return resp.headers.get("Docker-Content-Digest", "")
            except (urllib.error.URLError, OSError):
                return ""
        return ""
    except (urllib.error.URLError, OSError):
        return ""


def _local_digest(image: dict, registry: str, repo: str) -> str:
    for d in image.get("repo_digests") or []:
        if "@" in d and (repo in d or registry in d):
            return d.split("@", 1)[1]
    digests = image.get("repo_digests") or []
    return digests[0].split("@", 1)[1] if digests and "@" in digests[0] else ""


def _update_status(image: dict) -> str:
    """`outdated` | `current` | `unknown` comparando digest local x registry."""
    tags = image.get("tags") or []
    if not tags or image.get("dangling"):
        return "unknown"
    registry, repo, tag = _parse_ref(tags[0])
    local = _local_digest(image, registry, repo)
    if not local:
        return "unknown"
    remote = _remote_digest(registry, repo, tag)
    if not remote:
        return "unknown"
    return "current" if remote == local else "outdated"


def check_updates(images: list[dict]) -> dict[str, str]:
    """Mapa id → status de atualização (checagem paralela best-effort)."""
    if not images:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(images))) as pool:
        statuses = list(pool.map(_update_status, images))
    return {im["id"]: st for im, st in zip(images, statuses)}


# --- Vulnerabilidades (trivy) ------------------------------------------------
# A execução do scan (fila + worker + container efêmero) vive em `api/trivyscan.py`.
# Aqui ficam só o toggle (`scanner_enabled`) e as constantes TRIVY_* usadas por lá.
