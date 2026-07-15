"""WebSocket: terminal TTY real de um serviço (grupo CI/CD).

Faz o *bridge* entre o WebSocket e um `docker exec` com TTY (hijack do socket
unix em `dockerclient.exec_interactive`). Bytes do container → `send_bytes`;
mensagens de texto do cliente são JSON de controle (`{"type":"resize",...}`),
mensagens binárias são a entrada (stdin) do usuário.

O middleware RBAC é `@app.middleware("http")` — não roda em WebSocket. Então a
autenticação é feita aqui, pelo `?token=` (mesmo esquema do SSE), exigindo
`projects:write`.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .. import dockerclient
from .. import projects as P
from ..auth import resolve_identity

router = APIRouter()


async def _terminal_bridge(websocket: WebSocket, cid: str, shell: str = "sh") -> None:
    cmd = ["/bin/bash"] if shell == "bash" else ["/bin/sh"]
    if not dockerclient.available():
        await websocket.accept()
        await websocket.send_text("Docker indisponível — monte /var/run/docker.sock\r\n")
        await websocket.close()
        return

    await websocket.accept()
    try:
        exec_id, sock, rest = await asyncio.to_thread(
            dockerclient.exec_interactive, cid, cmd)
    except dockerclient.DockerError as exc:
        await websocket.send_text(f"{exc}\r\n")
        await websocket.close()
        return

    async def reader():
        """Lê a saída do container e envia ao WebSocket."""
        try:
            if rest:
                await websocket.send_bytes(rest)
            while True:
                data = await asyncio.to_thread(sock.recv, 4096)
                if not data:
                    break
                await websocket.send_bytes(data)
        except (OSError, WebSocketDisconnect, RuntimeError):
            pass
        finally:
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.close()

    reader_task = asyncio.create_task(reader())
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if text is not None:
                try:
                    obj = json.loads(text)
                    if obj.get("type") == "resize":
                        await asyncio.to_thread(
                            dockerclient.exec_resize, exec_id,
                            int(obj.get("cols") or 80), int(obj.get("rows") or 24))
                except (json.JSONDecodeError, dockerclient.DockerError, ValueError):
                    pass
                continue
            data = message.get("bytes")
            if data:
                await asyncio.to_thread(sock.sendall, data)
    except WebSocketDisconnect:
        pass
    finally:
        reader_task.cancel()
        try:
            sock.close()
        except OSError:
            pass


@router.websocket("/projects/{project_id}/services/{service_id}/terminal")
async def service_terminal(websocket: WebSocket, project_id: int, service_id: int):
    identity = resolve_identity(websocket.query_params.get("token", ""))
    if identity is None or not identity.has("projects", "write"):
        await websocket.close(code=4401)  # não autorizado
        return

    try:
        cid = P.container_for(
            project_id, service_id, websocket.query_params.get("container", ""))
    except KeyError:
        await websocket.close(code=4404)
        return
    except ValueError:
        await websocket.close(code=4400)
        return
    await _terminal_bridge(websocket, cid, websocket.query_params.get("shell", "sh"))


@router.websocket("/docker/containers/{container_id}/terminal")
async def docker_terminal(websocket: WebSocket, container_id: str):
    identity = resolve_identity(websocket.query_params.get("token", ""))
    if identity is None or not identity.has("docker", "write"):
        await websocket.close(code=4401)
        return
    await _terminal_bridge(websocket, container_id, websocket.query_params.get("shell", "sh"))
