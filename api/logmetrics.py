"""Métricas derivadas do access.log (log_format nexus, JSON por linha).

Lê as últimas N linhas do log, parseia e agrega em: tráfego, status HTTP,
latência (com percentis P50/P90/P95/P99), cache e upstreams. Só stdlib.

Campos usados (ver log_format `nexus` em conf/nginx.conf):
    ts  $msec (segundos)      st  $status           rt  $request_time
    bs  $bytes_sent           rl  $request_length   bl  $body_bytes_sent
    up  $upstream_addr        uct $upstream_connect_time
    uht $upstream_header_time (TTFB)                urt $upstream_response_time
    ucs $upstream_cache_status                      pr  $server_protocol
"""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from threading import Lock

from . import logs

CACHE_TTL_SECONDS = 30.0
_CACHE: dict[tuple[str, int], tuple[float, dict]] = {}
_CACHE_LOCK = Lock()


def _num(v) -> float | None:
    """Converte para float; trata "", "-" e None (campos ausentes do nginx)."""
    if v is None or v == "" or v == "-":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pct(vals: list[float], p: float) -> float | None:
    """Percentil p (0–100) por interpolação linear; vals já ordenado."""
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    k = (len(vals) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(vals) - 1)
    if f == c:
        return vals[f]
    return vals[f] + (vals[c] - vals[f]) * (k - f)


def _classify_browser(ua: str) -> str:
    s = ua.lower()
    if not ua or ua == "-":
        return "Outros"
    bots = ("bot", "spider", "crawl", "slurp", "bingpreview", "curl", "wget",
            "python-", "go-http", "httpclient", "facebookexternalhit", "headless",
            "monitor", "uptime", "scan")
    if any(b in s for b in bots):
        return "Bots"
    if "edg" in s:
        return "Edge"
    if "firefox" in s or "fxios" in s:
        return "Firefox"
    if "chrome" in s or "crios" in s or "chromium" in s:
        return "Chrome"
    if "safari" in s:
        return "Safari"
    return "Outros"


def _classify_os(ua: str) -> str:
    s = ua.lower()
    if not ua or ua == "-":
        return "Outros"
    if "windows" in s:
        return "Windows"
    if "android" in s:  # antes de Linux (Android contém "Linux")
        return "Android"
    if "iphone" in s or "ipad" in s or "ipod" in s:  # antes de macOS
        return "iOS"
    if "mac os x" in s or "macintosh" in s:
        return "macOS"
    if "linux" in s:
        return "Linux"
    return "Outros"


def _enc(v) -> str:
    s = str(v or "").strip().lower()
    if not s or s == "-":
        return "none"
    if "br" in s:
        return "br"
    if "gzip" in s:
        return "gzip"
    if "zstd" in s:
        return "zstd"
    if "deflate" in s:
        return "deflate"
    return s


def _stats(vals: list[float]) -> dict:
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return {"avg": None, "p50": None, "p90": None, "p95": None, "p99": None, "max": None, "count": 0}
    return {
        "avg": sum(vals) / len(vals),
        "p50": _pct(vals, 50),
        "p90": _pct(vals, 90),
        "p95": _pct(vals, 95),
        "p99": _pct(vals, 99),
        "max": vals[-1],
        "count": len(vals),
    }


