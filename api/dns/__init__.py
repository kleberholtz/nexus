"""Fábrica de provedores DNS + schema de campos (para UI e validação)."""
from __future__ import annotations

from .azure import AzureProvider
from .base import DnsError, DnsProvider
from .cloudflare import CloudflareProvider
from .google import GoogleProvider
from .route53 import Route53Provider

_PROVIDERS = {
    "cloudflare": CloudflareProvider,
    "route53": Route53Provider,
    "google": GoogleProvider,
    "azure": AzureProvider,
}

# Campos por tipo (o frontend renderiza; `secret` some das respostas GET).
FIELDS: dict[str, list[dict]] = {
    "cloudflare": [
        {"key": "api_token", "label": "API Token", "secret": True},
    ],
    "route53": [
        {"key": "access_key", "label": "Access Key ID"},
        {"key": "secret_key", "label": "Secret Access Key", "secret": True},
    ],
    "google": [
        {"key": "project_id", "label": "Project ID"},
        {"key": "service_account", "label": "Service Account JSON", "secret": True, "multiline": True},
    ],
    "azure": [
        {"key": "tenant_id", "label": "Tenant ID"},
        {"key": "client_id", "label": "Client ID"},
        {"key": "client_secret", "label": "Client Secret", "secret": True},
        {"key": "subscription_id", "label": "Subscription ID"},
        {"key": "resource_group", "label": "Resource Group"},
    ],
}

LABELS = {
    "cloudflare": "Cloudflare DNS",
    "route53": "Amazon Route 53",
    "google": "Google Cloud DNS",
    "azure": "Azure DNS",
}


def provider_types() -> list[dict]:
    return [{"type": t, "label": LABELS[t], "fields": FIELDS[t]} for t in _PROVIDERS]


def required_keys(ptype: str) -> list[str]:
    return [f["key"] for f in FIELDS.get(ptype, [])]


def secret_keys(ptype: str) -> list[str]:
    return [f["key"] for f in FIELDS.get(ptype, []) if f.get("secret")]


def build(ptype: str, config: dict) -> DnsProvider:
    if ptype not in _PROVIDERS:
        raise DnsError(f"provedor DNS inválido: {ptype}")
    return _PROVIDERS[ptype](config)
