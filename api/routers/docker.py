"""Rotas /docker: inspeção e operação dos containers do host.

Lista todos os containers (nome/estado/status/imagem) e, por container, expõe
inspect (config/mounts/networks), logs ao vivo (SSE) e um exec de comando
(terminal/console). Exige o socket do Docker montado; sem ele responde 409.
Recurso RBAC `docker` (sensível: alcança qualquer container do host).
"""
from __future__ import annotations

import asyncio
import datetime as dt
import ipaddress
import json
import math
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from .. import appsettings
from .. import dockerclient
from .. import dockerimages
from .. import trivyscan
from ..auth import identity_from_request, require_token
from ..envelope import envelope, message

router = APIRouter(prefix="/docker", tags=["docker"], dependencies=[Depends(require_token)])


def _guard() -> None:
    if not dockerclient.available():
        raise HTTPException(status_code=409, detail=(
            "Docker não disponível — monte /var/run/docker.sock no container"))


def _paginate(items: list, page: int, limit: int) -> tuple[list, dict]:
    """Fatia `items` na página pedida (limit ≤ 50). Devolve (slice, meta)."""
    total = len(items)
    pages = max(1, math.ceil(total / limit)) if limit else 1
    page = max(1, min(page, pages))
    start = (page - 1) * limit
    return items[start:start + limit], {"total": total, "page": page, "pages": pages}


def _container_ip(info: dict) -> str:
    """IP do container: rede default ou o 1º com IP nas Networks."""
    ns = (info or {}).get("NetworkSettings") or {}
    if ns.get("IPAddress"):
        return ns["IPAddress"]
    for net in (ns.get("Networks") or {}).values():
        if net and net.get("IPAddress"):
            return net["IPAddress"]
    return ""


def _ports(info: dict) -> list[dict]:
    """Portas do container como `[{text, proto, published}]`.

    Publicadas (HostConfig.PortBindings) viram `host:container` (published=True);
    apenas expostas (Config.ExposedPorts, sem mapeamento) ficam `container`
    (published=False, exibidas esmaecidas no painel)."""
    bindings = ((info.get("HostConfig") or {}).get("PortBindings")) or {}
    exposed = ((info.get("Config") or {}).get("ExposedPorts")) or {}
    out: list[dict] = []
    for port, binds in bindings.items():
        cport, _, proto = port.partition("/")
        for b in (binds or [{}]):
            host_port = b.get("HostPort", "")
            text = f"{host_port}:{cport}" if host_port else cport
            out.append({"text": text, "proto": (proto or "tcp").upper(), "published": True})
    for port in exposed:
        if port in bindings:
            continue
        cport, _, proto = port.partition("/")
        out.append({"text": cport, "proto": (proto or "tcp").upper(), "published": False})
    return out


@router.get("/containers")
def list_containers(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=50),
    search: str = Query(""),
    state: str = Query(""),
):
    _guard()
    try:
        base = dockerclient.list_containers(all_=True)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    states = sorted({c.get("state", "") for c in base if c.get("state")})
    q = search.strip().lower()
    filtered = [c for c in base if (
        (not q or q in c.get("name", "").lower() or q in c.get("image", "").lower())
        and (not state or c.get("state") == state))]
    items, meta = _paginate(filtered, page, limit)
    out = []
    for c in items:  # inspeciona só a página (evita N+1 na lista inteira)
        try:
            info = dockerclient.inspect_container(c["id"])
        except dockerclient.DockerError:
            info = None
        host = (info or {}).get("HostConfig") or {}
        out.append({
            **c,
            "ip": _container_ip(info or {}),
            "ports": _ports(info or {}),
            "restart_policy": (host.get("RestartPolicy") or {}).get("Name") or "",
            "auto_remove": bool(host.get("AutoRemove")),
        })
    running = sum(1 for c in base if c.get("state") == "running")
    return envelope(data={
        "containers": out, "states": states,
        "summary": {"total": len(base), "running": running}, **meta,
    })


@router.get("/containers/updates")
def container_updates():
    """Mapa container_id → status de atualização da imagem (outdated/current/unknown).
    Reusa a checagem de digest das imagens: computa 1x por imagem, não por container."""
    _guard()
    try:
        images = dockerimages.list_images()
        img_status = dockerimages.check_updates(images)  # image_id → status
        by_id = {im["id"]: im["id"] for im in images}
        containers = dockerclient.list_containers(all_=True)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    out = {}
    for c in containers:
        iid = c.get("image_id", "")
        out[c["id"]] = img_status.get(by_id.get(iid, iid), "unknown")
    return envelope(data=out)


