import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// As credenciais ficam SOMENTE no backend, num arquivo local.
// O token nunca é devolvido ao frontend (só um indicador de que existe).
const CAMINHO = resolve(process.cwd(), "jira-config.json");

export interface JiraConfig {
  ativo: boolean;
  baseUrl: string; // ex.: https://suaempresa.atlassian.net
  email: string; // e-mail da conta Atlassian
  token: string; // API token
  projectKey: string; // ex.: TCC
  issueType: string; // ex.: Task
}

const PADRAO: JiraConfig = {
  ativo: false,
  baseUrl: "",
  email: "",
  token: "",
  projectKey: "",
  issueType: "Task",
};

export function lerConfig(): JiraConfig {
  if (!existsSync(CAMINHO)) return { ...PADRAO };
  try {
    const bruto = JSON.parse(readFileSync(CAMINHO, "utf-8"));
    return { ...PADRAO, ...bruto };
  } catch {
    return { ...PADRAO };
  }
}

// Salva a config. Se o token vier vazio, mantém o token já salvo
// (permite editar os outros campos sem redigitar o token).
export function salvarConfig(parcial: Partial<JiraConfig>): JiraConfig {
  const atual = lerConfig();
  const nova: JiraConfig = {
    ativo: parcial.ativo ?? atual.ativo,
    baseUrl: (parcial.baseUrl ?? atual.baseUrl).trim().replace(/\/+$/, ""),
    email: (parcial.email ?? atual.email).trim(),
    token:
      parcial.token && parcial.token.trim()
        ? parcial.token.trim()
        : atual.token,
    projectKey: (parcial.projectKey ?? atual.projectKey).trim().toUpperCase(),
    issueType: (parcial.issueType ?? atual.issueType).trim() || "Task",
  };
  writeFileSync(CAMINHO, JSON.stringify(nova, null, 2), "utf-8");
  return nova;
}

// Versão segura para enviar ao frontend: sem o token.
export function configPublica() {
  const c = lerConfig();
  return {
    ativo: c.ativo,
    baseUrl: c.baseUrl,
    email: c.email,
    projectKey: c.projectKey,
    issueType: c.issueType,
    temToken: Boolean(c.token),
  };
}
