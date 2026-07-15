"""CRUD dos provedores Git configurados (tabela git_providers).

GitHub usa App ID, client secret e private key PEM. GitLab/Gitea usam app
OAuth: app_id/app_secret são salvos e o callback troca `code` por access token.
Bitbucket usa token explícito com escopos.
Segredos nunca voltam em claro.
"""
from __future__ import annotations

import json
import re
import secrets
import time
import urllib.parse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from sqlalchemy import inspect, text

from . import gitprovider as GP
from .db import engine, get_session
from .db.models import DeployApp, GitProviderRow
from .dns.base import DnsError, http

MASK = "********"
_SCHEMA_READY = False


def _b64u(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _github_private_key(row: GitProviderRow) -> str:
    private_key = (getattr(row, "github_private_key", "") or "").strip()
    if private_key:
        return private_key
    legacy = (row.app_secret or "").strip()
    if row.type == "github" and "PRIVATE KEY-----" in legacy:
        return legacy
    return ""


def _ensure_schema() -> None:
    """Compatibilidade para dev/hot reload quando a migration ainda não rodou."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    inspector = inspect(engine)
    if not inspector.has_table("git_providers"):
        _SCHEMA_READY = True
        return
    columns = {column["name"] for column in inspector.get_columns("git_providers")}
    statements: list[str] = []
    if "github_app_slug" not in columns:
        statements.append("ALTER TABLE git_providers ADD COLUMN github_app_slug VARCHAR(120) NOT NULL DEFAULT ''")
    if "github_client_id" not in columns:
        statements.append("ALTER TABLE git_providers ADD COLUMN github_client_id VARCHAR(255) NOT NULL DEFAULT ''")
    if "github_private_key" not in columns:
        statements.append("ALTER TABLE git_providers ADD COLUMN github_private_key TEXT")
    if statements:
        with engine.begin() as conn:
            for statement in statements:
                conn.execute(text(statement))
    _SCHEMA_READY = True


def _public(row: GitProviderRow) -> dict:
    has_token = bool(row.token)
    auth_mode = "token" if row.type in GP.TOKEN_KINDS else "app"
    return {
        "id": row.id,
        "name": row.name or str(row.id),
        "type": row.type,
        "auth_mode": auth_mode,
        "label": row.label,
        "base_url": row.base_url,
        "provider_url": row.base_url,
        "app_id": row.app_id,
        "app_secret": MASK if row.app_secret else "",
        "github_app_slug": (getattr(row, "github_app_slug", "") or row.name or "") if row.type == "github" else "",
        "github_client_id": (getattr(row, "github_client_id", "") or "") if row.type == "github" else "",
        "github_private_key": MASK if _github_private_key(row) else "",
        "token": MASK if has_token and row.type in GP.TOKEN_KINDS else "",
        "has_token": has_token,
        "callback_path": f"/git/providers/{row.name or row.id}/callback",
        "webhook_path": f"/git/providers/{row.name or row.id}/webhook",
        "webhook_secret": row.webhook_secret,
        "created_ts": row.created_ts,
    }


def _normalize_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", (name or "").strip().lower()).strip("-_")
    if not slug:
        raise ValueError("name é obrigatório")
    if len(slug) > 80:
        raise ValueError("name deve ter no máximo 80 caracteres")
    return slug


def _base_url(kind: str, value: str) -> str:
    base = (value or GP.DEFAULT_BASE_URL.get(kind, "")).strip().rstrip("/")
    if kind == "gitea" and not base:
        raise ValueError("provider_url é obrigatório para Gitea")
    return base


def authorization_url(kind: str, base_url: str, app_id: str, redirect_uri: str) -> str:
    base = _base_url(kind, base_url)
    app_id = (app_id or "").strip()
    redirect_uri = (redirect_uri or "").strip()
    if kind not in GP.APP_KINDS:
        raise ValueError("authorization_url só está disponível para GitHub/GitLab/Gitea")
    if not app_id and kind != "github":
        raise ValueError("app_id é obrigatório")
    if not redirect_uri and kind != "github":
        raise ValueError("redirect_uri é obrigatório")
    if kind == "github":
        raise ValueError("GitHub App usa github_app_install_url com o slug do App")
    elif kind == "gitlab":
        url = f"{base or 'https://gitlab.com'}/oauth/authorize"
        scope = "read_repository"
    else:
        url = f"{base}/login/oauth/authorize"
        scope = "read:repository"
    return url + "?" + urllib.parse.urlencode({
        "client_id": app_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
    })


def github_app_install_url(base_url: str, app_slug: str) -> str:
    base = _base_url("github", base_url)
    slug = _normalize_name(app_slug)
    state = "gh_setup:" + secrets.token_urlsafe(18)
    return f"{base or 'https://github.com'}/apps/{urllib.parse.quote(slug, safe='')}/installations/new?" + urllib.parse.urlencode({"state": state})


def github_manifest_conversion_url(base_url: str, code: str) -> str:
    base = _base_url("github", base_url)
    api_base = "https://api.github.com" if (base or "https://github.com") == "https://github.com" else f"{base}/api/v3"
    return f"{api_base}/app-manifests/{urllib.parse.quote(code, safe='')}/conversions"


def github_create_from_manifest(code: str, name: str, label: str, base_url: str) -> dict:
    _ensure_schema()
    code = (code or "").strip()
    if not code:
        raise ValueError("code ausente no callback do manifesto")
    name = _normalize_name(name)
    base_url = _base_url("github", base_url)
    try:
        status, raw = http("POST", github_manifest_conversion_url(base_url, code), {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }, timeout=20)
    except DnsError as exc:
        raise RuntimeError(str(exc)) from exc
    try:
        data = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError("GitHub retornou resposta inválida ao converter manifesto") from exc
    if status >= 400:
        raise RuntimeError(f"GitHub manifest conversion falhou HTTP {status}: {str(data)[:300]}")

    app_id = str(data.get("id") or "")
    app_slug = _normalize_name(str(data.get("slug") or name))
    github_client_id = str(data.get("client_id") or "")
    app_secret = str(data.get("client_secret") or "")
    github_private_key = str(data.get("pem") or "")
    webhook_secret = str(data.get("webhook_secret") or secrets.token_hex(24))
    _validate_payload("github", name, app_id, app_secret, "", github_private_key, github_client_id)
    _load_github_private_key(github_private_key)

    with get_session() as s:
        row = _find_by_name(s, name)
        if row and row.type != "github":
            raise ValueError("já existe um provedor Git com esse name")
        if not row:
            row = GitProviderRow(
                type="github",
                name=name,
                created_ts=int(time.time() * 1000),
            )
            s.add(row)
        row.label = label or str(data.get("name") or GP.LABELS["github"])
        row.base_url = base_url
        row.app_id = app_id
        row.github_app_slug = app_slug
        row.github_client_id = github_client_id
        row.app_secret = app_secret
        row.github_private_key = github_private_key
        row.webhook_secret = webhook_secret
        s.commit()
        s.refresh(row)
        return _public(row)


def _find_by_name(session, name: str) -> GitProviderRow | None:
    row = session.query(GitProviderRow).filter(GitProviderRow.name == name).first()
    if row is None and name.isdigit():
        return session.get(GitProviderRow, int(name))
    return row


def _validate_payload(ptype: str, name: str, app_id: str, app_secret: str, token: str,
                      github_private_key: str = "", github_client_id: str = "") -> None:
    if ptype not in GP.KINDS:
        raise ValueError(f"tipo de provedor inválido: {ptype}")
    if not name:
        raise ValueError("name é obrigatório")
    if ptype == "github":
        if not app_id or not github_client_id or not app_secret or not github_private_key:
            raise ValueError("App ID, Client ID, Client secret e Private key (PEM) são obrigatórios para GitHub")
    elif ptype in GP.APP_KINDS and (not app_id or not app_secret):
        raise ValueError("app_id e app_secret são obrigatórios para GitLab/Gitea")
    if ptype in GP.TOKEN_KINDS and not token:
        raise ValueError(
            "token é obrigatório para Bitbucket com escopos: "
            + ", ".join(GP.BITBUCKET_SCOPES)
        )


def list_providers() -> list[dict]:
    _ensure_schema()
    with get_session() as s:
        rows = s.query(GitProviderRow).order_by(GitProviderRow.id).all()
        changed = False
        for row in rows:
            if not row.webhook_secret:
                row.webhook_secret = secrets.token_hex(24)
                changed = True
        if changed:
            s.commit()
        return [_public(r) for r in rows]


def get_provider(provider_id: int) -> dict:
    _ensure_schema()
    with get_session() as s:
        row = s.get(GitProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        if not row.webhook_secret:
            row.webhook_secret = secrets.token_hex(24)
            s.commit()
            s.refresh(row)
        return _public(row)


def create(ptype: str, name: str, label: str, base_url: str, app_id: str,
           app_secret: str, token: str, webhook_secret: str = "",
           github_private_key: str = "", github_client_id: str = "") -> dict:
    _ensure_schema()
    name = _normalize_name(name)
    base_url = _base_url(ptype, base_url)
    app_id = (app_id or "").strip()
    github_client_id = (github_client_id or "").strip()
    app_secret = (app_secret or "").strip()
    github_private_key = (github_private_key or "").strip()
    if ptype == "github" and not github_private_key and "PRIVATE KEY-----" in app_secret:
        github_private_key = app_secret
        app_secret = ""
    token = (token or "").strip()
    _validate_payload(ptype, name, app_id, app_secret, token, github_private_key, github_client_id)
    with get_session() as s:
        if _find_by_name(s, name):
            raise ValueError("já existe um provedor Git com esse name")
        row = GitProviderRow(
            type=ptype,
            name=name,
            label=label or GP.LABELS[ptype],
            base_url=base_url,
            app_id=app_id,
            app_secret=app_secret,
            github_client_id=github_client_id if ptype == "github" else "",
            github_private_key=github_private_key if ptype == "github" else "",
            token=token if ptype in GP.TOKEN_KINDS else "",
            webhook_secret=(webhook_secret or secrets.token_hex(24)).strip(),
            created_ts=int(time.time() * 1000),
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        return _public(row)


def test_config(ptype: str, name: str, base_url: str, app_id: str, app_secret: str,
                token: str, callback_url: str, provider_id: int | None = None,
                github_private_key: str = "", github_client_id: str = "") -> dict:
    _ensure_schema()
    name = _normalize_name(name)
    base_url = _base_url(ptype, base_url)
    app_id = (app_id or "").strip()
    github_client_id = (github_client_id or "").strip()
    app_secret = (app_secret or "").strip()
    github_private_key = (github_private_key or "").strip()
    token = (token or "").strip()
    if provider_id:
        with get_session() as s:
            row = s.get(GitProviderRow, provider_id)
            if row:
                if app_secret in ("", MASK):
                    app_secret = row.app_secret
                if github_client_id in ("", MASK):
                    github_client_id = getattr(row, "github_client_id", "") or ""
                if github_private_key in ("", MASK):
                    github_private_key = _github_private_key(row)
                if token in ("", MASK):
                    token = row.token
    if ptype == "github" and not github_private_key and "PRIVATE KEY-----" in app_secret:
        github_private_key = app_secret
        app_secret = ""
    _validate_payload(ptype, name, app_id, app_secret, token, github_private_key, github_client_id)
    if ptype in GP.APP_KINDS:
        if ptype == "github":
            _load_github_private_key(github_private_key)
        auth_url = github_app_install_url(base_url, name) if ptype == "github" else authorization_url(ptype, base_url, app_id, callback_url)
        return {
            "ok": True,
            "auth_mode": "app",
            "authorization_url": auth_url,
        }
    status, raw = http("GET", "https://api.bitbucket.org/2.0/user", {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }, timeout=20)
    if status >= 400:
        raise RuntimeError(
            f"Bitbucket token inválido ou sem acesso HTTP {status}: "
            f"{raw.decode('utf-8', 'replace')[:200]}"
        )
    return {"ok": True, "auth_mode": "token"}


def update(provider_id: int, name: str | None, label: str | None, base_url: str | None,
           app_id: str | None, app_secret: str | None, token: str | None,
           webhook_secret: str | None = None, github_private_key: str | None = None,
           github_client_id: str | None = None) -> dict:
    _ensure_schema()
    with get_session() as s:
        row = s.get(GitProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        if name is not None:
            normalized = _normalize_name(name)
            existing = _find_by_name(s, normalized)
            if existing and existing.id != provider_id:
                raise ValueError("já existe um provedor Git com esse name")
            row.name = normalized
        if label is not None:
            row.label = label
        if base_url is not None:
            row.base_url = _base_url(row.type, base_url)
        if app_id is not None:
            row.app_id = app_id.strip()
        if github_client_id is not None and github_client_id != "" and github_client_id != MASK:
            row.github_client_id = github_client_id.strip()
        if app_secret is not None and app_secret != "" and app_secret != MASK:
            row.app_secret = app_secret.strip()
        if github_private_key is not None and github_private_key != "" and github_private_key != MASK:
            row.github_private_key = github_private_key.strip()
        if token is not None and token != "" and token != MASK:
            if row.type not in GP.TOKEN_KINDS:
                raise ValueError("token manual só é aceito para Bitbucket")
            row.token = token.strip()
        if webhook_secret is not None and webhook_secret != "" and webhook_secret != MASK:
            row.webhook_secret = webhook_secret.strip()
        s.commit()
        s.refresh(row)
        return _public(row)


def delete(provider_id: int) -> None:
    _ensure_schema()
    with get_session() as s:
        row = s.get(GitProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        in_use = s.query(DeployApp).filter(DeployApp.provider_id == provider_id).count()
        if in_use:
            raise ValueError(f"provedor em uso por {in_use} aplicação(ões)")
        s.delete(row)
        s.commit()


def build_clone_url(provider_id: int | None, git_url: str, installation_id: str = "") -> str:
    """Devolve a URL de clone pronta (com access token embutido, se houver).

    `installation_id` sobrepõe a instalação padrão do provedor (necessário quando
    o mesmo GitHub App atende várias contas/instalações — cada serviço guarda a
    sua em `config.github_installation_id`).
    """
    if not provider_id:
        return git_url
    _ensure_schema()
    with get_session() as s:
        row = s.get(GitProviderRow, provider_id)
        if not row:
            raise KeyError("provedor não encontrado")
        token = row.token
        if token.startswith("github-app-installation:"):
            inst = (installation_id or "").strip() or token.split(":", 1)[1]
            token = _github_installation_access_token(row, inst)
        return GP.clone_url(row.type, git_url, token)


def github_accounts(provider_id: int) -> list[dict]:
    _ensure_schema()
    with get_session() as s:
        row = _github_provider_row(s, provider_id)
        selected = _github_installation_id(row, required=False)
        data = _github_request(row, "GET", "/app/installations?per_page=100", _github_app_jwt(row))
        items = data if isinstance(data, list) else []
        out = []
        for item in items:
            if not isinstance(item, dict):
                continue
            account = item.get("account") if isinstance(item.get("account"), dict) else {}
            installation_id = str(item.get("id") or "")
            out.append({
                "id": int(item.get("id") or 0),
                "account": {
                    "id": int(account.get("id") or 0),
                    "login": str(account.get("login") or ""),
                    "type": str(account.get("type") or ""),
                },
                "selected": bool(selected and selected == installation_id),
            })
        return out


def github_repositories(provider_id: int, installation_id: str = "") -> list[dict]:
    _ensure_schema()
    with get_session() as s:
        row = _github_provider_row(s, provider_id)
        installation_id = _github_installation_id(row, fallback=installation_id)
        token = _github_installation_access_token(row, installation_id)
        data = _github_request(row, "GET", "/installation/repositories?per_page=100", token)
        items = data.get("repositories") if isinstance(data, dict) else []
        out = []
        for repo in items or []:
            if not isinstance(repo, dict):
                continue
            owner = repo.get("owner") if isinstance(repo.get("owner"), dict) else {}
            out.append({
                "full_name": str(repo.get("full_name") or ""),
                "name": str(repo.get("name") or ""),
                "owner": str(owner.get("login") or ""),
                "clone_url": str(repo.get("clone_url") or ""),
                "default_branch": str(repo.get("default_branch") or ""),
            })
        return out


def github_branches(provider_id: int, repo: str, installation_id: str = "") -> list[dict]:
    _ensure_schema()
    repo = (repo or "").strip().strip("/")
    if not re.match(r"^[^/\s]+/[^/\s]+$", repo):
        raise ValueError("repo deve estar no formato owner/name")
    owner, name = repo.split("/", 1)
    with get_session() as s:
        row = _github_provider_row(s, provider_id)
        installation_id = _github_installation_id(row, fallback=installation_id)
        token = _github_installation_access_token(row, installation_id)
        path = f"/repos/{urllib.parse.quote(owner, safe='')}/{urllib.parse.quote(name, safe='')}/branches?per_page=100"
        data = _github_request(row, "GET", path, token)
        items = data if isinstance(data, list) else []
        return [{"name": str(item.get("name") or "")} for item in items if isinstance(item, dict)]


def exchange_callback(name: str, code: str, redirect_uri: str, installation_id: str = "") -> dict:
    """Troca o OAuth `code` pelo access token e salva no provider pelo `name`."""
    _ensure_schema()
    with get_session() as s:
        row = _find_by_name(s, _normalize_name(name))
        if not row:
            raise KeyError("provedor não encontrado")
        if row.type not in GP.APP_KINDS:
            raise ValueError("callback OAuth só está disponível para GitHub/GitLab/Gitea")
        if row.type == "github" and installation_id:
            if not row.app_id or not _github_private_key(row):
                raise ValueError("GitHub App sem App ID/private key configurados")
            row.token = f"github-app-installation:{installation_id.strip()}"
            s.commit()
            s.refresh(row)
            return _public(row)
        if row.type == "github" and not (getattr(row, "github_client_id", "") or ""):
            raise ValueError("GitHub App sem Client ID configurado")
        if not row.app_id or not row.app_secret:
            raise ValueError("app_id/app_secret não configurados")
        if not code:
            raise ValueError("code ausente no callback")
        token = _request_access_token(row, code, redirect_uri)
        row.token = token
        s.commit()
        s.refresh(row)
        return _public(row)


def _request_access_token(row: GitProviderRow, code: str, redirect_uri: str) -> str:
    base = row.base_url.rstrip("/")
    if row.type == "github":
        url = f"{base or 'https://github.com'}/login/oauth/access_token"
    elif row.type == "gitlab":
        url = f"{base or 'https://gitlab.com'}/oauth/token"
    elif row.type == "gitea":
        url = f"{base}/login/oauth/access_token"
    else:
        raise ValueError("provedor não usa callback OAuth")

    client_id = (getattr(row, "github_client_id", "") or row.app_id) if row.type == "github" else row.app_id
    form = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": row.app_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    })
    try:
        status, raw = http("POST", url, {
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }, form, timeout=20)
    except DnsError as exc:
        raise RuntimeError(str(exc)) from exc
    try:
        data = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    except json.JSONDecodeError:
        data = dict(urllib.parse.parse_qsl(raw.decode("utf-8", "replace")))
    if status >= 400:
        raise RuntimeError(f"callback OAuth falhou HTTP {status}: {str(data)[:300]}")
    token = str(data.get("access_token") or "")
    if not token:
        raise RuntimeError("callback OAuth não retornou access_token")
    return token


def _load_github_private_key(private_key_pem: str):
    try:
        return serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("private_key do GitHub App inválida; informe a chave PEM baixada no GitHub") from exc


def _github_provider_row(session, provider_id: int) -> GitProviderRow:
    row = session.get(GitProviderRow, provider_id)
    if not row:
        raise KeyError("provedor não encontrado")
    if row.type != "github":
        raise ValueError("endpoint disponível apenas para GitHub App")
    if not row.app_id or not _github_private_key(row):
        raise ValueError("GitHub App sem app_id/private_key configurados")
    return row


def _github_api_base(row: GitProviderRow) -> str:
    base = row.base_url.rstrip("/") or "https://github.com"
    return "https://api.github.com" if base == "https://github.com" else f"{base}/api/v3"


def _github_installation_id(row: GitProviderRow, fallback: str = "", required: bool = True) -> str:
    token = str(row.token or "")
    if token.startswith("github-app-installation:"):
        installation_id = token.split(":", 1)[1].strip()
        if installation_id:
            return installation_id
    fallback = (fallback or "").strip()
    if fallback:
        return fallback
    if required:
        raise ValueError("GitHub App ainda não foi instalado/conectado")
    return ""


def _github_request(row: GitProviderRow, method: str, path: str, token: str):
    try:
        status, raw = http(method, f"{_github_api_base(row)}{path}", {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }, timeout=20)
    except DnsError as exc:
        raise RuntimeError(str(exc)) from exc
    try:
        data = json.loads(raw.decode("utf-8", "replace")) if raw else {}
    except json.JSONDecodeError:
        data = {"_raw": raw.decode("utf-8", "replace")}
    if status >= 400:
        raise RuntimeError(f"GitHub API falhou HTTP {status}: {str(data)[:300]}")
    return data


def _github_app_jwt(row: GitProviderRow) -> str:
    key = _load_github_private_key(_github_private_key(row))
    now = int(time.time())
    header = {"alg": "RS256", "typ": "JWT"}
    payload = {
        "iat": now - 60,
        "exp": now + 540,
        "iss": row.app_id,
    }
    signing_input = (
        _b64u(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        + "."
        + _b64u(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    )
    signature = key.sign(signing_input.encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
    return f"{signing_input}.{_b64u(signature)}"


def _github_installation_access_token(row: GitProviderRow, installation_id: str) -> str:
    data = _github_request(
        row,
        "POST",
        f"/app/installations/{urllib.parse.quote(str(installation_id), safe='')}/access_tokens",
        _github_app_jwt(row),
    )
    token = str(data.get("token") or "")
    if not token:
        raise RuntimeError("GitHub não retornou installation access token")
    return token
