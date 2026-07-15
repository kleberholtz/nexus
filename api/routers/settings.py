"""Rota /settings: intervalo do SSE e retenção do histórico de métricas."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import appsettings, cloudflared, dbconfig, ipv6
from ..auth import require_token
from ..envelope import envelope, message

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_token)])

TUNNEL_KEYS = {
    "cloudflare_tunnel_enabled",
    "cloudflare_tunnel_token",
    "cloudflare_tunnel_1_enabled",
    "cloudflare_tunnel_1_token",
    "cloudflare_tunnel_2_enabled",
    "cloudflare_tunnel_2_token",
    "cloudflare_tunnel_3_enabled",
    "cloudflare_tunnel_3_token",
}


def _payload() -> dict:
    limits = {**appsettings.FLOAT_LIMITS, **appsettings.INT_LIMITS}
    return {
        "values": appsettings.get_all(mask_secrets=True),
        "limits": {k: {"min": lo, "max": hi} for k, (lo, hi) in limits.items()},
        "defaults": {
            **appsettings.FLOAT_DEFAULTS, **appsettings.INT_DEFAULTS,
            **appsettings.STR_DEFAULTS, **appsettings.BOOL_DEFAULTS,
        },
        "cloudflared": cloudflared.status(),
    }


@router.get("")
def get_settings():
    return envelope(data=_payload())


# --- Banco de dados (config em arquivo, fora do app_settings) ----------------

def _merge_db_secrets(payload: dict) -> dict:
    """Substitui senha/DSN mascarados (********) pelos valores salvos."""
    stored = dbconfig.effective()
    cfg = {k: payload.get(k, stored.get(k, "")) for k in dbconfig._FIELDS}
    for secret in ("password", "dsn"):
        if not payload.get(secret) or payload.get(secret) == "********":
            cfg[secret] = stored.get(secret, "")
    return cfg


@router.get("/database")
def get_database():
    return envelope(data={
        "config": dbconfig.public(dbconfig.effective()),
        "source": "file" if dbconfig.load() is not None else "env",
    })


@router.post("/database/test")
def test_database(payload: dict = Body(...)):
    try:
        dbconfig.test_connection(_merge_db_secrets(payload))
    except Exception as exc:  # noqa: BLE001 — erro de conexão vira 400 legível
        raise HTTPException(status_code=400, detail=f"falha na conexão: {exc}")
    return envelope(data={"ok": True}, messages=[message("conexão bem-sucedida", "success")])


@router.put("/database")
def update_database(payload: dict = Body(...)):
    cfg = _merge_db_secrets(payload)
    try:
        dbconfig.test_connection(cfg)  # só grava se conectar
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"falha na conexão — nada salvo: {exc}")
    dbconfig.save(cfg)
    return envelope(
        data={"config": dbconfig.public(cfg), "source": "file"},
        messages=[message("configuração salva — reinicie a API para aplicar", "success")],
    )


@router.get("/cloudflared/{index}/log")
def get_cloudflared_log(index: int, max_bytes: int = 80_000):
    try:
        return envelope(data=cloudflared.read_log(index, max_bytes=max(1_000, min(max_bytes, 500_000))))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.put("")
def update_settings(payload: dict = Body(...)):
    # Só aceita chaves conhecidas; valores fora do range viram 400.
    unknown = set(payload) - appsettings.known_keys()
    if unknown:
        raise HTTPException(status_code=400, detail=f"chaves inválidas: {', '.join(sorted(unknown))}")
    if not payload:
        raise HTTPException(status_code=400, detail="nenhuma configuração informada")
    try:
        normalized = {k: appsettings.validate(k, v) for k, v in payload.items()}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    tunnel_changed = TUNNEL_KEYS & set(normalized)
    if tunnel_changed:
        for index in range(1, cloudflared.MAX_TUNNELS + 1):
            enabled_key = f"cloudflare_tunnel_{index}_enabled"
            token_key = f"cloudflare_tunnel_{index}_token"
            enabled = bool(normalized.get(enabled_key, appsettings.get_bool(enabled_key)))
            if index == 1:
                enabled = enabled or bool(normalized.get(
                    "cloudflare_tunnel_enabled",
                    appsettings.get_bool("cloudflare_tunnel_enabled"),
                ))
            token = normalized.get(token_key)
            if token is None or token == "********":
                token = appsettings.get_str(token_key)
            if index == 1 and not str(token).strip():
                legacy = normalized.get("cloudflare_tunnel_token")
                token = appsettings.get_str("cloudflare_tunnel_token") if legacy in (None, "********") else legacy
            if enabled and not str(token).strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"cloudflare_tunnel_{index}_token é obrigatório para ativar o tunnel {index}",
                )

    # ipv6_enabled é um interruptor mestre: ao mudar, reconcilia todas as confs
    # (comenta/descomenta `listen [::]...`) antes de persistir — se o
    # `nginx -t` rejeitar, nada é salvo (ipv6.apply levanta ConfigError → 409).
    if "ipv6_enabled" in normalized and normalized["ipv6_enabled"] != appsettings.get_bool("ipv6_enabled"):
        ipv6.apply(normalized["ipv6_enabled"])

    appsettings.update(normalized)
    if tunnel_changed:
        try:
            restart = {
                index
                for index in range(1, cloudflared.MAX_TUNNELS + 1)
                if f"cloudflare_tunnel_{index}_token" in normalized
                and normalized[f"cloudflare_tunnel_{index}_token"] != "********"
            }
            if "cloudflare_tunnel_token" in normalized and normalized["cloudflare_tunnel_token"] != "********":
                restart.add(1)
            cloudflared.apply_from_settings(restart_indexes=restart)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"falha ao aplicar Cloudflare Tunnel: {exc}")
    return envelope(data=_payload(), messages=[message("configurações salvas", "success")])
