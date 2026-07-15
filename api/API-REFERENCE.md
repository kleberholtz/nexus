# Holtz Nexus — catálogo completo da API

Este documento lista as rotas registradas em `api/main.py` e em
`api/routers/`. Para exemplos de corpos de configuração nginx e explicações
mais detalhadas sobre o modelo de nós, consulte também [`ROUTES.md`](ROUTES.md).

Validado em 14/07/2026 contra a API local v1.1.0: 230 caminhos e 366 operações
HTTP no OpenAPI, mais 2 WebSockets e 4 endpoints internos da documentação. Os
contratos de corpos genéricos foram conferidos diretamente nas validações do
código, pois o OpenAPI expõe esses bodies apenas como `object`.

## Convenções

- Base validada: `http://127.0.0.1:3001`.
- Salvo indicação de rota pública, envie `Authorization: Bearer <token>`.
- Rotas SSE e downloads abertos pelo navegador também aceitam `?token=<token>`.
- Respostas JSON da aplicação usam o envelope
  `{ "success": boolean, "data": ..., "messages": [...] }`.
- `messages[].type` pode ser `warn`, `error` ou `success`.
- Escritas de configuração nginx fazem backup, validação com `nginx -t` e
  rollback automático quando a configuração é rejeitada.
- `GET` lê; `POST` cria ou executa uma ação; `PUT` substitui ou atualiza;
  `DELETE` remove; `WS` indica WebSocket.

As únicas rotas públicas são `/health`, `/auth/login`, a documentação OpenAPI,
os callbacks e webhooks Git, o webhook de serviço, os heartbeats push e as
status pages públicas. As demais usam autenticação e, quando aplicável, RBAC.

## Como ler os contratos

- Todo campo entre chaves no caminho, como `{project_id}`, é **obrigatório**.
- O header `Authorization: Bearer <token>` é **obrigatório** nas rotas não
  públicas, embora apareça como opcional no OpenAPI por ser validado em
  middleware/dependency.
- Em streams SSE, downloads e terminais WebSocket, `token` pode ou deve ser
  enviado na query porque `EventSource`, links e WebSocket não usam o header da
  mesma forma que `fetch`.
- `Sim` significa obrigatório na criação. `Não` significa opcional e mostra o
  default quando houver. `Condicional` indica que a exigência depende de outro
  campo. Em `PUT`, campos omitidos normalmente mantêm o valor atual.
- A coluna **Descrição** do catálogo de endpoints também resume o conteúdo de
  `data` devolvido por cada rota. As formas comuns são detalhadas abaixo.

### Envelope JSON

Resposta de sucesso:

```json
{
  "success": true,
  "data": {},
  "messages": [
    { "type": "success", "message": "operação concluída" }
  ]
}
```

Resposta de erro:

```json
{
  "success": false,
  "data": [],
  "messages": [
    { "type": "error", "message": "causa do erro" }
  ]
}
```

Exceções ao envelope:

| Tipo | Resposta |
|---|---|
| SSE | `text/event-stream`; eventos `data`, `snapshot`, `progress`, `version`, `end`, `deleted` ou `error`, conforme a rota. |
| Downloads/exports | Arquivo ou stream binário com `Content-Disposition`. |
| `/status/{slug}` | HTML público. |
| `/status/{slug}/data` | JSON público sem o envelope interno. |
| Callbacks Git | HTML que notifica a janela de origem e fecha o popup. |
| WebSocket | Frames binários para terminal e JSON de controle para resize. |

## Parâmetros de path e query

### Identificadores de path

Todos são obrigatórios.

| Campo | Tipo | Descrição |
|---|---|---|
| `ident` | string | Identificador derivado do server, upstream, stream ou aplicação RTMP. |
| `name` | string | Nome de certificado, CA, papel, volume, rede ou provedor Git. |
| `project_id` | inteiro | ID do projeto. |
| `service_id` | inteiro | ID de um serviço pertencente ao projeto. |
| `deployment_id` | inteiro | ID de um deployment do serviço. |
| `provider_id` | inteiro | ID de provedor DNS, Git ou IA, conforme o prefixo. |
| `config_id` | inteiro | ID de configuração S3. |
| `key_id` / `reg_id` | inteiro | ID de chave SSH ou registry Docker. |
| `user_id` | inteiro | ID de usuário do banco. |
| `monitor_id` | inteiro | ID do monitor. |
| `group_id`, `tag_id`, `proxy_id`, `channel_id` | inteiro | IDs de recursos auxiliares do uptime. |
| `incident_id`, `mid`, `page_id` | inteiro | IDs de incidente, manutenção e status page. |
| `domain_id` | string | ID persistido do domínio vinculado ao serviço. |
| `backup_id`, `snapshot_id`, `job_id` | string | Identificador de artefato ou job assíncrono. |
| `cid`, `container_id`, `image_id`, `scan_id` | string/integer | Identificador Docker ou ID do scan. |
| `record_id` | string/path | ID remoto do registro DNS; pode conter barras. |
| `slug` | string | Slug público da status page. |
| `token` | string | Token secreto do heartbeat push. |
| `verb` | enum | Ação de serviço: `deploy`, `start`, `stop`, `restart` ou `rebuild`. |

### Paginação e filtros comuns

Todos são opcionais.

| Campo | Default | Descrição |
|---|---:|---|
| `page` | ausente ou `1` | Página baseada em 1. Quando ausente em alguns catálogos, retorna a lista sem envelope de paginação. |
| `limit` | `50` | Itens por página; nas listagens Docker e catálogos o máximo usual é 50. |
| `page_size` | `10` | Itens por página em backups e snapshots; faixa 1–100. |
| `offset` | `0` | Quantidade de itens ignorados antes do resultado. |
| `search` | `""` | Busca textual case-insensitive. |
| `status` | ausente | Filtra pelo status aceito pelo recurso. |
| `type` | `""` | Filtra pelo tipo, por exemplo canal de notificação. |
| `from` | `0` | Sequência inicial para replay de eventos de um job SSE. |
| `tail` | `200` | Quantidade inicial de linhas de log antes de acompanhar o stream. |

### Queries específicas

| Endpoint/família | Campo | Obrigatório? | Default | Descrição |
|---|---|---|---|---|
| Rotas SSE/download | `token` | Condicional | — | Alternativa ao bearer para clientes que não conseguem enviar o header. |
| WebSockets de terminal | `token` | Sim | — | Token com `projects:write` ou `docker:write`. |
| WebSockets de terminal | `shell` | Não | `sh` | Shell `sh` ou `bash`. |
| Terminal de serviço | `container` | Não | container principal | Seleciona um container específico do serviço. |
| `/system/metrics` | `minutes` | Não | `60` | Janela do histórico, de 1 minuto a 1 ano. |
| `/system/metrics` | `max_points` | Não | automático | Máximo de 30–1000 pontos após agregação. |
| `/servers/{ident}/cache/clear` | `zone` | Não | todas | Limita a limpeza a uma zona de cache. |
| `POST /upstreams` | `name` | Sim | — | Nome único do upstream. |
| `POST /upstreams` | `context` | Não | `http` | Contexto visual `http` ou `stream`. |
| `POST /rtmp` | `name` | Sim | — | Nome da aplicação RTMP. |
| `POST /rtmp` | `listen` | Não | `1935` | Porta RTMP. |
| `PUT /rtmp/{ident}` | `name`, `listen` | Não | atuais | Renomeiam ou movem a aplicação. |
| GitHub repositories/branches | `installation_id` | Não | `""` | Instalação do GitHub App. |
| GitHub branches | `repo` | Sim | — | Repositório no formato esperado pelo provider. |
| Callbacks Git | `code`, `installation_id` | Condicional | `""` | Código OAuth ou ID de instalação fornecido pelo provider. |
| Manifest GitHub | `code` | Condicional | `""` | Código devolvido pelo GitHub App Manifest. |
| Manifest GitHub | `name`, `label`, `base_url` | Não | `""` | Metadados usados na criação do provider. |
| Webhooks Git/serviço | `secret` | Sim na prática | `""` | Segredo validado pelo handler; vazio resulta em não autorizado. |
| `/templates` | `tags` | Não | `""` | Tags separadas por vírgula. |
| Deployments | `project_id`, `service_id` | Sim no path | — | Escopo obrigatório do histórico. |
| Deployments | `status` | Não | todos | `queued`, `deploying`, `deployed`, `failed` ou `canceled`. |
| Exclusão de backup/snapshot | `delete_s3` | Não | `false` | Também exclui o objeto remoto. |
| Arquivos | `path` | Sim no DELETE | `""` no GET | Caminho relativo dentro da raiz gerenciada. |
| Docker lists | `state`, `status`, `driver` | Não | todos | Filtros específicos de containers, imagens, volumes e redes. |
| Remoção Docker | `force` | Não | `false` | Força remoção de imagem ou volume. |
| Scan history | `image_id` | Não | todas | Limita o histórico a uma imagem. |
| Monitor list/stream | `group_id`, `push` | Não | todos | Filtra grupo e monitores push. |
| Monitor list | `no_group` | Não | `false` | Retorna apenas monitores sem grupo. |
| Heartbeats/eventos | `limit` | Não | `100` | Máximo de registros, até 1000. |
| Chart | `range` | Não | `24h` | Intervalo do gráfico (`1h`, `3h`, `6h`, `12h`, `24h`, `1w`, `1m`). |
| Heartbeat push | `status`, `msg` | Não | `up`, `""` | Estado reportado e mensagem opcional. |
| Audit | `user`, `action`, `since` | Não | todos | Usuário, prefixo de ação e epoch mínimo em milissegundos. |
| Logs access/error | `lines`, `page` | Não | `50`, ausente | Últimas linhas ou página fixa de 50 itens. |
| Log metrics | `lines` | Não | `5000` | Linhas do access log usadas na agregação, até 50000. |
| DNS records | `zone_id` | Sim | — | Zona remota usada para listar ou remover registros. |
| Cloudflared log | `max_bytes` | Não | `80000` | Volume máximo retornado, limitado a 500000 bytes. |