@router.get("/containers/stats/stream")
async def container_stats_stream(request: Request):
    """SSE do uso (cpu/memória) dos containers em execução. Cadência das settings
    (`docker_stats_interval_seconds`, aba Docker). Token via `?token=`."""
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")
    _guard()

    def _collect() -> dict:
        out: dict[str, dict] = {}
        for c in dockerclient.list_containers(all_=False):  # só os running
            try:
                out[c["id"]] = dockerclient.container_stats(c["id"])
            except dockerclient.DockerError:
                continue
        return out

    async def gen():
        while True:
            if await request.is_disconnected():
                break
            try:
                interval = max(1, int(appsettings.get_int("docker_stats_interval_seconds")))
            except Exception:  # noqa: BLE001
                interval = 1
            try:
                stats = await asyncio.to_thread(_collect)
                yield f"data: {json.dumps(stats)}\n\n"
            except Exception as exc:  # noqa: BLE001
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            await asyncio.sleep(interval)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/containers/{cid}/start")
def container_start(cid: str):
    _guard()
    try:
        dockerclient.start_container(cid)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": cid, "state": "running"}, messages=[message("container iniciado", "success")])


@router.post("/containers/{cid}/stop")
def container_stop(cid: str):
    _guard()
    try:
        dockerclient.stop_container(cid)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": cid, "state": "exited"}, messages=[message("container parado", "success")])


@router.post("/containers/{cid}/restart")
def container_restart(cid: str):
    _guard()
    try:
        dockerclient.restart_container(cid)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"id": cid, "state": "running"}, messages=[message("container reiniciado", "success")])


@router.get("/containers/{cid}/inspect")
def inspect(cid: str):
    _guard()
    try:
        info = dockerclient.inspect_container(cid)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if info is None:
        raise HTTPException(status_code=404, detail="container não encontrado")
    return envelope(data=info)


@router.post("/containers/{cid}/exec")
def container_exec(cid: str, payload: dict = Body(...)):
    _guard()
    command = (payload.get("command") or "").strip()
    if not command:
        raise HTTPException(status_code=422, detail="comando vazio")
    try:
        code, out = dockerclient.exec_run(cid, ["sh", "-c", command])
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"exit_code": code, "output": out.decode("utf-8", "replace")})


@router.get("/containers/{cid}/logs/stream")
async def logs_stream(cid: str, request: Request, tail: int = Query(200)):
    # SSE via EventSource não manda header Authorization; aceita ?token=.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")
    _guard()

    async def gen():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_event_loop()
        stop = False

        def pump():
            try:
                for line in dockerclient.stream_logs(cid, tail=tail, follow=True):
                    if stop:
                        break
                    loop.call_soon_threadsafe(queue.put_nowait, line)
            except dockerclient.DockerError as exc:
                loop.call_soon_threadsafe(queue.put_nowait, f"[erro] {exc}")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        task = asyncio.create_task(asyncio.to_thread(pump))
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if line is None:
                    break
                yield f"data: {json.dumps({'line': line})}\n\n"
        finally:
            stop = True
            task.cancel()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# --- Imagens -----------------------------------------------------------------

def _image_matches(im: dict, q: str, status: str) -> bool:
    if q and q not in im.get("name", "").lower() and not any(
            q in t.lower() for t in im.get("tags") or []):
        return False
    if status == "in_use" and not im.get("in_use"):
        return False
    if status == "dangling" and not im.get("dangling"):
        return False
    if status == "free" and (im.get("in_use") or im.get("dangling")):
        return False
    return True


@router.get("/images")
def list_images(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=50),
    search: str = Query(""),
    status: str = Query(""),
):
    _guard()
    try:
        images = dockerimages.list_images()
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    summary = dockerimages.summary(images)
    q = search.strip().lower()
    filtered = [im for im in images if _image_matches(im, q, status)]
    items, meta = _paginate(filtered, page, limit)
    return envelope(data={
        "images": items,
        "summary": summary,
        "scan_enabled": dockerimages.scanner_enabled(),
        **meta,
    })


@router.get("/images/updates")
def image_updates():
    """Mapa id → status de atualização (checagem de digest no registry)."""
    _guard()
    try:
        images = dockerimages.list_images()
        return envelope(data=dockerimages.check_updates(images))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/images/{image_id}/inspect")
def inspect_image(image_id: str):
    _guard()
    try:
        info = dockerclient.inspect_image(image_id)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if info is None:
        raise HTTPException(status_code=404, detail="imagem não encontrada")
    return envelope(data=info)


@router.get("/images/{image_id}/history")
def image_history(image_id: str):
    _guard()
    try:
        return envelope(data=dockerimages.history(image_id))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# --- Scan de vulnerabilidades (fila + worker + SSE + histórico) ---------------
# Rotas literais `/images/scans*` declaradas antes das genéricas `/images/{id}/*`.

