import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Sem proxy: o painel fala DIRETO com a API (conexão direta, cross-origin). Em
// dev, defina VITE_API_URL para a base da API (padrão https://localhost:3001).
// A API é HTTPS self-signed, então aceite o certificado uma vez no browser
// (abra a base da API e confie) para o fetch cross-origin funcionar.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          radix: [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-dialog",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
          ],
          charts: ["recharts"],
        },
      },
    },
  },
  server: {
    port: Number(process.env.FRONT_PORT) || 3000,
  },
});
