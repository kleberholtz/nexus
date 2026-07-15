// Validações reutilizáveis (espelham as regras do backend).

export function validateInt(
  value: string | number,
  { min, max, label }: { min: number; max: number; label: string },
): string | null {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (String(value).trim() === "" || Number.isNaN(n)) return `${label} deve ser um número`;
  if (!Number.isInteger(n)) return `${label} deve ser inteiro`;
  if (n < min || n > max) return `${label} deve estar entre ${min} e ${max}`;
  return null;
}

// Número decimal (aceita frações, ex.: 0.1). Usado no intervalo do SSE.
export function validateNumber(
  value: string | number,
  { min, max, label }: { min: number; max: number; label: string },
): string | null {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (String(value).trim() === "" || Number.isNaN(n)) return `${label} deve ser um número`;
  if (n < min || n > max) return `${label} deve estar entre ${min} e ${max}`;
  return null;
}

// Nome de upstream/identificador: letras, números, _.- (sintaxe nginx segura).
export function validateName(value: string, label = "Nome"): string | null {
  const v = value.trim();
  if (!v) return `${label} é obrigatório`;
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return `${label} só aceita letras, números, . _ -`;
  if (v.length > 120) return `${label} muito longo`;
  return null;
}

// Config em texto: precisa de conteúdo e chaves balanceadas.
export function validateConfig(value: string, label = "Configuração"): string | null {
  const v = value.trim();
  if (!v) return `${label} não pode ficar vazia`;
  let depth = 0;
  for (const ch of v) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return "Chaves desbalanceadas ( } a mais )";
    }
  }
  if (depth !== 0) return "Chaves desbalanceadas ( { sem fechar )";
  return null;
}

export function validateUrl(value: string, label = "URL"): string | null {
  const v = value.trim();
  if (!v) return null; // vazio = usar padrão
  if (v.startsWith("/")) return null; // caminho relativo (proxy) é válido
  try {
    new URL(v);
    return null;
  } catch {
    return `${label} inválida`;
  }
}
