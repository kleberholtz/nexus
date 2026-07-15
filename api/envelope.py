"""Envelope padrão de resposta da API.

Todas as respostas (sucesso e erro) seguem o formato:

    {
      "success": true,
      "data": [],
      "messages": [ {"type": "warn", "message": "..."} ]
    }
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi.responses import JSONResponse

MessageType = Literal["warn", "error", "success"]


def message(text: str, type: MessageType = "warn") -> dict:
    return {"type": type, "message": text}


def envelope(data: Any = None, success: bool = True,
             messages: list[dict] | None = None) -> dict:
    """Monta o dict do envelope. `data` vira [] quando None."""
    return {
        "success": success,
        "data": [] if data is None else data,
        "messages": messages or [],
    }


def json_response(data: Any = None, *, success: bool = True,
                  messages: list[dict] | None = None,
                  status_code: int = 200) -> JSONResponse:
    """Envelope como JSONResponse (usado nos exception handlers)."""
    return JSONResponse(
        status_code=status_code,
        content=envelope(data=data, success=success, messages=messages),
    )
