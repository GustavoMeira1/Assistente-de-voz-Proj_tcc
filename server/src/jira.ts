import { lerConfig } from "./jiraConfig.js";
import type { UserStory } from "./types.js";

export interface ResultadoJira {
  ok: boolean;
  key?: string; // ex.: TCC-42
  url?: string; // link direto para o card
  erro?: string;
}

// O Jira Cloud espera a descrição no formato ADF (Atlassian Document Format).
// Monta um ADF mínimo: uma lista de parágrafos de texto simples.
function adf(paragrafos: string[]) {
  return {
    type: "doc",
    version: 1,
    content: paragrafos
      .filter((p) => p && p.trim())
      .map((p) => ({
        type: "paragraph",
        content: [{ type: "text", text: p }],
      })),
  };
}

// Monta o resumo (título) do card a partir da história.
function montarResumo(story: UserStory): string {
  const base = story.what?.trim() || "Demanda sem descrição";
  const quem = story.who?.trim();
  const titulo = quem ? `${quem}: ${base}` : base;
  // O campo summary do Jira tem limite de 255 caracteres.
  return titulo.length > 250 ? titulo.slice(0, 247) + "..." : titulo;
}

// Cria uma issue no Jira a partir de uma user story.
export async function criarIssueJira(
  story: UserStory,
  criterios: string[] = [],
  entradaOriginal?: string,
): Promise<ResultadoJira> {
  const cfg = lerConfig();

  if (!cfg.ativo)
    return { ok: false, erro: "Integração com Jira está desativada." };
  if (!cfg.baseUrl || !cfg.email || !cfg.token || !cfg.projectKey) {
    return { ok: false, erro: "Configuração do Jira incompleta." };
  }

  // Corpo da descrição: a história no formato canônico + critérios + origem.
  const partes: string[] = [];
  const linhaHistoria = [
    story.who ? `Como ${story.who}` : null,
    story.what ? `eu quero ${story.what}` : null,
    story.why ? `para ${story.why}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (linhaHistoria) partes.push(linhaHistoria + ".");

  if (criterios.length > 0) {
    partes.push("Critérios de aceite:");
    criterios.forEach((c, i) => partes.push(`${i + 1}. ${c}`));
  }
  if (entradaOriginal && entradaOriginal !== "[edição manual]") {
    partes.push(`Origem (trecho da reunião): "${entradaOriginal}"`);
  }
  partes.push("Card gerado automaticamente pelo Assistente de Voz (TCC).");

  const corpo = {
    fields: {
      project: { key: cfg.projectKey },
      summary: montarResumo(story),
      description: adf(partes),
      issuetype: { name: cfg.issueType || "Task" },
    },
  };

  // Autenticação Basic com e-mail + API token (padrão do Jira Cloud).
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");

  try {
    const resp = await fetch(`${cfg.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(corpo),
    });

    const texto = await resp.text();

    if (!resp.ok) {
      // O Jira devolve erros descritivos em JSON; tenta extrair a mensagem.
      let detalhe = texto;
      try {
        const j = JSON.parse(texto);
        const msgs = [
          ...(j.errorMessages ?? []),
          ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
        ];
        if (msgs.length) detalhe = msgs.join(" | ");
      } catch {
        /* mantém o texto bruto */
      }
      return { ok: false, erro: `Jira respondeu ${resp.status}: ${detalhe}` };
    }

    const dados = JSON.parse(texto) as { key: string };
    return {
      ok: true,
      key: dados.key,
      url: `${cfg.baseUrl}/browse/${dados.key}`,
    };
  } catch (err) {
    return {
      ok: false,
      erro: err instanceof Error ? err.message : "Falha ao contatar o Jira.",
    };
  }
}

// Testa a conexão sem criar card: consulta os dados do usuário autenticado.
export async function testarConexaoJira(): Promise<ResultadoJira> {
  const cfg = lerConfig();
  if (!cfg.baseUrl || !cfg.email || !cfg.token) {
    return { ok: false, erro: "Preencha URL, e-mail e token antes de testar." };
  }
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  try {
    const resp = await fetch(`${cfg.baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      return {
        ok: false,
        erro: `Jira respondeu ${resp.status}. Verifique URL, e-mail e token.`,
      };
    }
    const d = (await resp.json()) as { displayName?: string };
    return { ok: true, key: d.displayName ?? "conectado" };
  } catch (err) {
    return {
      ok: false,
      erro: err instanceof Error ? err.message : "Falha ao contatar o Jira.",
    };
  }
}