## Corpos JSON: campos obrigatórios e opcionais

### Sessão, usuários e papéis

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /auth/login` | `username` | string | Sim | Usuário master ou usuário cadastrado. |
|  | `password` | string | Sim | Senha da conta. |
| `PUT /users/profile` | `name` | string | Sim | Nome do próprio usuário, 2–120 caracteres. |
|  | `email` | string | Sim | E-mail válido, até 254 caracteres. |
|  | `current_password` | string | Condicional | Obrigatória quando `new_password` for informado. |
|  | `new_password` | string | Não | Nova senha, mínimo de 8 caracteres. |
| `POST /users` | `username` | string | Sim | Identificador único, 3–120 caracteres. |
|  | `password` | string | Sim | Senha inicial, mínimo de 8 caracteres. |
|  | `name` | string | Sim | Nome, 2–120 caracteres. |
|  | `email` | string | Sim | E-mail válido. |
|  | `role` | string | Não | Papel atribuível; default `viewer`. |
| `PUT /users/{user_id}` | `role` | string | Não | Novo papel atribuível. |
|  | `active` | boolean | Não | Ativa ou inativa a conta. |
|  | `password` | string | Não | Nova senha; vazio mantém. A troca encerra sessões. |
|  | `name` | string | Não | Novo nome. |
|  | `email` | string | Não | Novo e-mail. |
| `POST /users/roles` | `name` | string | Sim | Nome único `a-z`, números, `-` e `_`, com 2–40 caracteres. |
|  | `label` | string | Não | Nome de exibição; default igual a `name`. |
|  | `permissions` | string[] | Não | Permissões `recurso:read`, `recurso:write` ou `*`; default vazio. |
| `PUT /users/roles/{name}` | `label` | string | Não | Novo nome de exibição. |
|  | `permissions` | string[] | Não | Substitui a lista de permissões. |

Respostas: login devolve `{token, user, name, email, role, is_master,
permissions}`; perfil e usuários devolvem o objeto público da conta; papéis
devolvem `{name, label, permissions, builtin, assignable, in_use, editable}`.

### Nós e configuração nginx

Servers, upstreams, streams e RTMP aceitam um dos dois formatos:

```json
{ "raw": "server { listen 80; server_name exemplo.com; }" }
```

ou uma lista de nós:

```json
[
  { "type": "directive", "name": "listen", "args": ["80"] },
  {
    "type": "block",
    "name": "location",
    "args": ["/"],
    "children": [
      { "type": "directive", "name": "return", "args": ["200", "ok"] }
    ]
  },
  { "type": "comment", "text": "comentário opcional" }
]
```

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `raw` | string | Condicional | Configuração textual; alternativa à lista de nós. |
| `type` | enum | Sim por nó | `directive`, `block` ou `comment`. |
| `name` | string | Sim em directive/block | Nome da diretiva ou bloco. |
| `args` | string[] | Não | Argumentos da diretiva/bloco; default vazio. |
| `children` | node[] | Não | Nós filhos de um bloco. |
| `text` | string | Sim em comment | Texto do comentário. |

`POST` e `PUT` de sub-recursos exigem uma lista de nós. As respostas de detalhe
de server/upstream/stream/RTMP trazem `id`, `file`, `enabled`, `nodes` e `raw`,
mais metadados específicos. Mutadores de sub-recurso devolvem os nós resultantes;
`DELETE` devolve `{removed}`.

### Configuração global e tuning do nginx

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `PUT /nginx/config` | `main` | nodes ou `{raw}` | Condicional | Diretivas do contexto principal. Pelo menos um dos três campos é obrigatório. |
|  | `events` | nodes ou `{raw}` | Condicional | Conteúdo do bloco `events`. |
|  | `http` | nodes ou `{raw}` | Condicional | Diretivas diretas do bloco `http`; sub-blocos são preservados. |
| `POST /nginx/tune` | `worker_processes` | inteiro | Não | Workers, 1–1024; default calculado. |
|  | `worker_connections` | inteiro | Não | Conexões por worker; default calculado. |
|  | `worker_rlimit_nofile` | inteiro | Não | Limite de arquivos, deve ser ≥ conexões. |
|  | `mem_fraction` | número | Não | Fração de memória usada no cálculo. |

Respostas: `/nginx/config` devolve arquivo e blocos raw/AST; `/nginx/tune`
devolve recursos detectados, valores calculados, atuais e, na aplicação,
`{applied: {worker_processes, worker_connections, worker_rlimit_nofile}}`.

### Certificados

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /certificates/import` | `cert` | string PEM | Sim | Certificado de servidor. |
|  | `key` | string PEM | Sim | Chave privada correspondente. |
|  | `chain` | string PEM | Não | Cadeia intermediária anexada ao certificado. |
|  | `name` | string | Não | Nome do arquivo; deriva do certificado se ausente. |
|  | `auto_renew` | boolean | Não | Registra auto-renovação; default `false`. |
| `PUT /certificates/{name}/auto-renew` | `auto_renew` | boolean | Sim | Novo estado da auto-renovação. |
| `POST /certificates/self-signed` | `domains` | string[] | Condicional | Domínios/SANs; obrigatório se `ips` estiver vazio. |
|  | `ips` | string[] | Condicional | IPv4/IPv6; obrigatório se `domains` estiver vazio. |
|  | `days` | inteiro | Não | Validade de 1–3650 dias; default 365. |
|  | `rsa` | boolean | Não | Usa RSA em vez do algoritmo padrão. |
|  | `auto_renew` | boolean | Não | Ativa renovação automática. |
| `POST /certificates/ca` | `cn` | string | Sim | Common Name da CA. |
|  | `org` | string | Não | Organização; default `Holtz Nexus`. |
|  | `days` | inteiro | Não | Validade de 1–7300 dias; default 3650. |
|  | `rsa` | boolean | Não | Usa RSA. |
| `POST /certificates/ca/import` | `cert` | string PEM | Sim | Certificado com `BasicConstraints CA=true`. |
|  | `key` | string PEM | Sim | Chave privada correspondente. |
|  | `name` | string | Não | Nome local da CA. |
| `POST /certificates/ca-signed` | `ca_name` | string | Sim | CA própria usada para assinar. |
|  | `domains`, `ips` | string[] | Condicional | Pelo menos um domínio ou IP. |
|  | `days`, `rsa`, `auto_renew` | vários | Não | Mesmos significados do self-signed. |
| `POST /certificates/letsencrypt` | `domains` | string[] | Sim | Domínios do certificado. |
|  | `provider_id` | inteiro | Sim | Provedor DNS usado no desafio DNS-01. |
|  | `staging` | boolean | Não | Usa o ambiente de testes; default `true`. |
|  | `auto_renew` | boolean | Não | Ativa renovação automática. |

As emissões/importações devolvem metadados do certificado, incluindo nome,
caminhos, domínios, validade e tipo. Exclusões devolvem `{deleted}`.

### DNS

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /dns/providers` | `type` | enum | Sim | `cloudflare`, `route53`, `google` ou `azure`. |
|  | `label` | string | Não | Nome de exibição. |
|  | `config` | object | Sim | Credenciais/campos definidos por `/dns/provider-types`. |
| `PUT /dns/providers/{provider_id}` | `label` | string | Não | Novo rótulo. |
|  | `config` | object | Não | Configuração parcial; segredos vazios/mascarados são preservados. |
| `POST/PUT .../records` | `zone_id` | string | Sim | ID da zona remota. |
|  | `type` | enum | Sim | `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `NS`, `CAA` ou `SRV`. |
|  | `name` | string | Sim | Nome/FQDN do registro. |
|  | `content` | string | Sim | Valor do registro. |
|  | `ttl` | inteiro | Não | TTL 1–604800; default 300. |
|  | `proxied` | boolean | Não | Proxy Cloudflare; ignorado nos demais providers. |

Campos obrigatórios de `config` por provedor:

| Provedor | Campos obrigatórios | Resumo |
|---|---|---|
| Cloudflare | `api_token` | Token com permissão de leitura de zonas e edição DNS. |
| Route 53 | `access_key`, `secret_key` | Credenciais AWS usadas na assinatura SigV4. |
| Google Cloud DNS | `service_account`, `project_id` | JSON completo da conta de serviço e ID explícito do projeto. |
| Azure DNS | `tenant_id`, `client_id`, `client_secret`, `subscription_id`, `resource_group` | Credenciais de aplicação e escopo da zona no Azure. |

Providers devolvem configuração pública mascarada; operações remotas devolvem
zonas ou registros no formato normalizado do provider; remoções devolvem
`{deleted}`.

