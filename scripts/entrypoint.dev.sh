#!/bin/sh
# Entrypoint de DESENVOLVIMENTO do container da API (hot-reload).
#
# Deploy de 3 containers: este é o `api`. Prepara a config nos volumes
# compartilhados (tuning → generated/, self-signed, ipv6) ANTES de o nginx subir
# (o nginx usa depends_on: api service_healthy) e sobe a API com `uvicorn
# --reload`, que reinicia sozinho ao salvar qualquer arquivo em /opt/api (montado
# do host). O nginx roda no serviço `nginx`; o painel, no serviço `web` (Vite).
set -e

# Semeia /etc/nginx a partir do template embutido quando ./data/conf está vazio.
if [ ! -f /etc/nginx/nginx.conf ] && [ -d /opt/nexus/seed ]; then
    echo "entrypoint.dev: semeando /etc/nginx a partir de /opt/nexus/seed" >&2
    mkdir -p /etc/nginx
    cp -a /opt/nexus/seed/. /etc/nginx/
fi

LOG_DIR=/var/log/nexus
mkdir -p "$LOG_DIR" /etc/nginx/generated
touch "$LOG_DIR/api.log"

# Tuning → /etc/nginx/generated (volume compartilhado, incluído pelo nginx.conf).
if [ "${NGINX_TUNE:-on}" != "off" ] || [ ! -f /etc/nginx/generated/tuning.conf ]; then
    python3 -m api.tune || echo "entrypoint.dev: api.tune falhou, seguindo" >&2
fi
python3 -m api.ipv6 || echo "entrypoint.dev: api.ipv6 falhou, seguindo" >&2
if [ "${NGINX_SELFSIGN:-on}" != "off" ]; then
    python3 -m api.certboot || echo "entrypoint.dev: api.certboot falhou, seguindo" >&2
fi
python3 -m api.cloudflared || echo "entrypoint.dev: cloudflared falhou, seguindo" >&2

# API com hot-reload. WATCHFILES_FORCE_POLLING ajuda em bind mounts (WSL2/macOS)
# onde o inotify não propaga eventos de arquivos do host — defina no compose.
if [ "${API_ENABLED:-on}" != "off" ]; then
    echo "entrypoint.dev: iniciando API (uvicorn --reload, porta ${API_PORT:-3001})" >&2
    uvicorn api.main:app \
        --host "${API_HOST:-0.0.0.0}" --port "${API_PORT:-3001}" \
        --reload --reload-dir /opt/api \
        >>"$LOG_DIR/api.log" 2>&1 &
fi

# Executa o CMD (por padrão: streama o log da API para o stdout).
exec "$@"
