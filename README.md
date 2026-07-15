# Holtz Nexus

**Holtz Nexus** é uma plataforma de **edge, deploy e observabilidade** construída
em torno de um **nginx compilado do zero** e operada por completo pelo navegador.
Reúne, num único container, um servidor web/proxy de alto desempenho, uma **API de
gerenciamento** (FastAPI) que lê e edita a configuração do nginx com segurança, e
um **painel web** (React) para operar tudo — de server blocks e certificados a
CI/CD, containers Docker e monitoramento de uptime.

---

## Sumário de recursos

| Área | O que faz |
|------|-----------|
| **Nginx** | Server blocks HTTP e Stream (TCP/UDP), upstreams, RTMP (live), opções globais e tuning automático. Padrão *available/enabled* com escrita segura (`nginx -t` + rollback). |
| **HTTP/3 + QUIC** | nginx compilado com QuicTLS, além de GeoIP2, brotli, zstd, headers-more e o módulo stream. |
| **Certificados** | Self-signed (com IP), **CA própria** e **Let's Encrypt** via cliente ACME puro (DNS-01), com auto-renovação. |
| **DNS** | Provedores Cloudflare, Route53, Google e Azure (usados no desafio DNS-01), sem SDKs. |
| **CI/CD** | Projetos e serviços (aplicação, banco de dados, compose, template) provisionados via Docker Engine API; deploys estáticos/git/docker com releases versionadas e rollback atômico. |
| **Docker** | Gestão completa de containers, imagens, volumes e redes do host; terminal (TTY real via WebSocket), logs ao vivo, uso de CPU/memória e scan de vulnerabilidades (Trivy). |
| **Uptime** | Monitores (http/tcp/ping/dns/domain/bancos/container/push), heartbeats, incidentes, janelas de manutenção, status pages públicas, notificações e proxies. |
| **Logs & Métricas** | Tail/stream do access/error log, agregação em métricas, rotação automática com envio para S3. |
| **Usuários & RBAC** | Usuário master (`.env`) + usuários no banco (Argon2id), papéis editáveis por recurso×ação, auditoria de toda mutação. |

---

## Arquitetura

Três containers, cada um com seu Dockerfile e serviço no `docker-compose.yml`:
**nginx** (edge), **api** (gerência) e **web** (painel). A API edita a config nos
**volumes compartilhados** e **controla o nginx do outro container pela Docker
Engine API** (o socket montado): `nginx -t`/`reload`/`reopen` via `docker exec` e
start/stop/restart pelo ciclo de vida do container — ver `api/nginxctl.py` (modo
docker, selecionado pela env `NGINX_CONTAINER`).

```
┌──── nginx ─────┐   ┌──────── api ────────┐   ┌──── web ────┐
│ reverse proxy  │   │ FastAPI (3001)      │   │ SPA estático│
│ 80/443/1935    │◄──┤ edita conf/ (vol.)  │   │ (nginx      │
│ (edge, HTTP/3) │   │ controla o nginx    │   │  :alpine)   │
│                │   │ via docker.sock     │   │ 3000        │
└───────┬────────┘   └──────────┬──────────┘   └─────────────┘
        │  volumes compartilhados │ (conf, certs, generated, logs)
        └─────────────────────────┘
   rede docker `nexus` (a API resolve o nginx pelo nome; stub_status :8090)
```

**Boot ordenado:** a API gera tuning/self-signed/ipv6 nos volumes compartilhados
**antes** de o nginx subir — o `nginx` usa `depends_on: api service_healthy`.

**Painel desacoplado do nginx principal:** o `web` é um nginx:alpine próprio
servindo o SPA, para seguir acessível mesmo enquanto se recarrega o nginx de edge.
A conexão do painel com a API é **direta** (cross-origin, sem proxy nem prefixo
`/api`).

> **Single-container (swarm):** ainda existe um `Dockerfile` all-in-one (nginx +
> API + painel no mesmo container, controle local por subprocess quando
> `NGINX_CONTAINER` não está definido), usado por `docker-compose.prod.yml`
> (Docker Swarm, réplicas).

### Portas

| Porta | Serviço |
|-------|---------|
| 80 / 443 | nginx (reverse proxy / serviço principal; 443 em TCP **e** UDP para HTTP/3) |
| 1935 | RTMP (live) |
| `FRONT_PORT` (3000) | painel web (SPA estático) |
| `API_PORT` (3001) | API de gerenciamento (HTTP por padrão; `API_TLS=on` p/ HTTPS self-signed) |

---

## Como rodar

Crie um `.env` ao lado do `docker-compose.yml` com, no mínimo, `API_TOKEN`,
`API_USER` e `API_PASSWORD`:

```bash
cat > .env <<EOF
API_TOKEN=$(openssl rand -hex 32)
API_USER=admin
API_PASSWORD=troque-esta-senha
EOF

docker compose up --build
```