### S3

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /s3/configs` | `label` | string | Não | Nome de exibição; default igual ao bucket. |
|  | `config` | object | Sim | Configuração descrita abaixo. |
| `PUT /s3/configs/{config_id}` | `label` | string | Não | Novo rótulo. |
|  | `config` | object | Não | Patch da configuração; segredo mascarado mantém o atual. |
| `config` | `bucket` | string | Sim | Nome do bucket. |
|  | `access_key` | string | Sim | Access Key ID. |
|  | `secret_key` | string | Sim na criação | Secret Access Key; vazio/`********` mantém no update. |
|  | `region` | string | Não | Região AWS ou `auto` para serviços compatíveis. |
|  | `endpoint` | URL | Não | Endpoint customizado; vazio usa AWS S3. |
|  | `prefix` | string | Não | Pasta/prefixo dentro do bucket. |

Configs devolvem `{id, label, config, created_ts, updated_ts}` com segredo
mascarado. O teste devolve `{key}` com a chave do objeto enviado.

### Provedores de IA

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| create/update/test | `type` | enum | Sim na criação/teste | `openai`, `anthropic`, `gemini`, `perplexity`, `ollama`, `openrouter`, `zai` ou `minimax`. |
|  | `name` | string | Sim na criação | Nome de exibição, até 120 caracteres. |
|  | `api_url` | URL | Sim | Base HTTP/HTTPS sem credenciais embutidas. |
|  | `api_key` | string | Condicional | Obrigatória exceto para Ollama; vazia/mascarada mantém no update. |
|  | `model` | string | Sim | Identificador do modelo, até 255 caracteres. |
|  | `enabled` | boolean | Não | Default `true`. |
| `POST /ai/providers/test` | `id` | inteiro | Não | Provider salvo do qual herdar a chave mascarada. |

O objeto público contém `{id, type, name, api_url, api_key, has_api_key, model,
enabled, created_ts, updated_ts}`. Testes devolvem provider/model e conteúdo
resumido da resposta do modelo.

### Chaves SSH, registries e provedores Git

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /deploy/ssh-keys` | `name` | string | Sim | Nome da chave. |
|  | `private_key` | string | Não | Chave privada OpenSSH; ausente gera um par Ed25519. |
|  | `public_key` | string | Não | Chave pública; preenchida automaticamente quando o par é gerado. |
| `PUT /deploy/ssh-keys/{key_id}` | `name` | string | Não | Novo nome. |
|  | `private_key` | string | Não | Nova chave; vazio/mascarado mantém. |
|  | `public_key` | string | Não | Nova chave pública. |
| `POST /deploy/registries` | `name` | string | Sim | Nome do registry. |
|  | `url` | string | Não | URL/base do registry. |
|  | `username` | string | Não | Usuário. |
|  | `password` | string | Não | Senha/token, mascarado nas respostas. |
| `PUT /deploy/registries/{reg_id}` | todos acima | vários | Não | Atualização parcial; senha vazia/mascarada mantém. |
| Git provider create/test | `type` | enum | Sim | `github`, `gitlab`, `gitea` ou `bitbucket`. |
|  | `name` | string | Sim | Slug único do provider/App. |
|  | `label` | string | Não | Nome de exibição. |
|  | `provider_url` / `base_url` | URL | Não | URL do serviço; usa default do tipo quando vazio. |
|  | `app_id` | string | Condicional | Obrigatório para GitHub, GitLab e Gitea. |
|  | `github_client_id` | string | Condicional | Obrigatório para GitHub App. |
|  | `app_secret` | string | Condicional | Client secret; obrigatório para providers baseados em App. |
|  | `github_private_key` | PEM | Condicional | Private key obrigatória para GitHub App. |
|  | `token` | string | Condicional | Obrigatório para Bitbucket. |
|  | `webhook_secret` | string | Não | Gerado automaticamente quando vazio. |
| Git provider test | `callback_url` | URL | Não | Callback usado para montar a URL OAuth. |
|  | `provider_id` | inteiro | Não | Herda segredos de uma configuração salva. |
| `PUT /deploy/providers/{provider_id}` | campos do provider | vários | Não | Atualização parcial; segredos vazios/mascarados mantêm. |

Chaves e registries devolvem objetos públicos com segredo mascarado. Providers
devolvem metadados de integração; o teste devolve `{ok, auth_mode,
authorization_url?}`.

Webhooks `POST /git/providers/{name}/webhook` e
`POST /projects/{project_id}/services/{service_id}/webhook` recebem o JSON bruto
enviado pelo provedor Git. Não há um campo universal obrigatório: headers,
assinatura/segredo e estrutura variam entre GitHub, GitLab, Gitea e Bitbucket.
A resposta informa se o evento foi aceito, ignorado ou quais serviços/jobs
foram disparados.

