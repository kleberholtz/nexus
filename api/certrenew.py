"""Renovação automática de certificados (thread em background).

Percorre os metadados com `auto_renew=True` e reemite os certificados perto do
vencimento: self-signed localmente; Let's Encrypt via ACME + provedor DNS.
"""
from __future__ import annotations

import threading
import time

from . import appsettings, certs, dnsproviders

_thread: threading.Thread | None = None
_stop = threading.Event()
CHECK_INTERVAL = 6 * 3600  # 6h


def _days_left() -> dict[str, int]:
    return {c["name"]: c["days_left"] for c in certs.list_certs()}


def renew_due() -> list[str]:
    """Renova o que estiver vencendo; retorna os nomes renovados."""
    left = _days_left()
    renewed: list[str] = []
    for meta in certs.list_meta():
        if not meta["auto_renew"]:
            continue
        name = meta["name"]
        threshold = certs.RENEW_THRESHOLD.get(meta["kind"], 30)
        days = left.get(name)
        if days is not None and days > threshold:
            continue  # ainda longe do vencimento
        try:
            _renew_one(meta)
            renewed.append(name)
        except Exception as exc:  # noqa: BLE001
            print(f"certrenew: falha ao renovar {name}: {exc}", flush=True)
    return renewed


def _renew_one(meta: dict) -> None:
    if meta["kind"] == "self-signed":
        certs.issue_self_signed(meta["domains"], meta["ips"], meta["days"], meta["rsa"])
        certs.save_meta(meta["name"], "self-signed", domains=meta["domains"], ips=meta["ips"],
                        days=meta["days"], rsa=meta["rsa"], auto_renew=True)
        return
    if meta["kind"] == "ca-signed":
        if not meta.get("ca_name"):
            raise RuntimeError("ca_name ausente")
        certs.issue_ca_signed(meta["ca_name"], meta["domains"], meta["ips"],
                              meta["days"], meta["rsa"])
        certs.save_meta(meta["name"], "ca-signed", domains=meta["domains"], ips=meta["ips"],
                        days=meta["days"], rsa=meta["rsa"], ca_name=meta["ca_name"], auto_renew=True)
        return
    # letsencrypt
    from .acme import AcmeClient

    email = appsettings.get_str("acme_email")
    if not email:
        raise RuntimeError("acme_email não configurado")
    if not meta["provider_id"]:
        raise RuntimeError("provider_id ausente")
    provider = dnsproviders.build_instance(meta["provider_id"])
    client = AcmeClient(email=email, staging=meta["staging"])
    client.issue(meta["domains"], provider)
    certs.save_meta(meta["name"], "letsencrypt", domains=meta["domains"],
                    provider_id=meta["provider_id"], staging=meta["staging"], auto_renew=True)


def _loop() -> None:
    # Primeira checagem após 1min (dá tempo do DB/app estabilizarem).
    _stop.wait(60)
    while not _stop.is_set():
        try:
            done = renew_due()
            if done:
                print(f"certrenew: renovados {done}", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"certrenew: erro no ciclo ({exc})", flush=True)
        _stop.wait(CHECK_INTERVAL)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="cert-renewer", daemon=True)
    _thread.start()
