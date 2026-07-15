# Holtz Nexus — Frontend

SPA de gerenciamento do nginx: **Vite + React + TypeScript + Tailwind + shadcn/ui**
(Node 24). Consome a [API](../api/README.md) (HTTP 3001 por padrão, painel na 3000).

## Telas
- **Login** — usuário/senha validados pelo backend contra `API_USER`/`API_PASSWORD`
  do `.env`; em sucesso guarda o token no `localStorage`.
- **Dashboard** — CPU, memória, disco, uptime e host (via `GET /system`), além de
  status/versão do nginx com ações **Testar / Reload / Restart**. Auto-atualiza a
  cada 5s.
- **Servers** — lista, cria, edita e exclui server blocks. O `default` não pode ser
  removido (botão desabilitado + bloqueio no backend). Exclusão pede confirmação.
- **Upstreams** — lista, cria (com nome), edita e exclui.
- **Streams** — lista, cria, edita e exclui (proxy TCP/UDP).

A edição de config usa um editor de texto em sintaxe nginx (o backend valida com
`nginx -t` antes de aplicar e faz rollback se falhar).

## Desenvolvimento

Pré-requisito: a API rodando em `https://localhost:3001` (ou ajuste o alvo do
proxy). Com as envs `API_USER`, `API_PASSWORD` e `API_TOKEN` definidas no backend.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

O painel fala **direto** com a API (conexão direta, sem proxy). O padrão em dev
é `https://localhost:3001`; aponte para outro host com `VITE_API_URL`. Como a API
roda em **HTTP por padrão** (`API_TLS=on` liga HTTPS self-signed), então o fetch
cross-origin funciona sem prompt de certificado.

## Build de produção

```bash
npm run build      # gera ./dist (estático)
npm run preview    # serve o build localmente
```

No container, `dist/` é servido por `api/webserver.py` na `FRONT_PORT`. A conexão
com a API é **direta** (sem proxy, sem prefixo `/api`): o padrão é a **própria
API** `http://127.0.0.1:3001`, sobrescrevível no login e na tela de Configurações
(salvo no navegador). O CORS já vem `*` (Bearer, sem cookies). Para fixar outra
base no build, defina `VITE_API_URL`.

## Variáveis (`.env`)
Veja [.env.example](.env.example).

| var            | padrão                    | descrição                                     |
|----------------|---------------------------|-----------------------------------------------|
| `VITE_API_URL` | `http://127.0.0.1:3001`   | base das chamadas à API (override do padrão)  |
