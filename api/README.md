# Holtz Nexus — API

API de gerenciamento do nginx em **FastAPI**, servida por **HTTP na porta 3001**
por padrão (defina `API_TLS=on` para HTTPS self-signed, com cert gerado
automaticamente). Roda dentro do mesmo container do nginx (subida em background
pelo `entrypoint.sh`), pois precisa editar as confs e enviar sinais
(`reload`/`restart`) ao processo do nginx.

## Autenticação

Todas as rotas (exceto `/health`) exigem um **Bearer token**:

```
Authorization: Bearer <API_TOKEN>
```

O valor vem da env `API_TOKEN`. Se não estiver definido, a API responde `503` a
tudo (fail-safe para não ficar aberta por acidente).

## Subir

Via docker-compose (defina `API_TOKEN` em um `.env`):

```bash
echo "API_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up --build
curl -k https://localhost:3001/health
```

Docs interativas (Swagger): `https://localhost:3001/docs`.

Variáveis de ambiente relevantes:

| var            | padrão            | descrição                                   |
|----------------|-------------------|---------------------------------------------|
| `API_TOKEN`    | —                 | token Bearer exigido (obrigatório)          |
| `API_ENABLED`  | `on`              | `off` não sobe a API                        |
| `API_HOST`     | `0.0.0.0`         | bind                                         |
| `API_PORT`     | `3001`            | porta                                        |
| `API_CERT/KEY` | `/etc/certs/api.*`| cert/chave TLS (gerados se ausentes)         |
| `NGINX_PREFIX` | `/etc/nginx`      | raiz das confs                               |

## Formato de resposta

Toda resposta — sucesso ou erro — segue o mesmo envelope:

```jsonc
{
  "success": true,
  "data": [],          // payload (objeto ou lista); [] quando não há dados
  "messages": [        // avisos/erros/infos legíveis
    { "type": "warn", "message": "mensagem" }
  ]
}
```

`type` ∈ `warn` | `error` | `success`. Erros de auth (401), validação
(422), não encontrado (404) e conflito de config (409) também vêm nesse formato,
com `success: false` e a causa em `messages`.

## Modelo de dados: nós de configuração

Sub-recursos são manipulados como listas de **nós** da árvore de config:

```jsonc
// diretiva:  add_header X-Frame-Options SAMEORIGIN;
{ "type": "directive", "name": "add_header", "args": ["X-Frame-Options", "SAMEORIGIN"] }

// bloco:     location / { return 200 ok; }
{ "type": "block", "name": "location", "args": ["/"],
  "children": [ { "type": "directive", "name": "return", "args": ["200", "ok"] } ] }

// comentário
{ "type": "comment", "text": "meu comentário" }
```

## Rotas

> Referência completa de todas as rotas, com parâmetros, corpos, exemplos `curl`
> e o mapeamento de cada sub-recurso para as diretivas do nginx:
> **[ROUTES.md](ROUTES.md)**.

### `/nginx` — controle
| método | rota                     | ação                              |
|--------|--------------------------|-----------------------------------|
| GET    | `/nginx/status`          | rodando? pid, config_ok, versão   |
| GET    | `/nginx/version`         | versão do nginx                   |
| POST   | `/nginx/test`            | `nginx -t`                        |
| POST   | `/nginx/reload`          | `nginx -s reload`                 |
| POST   | `/nginx/restart`         | quit + start                      |
| GET    | `/nginx/configuration`   | config efetiva (`nginx -T`)       |
| GET    | `/nginx/globals`         | diretivas de nível principal      |

### `/servers` — server blocks (http)
`GET /servers`, `POST /servers`, `GET|PUT|DELETE /servers/{serverId}`.

O `serverId` é derivado do primeiro `server_name` (ex.: `nexus.com`); `_` vira
`default`. Sub-recursos (todos com **GET/PUT/POST/DELETE**):

`locations`, `upstream`, `certificates`, `redirects`, `headers`, `logs`,
`rate-limits`, `access`, `cache`, `gzip`, `brotli`, `proxy`, `websocket`,
`http2`, `http3`, `security`, `snippets`.

- **GET** retorna os nós que casam com o sub-recurso.
- **PUT** substitui esse conjunto de nós.
- **POST** adiciona nós.
- **DELETE** remove os nós que casam.

### `/upstreams`
`GET /upstreams`, `POST /upstreams?name=<id>`, `GET|PUT|DELETE /upstreams/{upstreamId}`,
e `GET|PUT|POST|DELETE /upstreams/{upstreamId}/servers`.

### `/streams` — server blocks dentro de `stream {}`
`GET /streams`, `POST /streams`, `GET|PUT|DELETE /streams/{streamId}`, com
sub-recursos `upstream`, `access`, `logs`, `proxy`. O `streamId` deriva do
primeiro `listen`.

## Segurança das escritas

Toda mutação: **backup → grava → `nginx -t` → mantém**, ou **restaura o backup**
se o teste falhar (responde `409` com a saída do nginx). Nenhuma config inválida
chega ao disco de forma persistente.

## Exemplos

```bash
TOKEN=... ; B="https://localhost:3001"

# adicionar um header a um server
curl -k -X POST "$B/servers/default/headers" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '[{"type":"directive","name":"add_header","args":["X-Robots-Tag","noindex"]}]'

# criar um server novo
curl -k -X POST "$B/servers" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '[
    {"type":"directive","name":"listen","args":["8080"]},
    {"type":"directive","name":"server_name","args":["novo.nexus.com"]},
    {"type":"block","name":"location","args":["/"],
     "children":[{"type":"directive","name":"return","args":["200","ok"]}]}
  ]'

# recarregar
curl -k -X POST "$B/nginx/reload" -H "Authorization: Bearer $TOKEN"
```

## Limitações conhecidas

- Ao reescrever um arquivo, os **comentários são preservados**, mas o
  espaçamento/linhas em branco originais são **normalizados** (reindentado).
  Só arquivos efetivamente modificados são reescritos.
- Os seletores de sub-recurso se sobrepõem por natureza (ex.: `proxy` inclui
  `proxy_set_header`, que também aparece em `websocket`/`headers`). GET é uma
  visão filtrada; para escrever, use o sub-recurso mais específico.
