"""Rotas /ai: cadastro e teste de providers de inteligência artificial."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import aiproviders
from ..auth import require_token
from ..envelope import envelope, message

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(require_token)])


def _run(operation):
    try:
        return operation()
    except aiproviders.AiProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@router.get("/provider-types")
def provider_types():
    return envelope(data=aiproviders.PROVIDER_TYPES)


@router.get("/providers")
def list_providers():
    return envelope(data=aiproviders.list_providers())


@router.post("/providers", status_code=201)
def create_provider(payload: dict = Body(...)):
    data = _run(lambda: aiproviders.create_provider(payload))
    return envelope(data=data, messages=[message("provider IA criado", "success")])


@router.post("/providers/test")
def test_provider_config(payload: dict = Body(...)):
    """Testa os dados do modal sem exigir que o provider já esteja salvo."""
    data = _run(lambda: aiproviders.test_payload(payload))
    return envelope(data=data, messages=[message("conexão com o provider validada", "success")])


@router.get("/providers/{provider_id}")
def get_provider(provider_id: int):
    return envelope(data=_run(lambda: aiproviders.get_provider(provider_id)))


@router.put("/providers/{provider_id}")
def update_provider(provider_id: int, payload: dict = Body(...)):
    data = _run(lambda: aiproviders.update_provider(provider_id, payload))
    return envelope(data=data, messages=[message("provider IA atualizado", "success")])


@router.delete("/providers/{provider_id}")
def delete_provider(provider_id: int):
    _run(lambda: aiproviders.delete_provider(provider_id))
    return envelope(data={"deleted": provider_id}, messages=[message("provider IA removido", "success")])


@router.post("/providers/{provider_id}/test")
def test_provider(provider_id: int):
    data = _run(lambda: aiproviders.test_provider(provider_id))
    return envelope(data=data, messages=[message("conexão com o provider validada", "success")])
