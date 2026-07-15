"""Suporte a Git Provider: funções puras, sem estado.

GitHub/GitLab/Gitea usam app OAuth e recebem access token via callback.
Bitbucket usa token explícito com escopos de repositório/webhook/workspace.
"""
from __future__ import annotations

import hashlib
import hmac
from urllib.parse import quote, urlsplit, urlunsplit

KINDS: tuple[str, ...] = ("github", "gitlab", "gitea", "bitbucket")
APP_KINDS: tuple[str, ...] = ("github", "gitlab", "gitea")
TOKEN_KINDS: tuple[str, ...] = ("bitbucket",)
LABELS: dict[str, str] = {
    "github": "GitHub", "gitlab": "GitLab", "gitea": "Gitea", "bitbucket": "Bitbucket",
}
DEFAULT_BASE_URL: dict[str, str] = {
    "github": "https://github.com",
    "gitlab": "https://gitlab.com",
    "gitea": "",
    "bitbucket": "https://bitbucket.org",
}
BITBUCKET_SCOPES: tuple[str, ...] = (
    "read:repository:bitbucket",
    "read:pullrequest:bitbucket",
    "read:webhook:bitbucket",
    "read:workspace:bitbucket",
    "write:webhook:bitbucket",
)


class GitProviderError(Exception):
    """Erro de domínio do git provider (URL/config inválida)."""


def clone_url(kind: str, git_url: str, token: str) -> str:
    """Injeta um access token na URL HTTPS de clone.

    Sem token, devolve a URL como veio. O token não é PAT para GitHub/GitLab/
    Gitea; é o access token obtido via callback do app.
    """
    if not token:
        return git_url
    parsed = urlsplit(git_url)
    if parsed.scheme not in ("http", "https"):
        raise GitProviderError(f"URL de clone precisa ser http(s): {git_url}")
    username = {
        "github": "x-access-token",
        "gitlab": "oauth2",
        "gitea": "oauth2",
        "bitbucket": "x-token-auth",
    }.get(kind, "oauth2")
    netloc = f"{quote(username, safe='')}:{quote(token, safe='')}@{parsed.hostname}"
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, ""))


def verify_signature(kind: str, secret: str, body: bytes, headers: dict[str, str]) -> bool:
    """Verifica a assinatura/token do webhook conforme o provedor."""
    if kind == "github":
        sig = headers.get("x-hub-signature-256", "")
        digest = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return bool(sig) and hmac.compare_digest(sig, digest)
    if kind == "gitea":
        sig = headers.get("x-gitea-signature", "")
        digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return bool(sig) and hmac.compare_digest(sig, digest)
    if kind == "gitlab":
        tok = headers.get("x-gitlab-token", "")
        return bool(tok) and hmac.compare_digest(tok, secret)
    return False


def event_kind(kind: str, headers: dict[str, str]) -> str:
    """Nome do evento do webhook, normalizado pelo header específico do provedor."""
    if kind == "github":
        return headers.get("x-github-event", "")
    if kind == "gitea":
        return headers.get("x-gitea-event", "")
    if kind == "gitlab":
        return headers.get("x-gitlab-event", "")
    return ""


def extract_ref(git_ref: str) -> str:
    """`refs/heads/main` -> `main`; `refs/tags/v1` -> `v1`."""
    for prefix in ("refs/heads/", "refs/tags/"):
        if git_ref.startswith(prefix):
            return git_ref[len(prefix):]
    return git_ref
