"""Rotas de Status pages.

- **admin** (`/monitors/status-pages`, RBAC → recurso `monitors`): CRUD.
- **público** (`/status/{slug}`, sem auth — ver `api/authz.py::_PUBLIC_PREFIXES`):
  renderiza o HTML self-contained da página e um JSON de dados não sensíveis.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse

from .. import statuspages
from ..auth import require_token
from ..envelope import envelope, message
from ..statuspages import StatusPageError

router = APIRouter(prefix="/monitors/status-pages", tags=["monitors"],
                   dependencies=[Depends(require_token)])

# Rotas públicas (sem auth) — a página é pública por natureza.
public_router = APIRouter(prefix="/status", tags=["status"])


def _guard(fn):
    try:
        return fn()
    except StatusPageError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("")
def list_pages(search: str = Query(""), page: int | None = Query(None), limit: int = Query(50)):
    return envelope(data=statuspages.list_pages(search=search, page=page, limit=limit))


@router.get("/{page_id}")
def get_page(page_id: int):
    return envelope(data=_guard(lambda: statuspages.get_page(page_id)))


@router.post("", status_code=201)
def create_page(payload: dict = Body(...)):
    data = _guard(lambda: statuspages.create_page(payload))
    return envelope(data=data, messages=[message("página criada", "success")])


@router.put("/{page_id}")
def update_page(page_id: int, payload: dict = Body(...)):
    data = _guard(lambda: statuspages.update_page(page_id, payload))
    return envelope(data=data, messages=[message("página atualizada", "success")])


@router.delete("/{page_id}")
def delete_page(page_id: int):
    _guard(lambda: statuspages.delete_page(page_id))
    return envelope(data={"deleted": page_id}, messages=[message("página removida", "success")])


# --- público -----------------------------------------------------------------

@public_router.get("/{slug}", response_class=HTMLResponse)
def render_page(slug: str):
    try:
        return HTMLResponse(statuspages.render_html(slug))
    except StatusPageError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@public_router.get("/{slug}/data")
def page_data(slug: str):
    try:
        return JSONResponse(statuspages.public_data(slug))
    except StatusPageError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