@router.get("/images/scans/latest")
def scan_latest():
    """Mapa image_id → último scan concluído (popula os badges na listagem)."""
    return envelope(data=trivyscan.latest_all())


@router.get("/images/scans/active")
def scan_active():
    """Mapa image_id → scan em andamento (restaura o acompanhamento no reload)."""
    return envelope(data=trivyscan.active_all())


@router.get("/images/scans")
def scan_history(image_id: str = Query(""), limit: int = Query(50, ge=1, le=200)):
    return envelope(data=trivyscan.history(image_id or None, limit))


@router.get("/images/scans/{scan_id}")
def scan_detail(scan_id: int):
    """Um scan com a lista de CVEs (detalhes)."""
    row = trivyscan.get(scan_id, details=True)
    if row is None:
        raise HTTPException(status_code=404, detail="scan não encontrado")
    return envelope(data=row)


@router.get("/images/scans/{scan_id}/stream")
async def scan_stream(scan_id: int, request: Request):
    # SSE via EventSource não manda header Authorization; aceita ?token=.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")

    async def gen():
        last = None
        while True:
            if await request.is_disconnected():
                break
            row = trivyscan.get(scan_id)
            if row is None:
                yield f"data: {json.dumps({'error': 'scan não encontrado'})}\n\n"
                break
            snapshot = (row["status"], row["phase"])
            if snapshot != last:
                last = snapshot
                yield f"data: {json.dumps(row)}\n\n"
            if row["status"] in trivyscan.STATUS_FINAL:
                yield "event: end\ndata: {}\n\n"
                break
            await asyncio.sleep(0.4)

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/images/{image_id}/scan")
def scan_image(image_id: str, request: Request):
    """Enfileira um scan (roda em background, 1x por vez). Devolve o registro
    para o front acompanhar via `GET /images/scans/{id}/stream`."""
    _guard()
    info = dockerclient.inspect_image(image_id)
    tags = (info or {}).get("RepoTags") or []
    ref = next((t for t in tags if t and t != "<none>:<none>"), image_id.split(":", 1)[-1][:19])
    user = getattr(request.state, "user", "") or ""
    try:
        data = trivyscan.enqueue(image_id, ref, user)
    except trivyscan.RateLimited as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except trivyscan.ToolUnavailable as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data=data, messages=[message("scan enfileirado", "success")])


@router.post("/images/{image_id}/pull")
def pull_image(image_id: str, payload: dict = Body(default={})):
    """(Re)puxa a imagem. Usa `reference` do corpo ou a 1ª tag da imagem local."""
    _guard()
    reference = (payload.get("reference") or "").strip()
    if not reference:
        info = dockerclient.inspect_image(image_id)
        tags = (info or {}).get("RepoTags") or []
        reference = next((t for t in tags if t and t != "<none>:<none>"), "")
    if not reference:
        raise HTTPException(status_code=422, detail="imagem sem tag — informe uma referência para puxar")
    try:
        dockerclient.pull_image(reference)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"reference": reference}, messages=[message(f"imagem {reference} atualizada", "success")])


@router.delete("/images/{image_id}")
def remove_image(image_id: str, force: bool = Query(False)):
    _guard()
    try:
        deleted = dockerclient.remove_image(image_id, force=force)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"deleted": deleted}, messages=[message("imagem removida", "success")])


@router.get("/images/{image_id}/export")
def export_image(image_id: str, request: Request):
    # Download direto (âncora/nova aba): auth via ?token= como nos SSE.
    if identity_from_request(request) is None:
        raise HTTPException(status_code=401, detail="token inválido ou ausente")
    _guard()
    safe = image_id.replace("/", "_").replace(":", "_").replace("sha256_", "")[:40] or "image"
    return StreamingResponse(
        dockerimages_export(image_id), media_type="application/x-tar",
        headers={"Content-Disposition": f'attachment; filename="{safe}.tar"'},
    )


def dockerimages_export(image_id: str):
    try:
        yield from dockerclient.export_image(image_id)
    except dockerclient.DockerError:
        return


# --- Volumes -----------------------------------------------------------------

def _iso_ms(value: str) -> int:
    """CreatedAt ISO-8601 do Docker → epoch ms (0 se ausente/inválido)."""
    if not value:
        return 0
    try:
        text = re.sub(r"(\.\d{6})\d+", r"\1", value.strip().replace("Z", "+00:00"))
        return int(dt.datetime.fromisoformat(text).timestamp() * 1000)
    except (ValueError, TypeError):
        return 0