### Projetos e serviços

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST /projects` | `name` | string | Sim | Nome do projeto. |
|  | `description` | string | Não | Descrição. |
|  | `tags` | string[] | Não | Tags livres. |
| `PUT /projects/{project_id}` | `name` | string | Não | Novo nome; não pode ser vazio. |
|  | `description` | string | Não | Nova descrição. |
|  | `tags` | string[] | Não | Substitui as tags. |
| `POST .../services` | `kind` | enum | Sim | `application`, `database`, `compose` ou `template`. |
|  | `name` | string | Sim | Nome do serviço. |
|  | `description` | string | Não | Descrição do serviço. |
|  | `config` | object | Não/condicional | Configuração por tipo; pode iniciar vazia em rascunhos permitidos. |
| `PUT .../services/{service_id}` | `name` | string | Não | Novo nome. |
|  | `description` | string | Não | Nova descrição. |
|  | `config` | object | Não | Patch mesclado à configuração atual. |

Projeto devolve `{id, name, description, tags, services, created_ts,
updated_ts}`. Serviço devolve `{id, project_id, kind, name, slug, description,
status, config, created_ts, updated_ts}` com segredos mascarados.

#### `config` de application

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `provider` | enum | Não | Origem `git`, `github`, `gitlab`, `gitea`, `bitbucket`, `docker` ou `spa`; default `git`. |
| `build_type` | enum | Não | Tipo de build aceito pelo catálogo; `spa` força `static`, `docker` força `dockerfile`. |
| `git_url` | string | Condicional | URL do repositório; exigida quando não há `github_repo` e o provider não é `spa`. |
| `github_repo` | string | Condicional | Repositório escolhido no provider; alternativa a `git_url`. |
| `github_installation_id`, `github_account` | string | Não | Metadados do GitHub App. |
| `branch` | string | Não | Branch/ref usada no clone. |
| `webhook_enabled` | boolean | Não | Habilita deploy por webhook. |
| `webhook_trigger` | enum | Não | Trigger do catálogo; default `manual`. |
| `webhook_secret` | string | Não | Gerado automaticamente. |
| `dockerfile` | string | Não | Caminho do Dockerfile; default `Dockerfile`. |
| `docker_context` | string | Não | Contexto do build; default `.`. |
| `build_stage` | string | Não | Stage alvo do multi-stage build. |
| `docker_build_cache` | boolean | Não | Usa cache; default `true`. |
| `spa` | boolean | Não | Marca aplicação estática gerenciada. |
| `nginx`, `nginx_server_name`, `nginx_port` | vários | Não | Integração nginx legada/configurável. |
| campos de runtime | vários | Não | `env`, `volumes`, `ports`, `resources`, `ulimits`, `command` e `command_args`. |

#### `config` de database

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `engine` | enum | Sim | Engine presente em `DB_ENGINES`. |
| `version` | string | Condicional | Versão do catálogo quando `image` não é informada. |
| `image` | string | Não | Imagem customizada; dispensa a validação de versão do catálogo. |
| `user` | string | Não | Usuário do banco. |
| `password` | string | Sim | Senha; vazia/mascarada mantém no update. |
| `database` | string | Não | Banco inicial. |
| `expose` | boolean | Não | Publica a porta no host. |
| `external_port` | inteiro | Não | Porta publicada; default da engine quando `expose=true`. |
| `backup_*`, `snapshot_*` | vários | Não | S3, compactação, retenção, split, criptografia e agendamento. |
| campos de runtime | vários | Não | Ambiente, volumes, portas, recursos, ulimits e comando. |

#### `config` de compose e template

| Tipo | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| compose | `mode` | enum | Não | `compose` ou `stack`; default `compose`. |
| compose | `content` | string | Não | Conteúdo YAML do compose/stack. |
| compose | campos de runtime | vários | Não | Opções adicionais normalizadas. |
| template | `template_id` | string | Sim | ID do template do catálogo. |
| template | `name`, `version`, `logo` | string | Não | Metadados copiados do template. |
| template | `tags` | string[] | Não | Tags do template. |

Campos comuns de runtime:

| Campo | Tipo | Descrição |
|---|---|---|
| `env` | string | Variáveis `KEY=VALUE`, uma por linha. |
| `volumes` | `{source,target}[]` | Mounts do container. |
| `ports` | `{host,container}[]` | Mapeamentos de portas. |
| `resources` | object | `cpu_reservation`, `cpu_limit`, `memory_reservation_mb`, `memory_limit_mb`. |
| `ulimits` | `{name,soft,hard}[]` | Limites aceitos pelo catálogo de ulimits. |
| `command` | string | Comando/entrypoint customizado. |
| `command_args` | object[] | Argumentos extras do comando. |

### Domínios de serviços

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `host` | domínio | Sim | Host/FQDN vinculado. |
| `path` | string | Não | Caminho público; default `/`. |
| `internal_path` | string | Condicional | Pasta interna obrigatória apenas quando necessária para uma SPA. |
| `container_port` | inteiro | Condicional | Porta 1–65535 para aplicações não SPA. |
| `https` | boolean | Não | Habilita TLS. |
| `provider` | enum | Condicional | Quando HTTPS: `self-signed`, `ca-signed` ou `letsencrypt`. |
| `cert_name` | string | Condicional | Certificado existente obrigatório quando HTTPS. |
| `dns_link` | boolean | Não | Cria/atualiza o registro A. |
| `dns_provider_id` | inteiro | Condicional | Obrigatório quando `dns_link=true`. |

A resposta devolve o domínio normalizado, IDs do server/registro DNS, caminhos,
TLS, porta e status do vínculo.

### Backups, snapshots e runtime avançado

Os dois endpoints de settings são updates parciais; nenhum campo isolado é
obrigatório.

| Corpo | Campo | Tipo | Descrição |
|---|---|---|---|
| backup/snapshot settings | `s3_enabled` | boolean | Habilita upload remoto. |
|  | `s3_config_id` | inteiro/null | Destino S3. |
|  | `compress` | boolean | Habilita compactação. |
|  | `file_format` | string | Template do nome do artefato. |
|  | `compression_method`, `compression_level` | string/inteiro | Algoritmo e nível aceitos pelo catálogo devolvido. |
|  | `local_retention`, `s3_retention` | inteiro | Quantidade mantida local/remotamente. |
|  | `split_size_mb` | inteiro | Tamanho das partes; usa opções permitidas. |
|  | `encryption_enabled` | boolean | Usa o segredo global de criptografia. |
|  | `schedule_enabled` | boolean | Ativa o agendador. |
|  | `schedule_cron` | string | Cron de cinco campos; defaults 03:00 para backup e 02:00 para snapshot. |
| apenas backup | `database` | string | Banco específico a exportar. |
| `PUT .../advanced/command` | `command` | string | Comando/entrypoint; vazio remove. |
|  | `command_args` | object[] | Argumentos estruturados. |
| `PUT .../advanced/volumes` | `volumes` | object[] | Substitui mounts/volumes. |
| `PUT .../advanced/resources` | `resources` | object | Limites e reservas de CPU/memória. |
| `PUT .../advanced/ulimits` | `ulimits` | object[] | Limites do processo. |
| `POST .../exec` | `command` | string | Comando obrigatório executado no container. |

Settings devolvem a configuração normalizada e catálogos auxiliares. Ações de
runtime devolvem um job; seus streams emitem `{seq, phase, message, ...}` até
`event: end`.

### Gerenciador de arquivos, Docker e logs rotacionados

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| `POST .../files/folder` | `path` | string | Não | Pasta pai; default raiz. |
|  | `name` | string | Sim | Nome da pasta. |
| `POST .../files/move` | `src`, `dst` | string | Sim | Caminhos relativos de origem e destino. |
| `POST .../files/copy` | `src`, `dst` | string | Sim | Caminhos relativos de origem e destino. |
| `POST .../files/upload` | `path` | multipart string | Não | Pasta destino. |
|  | `files` | multipart file[] | Sim | Um ou vários arquivos. |
|  | `paths` | multipart string[] | Não | Caminhos relativos para upload de pasta. |
| `POST /docker/containers/{cid}/exec` | `command` | string | Sim | Comando passado a `sh -c`. |
| `POST /docker/images/{image_id}/pull` | `reference` | string | Não | Referência/tag; usa a primeira tag local quando vazio. |
| `POST /logs/files/retry` | `name` | string | Sim | Nome de um access log rotacionado local. |
| `DELETE /logs/files/local` | `name` | string | Sim | Arquivo já confirmado no S3. |

Arquivos devolvem entradas normalizadas; exec devolve `{exit_code, output}`;
pull devolve `{reference}`; operações de log devolvem arquivo/chave e estado.




### Monitores: corpo comum

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `type` | enum | Não | Default `http`; imutável após criação. |
| `name` | string | Sim | Rótulo do monitor. |
| `group_id` | inteiro/null | Não | Grupo do monitor. |
| `tag_ids` | inteiro[] | Não | Tags vinculadas. |
| `interval_seconds` | inteiro | Não | Intervalo de checagem; default 60, com limites de `/monitors/meta`. |
| `max_retries` | inteiro | Não | Falhas toleradas antes de marcar down; default 0. |
| `timeout_seconds` | número | Não | Timeout; limitado automaticamente a 80% do intervalo. |
| `resend_enabled` | boolean | Não | Desativa reenvio quando `false`. |
| `resend_every` | inteiro | Não | Cadência do reenvio de notificações. |
| `active` | boolean | Não | Default `true`. |
| `config` | object | Condicional | Configuração por tipo; pode ser vazia apenas nos tipos sem alvo obrigatório, como `push`. |

Campos comuns dentro de `config`, todos opcionais: `description`,
`notification_channel_ids`, `proxy_ids`, `proxy_mode` (`round_robin` ou `all`),
`latency_threshold_ms` e `latency_window_seconds`.

O objeto de monitor inclui configuração mascarada, alvo seguro, status,
latência, tentativas, SSL/domínio, tags, grupo, timestamps e `push_url` quando
aplicável.

`PUT /monitors/{monitor_id}/group` recebe somente `group_id` (inteiro ou
`null`); o campo é obrigatório no corpo e `null` remove o monitor do grupo.

#### `config` por tipo de monitor

| Tipo | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| http | `url` | URL | Sim | Deve começar com HTTP ou HTTPS. |
| http | `method` | enum | Não | Default `GET`; opções em `/monitors/meta`. |
| http | `headers`, `body` | `{key,value}[]` | Não | Headers e corpo estruturado. |
| http | `body_encoding` | enum | Não | Default `json`. |
| http | `accepted_codes` | string | Não | Default `200-299`; aceita listas/faixas. |
| http | `keyword` | string | Não | Texto obrigatório no corpo, sensível a maiúsculas. |
| http | `max_response_bytes` | inteiro | Não | Limite de leitura; `0` desabilita. |
| http | `ssl.validate_expired` | boolean | Não | Default `true`. |
| http | `ssl.ignore_tls_errors` | boolean | Não | Default `false`. |
| http | `auth` | object | Não | Autenticação descrita abaixo. |
| http | `record_timings` | boolean | Não | Default `true`. |
| http | `record_advanced`, `record_last_only` | boolean | Não | Persistência adicional/compacta. |
| tcp | `hostname`, `port` | string/inteiro | Sim | Host e porta 1–65535. |
| tcp | `tls` | boolean | Não | Ativa handshake TLS. |
| tcp | `expected_tls_alert` | enum | Não | Alerta TLS aceito, se configurado. |
| ping | `hostname` | string | Sim | Host/IP. |
| ping | `packets`, `packet_size`, `per_ping_timeout` | números | Não | Quantidade, bytes e timeout por pacote. |
| dns | `hostname` | string | Sim | Nome consultado. |
| dns | `resolvers` | string[] | Não | Default `["1.1.1.1"]`. |
| dns | `port` | inteiro | Não | Default 53. |
| dns | `record_type` | enum | Não | Default `a`; opções em `/monitors/meta`. |
| dns | `conditions` | `{operator,value}[]` | Não | Regras aplicadas às respostas. |
| domain | `domain` | string | Sim | Domínio normalizado e consultado por RDAP. |
| container | `container` | string | Sim | ID ou nome do container. |
| push | `token` | string | Não | Gerado na criação e mantido no update. |
| push | `grace_period_seconds` | inteiro | Não | Tolerância após o intervalo esperado. |
| bancos/mensageria | `connection_mode` | enum | Não | `fields` (default) ou `uri`. |
| bancos/mensageria | `uri` | string | Condicional | Obrigatória no modo `uri`; esquemas dependem do tipo. |
| bancos/mensageria | `host` | string | Condicional | Obrigatório no modo `fields`. |
| bancos/mensageria | `port` | inteiro | Não | Default da tecnologia. |
| bancos/mensageria | `username`, `password`, `database` | string | Não | Credenciais e banco/vhost; segredos mascarados. |
| bancos/mensageria | `arguments` | `{key,value}[]` | Não | Parâmetros extras não reservados. |

Tipos de banco/mensageria: `postgresql`, `mysql`, `mongodb`, `redis` e
`rabbitmq`.

#### Autenticação HTTP (`config.auth`)

| `type` | Obrigatórios | Opcionais/resumo |
|---|---|---|
| `none` | nenhum | Default. |
| `basic` | nenhum estrito | `username`, `password`. |
| `bearer` | nenhum estrito | `token`. |
| `oauth2` | nenhum estrito | `method`, `token_url`, `client_id`, `client_secret`, `scope`, `audience`. |
| `ntlm` | nenhum estrito | `username`, `password`, `domain`, `workstation`. |
| `mtls` | nenhum estrito | `cert`, `key`, `ca`. |
| `other` | nenhum estrito | `header`, `param`. |

Segredos vazios ou `********` mantêm os valores existentes no update.

### Grupos, tags, proxies e notificações

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| group create/update | `name` | string | Sim na criação | Nome do grupo. |
|  | `color` | string | Não | Cor de exibição. |
| tag create/update | `name` | string | Sim na criação | Nome, até 120 caracteres. |
|  | `value` | string | Não | Valor, até 200 caracteres. |
|  | `color` | `#RRGGBB` | Não | Default `#64748b`. |
| proxy create/update | `protocol` | enum | Não | `http`, `https`, `socks4`, `socks5` ou `socks5h`; default `http`. |
|  | `server` | string | Sim | Host do proxy. |
|  | `port` | inteiro | Sim | Porta 1–65535. |
|  | `username`, `password` | string | Não | Credenciais; senha mascarada. |
|  | `enabled` | boolean | Não | Default `true`. |
| proxy create | `copy_from_id` | inteiro | Não | Copia valores de outro proxy. |
| proxy test | `proxy` | object | Sim | Configuração acima ou referência por `id`. |
|  | `config` | object | Não | Config HTTP alvo do teste. |
|  | `timeout_seconds` | número | Não | Default 10. |
| notification create | `name` | string | Sim | Nome do canal. |
|  | `type` | enum | Sim | `webhook`, `telegram`, `discord`, `email`, `slack` ou `teams`. |
|  | `config` | object | Sim | Configuração por tipo abaixo. |
|  | `enabled` | boolean | Não | Default `true`. |
| notification update | `name`, `config`, `enabled` | vários | Não | Atualização parcial; o tipo não muda. |
| unsaved notification test | `type`, `config` | vários | Sim | Mesmos campos da criação. |
|  | `id` | inteiro | Não | Herda segredos do canal salvo. |

Configuração por canal:

| Tipo | Obrigatórios | Opcionais |
|---|---|---|
| webhook | `url` | `method` (`POST` default, `GET` ou `PUT`) |
| telegram | `bot_token`, `chat_id` | — |
| discord | `webhook_url` | `username` |
| slack | `webhook_url` | `channel` |
| teams | `webhook_url` | — |
| email | `host`, `from`, `to` | `port` 587, `username`, `password`, `tls` true |

### Incidentes

| Endpoint | Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|---|
| create | `title` | string | Sim | Título do incidente. |
|  | `description` | string | Não | Descrição e primeira atualização. |
|  | `status` | enum | Não | Default `investigating`. |
|  | `severity` | enum | Não | Default `degraded`. |
| update | `title`, `description`, `severity` | vários | Não | Atualiza metadados; status muda pela timeline. |
| timeline update | `message` | string | Condicional | Pode ser vazia se status/severidade mudar. |
|  | `status`, `severity` | enum | Não | Novo estado e severidade. |

Incidentes devolvem metadados e `updates[]` com a linha do tempo.

