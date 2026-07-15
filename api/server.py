"""Runner: sobe o uvicorn com a API. Por padrão em HTTP (sem TLS) — a conexão do
painel é direta e o cert self-signed provocava ERR_CERT_AUTHORITY_INVALID no
browser. Defina API_TLS=on para rodar em HTTPS (gera cert self-signed).

Uso:
    python3 -m api.server
Variáveis de ambiente:
    API_HOST        bind (padrão 0.0.0.0)
    API_PORT        porta (padrão 3001)
    API_TLS         on liga HTTPS (self-signed); padrão off (HTTP)
    API_TOKEN       token Bearer exigido (obrigatório na prática)
    API_CERT/API_KEY  caminhos do cert/key (padrão /etc/certs/api.crt|.key)
    API_HOSTNAMES   nomes/IPs extras no SAN, separados por vírgula
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import os
import socket
from pathlib import Path

import uvicorn

CERT = Path(os.environ.get("API_CERT", "/etc/certs/api.crt"))
KEY = Path(os.environ.get("API_KEY", "/etc/certs/api.key"))


def _tls_enabled() -> bool:
    """HTTPS quando ligado nas configurações (Configurações → API, `api_tls_enabled`;
    default herda de API_TLS). Lido no boot — mudar exige restart da API."""
    try:
        from . import appsettings
        return appsettings.get_bool("api_tls_enabled")
    except Exception:  # noqa: BLE001 — DB indisponível no boot: cai pro env
        return os.environ.get("API_TLS", "off").strip().lower() in ("on", "true", "1", "yes")


def _ensure_cert() -> None:
    if CERT.exists() and KEY.exists():
        return
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    names = ["localhost", socket.gethostname()]
    names += [n.strip() for n in os.environ.get("API_HOSTNAMES", "").split(",") if n.strip()]
    san = []
    for n in dict.fromkeys(names):
        try:
            san.append(x509.IPAddress(ipaddress.ip_address(n)))
        except ValueError:
            san.append(x509.DNSName(n))
    san.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))

    key = ec.generate_private_key(ec.SECP256R1())
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, names[0])])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject).issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    CERT.parent.mkdir(parents=True, exist_ok=True)
    CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    KEY.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ))
    KEY.chmod(0o600)


def main() -> None:
    tls = _tls_enabled()
    ssl_args: dict[str, str] = {}
    if tls:
        _ensure_cert()
        ssl_args = {"ssl_certfile": str(CERT), "ssl_keyfile": str(KEY)}
    if not os.environ.get("API_TOKEN"):
        print("api: AVISO — API_TOKEN não definido; todas as rotas retornarão 503", flush=True)
    host = os.environ.get("API_HOST", "0.0.0.0")
    port = int(os.environ.get("API_PORT", "3001"))
    print(f"api: escutando em {'https' if tls else 'http'}://{host}:{port}", flush=True)
    uvicorn.run(
        "api.main:app",
        host=host,
        port=port,
        log_level=os.environ.get("API_LOG_LEVEL", "info"),
        **ssl_args,
    )


if __name__ == "__main__":
    main()