Depois de subir:

- **Painel:** <http://localhost:3000>
- **API:** <http://localhost:3001> · **Docs (Swagger):** <http://localhost:3001/docs>

O usuário do `.env` é o **master**: papel implícito, não editável, com todas as
permissões. Demais usuários são criados no painel, com papéis RBAC.

### Desenvolvimento com hot-reload

```bash
docker compose build                          # 1x: compila o nginx + monta as imagens
docker compose -f docker-compose.dev.yml up --build
# API (uvicorn --reload) :3001 · painel (Vite/HMR) :3000
```

Mesma topologia de 3 containers da produção: o serviço `api` roda com `uvicorn
--reload` (monta `./api` e `./conf`) e controla o `nginx` pelo socket do Docker; o
`web` roda o Vite apontando `VITE_API_URL` para a API. Ver
[web/README.md](web/README.md) para rodar só o frontend.

---

## Convenções importantes

- **Envelope de resposta:** toda resposta da API (sucesso e erro) é
  `{success, data, messages}`, com `messages[].type ∈ warn|error|success`.
- **Escrita segura:** toda mutação de config faz **backup → grava → `nginx -t` →
  mantém**, ou faz **rollback** e responde `409`.
- **Padrão `available`/`enabled`:** criar um recurso (server HTTP/stream, upstream,
  app RTMP) grava em `<tipo>-available/` e já cria o symlink em `<tipo>-enabled/`
  (nasce ativo). Só o que tem symlink em `*-enabled/` é incluído pelo nginx.
  Desativar remove o symlink, **não** apaga o arquivo.
- **CRUD por formulário (raw opcional):** o painel edita servers/upstreams/streams
  por formulário, com um "modo avançado (raw)" para colar config nginx diretamente.
- **Configuração persistente no banco:** métricas, auditoria, usuários, papéis,
  monitores, projetos, etc. usam SQLAlchemy + Alembic (`DB_TYPE` ∈
  sqlite/mysql/postgresql). Migrations rodam de forma idempotente no boot.

Para o contexto completo do projeto e as decisões de design, veja
[api/docs.md](api/docs.md).

---

## Estrutura do repositório

Três pastas, uma por container:

```
nginx/         fonte do nginx (auto/ src/ contrib/ docs/) + conf/ (edge)
  conf/        árvore de config do nginx (montada rw no compose)
api/           API FastAPI (routers, config store/parser, integrações)
  ROUTES.md    referência completa das rotas
  db/          modelos SQLAlchemy + migrations Alembic
  requirements.txt
web/           painel (Vite + React + TS + Tailwind + shadcn/ui) + web/nginx.conf
scripts/       entrypoints (nginx/api/dev) e boot (tune, certboot, ipv6)
Dockerfile.nginx   compila o nginx (edge) — runtime enxuto, sem python
Dockerfile.api     FastAPI + docker CLI (gerência)
Dockerfile.web     build do SPA + nginx:alpine (painel)
Dockerfile.dev     imagem de dev da API (uvicorn --reload)
docker-compose.yml         3 serviços: nginx + api + web
docker-compose.dev.yml     idem, com hot-reload
```

Documentação por camada:

- **API** — [api/README.md](api/README.md) · rotas completas em
  [api/ROUTES.md](api/ROUTES.md)
- **Painel web** — [web/README.md](web/README.md)

---

## Variáveis de ambiente principais

| var | padrão | descrição |
|-----|--------|-----------|
| `API_TOKEN` | — | Bearer exigido pela API; também é o bearer "root" do master (**obrigatório**) |
| `API_USER` / `API_PASSWORD` | — | credenciais do usuário master (**obrigatórias**) |
| `API_NAME` / `API_EMAIL` | — | nome/e-mail do master (exibição no perfil) |
| `API_TLS` | `off` | `on` liga HTTPS self-signed na API |
| `API_PORT` | `3001` | porta da API |
| `FRONT_PORT` | `3000` | porta do painel |
| `DB_TYPE` | `sqlite` | banco (`sqlite`/`mysql`/`postgresql`) |

Muitas configurações antes controladas por env (CORS, TLS, TTL de sessão, scanner
de imagens, banco, ...) hoje são editáveis em **Configurações** no painel — o env
serve só como *default/fallback*. A lista completa está em [api/docs.md](api/docs.md).

---

## Segurança

- A API responde `503` a tudo se `API_TOKEN` não estiver definido (fail-safe).
- Toda mutação (POST/PUT/DELETE) é **auditada**, com o usuário resolvido pela
  identidade do Bearer (não spoofável).
- Montar `/var/run/docker.sock` (necessário para os recursos de CI/CD e Docker)
  **equivale a acesso root no host** — habilitado por padrão no compose; remova o
  bind se não for usar essas funcionalidades.

---

Comentários e mensagens do projeto são em **português** — mantenha esse padrão ao
contribuir.
