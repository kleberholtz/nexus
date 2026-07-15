#!/bin/sh
# Entrypoint do container.
#
# Prepara o ambiente (tuning + certificados), sobe o nginx e a API de
# gerenciamento como serviços em background — cada um gravando seus logs em
# arquivo — e então executa o CMD, que por padrão apenas streama esses logs
# para o stdout do container (`docker logs`).
set -e

# Diretório onde os serviços despejam seus logs (streamados pelo CMD/tail).
LOG_DIR=/var/log/nexus

# Gera /etc/nginx/tuning.conf e /etc/nginx/events-tuning.conf (via api.tune).
# Pode ser desativado com NGINX_TUNE=off, mas ainda geramos os includes na
# primeira vez (senão o nginx.conf falharia ao incluí-los). A mesma lógica é
# exposta pela API em GET/POST /nginx/tune.
if [ "${NGINX_TUNE:-on}" != "off" ] || [ ! -f /etc/nginx/generated/tuning.conf ]; then
    python3 -m api.tune || \
        echo "entrypoint: api.tune falhou, seguindo com os valores atuais" >&2
fi

# Reconcilia as confs com a preferência de IPv6 persistida (app_settings,
# padrão desativado): comenta/descomenta `listen [::]...` em todo server/
# stream/rtmp gerido. Necessário porque `nginx -t` não detecta
# "Address family not supported" (só ocorre ao abrir o socket de verdade) —
# sem isso, uma máquina/rede sem IPv6 derruba o nginx no boot.
python3 -m api.ipv6 || \
    echo "entrypoint: api.ipv6 falhou, seguindo com a config atual" >&2

# Varre as confs em busca de server{} com TLS e emite certificados
# auto-assinados para os domínios cujos ssl_certificate ainda não existem em
# disco (senão o nginx -t falharia por certificado ausente). Certificados já
# presentes nunca são sobrescritos. Desative com NGINX_SELFSIGN=off.
if [ "${NGINX_SELFSIGN:-on}" != "off" ]; then
    python3 -m api.certboot || \
        echo "entrypoint: api.certboot falhou, seguindo mesmo assim" >&2
fi

# Layout do cache (compartilhada em shared/, zonas dedicadas em zones/<zona>,
# rotas em routes/<zona>). O nginx só cria o último nível do cache_path, então
# garantimos os pais aqui (senão o boot falha com mkdir() ENOENT) e liberamos
# p/ www-data (usuário dos workers).
mkdir -p /var/cache/nginx/shared /var/cache/nginx/zones /var/cache/nginx/routes
chown -R www-data:www-data /var/cache/nginx 2>/dev/null || true

# Valida a configuração antes de iniciar (falha cedo com erro claro).
nginx -t

mkdir -p "$LOG_DIR"
touch "$LOG_DIR/nginx.log" "$LOG_DIR/api.log" "$LOG_DIR/web.log" \
    "$LOG_DIR/cloudflared-1.log" "$LOG_DIR/cloudflared-2.log" "$LOG_DIR/cloudflared-3.log"

# Aplica a preferência persistida do Cloudflare Tunnel no boot do container.
# Se estiver desativado, garante que não ficou processo antigo rodando; se
# estiver ativo, instala o binário quando necessário e sobe o cloudflared.
python3 -m api.cloudflared || \
    echo "entrypoint: cloudflared falhou, a API tentará reconciliar no start" >&2

# --- serviço: API de gerenciamento (FastAPI, API_PORT) --------------------- #
# Controla o nginx (reload/restart) e edita as confs, por isso roda no mesmo
# container. HTTP por padrão (API_TLS=on p/ HTTPS). Desative com API_ENABLED=off.
if [ "${API_ENABLED:-on}" != "off" ]; then
    echo "entrypoint: iniciando serviço api (porta ${API_PORT:-3001})" >&2
    python3 -m api.server >>"$LOG_DIR/api.log" 2>&1 &
fi

# --- serviço: painel (frontend SPA estático) ------------------------------- #
# Servido por um servidor estático próprio (stdlib), NÃO pelo nginx — assim o
# painel continua no ar mesmo enquanto se mexe/recarrega o nginx. A conexão com
# a API é direta (o painel monta a URL da API via /env.js). Desative com
# FRONT_ENABLED=off.
if [ "${FRONT_ENABLED:-on}" != "off" ]; then
    echo "entrypoint: iniciando serviço painel (HTTP ${FRONT_PORT:-3000})" >&2
    python3 -m api.webserver >>"$LOG_DIR/web.log" 2>&1 &
fi

# --- serviço: nginx -------------------------------------------------------- #
# Roda em foreground-mode (daemon off) porém em background do shell; a saída e
# o access_log/error_log (/dev/stdout, /dev/stderr) caem no arquivo de log.
echo "entrypoint: iniciando serviço nginx" >&2
nginx -g 'daemon off;' >>"$LOG_DIR/nginx.log" 2>&1 &

# Executa o CMD (por padrão: streama os logs dos serviços para o stdout).
exec "$@"