@router.get("/volumes")
def list_volumes(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=50),
    search: str = Query(""),
    status: str = Query(""),
    driver: str = Query(""),
):
    _guard()
    try:
        vols = dockerclient.list_volumes()
        usage = dockerclient.volumes_usage()
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    items = []
    for v in vols:
        name = v.get("Name", "")
        u = usage.get(name, {})
        refcount = int(u.get("refcount", -1))
        items.append({
            "name": name,
            "driver": v.get("Driver", ""),
            "mountpoint": v.get("Mountpoint", ""),
            "created": _iso_ms(v.get("CreatedAt", "")),
            "scope": v.get("Scope", ""),
            "labels": v.get("Labels") or {},
            "size": int(u.get("size", -1)),
            "refcount": refcount,
            "in_use": refcount > 0,
        })
    items.sort(key=lambda i: (i["refcount"] <= 0, i["name"]))
    summary = {
        "total": len(items),
        "unused": sum(1 for i in items if i["refcount"] == 0),
        "size": sum(i["size"] for i in items if i["size"] > 0),
    }
    drivers = sorted({i["driver"] for i in items if i["driver"]})
    q = search.strip().lower()
    filtered = [i for i in items if (
        (not q or q in i["name"].lower())
        and (status != "in_use" or i["refcount"] > 0)
        and (status != "unused" or i["refcount"] == 0)
        and (not driver or i["driver"] == driver))]
    sliced, meta = _paginate(filtered, page, limit)
    return envelope(data={"volumes": sliced, "summary": summary, "drivers": drivers, **meta})


@router.get("/volumes/{name}/inspect")
def inspect_volume(name: str):
    _guard()
    try:
        info = dockerclient.inspect_volume(name)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if info is None:
        raise HTTPException(status_code=404, detail="volume não encontrado")
    return envelope(data=info)


@router.delete("/volumes/{name}")
def remove_volume(name: str, force: bool = Query(False)):
    _guard()
    try:
        dockerclient.remove_volume(name, force=force)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return envelope(data={"deleted": name}, messages=[message("volume removido", "success")])


# --- Redes -------------------------------------------------------------------

def _ipam_stats(info: dict) -> tuple[list[dict], int]:
    """Subnets (com gateway + total de hosts) e total agregado (-1 = muito grande)."""
    subnets: list[dict] = []
    total = 0
    for cfg in (info.get("IPAM") or {}).get("Config") or []:
        subnet = cfg.get("Subnet")
        if not subnet:
            continue
        try:
            net = ipaddress.ip_network(subnet, strict=False)
        except ValueError:
            continue
        usable = max(net.num_addresses - 2, 0) if net.version == 4 else net.num_addresses
        big = usable >= 2 ** 32
        subnets.append({"subnet": subnet, "gateway": cfg.get("Gateway", ""),
                        "total": -1 if big else usable})
        if total != -1:
            total = -1 if big else total + usable
    return subnets, total


@router.get("/networks")
def list_networks(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=50),
    search: str = Query(""),
    status: str = Query(""),
    driver: str = Query(""),
):
    _guard()
    try:
        nets = dockerclient.list_networks()
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    items = []
    for n in nets:
        nid = n.get("Id", "")
        try:
            info = dockerclient.inspect_network(nid) or n
        except dockerclient.DockerError:
            info = n
        subnets, ip_total = _ipam_stats(info)
        containers = [
            {"name": c.get("Name", ""), "ipv4": (c.get("IPv4Address", "") or "").split("/")[0]}
            for c in (info.get("Containers") or {}).values()
        ]
        items.append({
            "id": nid,
            "name": n.get("Name", ""),
            "driver": n.get("Driver", ""),
            "scope": n.get("Scope", ""),
            "created": _iso_ms(info.get("Created", "")),
            "internal": bool(n.get("Internal")),
            "attachable": bool(n.get("Attachable")),
            "ipv6": bool(n.get("EnableIPv6")),
            "ipam": subnets,
            "ip_used": len(containers),
            "ip_total": ip_total,
            "containers": containers,
            "in_use": len(containers) > 0,
            "labels": n.get("Labels") or {},
        })
    items.sort(key=lambda i: (not i["in_use"], i["name"]))
    summary = {"total": len(items), "in_use": sum(1 for i in items if i["in_use"])}
    drivers = sorted({"bridge", "host", "overlay", *(i["driver"] for i in items if i["driver"])})
    q = search.strip().lower()
    filtered = [i for i in items if (
        (not q or q in i["name"].lower())
        and (status != "in_use" or i["in_use"])
        and (status != "unused" or not i["in_use"])
        and (not driver or i["driver"] == driver))]
    sliced, meta = _paginate(filtered, page, limit)
    return envelope(data={"networks": sliced, "summary": summary, "drivers": drivers, **meta})


@router.get("/networks/{name}/inspect")
def inspect_network(name: str):
    _guard()
    try:
        info = dockerclient.inspect_network(name)
    except dockerclient.DockerError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if info is None:
        raise HTTPException(status_code=404, detail="rede não encontrada")
    return envelope(data=info)