### Status pages

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `title` | string | Sim na criação | Título público. |
| `slug` | string | Não | Gerado do título e tornado único. |
| `description` | string | Não | Texto de apresentação. |
| `monitor_ids` | inteiro[] | Não | Monitores exibidos; IDs devem existir. |
| `domain` | string | Não | Domínio customizado, sincronizado com nginx. |
| `cert_name` | string | Não | Certificado do domínio. |
| `logo_url`, `banner` | string | Não | Identidade visual. |
| `accent_color` | `#RRGGBB` | Não | Cor principal. |
| `custom_css`, `custom_js` | string | Não | Customização injetada na página pública. |
| `show_incidents`, `show_maintenance` | boolean | Não | Controla seções públicas. |
| `published` | boolean | Não | Publica/despublica a página. |

O admin recebe o objeto completo da página. `/status/{slug}/data` devolve
somente dados públicos de monitores, incidentes e manutenções.

### Janelas de manutenção

| Campo | Tipo | Obrigatório? | Descrição |
|---|---|---|---|
| `title` | string | Sim na criação | Título. |
| `description` | string | Não | Descrição pública/interna. |
| `monitor_ids` | inteiro[] | Não | Monitores afetados. |
| `active` | boolean | Não | Default `true`. |
| `timezone` | string IANA | Não | Default `UTC`. |
| `strategy` | enum | Não | Default `single`; também `manual`, `cron`, `recurring_interval`, `recurring_weekday`, `recurring_dayofmonth`. |
| `config` | object | Condicional | Campos dependentes da estratégia. |

| Estratégia | Campos obrigatórios em `config` | Opcionais |
|---|---|---|
| `manual` | nenhum | — |
| `single` | `start`, `end` | — |
| `cron` | `cron`, `duration_minutes` | `effective_start`, `effective_end` |
| `recurring_interval` | `interval_days` | `time_start`, `time_end`, vigência |
| `recurring_weekday` | `weekdays` (0–6) | horários e vigência |
| `recurring_dayofmonth` | `days_of_month` (1–31) | horários e vigência |

### Configurações da aplicação e banco

`PUT /settings` aceita qualquer subconjunto abaixo, mas rejeita chaves
desconhecidas e um corpo vazio.

| Campo | Tipo/faixa | Descrição |
|---|---|---|
| `sse_interval_seconds` | float 1–300 | Cadência dos SSEs/coletor. |
| `metrics_retention_days` | int 1–365 | Retenção das métricas. |
| `log_rotate_max_mb` | int 1–10240 | Tamanho para rotação. |
| `log_rotate_keep` | int 1–365 | Arquivos mantidos. |
| `log_rotate_interval_min` | int 1–1440 | Cadência do worker. |
| `log_s3_config_id` | int ≥0 | Destino S3. |
| `deployment_preview_port` | int 0–65535 | Porta explícita do preview. |
| `deployment_preview_limit` | int 0–10000 | Limite de previews. |
| `upload_max_mb` | int 1–10240 | Limite por arquivo. |
| `upload_concurrency` | int 1–64 | Concorrência de upload. |
| `session_ttl_days` | int 1–3650 | Validade das sessões. |
| `docker_scan_rate_limit_seconds` | int 10–86400 | Intervalo mínimo de scan por imagem. |
| `docker_scan_max_details` | int 0–50000 | CVEs detalhados persistidos. |
| `docker_scan_workers` | int 1–4 | Workers de scan. |
| `docker_stats_interval_seconds` | int 1–60 | Cadência das estatísticas Docker. |
| `acme_email` | e-mail/string vazia | Conta Let's Encrypt. |
| `api_cors_origins` | string CSV | Origens CORS; aplica no restart. |
| `cloudflare_tunnel_token`, `cloudflare_tunnel_{1..3}_token` | segredo | Tokens dos túneis. |
| `backup_encryption_secret` | segredo | Senha global de criptografia. |
| `deployment_preview_domain`, `deployment_preview_ip` | string | Endereço dos previews. |
| `log_rotate_enabled`, `log_compress`, `log_s3_enabled` | boolean | Rotação, gzip e upload. |
| `ipv6_enabled` | boolean | Reconcilia listeners IPv6. |
| `cloudflare_tunnel_enabled`, `cloudflare_tunnel_{1..3}_enabled` | boolean | Habilita túneis. |
| `deployment_preview_https` | boolean | HTTPS nos previews. |
| `docker_scan_enabled` | boolean | Scanner Trivy. |
| `api_tls_enabled` | boolean | TLS da API; aplica no restart. |

Banco (`POST /settings/database/test` e `PUT /settings/database`):

| Campo | Obrigatório? | Descrição |
|---|---|---|
| `type` | Não | `sqlite`, `mysql`, `mariadb` ou `postgresql`; default efetivo atual. |
| `dsn` | Não | DSN completo; quando presente tem precedência e é mascarado. |
| `sqlite_path` | Condicional | Caminho usado para SQLite. |
| `host`, `port`, `user`, `password`, `name` | Condicional | Componentes para MySQL/PostgreSQL; senha mascarada mantém. |

`GET /settings` devolve `{values, limits, defaults, cloudflared}`. Banco devolve
`{config, source}`; teste devolve `{ok: true}`.

## Resumo das respostas por família

| Família | Conteúdo de `data` |
|---|---|
| Listagens | Lista direta ou `{items, total, page, pages}`; Docker usa a chave da coleção mais resumo/filtros. |
| Detalhes CRUD | Objeto público completo do recurso; segredos aparecem como `********`. |
| Creates/updates | Recurso criado/atualizado já normalizado, geralmente com mensagem `success`. |
| Deletes | `{deleted: id}` ou `{removed: quantidade}`. |
| Enable/disable | `{id, enabled}` ou recurso atualizado com estado ativo. |
| nginx actions | Status, saída do comando, versão/PID ou valores aplicados. |
| System | Snapshot do host ou pontos `{ts, cpu, mem, disk, req_per_s, connections, ...}`. |
| Logs | `{raw, parsed}`, página de entradas, métricas agregadas ou inventário de arquivos. |
| Docker inspect | JSON bruto normalizado da Docker Engine API. |
| Jobs | Registro do job; SSE subsequente transmite progresso e `end`. |
| Uptime | Monitor/heartbeat/evento/incidente normalizado, uptime por período ou pontos de gráfico. |
| Webhooks | Resultado do evento: aceito, ignorado ou job/deploy disparado. |

Os códigos `200`/`201` apresentados pelo OpenAPI indicam o sucesso principal.
Erros de autenticação, RBAC, validação, conflito e integrações externas seguem o
envelope e os códigos descritos no fim deste documento.

## Meta e documentação interativa

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verifica se a API está disponível. |
| GET | `/openapi.json` | Retorna o schema OpenAPI gerado pelo FastAPI. |
| GET | `/docs` | Abre a documentação Swagger UI. |
| GET | `/docs/oauth2-redirect` | Callback interno usado pelo Swagger UI. |
| GET | `/redoc` | Abre a documentação ReDoc. |

