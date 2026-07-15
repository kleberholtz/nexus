"""CRUD e teste de conexão dos provedores de inteligência artificial.

A chave de API nunca é devolvida sem máscara. Em updates e testes de uma
configuração existente, chave vazia/mascarada mantém a chave persistida.
Os testes usam apenas a stdlib e enviam uma mensagem curta ao modelo informado.
"""
from __future__ import annotations

import json
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlparse

from .db import get_session
from .db.models import AiProviderRow

MASK = "********"
TYPES = (
    "openai", "anthropic", "gemini", "perplexity", "ollama", "openrouter", "zai", "minimax",
)

PROVIDER_TYPES: list[dict] = [
    {"type": "openai", "label": "OpenAI", "default_url": "https://api.openai.com/v1",
     "api_key_required": True, "model_placeholder": "ex.: gpt-5.6"},
    {"type": "anthropic", "label": "Anthropic", "default_url": "https://api.anthropic.com/v1",
     "api_key_required": True, "model_placeholder": "ex.: claude-sonnet-5"},
    {"type": "gemini", "label": "Google Gemini",
     "default_url": "https://generativelanguage.googleapis.com/v1beta",
     "api_key_required": True, "model_placeholder": "ex.: gemini-3.5-flash"},
    {"type": "perplexity", "label": "Perplexity", "default_url": "https://api.perplexity.ai",
     "api_key_required": True, "model_placeholder": "ex.: sonar"},
    {"type": "ollama", "label": "Ollama", "default_url": "http://localhost:11434",
     "api_key_required": False, "model_placeholder": "ex.: llama3.2"},
    {"type": "openrouter", "label": "OpenRouter", "default_url": "https://openrouter.ai/api/v1",
     "api_key_required": True, "model_placeholder": "ex.: openai/gpt-5.2"},
    {"type": "zai", "label": "Z.AI", "default_url": "https://api.z.ai/api/paas/v4",
     "api_key_required": True, "model_placeholder": "ex.: glm-5.1"},
    {"type": "minimax", "label": "MiniMax", "default_url": "https://api.minimax.io/v1",
     "api_key_required": True, "model_placeholder": "ex.: MiniMax-M2.7"},
]

_TYPE_META = {item["type"]: item for item in PROVIDER_TYPES}
_HTTP_TIMEOUT = 60
_MAX_RESPONSE_BYTES = 256 * 1024


class AiProviderError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json(row: AiProviderRow) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "name": row.name,
        "api_url": row.api_url,
        "api_key": MASK if row.api_key else "",
        "has_api_key": bool(row.api_key),
        "model": row.model,
        "enabled": bool(row.enabled),
        "created_ts": row.created_ts,
        "updated_ts": row.updated_ts,
    }


def _required_text(value, label: str, max_length: int) -> str:
    clean = str(value or "").strip()
    if not clean:
        raise AiProviderError(f"{label} é obrigatório")
    if len(clean) > max_length:
        raise AiProviderError(f"{label} excede {max_length} caracteres")
    return clean


def _validate_url(value) -> str:
    url = _required_text(value, "API URL", 1000).rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AiProviderError("API URL deve começar com http:// ou https://")
    if parsed.username or parsed.password:
        raise AiProviderError("API URL não deve conter usuário ou senha")
    return url


def _merge(payload: dict, previous: AiProviderRow | None = None, *, require_name: bool = True) -> dict:
    if not isinstance(payload, dict):
        raise AiProviderError("corpo deve ser um objeto")

    def current(field: str, default=None):
        if field in payload:
            return payload[field]
        return getattr(previous, field) if previous is not None else default

    ptype = str(current("type", "")).strip().lower()
    if ptype not in TYPES:
        raise AiProviderError(f"tipo inválido (use: {', '.join(TYPES)})")
    name = str(current("name", "")).strip()
    if require_name:
        name = _required_text(name, "Nome", 120)
    elif len(name) > 120:
        raise AiProviderError("Nome excede 120 caracteres")
    api_url = _validate_url(current("api_url", ""))
    model = _required_text(current("model", ""), "Model", 255)

    incoming_key = current("api_key", "")
    api_key = "" if incoming_key is None else str(incoming_key).strip()
    if previous is not None and api_key in ("", MASK):
        api_key = previous.api_key
    if _TYPE_META[ptype]["api_key_required"] and not api_key:
        raise AiProviderError("API key é obrigatória para este provider")

    enabled_value = current("enabled", True)
    if not isinstance(enabled_value, bool):
        raise AiProviderError("Ativo deve ser verdadeiro ou falso")
    return {
        "type": ptype,
        "name": name,
        "api_url": api_url,
        "api_key": api_key,
        "model": model,
        "enabled": enabled_value,
    }


def list_providers() -> list[dict]:
    with get_session() as session:
        rows = session.query(AiProviderRow).order_by(AiProviderRow.name.asc(), AiProviderRow.id.asc()).all()
        return [_json(row) for row in rows]


