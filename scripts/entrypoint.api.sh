#!/bin/sh
# Entrypoint do container da API (Holtz Nexus).
#
# Prepara a config do nginx nos volumes COMPARTILHADOS (tuning, certs
# self-signed, ipv6) ANTES de o container do nginx subir — o compose usa
# depends_on: api service_healthy, então tudo aqui roda antes de a API ficar
# saudável e, portanto, antes de o nginx iniciar. Depois sobe a própria API, que
# controla o nginx do outro container pela Docker Engine API (api/nginxctl.py).
set -e

# Semeia /etc/nginx a partir do template embutido quando o volume ./data/conf
# está vazio (1º boot). A API roda antes do nginx (depends_on healthy), então é
# aqui que a config nasce. Depois disso a API edita direto em /etc/nginx.
if [ ! -f /etc/nginx/nginx.conf ] && [ -d /opt/nexus/seed ]; then
    echo "entrypoint: semeando /etc/nginx a partir de /opt/nexus/seed" >&2
    mkdir -p /etc/nginx
    cp -a /opt/nexus/seed/. /etc/nginx/
fi

LOG_DIR=/var/log/nexus
mkdir -p "$LOG_DIR" /etc/nginx/generated

# Tuning por máquina → /etc/nginx/generated/{tuning,events-tuning}.conf (volume
# compartilhado, incluído pelo nginx.conf). NGINX_TUNE=off pula, mas geramos os
# includes na 1ª vez (senão o include do nginx.conf falharia).
if [ "${NGINX_TUNE:-on}" != "off" ] || [ ! -f /etc/nginx/generated/tuning.conf ]; then
    python3 -m api.tune || \
        echo "entrypoint: api.tune falhou, seguindo com os valores atuais" >&2
fi

# Reconcilia `listen [::]...` com a preferência de IPv6 persistida (app_settings,
# padrão desativado). Necessário porque `nginx -t` não detecta "Address family
# not supported" — só falha ao abrir o socket. Escreve nas confs compartilhadas.
python3 -m api.ipv6 || \
    echo "entrypoint: api.ipv6 falhou, seguindo com a config atual" >&2

# Emite self-signed p/ os ssl_certificate ausentes (senão o `nginx -t` do outro
# container falharia). Escreve no volume de certs compartilhado. NGINX_SELFSIGN=off pula.
if [ "${NGINX_SELFSIGN:-on}" != "off" ]; then
    python3 -m api.certboot || \
        echo "entrypoint: api.certboot falhou, seguindo mesmo assim" >&2
fi

# Aplica a preferência persistida do Cloudflare Tunnel no boot.
python3 -m api.cloudflared || \
    echo "entrypoint: cloudflared falhou, a API tentará reconciliar no start" >&2

# --- serviço: API de gerenciamento (FastAPI, API_PORT) --------------------- #
# HTTP por padrão (API_TLS=on p/ HTTPS). Desative com API_ENABLED=off.
if [ "${API_ENABLED:-on}" != "off" ]; then
    echo "entrypoint: iniciando serviço api (porta ${API_PORT:-3001})" >&2
    python3 -m api.server >>"$LOG_DIR/api.log" 2>&1 &
fi

# Executa o CMD (por padrão: streama o log da API para o stdout do container).
exec "$@"
