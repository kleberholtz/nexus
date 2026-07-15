#!/bin/sh
# Entrypoint do container do NGINX (Holtz Nexus).
#
# Container "burro": não gera config nem tuning — isso é feito pela API (outro
# container), que escreve nos volumes compartilhados (conf/, certs/, generated/)
# ANTES de o nginx subir (o compose usa depends_on: api service_healthy). Aqui só
# garantimos os diretórios de runtime, validamos e rodamos o nginx em foreground
# (PID 1), para o Docker cuidar do ciclo de vida (restart/stop) e a API
# controlar via `docker exec`/lifecycle (ver api/nginxctl.py, modo docker).
set -e

# Fallback de semeadura: normalmente a API (que sobe antes, depends_on healthy)
# já populou /etc/nginx (= ./data/conf). Mas se o nginx subir sem isso, semeia do
# template embutido para o `nginx -t` não falhar por config ausente.
if [ ! -f /etc/nginx/nginx.conf ] && [ -d /opt/nexus/seed ]; then
    echo "entrypoint: semeando /etc/nginx a partir de /opt/nexus/seed" >&2
    mkdir -p /etc/nginx
    cp -a /opt/nexus/seed/. /etc/nginx/
fi

# Diretórios de runtime (cache do proxy e logs). O nginx só cria o último nível
# do cache_path; garantimos os pais aqui (senão o boot falha com mkdir ENOENT).
mkdir -p /var/cache/nginx/shared /var/cache/nginx/zones /var/cache/nginx/routes \
         /var/log/nginx /var/log/nexus /etc/nginx/generated
chown -R www-data:www-data /var/cache/nginx 2>/dev/null || true

# Fallback: se a API ainda não gerou os includes de tuning (ex.: subiu fora de
# ordem), cria valores mínimos para o `nginx -t` não falhar no include.
if [ ! -f /etc/nginx/generated/tuning.conf ]; then
    printf 'worker_processes auto;\n' > /etc/nginx/generated/tuning.conf
fi
if [ ! -f /etc/nginx/generated/events-tuning.conf ]; then
    printf '    worker_connections 1024;\n' > /etc/nginx/generated/events-tuning.conf
fi

# Valida a configuração antes de iniciar (falha cedo com erro claro).
nginx -t

# Foreground como PID 1: o error_log vai p/ /dev/stderr (docker logs) e também
# p/ /var/log/nexus/nginx.log (volume compartilhado, lido pela API).
exec nginx -g 'daemon off;'
