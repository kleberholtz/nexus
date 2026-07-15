"""Leitura do access.log/error.log do nginx: últimas N linhas + follow (live logs)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

ACCESS_LOG = Path(os.environ.get("NGINX_ACCESS_LOG", "/var/log/nginx/access.log"))
# error_log vai para /dev/stderr, capturado pelo entrypoint neste arquivo.
ERROR_LOG = Path(os.environ.get("NGINX_ERROR_LOG", "/var/log/nexus/nginx.log"))

# Campos numéricos do log_format nexus ($sent_http_content_length, etc.) podem
# sair vazios, gerando JSON inválido tipo `"cl":,`. Este padrão casa uma chave
# ("...":) seguida de valor vazio (antes de , ou }) para preencher com null.
_EMPTY_VALUE = re.compile(r'("(?:[^"\\]|\\.)*"\s*:)\s*(?=[,}])')
# Alguns campos upstream do nginx usam "-" quando não houve valor. Como o
# log_format nexus não envolve todos os campos numéricos em aspas, isso sai como
# JSON inválido (`"uht":-`). Normalizamos esse placeholder para null.
_DASH_VALUE = re.compile(r'("(?:[^"\\]|\\.)*"\s*:)\s*-(?=[,}])')

# Ex.: `2024/06/01 10:00:00 [error] 123#456: *789 mensagem, client: 1.2.3.4,
# server: example.com, request: "GET / HTTP/1.1", host: "example.com"`
_ERROR_LINE = re.compile(
    r"^(?P<time>\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) "
    r"\[(?P<level>\w+)\] "
    r"(?P<pid>\d+)#(?P<tid>\d+): "
    r"(?:\*(?P<cid>\d+) )?"
    r"(?P<message>.*)$"
)
_ERROR_FIELD_KEYS = ("client", "server", "request", "upstream", "host", "referrer")
_ERROR_FIELD_SPLIT = re.compile(r", (?=(?:%s): )" % "|".join(_ERROR_FIELD_KEYS))


def parse_line(line: str) -> dict | None:
    """As linhas do log_format nexus são JSON; devolve o dict ou None.

    Tolera valores vazios não-citados (ex.: `"cl":,`) sanitizando para `null`.
    """
    line = line.strip()
    if not line:
        return None
    sanitized = _DASH_VALUE.sub(r"\1null", _EMPTY_VALUE.sub(r"\1null", line))
    for candidate in (line, sanitized):
        try:
            obj = json.loads(candidate)
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            continue
    return None


def parse_error_line(line: str) -> dict | None:
    """Linha do error_log do nginx (texto, não-JSON) → dict, ou None se não casar."""
    line = line.strip()
    if not line:
        return None
    m = _ERROR_LINE.match(line)
    if not m:
        return None
    d = m.groupdict()
    parts = _ERROR_FIELD_SPLIT.split(d.pop("message"))
    d["message"] = parts[0]
    for part in parts[1:]:
        key, _, val = part.partition(": ")
        d[key] = val.strip('"')
    return d


def tail(n: int = 50, path: Path = ACCESS_LOG) -> list[str]:
    """Últimas `n` linhas do arquivo (leitura por blocos, de trás pra frente)."""
    if not path.exists():
        return []
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            block = 4096
            data = b""
            pos = size
            while pos > 0 and data.count(b"\n") <= n:
                step = min(block, pos)
                pos -= step
                f.seek(pos)
                data = f.read(step) + data
        return data.decode("utf-8", "replace").splitlines()[-n:]
    except OSError:
        return []


def line_count(path: Path) -> int:
    """Conta linhas de forma incremental para montar paginação."""
    if not path.exists():
        return 0
    total = 0
    last = b""
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                total += chunk.count(b"\n")
                if chunk:
                    last = chunk[-1:]
        if last and last != b"\n":
            total += 1
        return total
    except OSError:
        return 0


def page_lines(page: int = 1, page_size: int = 50, path: Path = ACCESS_LOG) -> tuple[list[str], dict]:
    total = line_count(path)
    pages = max(1, (total + page_size - 1) // page_size)
    page = max(1, min(page, pages))
    lines = tail(page * page_size, path)
    end = None if page == 1 else -(page - 1) * page_size
    start = -page * page_size
    return lines[start:end], {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": pages,
    }


def entries(n: int = 50, path: Path = ACCESS_LOG) -> list[dict]:
    return [{"raw": ln, "parsed": parse_line(ln)} for ln in tail(n, path)]


def error_entries(n: int = 50, path: Path = ERROR_LOG) -> list[dict]:
    return [{"raw": ln, "parsed": parse_error_line(ln)} for ln in tail(n, path)]


def entries_page(page: int = 1, page_size: int = 50, path: Path = ACCESS_LOG) -> dict:
    lines, pagination = page_lines(page, page_size, path)
    return {
        "items": [{"raw": ln, "parsed": parse_line(ln)} for ln in lines],
        "pagination": pagination,
    }


def error_entries_page(page: int = 1, page_size: int = 50, path: Path = ERROR_LOG) -> dict:
    lines, pagination = page_lines(page, page_size, path)
    return {
        "items": [{"raw": ln, "parsed": parse_error_line(ln)} for ln in lines],
        "pagination": pagination,
    }