def compute(lines: int = 5000, path=None, use_cache: bool = True) -> dict:
    path = path or logs.ACCESS_LOG
    cache_key = (str(path), int(lines))
    now = time.time()
    if use_cache:
        with _CACHE_LOCK:
            cached = _CACHE.get(cache_key)
            if cached and now - cached[0] < CACHE_TTL_SECONDS:
                return cached[1]

    raw = logs.tail(lines, path)
    entries = [p for p in (logs.parse_line(ln) for ln in raw) if p]

    total = len(entries)
    tss = sorted(t for t in (_num(e.get("ts")) for e in entries) if t)
    span = (tss[-1] - tss[0]) if len(tss) >= 2 else 0.0
    span = span or 1.0  # evita divisão por zero em amostras minúsculas

    # --- Tráfego ----------------------------------------------------------- #
    bytes_out = sum((_num(e.get("bs")) or 0) for e in entries)
    bytes_in = sum((_num(e.get("rl")) or 0) for e in entries)
    rps = total / span

    # --- Status HTTP ------------------------------------------------------- #
    status = Counter()
    status_codes = Counter()
    for e in entries:
        st = _num(e.get("st"))
        if st is not None:
            code = int(st)
            status[f"{code // 100}xx"] += 1
            status_codes[str(code)] += 1

    # --- Métodos HTTP ------------------------------------------------------ #
    methods = Counter()
    for e in entries:
        method = str(e.get("m") or "").upper().strip()
        if method and method != "-":
            methods[method] += 1

    # --- Latência ---------------------------------------------------------- #
    latency = {
        "request": _stats([_num(e.get("rt")) for e in entries]),
        "ttfb": _stats([_num(e.get("uht")) for e in entries]),
        "upstream": _stats([_num(e.get("urt")) for e in entries]),
    }

    # --- Cache (upstream_cache_status) ------------------------------------- #
    cache = Counter()
    for e in entries:
        cs = str(e.get("ucs") or "").upper().strip()
        if cs and cs != "-":
            cache[cs] += 1
    cache_total = sum(cache.values())
    cache_hits = cache.get("HIT", 0) + cache.get("STALE", 0) + cache.get("REVALIDATED", 0) + cache.get("UPDATING", 0)
    cache_summary = {
        "total": cache_total,
        "hits": cache_hits,
        "misses": max(cache_total - cache_hits, 0),
        "hit_ratio": (cache_hits / cache_total) if cache_total else None,
    }

    # --- Upstreams --------------------------------------------------------- #
    ups: dict[str, dict] = defaultdict(lambda: {"requests": 0, "failures": 0, "lat": []})
    for e in entries:
        up = str(e.get("up") or "").strip()
        if not up or up == "-":
            continue
        # upstream_addr pode listar vários (redirecionamentos internos): pega o último.
        addr = up.split(",")[-1].strip()
        u = ups[addr]
        u["requests"] += 1
        st = _num(e.get("st"))
        if st is not None and int(st) >= 500:
            u["failures"] += 1
        lat = _num(e.get("urt"))
        if lat is not None:
            u["lat"].append(lat)
    upstreams = []
    for addr, u in sorted(ups.items(), key=lambda kv: -kv[1]["requests"]):
        lat = sorted(u["lat"])
        upstreams.append({
            "addr": addr,
            "requests": u["requests"],
            "failures": u["failures"],
            "avg_latency": (sum(lat) / len(lat)) if lat else None,
            "p95_latency": _pct(lat, 95) if lat else None,
        })

    # --- Hosts / domínios -------------------------------------------------- #
    hosts_map: dict[str, dict] = defaultdict(lambda: {
        "requests": 0,
        "errors": 0,
        "bytes": 0.0,
        "lat": [],
        "cache_total": 0,
        "cache_hits": 0,
    })
    for e in entries:
        host = str(e.get("host") or "").strip() or "-"
        h = hosts_map[host]
        h["requests"] += 1
        h["bytes"] += _num(e.get("bs")) or 0
        st = _num(e.get("st"))
        if st is not None and int(st) >= 400:
            h["errors"] += 1
        rt = _num(e.get("rt"))
        if rt is not None:
            h["lat"].append(rt)
        cs = str(e.get("ucs") or "").upper().strip()
        if cs and cs != "-":
            h["cache_total"] += 1
            if cs in {"HIT", "STALE", "REVALIDATED", "UPDATING"}:
                h["cache_hits"] += 1

    hosts = []
    for host, h in sorted(hosts_map.items(), key=lambda kv: -kv[1]["requests"])[:30]:
        lat = sorted(h["lat"])
        hosts.append({
            "host": host,
            "requests": h["requests"],
            "errors": h["errors"],
            "error_rate": (h["errors"] / h["requests"]) if h["requests"] else 0.0,
            "bytes": h["bytes"],
            "avg_latency": (sum(lat) / len(lat)) if lat else None,
            "p95_latency": _pct(lat, 95) if lat else None,
            "p99_latency": _pct(lat, 99) if lat else None,
            "cache_hit_ratio": (h["cache_hits"] / h["cache_total"]) if h["cache_total"] else None,
        })

    # --- IPs --------------------------------------------------------------- #
    ips: dict[str, dict] = defaultdict(lambda: {"requests": 0, "errors": 0, "bytes": 0.0})
    for e in entries:
        ip = str(e.get("ip") or "").strip() or "-"
        i = ips[ip]
        i["requests"] += 1
        i["bytes"] += _num(e.get("bs")) or 0
        st = _num(e.get("st"))
        if st is not None and int(st) >= 400:
            i["errors"] += 1
    top_ips = [
        {"ip": ip, "requests": s["requests"], "errors": s["errors"], "bytes": s["bytes"]}
        for ip, s in sorted(ips.items(), key=lambda kv: -kv[1]["requests"])[:20]
    ]
    top_error_ips = [
        {"ip": ip, "requests": s["requests"], "errors": s["errors"], "bytes": s["bytes"]}
        for ip, s in sorted((kv for kv in ips.items() if kv[1]["errors"]), key=lambda kv: -kv[1]["errors"])[:20]
    ]

    # --- Protocolos (HTTP/1.1, HTTP/2.0, HTTP/3) --------------------------- #
    protocols = Counter()
    for e in entries:
        pr = str(e.get("pr") or "").strip()
        if pr and pr != "-":
            protocols[pr] += 1

    # --- Endpoints (por path, sem query string) ---------------------------- #
    eps: dict[str, dict] = defaultdict(lambda: {"count": 0, "errors": 0, "lat": [], "bytes": 0.0})
    for e in entries:
        path = str(e.get("uri") or "").split("?", 1)[0] or "/"
        s = eps[path]
        s["count"] += 1
        st = _num(e.get("st"))
        if st is not None and int(st) >= 400:
            s["errors"] += 1
        rt = _num(e.get("rt"))
        if rt is not None:
            s["lat"].append(rt)
        s["bytes"] += _num(e.get("bs")) or 0

    def _ep_avg(s: dict) -> float | None:
        return (sum(s["lat"]) / len(s["lat"])) if s["lat"] else None

    top_endpoints = [
        {"path": p, "count": s["count"], "avg_latency": _ep_avg(s), "bytes": s["bytes"]}
        for p, s in sorted(eps.items(), key=lambda kv: -kv[1]["count"])[:20]
    ]
    slowest_endpoints = [
        {"path": p, "avg_latency": _ep_avg(s), "count": s["count"]}
        for p, s in sorted(
            (kv for kv in eps.items() if kv[1]["lat"]),
            key=lambda kv: -(_ep_avg(kv[1]) or 0),
        )[:20]
    ]
    error_endpoints = [
        {"path": p, "errors": s["errors"], "count": s["count"]}
        for p, s in sorted(
            (kv for kv in eps.items() if kv[1]["errors"]),
            key=lambda kv: -kv[1]["errors"],
        )[:20]
    ]

    # --- Requests lentas --------------------------------------------------- #
    slow_thresholds = {"gt_1s": 0, "gt_5s": 0, "gt_30s": 0}
    slowest_requests = []
    for e in entries:
        rt = _num(e.get("rt"))
        if rt is None:
            continue
        if rt > 1:
            slow_thresholds["gt_1s"] += 1
        if rt > 5:
            slow_thresholds["gt_5s"] += 1
        if rt > 30:
            slow_thresholds["gt_30s"] += 1
        slowest_requests.append({
            "host": str(e.get("host") or "-"),
            "path": str(e.get("uri") or "").split("?", 1)[0] or "/",
            "method": str(e.get("m") or "-"),
            "status": int(_num(e.get("st")) or 0),
            "request_time": rt,
            "upstream": str(e.get("up") or "-"),
        })
    slowest_requests = sorted(slowest_requests, key=lambda r: -r["request_time"])[:20]

    # --- Países (GeoIP: requests, banda, latência) ------------------------- #
    ctry: dict[str, dict] = defaultdict(lambda: {"requests": 0, "bytes": 0.0, "lat": []})
    for e in entries:
        c = str(e.get("country") or "").strip() or "Desconhecido"
        if c == "-":
            c = "Desconhecido"
        s = ctry[c]
        s["requests"] += 1
        s["bytes"] += _num(e.get("bs")) or 0
        rt = _num(e.get("rt"))
        if rt is not None:
            s["lat"].append(rt)
    countries = [
        {
            "country": c,
            "requests": s["requests"],
            "bytes": s["bytes"],
            "avg_latency": (sum(s["lat"]) / len(s["lat"])) if s["lat"] else None,
        }
        for c, s in sorted(ctry.items(), key=lambda kv: -kv[1]["requests"])[:60]
    ]

    # --- User agents & sistemas operacionais ------------------------------- #
    browsers = Counter()
    oses = Counter()
    for e in entries:
        ua = str(e.get("ua") or "")
        browsers[_classify_browser(ua)] += 1
        oses[_classify_os(ua)] += 1

    # --- Compressão (contagem/bytes por encoding + série temporal + economia) #
    comp_counts = Counter()
    comp_bytes = Counter()
    saved_bytes = 0.0
    for e in entries:
        enc = _enc(e.get("enc"))
        comp_counts[enc] += 1
        comp_bytes[enc] += _num(e.get("bs")) or 0
        ratio = _num(e.get("gz"))  # gzip_ratio (>1) — só p/ gzip
        body = _num(e.get("bl")) or 0
        if ratio and ratio > 1:
            saved_bytes += body * (ratio - 1)

    comp_series: list[dict] = []
    if len(tss) >= 2:
        n_buckets = 30
        t0, t1 = tss[0], tss[-1]
        width = (t1 - t0) / n_buckets or 1.0
        comp_series = [{
            "ts": int((t0 + i * width) * 1000),
            "gzip": 0,
            "brotli": 0,
            "zstd": 0,
            "none": 0,
        } for i in range(n_buckets)]
        for e in entries:
            t = _num(e.get("ts"))
            if t is None:
                continue
            idx = min(int((t - t0) / width), n_buckets - 1)
            enc = _enc(e.get("enc"))
            if enc == "gzip":
                comp_series[idx]["gzip"] += 1
            elif enc == "br":
                comp_series[idx]["brotli"] += 1
            elif enc == "zstd":
                comp_series[idx]["zstd"] += 1
            else:
                comp_series[idx]["none"] += 1

    result = {
        "generated_ts": time.time(),
        "window_seconds": round(span, 2),
        "sample_size": total,
        "traffic": {
            "rps": rps,
            "rpm": rps * 60.0,
            "rph": rps * 3600.0,
            "throughput_out_bps": (bytes_out * 8.0) / span,
            "throughput_in_bps": (bytes_in * 8.0) / span,
            "bytes_out": bytes_out,
            "bytes_in": bytes_in,
        },
        "status": dict(status),
        "status_codes": dict(status_codes),
        "methods": dict(methods),
        "latency": latency,
        "cache": dict(cache),
        "cache_summary": cache_summary,
        "upstreams": upstreams,
        "hosts": hosts,
        "top_ips": top_ips,
        "top_error_ips": top_error_ips,
        "protocols": dict(protocols),
        "top_endpoints": top_endpoints,
        "slowest_endpoints": slowest_endpoints,
        "error_endpoints": error_endpoints,
        "slow_requests": {
            "thresholds": slow_thresholds,
            "items": slowest_requests,
        },
        "countries": countries,
        "browsers": dict(browsers),
        "os": dict(oses),
        "compression": {
            "counts": dict(comp_counts),
            "bytes": dict(comp_bytes),
            "saved_bytes_est": saved_bytes,
            "series": comp_series,
        },
    }
    if use_cache:
        with _CACHE_LOCK:
            _CACHE[cache_key] = (now, result)
    return result