## Autenticação e sessão

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/login` | Autentica o master do ambiente ou um usuário do banco e emite o token. Rota pública. |
| GET | `/auth/verify` | Valida o bearer e devolve identidade, papel e permissões. |
| POST | `/auth/logout` | Invalida a sessão atual; para o master é uma operação sem efeito. |

## Usuários, perfil e RBAC

| Método | Rota | Descrição |
|---|---|---|
| GET | `/users/me` | Retorna a identidade e as permissões da sessão atual. |
| GET | `/users/profile` | Retorna o perfil do usuário autenticado. |
| PUT | `/users/profile` | Atualiza nome, e-mail e, mediante senha atual, a própria senha. |
| GET | `/users` | Lista usuários, incluindo a conta master não editável. |
| POST | `/users` | Cria um usuário. |
| PUT | `/users/{user_id}` | Atualiza papel, estado, senha, nome ou e-mail de um usuário. |
| DELETE | `/users/{user_id}` | Remove um usuário; não permite autoexclusão. |
| GET | `/users/roles` | Lista papéis e o catálogo de permissões recurso × ação. |
| POST | `/users/roles` | Cria um papel personalizado. |
| PUT | `/users/roles/{name}` | Atualiza rótulo e permissões de um papel. |
| DELETE | `/users/roles/{name}` | Remove um papel não interno e fora de uso. |

## Controle do nginx

| Método | Rota | Descrição |
|---|---|---|
| GET | `/nginx/status` | Retorna execução, PID, validade da configuração e versão do nginx. |
| GET | `/nginx/version` | Retorna a versão do binário nginx. |
| POST | `/nginx/test` | Executa `nginx -t`. |
| POST | `/nginx/reload` | Recarrega a configuração sem parar o processo master. |
| POST | `/nginx/start` | Inicia o nginx quando estiver parado. |
| POST | `/nginx/stop` | Encerra o nginx. |
| POST | `/nginx/restart` | Para e inicia novamente o nginx. |
| GET | `/nginx/configuration` | Retorna a configuração efetiva produzida por `nginx -T`. |
| GET | `/nginx/globals` | Lista diretivas e blocos do nível raiz. |
| GET | `/nginx/config` | Retorna as opções editáveis dos contextos principal e `events`. |
| PUT | `/nginx/config` | Atualiza opções globais e valida a alteração com rollback. |
| GET | `/nginx/tune` | Mostra recursos detectados, valores atuais e tuning calculado. |
| POST | `/nginx/tune` | Calcula ou aplica workers, conexões, limite de arquivos e fração de memória. |

## Servers HTTP

| Método | Rota | Descrição |
|---|---|---|
| GET | `/servers` | Lista server blocks HTTP e seus estados. |
| POST | `/servers` | Cria e ativa um server block a partir de nós ou configuração raw. |
| GET | `/servers/{ident}` | Retorna o arquivo completo, AST, raw e metadados do server. |
| PUT | `/servers/{ident}` | Substitui o conteúdo do server com validação e rollback. |
| POST | `/servers/{ident}/enable` | Ativa o server criando o symlink em `http-enabled`. |
| POST | `/servers/{ident}/disable` | Desativa o server sem apagar seu arquivo. |
| DELETE | `/servers/{ident}` | Remove o server e seu symlink; o server `default` é protegido. |
| GET | `/servers/{ident}/cache/status` | Retorna zonas, diretórios, tamanho e quantidade de entradas do cache. |
| POST | `/servers/{ident}/cache/clear` | Limpa todas as zonas de cache ou uma zona indicada por `zone`. |

### Sub-recursos de servers

Cada rota abaixo aceita os quatro métodos: `GET` seleciona os nós, `PUT`
substitui o conjunto, `POST` adiciona nós e `DELETE` remove os nós selecionados.

| Métodos | Rota | Descrição |
|---|---|---|
| GET / PUT / POST / DELETE | `/servers/{ident}/locations` | Blocos `location`. |
| GET / PUT / POST / DELETE | `/servers/{ident}/upstream` | Diretivas de encaminhamento para upstream. |
| GET / PUT / POST / DELETE | `/servers/{ident}/certificates` | Certificados e opções de autenticação TLS. |
| GET / PUT / POST / DELETE | `/servers/{ident}/redirects` | Diretivas `return` e `rewrite`. |
| GET / PUT / POST / DELETE | `/servers/{ident}/headers` | Headers de resposta e de proxy. |
| GET / PUT / POST / DELETE | `/servers/{ident}/logs` | Diretivas de access e error log. |
| GET / PUT / POST / DELETE | `/servers/{ident}/rate-limits` | Limites de requisição, conexão e taxa. |
| GET / PUT / POST / DELETE | `/servers/{ident}/access` | ACL, basic auth e `auth_request`. |
| GET / PUT / POST / DELETE | `/servers/{ident}/cache` | Diretivas de cache de proxy e FastCGI/SCGI/uWSGI. |
| GET / PUT / POST / DELETE | `/servers/{ident}/gzip` | Diretivas gzip. |
| GET / PUT / POST / DELETE | `/servers/{ident}/brotli` | Diretivas brotli. |
| GET / PUT / POST / DELETE | `/servers/{ident}/proxy` | Diretivas iniciadas por `proxy_`. |
| GET / PUT / POST / DELETE | `/servers/{ident}/websocket` | Opções de upgrade e headers WebSocket. |
| GET / PUT / POST / DELETE | `/servers/{ident}/http2` | Listen e diretivas HTTP/2. |
| GET / PUT / POST / DELETE | `/servers/{ident}/http3` | Listen QUIC, HTTP/3 e header `Alt-Svc`. |
| GET / PUT / POST / DELETE | `/servers/{ident}/security` | Protocolos, cifras, tickets, tokens e headers de segurança. |
| GET / PUT / POST / DELETE | `/servers/{ident}/snippets` | Diretivas `include`. |

## Upstreams

| Método | Rota | Descrição |
|---|---|---|
| GET | `/upstreams` | Lista upstreams, contexto, backends, uso e estado. |
| POST | `/upstreams` | Cria e ativa um upstream; usa `name` e `context` na query. |
| GET | `/upstreams/{ident}` | Retorna nós, raw, contexto e estado do upstream. |
| PUT | `/upstreams/{ident}` | Substitui o conteúdo do upstream. |
| POST | `/upstreams/{ident}/enable` | Ativa o upstream. |
| POST | `/upstreams/{ident}/disable` | Desativa o upstream quando não estiver em uso. |
| DELETE | `/upstreams/{ident}` | Remove um upstream quando não estiver em uso. |
| GET / PUT / POST / DELETE | `/upstreams/{ident}/servers` | Lista, substitui, adiciona ou remove backends `server`. |

## Streams TCP/UDP

| Método | Rota | Descrição |
|---|---|---|
| GET | `/streams` | Lista server blocks do contexto stream. |
| POST | `/streams` | Cria e ativa um stream a partir de nós ou raw. |
| GET | `/streams/{ident}` | Retorna nós, raw e estado do stream. |
| PUT | `/streams/{ident}` | Substitui o conteúdo do stream. |
| POST | `/streams/{ident}/enable` | Ativa o stream. |
| POST | `/streams/{ident}/disable` | Desativa o stream sem remover o arquivo. |
| DELETE | `/streams/{ident}` | Remove o stream. |
| GET / PUT / POST / DELETE | `/streams/{ident}/upstream` | Gerencia o `proxy_pass` do stream. |
| GET / PUT / POST / DELETE | `/streams/{ident}/access` | Gerencia acesso/log de acesso do stream. |
| GET / PUT / POST / DELETE | `/streams/{ident}/logs` | Gerencia access e error log do stream. |
| GET / PUT / POST / DELETE | `/streams/{ident}/proxy` | Gerencia diretivas iniciadas por `proxy_`. |

## RTMP

| Método | Rota | Descrição |
|---|---|---|
| GET | `/rtmp` | Lista aplicações RTMP agrupadas por porta. |
| POST | `/rtmp` | Cria uma aplicação e ativa sua porta. |
| GET | `/rtmp/{ident}` | Retorna configuração, raw e estado da aplicação. |
| PUT | `/rtmp/{ident}` | Atualiza, renomeia ou move a aplicação para outra porta. |
| POST | `/rtmp/{ident}/enable` | Ativa a porta e todas as aplicações do arquivo correspondente. |
| POST | `/rtmp/{ident}/disable` | Desativa a porta e todas as suas aplicações. |
| POST | `/rtmp/{ident}/test` | Testa porta, endpoint RTMP e disponibilidade do ffmpeg. |
| DELETE | `/rtmp/{ident}` | Remove a aplicação e poda o arquivo se a porta ficar vazia. |

## Sistema, métricas e configurações

| Método | Rota | Descrição |
|---|---|---|
| GET | `/system` | Retorna snapshot de host, CPU, memória, disco, rede e nginx. |
| GET | `/system/metrics` | Retorna histórico agregado; aceita `minutes` e `max_points`. |
| GET | `/system/stream` | SSE com o overview do sistema em tempo real. |
| GET | `/settings` | Retorna valores, limites, defaults e estado do Cloudflare Tunnel. |
| PUT | `/settings` | Valida, persiste e aplica configurações conhecidas. |
| GET | `/settings/database` | Retorna configuração pública e origem da configuração do banco. |
| POST | `/settings/database/test` | Testa uma configuração de banco sem persistir. |
| PUT | `/settings/database` | Testa e salva a configuração de banco; requer reinício da API. |
| GET | `/settings/cloudflared/{index}/log` | Retorna o log de uma instância do Cloudflare Tunnel. |

## Auditoria

| Método | Rota | Descrição |
|---|---|---|
| GET | `/audit` | Lista mutações auditadas com paginação e filtros por usuário, ação e data. |

## Certificados e CAs

| Método | Rota | Descrição |
|---|---|---|
| GET | `/certificates` | Lista certificados, validade, tipo, uso e auto-renovação. |
| POST | `/certificates/import` | Importa certificado, chave e cadeia PEM. |
| PUT | `/certificates/{name}/auto-renew` | Ativa ou desativa a auto-renovação. |
| POST | `/certificates/self-signed` | Emite certificado self-signed para domínios ou IPs. |
| GET | `/certificates/ca` | Lista CAs próprias, uso e certificado público. |
| POST | `/certificates/ca` | Cria uma CA raiz. |
| POST | `/certificates/ca/import` | Importa certificado e chave de uma CA existente. |
| DELETE | `/certificates/ca/{name}` | Remove uma CA que não esteja assinando certificados presentes. |
| POST | `/certificates/ca-signed` | Emite certificado de servidor assinado por uma CA própria. |
| POST | `/certificates/letsencrypt` | Emite certificado Let's Encrypt por ACME DNS-01. |
| DELETE | `/certificates/{name}` | Remove certificado, chave e metadados quando não estiver em uso. |

## DNS

| Método | Rota | Descrição |
|---|---|---|
| GET | `/dns/provider-types` | Lista provedores suportados e campos de configuração. |
| GET | `/dns/providers` | Lista provedores configurados com segredos mascarados. |
| POST | `/dns/providers` | Cria um provedor DNS. |
| PUT | `/dns/providers/{provider_id}` | Atualiza rótulo e configuração de um provedor. |
| DELETE | `/dns/providers/{provider_id}` | Remove um provedor. |
| GET | `/dns/providers/{provider_id}/zones` | Lista zonas no provedor remoto. |
| GET | `/dns/providers/{provider_id}/records` | Lista registros da zona informada por `zone_id`. |
| POST | `/dns/providers/{provider_id}/records` | Cria um registro DNS. |
| PUT | `/dns/providers/{provider_id}/records/{record_id:path}` | Atualiza um registro DNS. |
| DELETE | `/dns/providers/{provider_id}/records/{record_id:path}` | Remove um registro DNS da zona informada. |

## Destinos S3

| Método | Rota | Descrição |
|---|---|---|
| GET | `/s3/fields` | Retorna o schema de campos usado pelo formulário S3. |
| GET | `/s3/configs` | Lista destinos S3 com segredos mascarados. |
| POST | `/s3/configs` | Cria um destino S3 ou compatível. |
| PUT | `/s3/configs/{config_id}` | Atualiza um destino preservando segredos mascarados. |
| DELETE | `/s3/configs/{config_id}` | Remove um destino S3. |
| POST | `/s3/configs/{config_id}/test` | Valida credenciais com um upload de teste. |

## Provedores de IA

| Método | Rota | Descrição |
|---|---|---|
| GET | `/ai/provider-types` | Lista tipos, URLs padrão e modelos sugeridos. |
| GET | `/ai/providers` | Lista provedores com chaves mascaradas. |
| POST | `/ai/providers` | Cria um provedor de IA. |
| POST | `/ai/providers/test` | Testa uma configuração ainda não salva. |
| GET | `/ai/providers/{provider_id}` | Retorna um provedor. |
| PUT | `/ai/providers/{provider_id}` | Atualiza um provedor. |
| DELETE | `/ai/providers/{provider_id}` | Remove um provedor. |
| POST | `/ai/providers/{provider_id}/test` | Testa um provedor persistido. |

## Logs

| Método | Rota | Descrição |
|---|---|---|
| GET | `/logs/access` | Retorna últimas linhas ou página do access log, com parsing JSON. |
| GET | `/logs/error` | Retorna últimas linhas ou página do error log, com parsing. |
| GET | `/logs/access/download` | Baixa o access log atual. |
| GET | `/logs/error/download` | Baixa o error log atual. |
| GET | `/logs/metrics` | Agrega tráfego, status, latência, cache, endpoints e clientes. |
| GET | `/logs/files` | Lista logs atuais e rotacionados e seus estados no S3. |
| POST | `/logs/rotate` | Força a rotação, compressão e eventual envio ao S3. |
| POST | `/logs/files/retry` | Reenvia um access log rotacionado para o S3. |
| DELETE | `/logs/files/local` | Remove uma cópia local já confirmada no S3. |
| GET | `/logs/access/stream` | SSE das novas linhas do access log. |
| GET | `/logs/error/stream` | SSE das novas linhas do error log. |

## Credenciais e provedores de CI/CD

### Chaves SSH e registries

| Método | Rota | Descrição |
|---|---|---|
| GET | `/deploy/ssh-keys` | Lista chaves SSH com material privado mascarado. |
| POST | `/deploy/ssh-keys` | Cadastra uma chave SSH. |
| PUT | `/deploy/ssh-keys/{key_id}` | Atualiza uma chave SSH. |
| DELETE | `/deploy/ssh-keys/{key_id}` | Remove uma chave SSH. |
| GET | `/deploy/registries` | Lista registries Docker com senhas mascaradas. |
| POST | `/deploy/registries` | Cadastra um registry Docker. |
| PUT | `/deploy/registries/{reg_id}` | Atualiza um registry. |
| DELETE | `/deploy/registries/{reg_id}` | Remove um registry. |

### Provedores Git

| Método | Rota | Descrição |
|---|---|---|
| GET | `/deploy/providers` | Lista provedores Git configurados. |
| POST | `/deploy/providers` | Cria uma integração GitHub, GitLab, Gitea ou Bitbucket. |
| POST | `/deploy/providers/test` | Valida uma configuração de provedor ainda não salva. |
| GET | `/deploy/providers/{provider_id}/github/accounts` | Lista contas/instalações acessíveis por um GitHub App. |
| GET | `/deploy/providers/{provider_id}/github/repositories` | Lista repositórios de uma instalação GitHub. |
| GET | `/deploy/providers/{provider_id}/github/branches` | Lista branches do repositório indicado por `repo`. |
| PUT | `/deploy/providers/{provider_id}` | Atualiza um provedor Git. |
| DELETE | `/deploy/providers/{provider_id}` | Remove um provedor que não esteja em uso. |
| GET | `/git/providers/{name}/callback` | Callback público de OAuth/instalação do provedor. |
| GET | `/git/providers/github/manifest/callback` | Callback público de criação de GitHub App por manifest. |
| GET | `/git/providers/github/manifest` | Alias legado do callback de manifest do GitHub. |
| POST | `/git/providers/{name}/webhook` | Webhook público que valida o segredo e dispara serviços vinculados. |

## Templates, projetos e serviços

Nos caminhos desta seção, `project_id` identifica o projeto e `service_id` um
serviço pertencente a ele.

### Catálogo e projetos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/templates` | Pesquisa e pagina templates, com filtro por tags. |
| GET | `/templates/tags` | Lista todas as tags do catálogo. |
| GET | `/projects` | Lista projetos e seus serviços. |
| POST | `/projects` | Cria um projeto. |
| GET | `/projects/{project_id}` | Retorna um projeto e seus serviços. |
| PUT | `/projects/{project_id}` | Atualiza nome, descrição e tags do projeto. |
| DELETE | `/projects/{project_id}` | Remove o projeto e seus dados relacionados. |
| POST | `/projects/{project_id}/services` | Cria um serviço de aplicação, banco, compose ou template. |
| GET | `/projects/{project_id}/services/{service_id}` | Retorna configuração, runtime e metadados do serviço. |
| PUT | `/projects/{project_id}/services/{service_id}` | Atualiza nome, descrição e configuração do serviço. |
| DELETE | `/projects/{project_id}/services/{service_id}` | Remove o serviço. |
| POST | `/projects/{project_id}/services/{service_id}/webhook` | Webhook público de deploy do serviço, autenticado pelo segredo na query. |

