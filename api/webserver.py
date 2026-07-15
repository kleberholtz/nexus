"""Servidor estático do painel (SPA) — independente do nginx.

Serve o build do frontend (`WEB_ROOT`) em `FRONT_PORT`, com fallback de SPA
para `index.html` (rotas client-side do React Router). O nginx **deixou de
servir o painel**: assim o painel continua acessível mesmo enquanto se mexe na
config do nginx (que é justamente o que este produto faz).

A conexão com a API é **direta** (cross-origin, sem proxy): o frontend usa por
padrão a própria API (`https://127.0.0.1:3001`), sobrescrevível na tela de
Configurações. Só usa a stdlib (nenhuma dependência extra).

Uso: `python3 -m api.webserver`
Variáveis:
    WEB_ROOT     raiz do build (padrão /var/www/nexus-web)
    FRONT_HOST   bind (padrão 0.0.0.0)
    FRONT_PORT   porta do painel (padrão 3000)
"""
from __future__ import annotations

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_ROOT = Path(os.environ.get("WEB_ROOT", "/var/www/nexus-web"))
FRONT_HOST = os.environ.get("FRONT_HOST", "0.0.0.0")
FRONT_PORT = int(os.environ.get("FRONT_PORT", "3000"))


class SpaHandler(SimpleHTTPRequestHandler):
    """Estáticos com fallback de SPA para as rotas client-side do React Router."""

    def send_head(self):
        # Fallback de SPA: caminhos inexistentes em disco e sem extensão (i.e.
        # não são assets) caem no index.html para o React Router resolver a rota.
        clean = self.path.split("?", 1)[0].split("#", 1)[0]
        fs = Path(self.translate_path(self.path))
        if not fs.exists() and "." not in Path(clean).name:
            self.path = "/index.html"
        return super().send_head()

    def log_message(self, *args) -> None:  # silencioso; o serviço já loga o essencial
        pass


def main() -> None:
    if not WEB_ROOT.exists():
        print(f"webserver: AVISO — WEB_ROOT {WEB_ROOT} não existe", flush=True)
    handler = partial(SpaHandler, directory=str(WEB_ROOT))
    httpd = ThreadingHTTPServer((FRONT_HOST, FRONT_PORT), handler)
    print(
        f"webserver: painel em http://{FRONT_HOST}:{FRONT_PORT} (WEB_ROOT={WEB_ROOT})",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