def get_provider(provider_id: int) -> dict:
    with get_session() as session:
        row = session.get(AiProviderRow, provider_id)
        if row is None:
            raise AiProviderError("provider IA não encontrado", status=404)
        return _json(row)


def create_provider(payload: dict) -> dict:
    values = _merge(payload)
    now = _now_ms()
    with get_session() as session:
        row = AiProviderRow(**values, created_ts=now, updated_ts=now)
        session.add(row)
        session.commit()
        session.refresh(row)
        return _json(row)


def update_provider(provider_id: int, payload: dict) -> dict:
    with get_session() as session:
        row = session.get(AiProviderRow, provider_id)
        if row is None:
            raise AiProviderError("provider IA não encontrado", status=404)
        values = _merge(payload, row)
        for key, value in values.items():
            setattr(row, key, value)
        row.updated_ts = _now_ms()
        session.commit()
        session.refresh(row)
        return _json(row)


def delete_provider(provider_id: int) -> None:
    with get_session() as session:
        row = session.get(AiProviderRow, provider_id)
        if row is None:
            raise AiProviderError("provider IA não encontrado", status=404)
        session.delete(row)
        session.commit()


def _join_endpoint(base: str, suffix: str) -> str:
    clean = base.rstrip("/")
    return clean if clean.endswith(suffix) else f"{clean}{suffix}"


def _test_request(config: dict) -> tuple[str, dict, dict]:
    ptype = config["type"]
    base = config["api_url"]
    api_key = config["api_key"]
    model = config["model"]
    prompt = "Reply only with OK."
    headers = {"Content-Type": "application/json", "Accept": "application/json"}

    if ptype == "anthropic":
        url = _join_endpoint(base, "/messages")
        headers.update({"x-api-key": api_key, "anthropic-version": "2023-06-01"})
        body = {"model": model, "max_tokens": 8,
                "messages": [{"role": "user", "content": prompt}]}
    elif ptype == "gemini":
        if base.endswith(":generateContent"):
            url = base
        else:
            clean_model = model.removeprefix("models/")
            url = f"{base.rstrip('/')}/models/{quote(clean_model, safe='')}:generateContent"
        headers["x-goog-api-key"] = api_key
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 8},
        }
    elif ptype == "ollama":
        url = _join_endpoint(base, "/api/chat")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        body = {"model": model, "messages": [{"role": "user", "content": prompt}],
                "stream": False, "options": {"num_predict": 8}}
    else:
        # A API Sonar atual também expõe /v1/sonar como endpoint completo.
        # Mantém a URL informada nesse caso, sem anexar /chat/completions.
        if ptype == "perplexity" and base.endswith("/sonar"):
            url = base
        else:
            url = _join_endpoint(base, "/chat/completions")
        headers["Authorization"] = f"Bearer {api_key}"
        body = {"model": model, "messages": [{"role": "user", "content": prompt}],
                "stream": False}
    return url, headers, body


def _error_detail(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return "sem detalhes"
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            error = parsed.get("error")
            if isinstance(error, dict):
                text = str(error.get("message") or error.get("detail") or error)
            elif error:
                text = str(error)
            elif parsed.get("message"):
                text = str(parsed["message"])
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return " ".join(text.split())[:500]


def _send_test(config: dict) -> dict:
    url, headers, body = _test_request(config)
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        detail = _error_detail(exc.read(32 * 1024))
        if config["api_key"]:
            detail = detail.replace(config["api_key"], MASK)
        raise AiProviderError(f"provider recusou o teste (HTTP {exc.code}): {detail}", status=502)
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        reason = getattr(exc, "reason", exc)
        raise AiProviderError(f"não foi possível conectar ao provider: {reason}", status=502)

    if len(raw) > _MAX_RESPONSE_BYTES:
        raise AiProviderError("resposta do provider excedeu o limite permitido", status=502)
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        raise AiProviderError("provider retornou uma resposta que não é JSON", status=502)
    if not isinstance(parsed, dict) or parsed.get("error"):
        raise AiProviderError("provider retornou uma resposta de teste inválida", status=502)
    return {
        "ok": True,
        "provider": config["type"],
        "model": config["model"],
        "latency_ms": round((time.monotonic() - started) * 1000),
    }


def test_payload(payload: dict) -> dict:
    provider_id = payload.get("id") if isinstance(payload, dict) else None
    if provider_id is None:
        return _send_test(_merge(payload, require_name=False))
    try:
        provider_id = int(provider_id)
    except (TypeError, ValueError):
        raise AiProviderError("id do provider inválido")
    with get_session() as session:
        row = session.get(AiProviderRow, provider_id)
        if row is None:
            raise AiProviderError("provider IA não encontrado", status=404)
        config = _merge(payload, row, require_name=False)
    return _send_test(config)


def test_provider(provider_id: int) -> dict:
    with get_session() as session:
        row = session.get(AiProviderRow, provider_id)
        if row is None:
            raise AiProviderError("provider IA não encontrado", status=404)
        config = _merge({}, row, require_name=False)
    return _send_test(config)