### Runtime, containers, domínios e logs

| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{project_id}/services/{service_id}/containers` | Lista containers do serviço. |
| GET | `/projects/{project_id}/services/{service_id}/domains` | Lista domínios e server blocks gerenciados pelo serviço. |
| POST | `/projects/{project_id}/services/{service_id}/domains` | Vincula e provisiona um domínio. |
| PUT | `/projects/{project_id}/services/{service_id}/domains/{domain_id}` | Atualiza um domínio vinculado. |
| DELETE | `/projects/{project_id}/services/{service_id}/domains/{domain_id}` | Desvincula um domínio e remove sua configuração gerenciada. |
| POST | `/projects/{project_id}/services/{service_id}/exec` | Executa um comando não interativo no container. |
| POST | `/projects/{project_id}/services/{service_id}/{verb}` | Inicia uma ação assíncrona; `verb` aceita `deploy`, `start`, `stop`, `restart` ou `rebuild`. |
| GET | `/projects/{project_id}/services/{service_id}/runtime/jobs/{job_id}/stream` | SSE do progresso de uma ação de runtime. |
| GET | `/projects/{project_id}/services/{service_id}/logs/stream` | SSE dos logs de um container do serviço. |

### Backups e snapshots

| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{project_id}/services/{service_id}/backups` | Lista backups paginados e suas configurações. |
| GET | `/projects/{project_id}/services/{service_id}/backup-settings` | Retorna agenda, retenção e destino de backup. |
| PUT | `/projects/{project_id}/services/{service_id}/backup-settings` | Atualiza configurações de backup. |
| POST | `/projects/{project_id}/services/{service_id}/backup` | Inicia um backup. |
| GET | `/projects/{project_id}/services/{service_id}/backup/jobs/{job_id}/stream` | SSE do progresso da criação de backup. |
| POST | `/projects/{project_id}/services/{service_id}/backups/{backup_id}/upload` | Envia um backup local para o S3. |
| POST | `/projects/{project_id}/services/{service_id}/backups/{backup_id}/restore` | Inicia a restauração de um backup. |
| GET | `/projects/{project_id}/services/{service_id}/backup/restore-jobs/{job_id}/stream` | SSE do progresso da restauração de backup. |
| DELETE | `/projects/{project_id}/services/{service_id}/backups/{backup_id}` | Remove um backup e, opcionalmente, sua cópia S3. |
| GET | `/projects/{project_id}/services/{service_id}/snapshots` | Lista snapshots paginados e suas configurações. |
| GET | `/projects/{project_id}/services/{service_id}/snapshot-settings` | Retorna agenda, retenção e destino de snapshot. |
| PUT | `/projects/{project_id}/services/{service_id}/snapshot-settings` | Atualiza configurações de snapshot. |
| POST | `/projects/{project_id}/services/{service_id}/snapshot` | Inicia a criação de um snapshot. |
| GET | `/projects/{project_id}/services/{service_id}/snapshot/jobs/{job_id}/stream` | SSE do progresso da criação de snapshot. |
| POST | `/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}/upload` | Envia um snapshot local para o S3. |
| POST | `/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}/restore` | Inicia a restauração de um snapshot. |
| GET | `/projects/{project_id}/services/{service_id}/snapshot/restore-jobs/{job_id}/stream` | SSE do progresso da restauração de snapshot. |
| DELETE | `/projects/{project_id}/services/{service_id}/snapshots/{snapshot_id}` | Remove um snapshot e, opcionalmente, sua cópia S3. |

### Configurações avançadas

| Método | Rota | Descrição |
|---|---|---|
| PUT | `/projects/{project_id}/services/{service_id}/advanced/command` | Atualiza comando e argumentos do container. |
| PUT | `/projects/{project_id}/services/{service_id}/advanced/volumes` | Atualiza mounts e volumes do serviço. |
| PUT | `/projects/{project_id}/services/{service_id}/advanced/resources` | Atualiza limites e reservas de recursos. |
| PUT | `/projects/{project_id}/services/{service_id}/advanced/ulimits` | Atualiza limites de processo do container. |

### Gerenciador de arquivos

Disponível para serviços de aplicação que possuem diretório gerenciado.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{project_id}/services/{service_id}/files` | Lista uma pasta e informa limites de upload. |
| POST | `/projects/{project_id}/services/{service_id}/files/folder` | Cria uma pasta. |
| POST | `/projects/{project_id}/services/{service_id}/files/move` | Move ou renomeia um item. |
| POST | `/projects/{project_id}/services/{service_id}/files/copy` | Copia um arquivo ou diretório. |
| DELETE | `/projects/{project_id}/services/{service_id}/files` | Remove o item indicado por `path`. |
| POST | `/projects/{project_id}/services/{service_id}/files/upload` | Faz upload multipart de um ou vários arquivos. |

## Deployments de serviços

Prefixo completo: `/projects/{project_id}/services/{service_id}/deployments`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/projects/{project_id}/services/{service_id}/deployments` | Lista deployments com filtro de status e paginação. |
| GET | `/projects/{project_id}/services/{service_id}/deployments/stream` | SSE da lista de deployments do serviço. |
| DELETE | `/projects/{project_id}/services/{service_id}/deployments/{deployment_id}` | Exclui um registro de deployment. |
| POST | `/projects/{project_id}/services/{service_id}/deployments/{deployment_id}/rollback` | Torna um deployment concluído a versão ativa. |
| GET | `/projects/{project_id}/services/{service_id}/deployments/{deployment_id}/history` | Retorna eventos e duração das fases do pipeline. |
| GET | `/projects/{project_id}/services/{service_id}/deployments/{deployment_id}/history/stream` | SSE do histórico e estado do deployment. |

