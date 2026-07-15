"""Rotação de logs em background: rotaciona o access.log por tamanho, opcional
compressão (gzip) e envio a um destino S3. Controlado pelas app_settings:

    log_rotate_enabled      liga/desliga o worker
    log_rotate_max_mb       rotaciona quando o arquivo passa deste tamanho
    log_rotate_keep         quantos rotacionados manter (poda os mais antigos)
    log_rotate_interval_min cadência de checagem
    log_compress            comprime (gzip) o arquivo rotacionado
    log_s3_enabled          envia o rotacionado ao S3
    log_s3_config_id        qual configuração S3 usar

Após renomear o arquivo, sinaliza `nginx -s reopen` para o nginx recriar o
access.log e voltar a escrever. Só stdlib (+ s3client para o upload).
"""
from __future__ import annotations

import gzip
import shutil
import threading
import time
from pathlib import Path

from . import appsettings, logs, nginxctl, s3client, s3configs

_thread: threading.Thread | None = None
_stop = threading.Event()


def _rotated_glob(base: Path) -> list[Path]:
    files = list(base.parent.glob(base.name + ".*"))
    # Ordena por mtime (mais novos primeiro).
    return sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)


def _upload(path: Path) -> None:
    try:
        cfg = s3configs.raw_config(appsettings.get_int("log_s3_config_id"))
    except KeyError:
        print("logrotate: log_s3_config_id inválido; upload ignorado", flush=True)
        return
    key = f"{time.strftime('%Y/%m/%d')}/{path.name}"
    s3client.put_object(cfg, key, path.read_bytes(),
                        content_type="application/gzip" if path.suffix == ".gz" else "text/plain")
    print(f"logrotate: enviado {path.name} → s3://{cfg.get('bucket')}/{key}", flush=True)


def rotate_now(path: Path | None = None) -> dict:
    """Rotaciona imediatamente (usado pelo worker e pela rota manual)."""
    base = path or logs.ACCESS_LOG
    if not base.exists() or base.stat().st_size == 0:
        return {"rotated": False, "reason": "log vazio ou inexistente"}

    stamp = time.strftime("%Y%m%d-%H%M%S")
    rotated = base.with_name(f"{base.name}.{stamp}")
    base.rename(rotated)
    # nginx recria o arquivo original e reabre os descritores.
    nginxctl._run(["-s", "reopen"])
    time.sleep(0.3)  # dá tempo do nginx reabrir antes de mexermos no rotacionado

    result: dict = {"rotated": True, "file": rotated.name}

    if appsettings.get_bool("log_compress"):
        gz = rotated.with_suffix(rotated.suffix + ".gz")
        with open(rotated, "rb") as src, gzip.open(gz, "wb") as dst:
            shutil.copyfileobj(src, dst)
        rotated.unlink()
        rotated = gz
        result["file"] = rotated.name

    if appsettings.get_bool("log_s3_enabled"):
        try:
            _upload(rotated)
            result["uploaded"] = True
        except Exception as exc:  # noqa: BLE001
            result["uploaded"] = False
            result["upload_error"] = str(exc)
            print(f"logrotate: falha no upload S3: {exc}", flush=True)

    # Poda: mantém apenas os N mais recentes.
    keep = appsettings.get_int("log_rotate_keep")
    for old in _rotated_glob(base)[keep:]:
        try:
            old.unlink()
        except OSError:
            pass

    return result


def _tick() -> None:
    if not appsettings.get_bool("log_rotate_enabled"):
        return
    base = logs.ACCESS_LOG
    if not base.exists():
        return
    max_bytes = appsettings.get_int("log_rotate_max_mb") * 1024 * 1024
    if base.stat().st_size >= max_bytes:
        rotate_now(base)


def _loop() -> None:
    while not _stop.is_set():
        try:
            _tick()
        except Exception as exc:  # noqa: BLE001
            print(f"logrotate: erro no ciclo: {exc}", flush=True)
        # Intervalo dinâmico (relê a setting a cada volta), com piso de 60s.
        try:
            minutes = appsettings.get_int("log_rotate_interval_min")
        except Exception:  # noqa: BLE001
            minutes = 10
        _stop.wait(max(60, minutes * 60))


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="logrotate", daemon=True)
    _thread.start()