## Docker

As rotas exigem o bind de `/var/run/docker.sock`; sem ele retornam conflito.
Listagens usam paginação server-side com `limit` máximo de 50.

### Containers

| Método | Rota | Descrição |
|---|---|---|
| GET | `/docker/containers` | Lista containers com estado, imagem, rede, portas e paginação. |
| GET | `/docker/containers/updates` | Retorna o estado de atualização da imagem por container. |
| GET | `/docker/containers/stats/stream` | SSE de CPU e memória dos containers em execução. |
| POST | `/docker/containers/{cid}/start` | Inicia um container. |
| POST | `/docker/containers/{cid}/stop` | Para um container. |
| POST | `/docker/containers/{cid}/restart` | Reinicia um container. |
| GET | `/docker/containers/{cid}/inspect` | Retorna a inspeção completa do container. |
| POST | `/docker/containers/{cid}/exec` | Executa um comando não interativo. |
| GET | `/docker/containers/{cid}/logs/stream` | SSE dos logs do container. |

### Imagens e scans

| Método | Rota | Descrição |
|---|---|---|
| GET | `/docker/images` | Lista imagens com uso, tamanho, filtros e paginação. |
| GET | `/docker/images/updates` | Consulta no registry se há versões mais recentes. |
| GET | `/docker/images/{image_id}/inspect` | Retorna a inspeção completa da imagem. |
| GET | `/docker/images/{image_id}/history` | Retorna o histórico de camadas da imagem. |
| POST | `/docker/images/{image_id}/pull` | Puxa novamente a referência informada ou a primeira tag local. |
| DELETE | `/docker/images/{image_id}` | Remove a imagem; aceita `force`. |
| GET | `/docker/images/{image_id}/export` | Exporta a imagem como arquivo tar. |
| POST | `/docker/images/{image_id}/scan` | Enfileira um scan de vulnerabilidades com Trivy. |
| GET | `/docker/images/scans/latest` | Retorna o último scan concluído de cada imagem. |
| GET | `/docker/images/scans/active` | Retorna scans em andamento por imagem. |
| GET | `/docker/images/scans` | Lista o histórico de scans. |
| GET | `/docker/images/scans/{scan_id}` | Retorna um scan e seus CVEs. |
| GET | `/docker/images/scans/{scan_id}/stream` | SSE do progresso e resultado do scan. |

### Volumes e redes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/docker/volumes` | Lista volumes, uso, tamanho, drivers, filtros e paginação. |
| GET | `/docker/volumes/{name}/inspect` | Retorna a inspeção de um volume. |
| DELETE | `/docker/volumes/{name}` | Remove um volume; aceita `force`. |
| GET | `/docker/networks` | Lista redes, IPAM, containers, drivers, filtros e paginação. |
| GET | `/docker/networks/{name}/inspect` | Retorna a inspeção de uma rede. |

## Uptime e monitoramento

Tipos de monitor incluem HTTP, TCP, ping, DNS, domínio, PostgreSQL, MySQL,
MongoDB, Redis, RabbitMQ, container e push.

### Metadados, grupos e tags

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/meta` | Retorna tipos, métodos, operadores, eventos, limites e catálogos do formulário. |
| GET | `/monitors/groups` | Lista grupos e quantidade de monitores. |
| POST | `/monitors/groups` | Cria um grupo. |
| PUT | `/monitors/groups/{group_id}` | Atualiza nome e cor do grupo. |
| DELETE | `/monitors/groups/{group_id}` | Remove o grupo e desvincula seus monitores. |
| GET | `/monitors/tags` | Pesquisa e pagina tags. |
| POST | `/monitors/tags` | Cria uma tag. |
| PUT | `/monitors/tags/{tag_id}` | Atualiza uma tag. |
| DELETE | `/monitors/tags/{tag_id}` | Remove uma tag e seus vínculos. |

### Monitores e histórico

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors` | Lista e filtra monitores, com estado ao vivo e paginação. |
| POST | `/monitors` | Cria um monitor. |
| GET | `/monitors/{monitor_id}` | Retorna um monitor com segredos mascarados. |
| PUT | `/monitors/{monitor_id}` | Atualiza um monitor; seu tipo não pode ser alterado. |
| PUT | `/monitors/{monitor_id}/group` | Move o monitor para um grupo ou remove o vínculo. |
| DELETE | `/monitors/{monitor_id}` | Remove o monitor e seus dados relacionados. |
| POST | `/monitors/{monitor_id}/enable` | Ativa o monitoramento. |
| POST | `/monitors/{monitor_id}/disable` | Pausa o monitoramento. |
| POST | `/monitors/{monitor_id}/check` | Executa uma checagem imediata. |
| GET | `/monitors/{monitor_id}/heartbeats` | Lista o histórico de checagens. |
| DELETE | `/monitors/{monitor_id}/heartbeats` | Limpa os heartbeats e estatísticas do monitor. |
| GET | `/monitors/{monitor_id}/uptime` | Retorna percentuais de disponibilidade. |
| GET | `/monitors/{monitor_id}/chart` | Retorna pontos do gráfico para o intervalo solicitado. |
| GET | `/monitors/{monitor_id}/events` | Lista eventos do monitor. |
| DELETE | `/monitors/{monitor_id}/events` | Limpa os eventos do monitor. |
| GET | `/monitors/stream` | SSE que sinaliza mudanças na listagem de monitores. |
| GET | `/monitors/{monitor_id}/stream` | SSE do detalhe, uptime, eventos e incidentes do monitor. |
| GET / POST | `/uptime/heartbeats/{token}` | Rota pública que registra o heartbeat de um monitor push. |

### Proxies de monitoramento

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/proxies` | Pesquisa e pagina proxies globais. |
| POST | `/monitors/proxies` | Cria um proxy de monitoramento. |
| PUT | `/monitors/proxies/{proxy_id}` | Atualiza um proxy. |
| DELETE | `/monitors/proxies/{proxy_id}` | Remove um proxy. |
| POST | `/monitors/proxies/test` | Testa uma configuração de proxy ainda não salva. |

### Canais de notificação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/notifications/types` | Lista tipos e campos de canais suportados. |
| GET | `/monitors/notifications` | Pesquisa e pagina canais, com segredos mascarados. |
| POST | `/monitors/notifications` | Cria um canal de notificação. |
| POST | `/monitors/notifications/test` | Testa uma configuração ainda não salva. |
| GET | `/monitors/notifications/{channel_id}` | Retorna um canal. |
| PUT | `/monitors/notifications/{channel_id}` | Atualiza um canal preservando segredos mascarados. |
| DELETE | `/monitors/notifications/{channel_id}` | Remove um canal. |
| POST | `/monitors/notifications/{channel_id}/test` | Envia uma notificação de teste pelo canal salvo. |

### Incidentes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/incidents` | Pesquisa incidentes de todos os monitores. |
| GET | `/monitors/{monitor_id}/incidents` | Lista incidentes de um monitor. |
| POST | `/monitors/{monitor_id}/incidents` | Cria um incidente manual. |
| PUT | `/monitors/{monitor_id}/incidents/{incident_id}` | Atualiza metadados do incidente. |
| POST | `/monitors/{monitor_id}/incidents/{incident_id}/updates` | Adiciona uma atualização à linha do tempo e pode alterar o status. |
| DELETE | `/monitors/{monitor_id}/incidents/{incident_id}` | Remove um incidente. |

### Janelas de manutenção

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/maintenances` | Lista janelas de manutenção, com busca. |
| GET | `/monitors/maintenances/{mid}` | Retorna uma janela de manutenção. |
| POST | `/monitors/maintenances` | Cria uma janela recorrente ou única. |
| PUT | `/monitors/maintenances/{mid}` | Atualiza uma janela de manutenção. |
| POST | `/monitors/maintenances/{mid}/enable` | Ativa a janela. |
| POST | `/monitors/maintenances/{mid}/disable` | Desativa a janela. |
| DELETE | `/monitors/maintenances/{mid}` | Remove a janela. |

### Status pages

| Método | Rota | Descrição |
|---|---|---|
| GET | `/monitors/status-pages` | Pesquisa e pagina status pages administrativas. |
| GET | `/monitors/status-pages/{page_id}` | Retorna a configuração de uma status page. |
| POST | `/monitors/status-pages` | Cria uma status page e, se necessário, seu domínio nginx. |
| PUT | `/monitors/status-pages/{page_id}` | Atualiza conteúdo, publicação, monitores e domínio. |
| DELETE | `/monitors/status-pages/{page_id}` | Remove a status page e a configuração gerenciada. |
| GET | `/status/{slug}` | Renderiza o HTML público da status page. |
| GET | `/status/{slug}/data` | Retorna os dados públicos e não sensíveis da status page. |

## Terminais WebSocket

WebSockets não passam pelo middleware HTTP. O token é obrigatório na query e o
backend valida explicitamente permissão de escrita.

| Método | Rota | Descrição |
|---|---|---|
| WS | `/projects/{project_id}/services/{service_id}/terminal` | Terminal TTY de um container do serviço; aceita `token`, `container` e `shell`. |
| WS | `/docker/containers/{container_id}/terminal` | Terminal TTY de um container Docker; aceita `token` e `shell`. |

## Códigos de resposta mais comuns

| Código | Significado |
|---|---|
| 200 | Operação concluída. |
| 201 | Recurso criado. |
| 400 | Parâmetro ou corpo inválido. |
| 401 | Token ausente, inválido ou segredo de webhook incorreto. |
| 403 | Identidade sem permissão ou operação protegida. |
| 404 | Rota ou recurso não encontrado. |
| 409 | Conflito de estado, dependência em uso, Docker indisponível ou configuração nginx rejeitada. |
| 422 | Falha de validação semântica do corpo ou dos parâmetros. |
| 429 | Limite de enfileiramento atingido, por exemplo no scanner. |
| 500 | Erro interno inesperado. |
| 502 | Falha em um provedor ou serviço externo. |
| 503 | API sem `API_TOKEN` configurado. |
