// Gera um relatório em texto das sessões, para análise dos resultados.
// Uso (dentro da pasta server):
//   npx tsx src/ver-cards.ts          -> só a sessão ativa
//   npx tsx src/ver-cards.ts todas    -> todas as sessões com histórias
// O relatório é exibido no terminal e salvo em "relatorio-daily.txt".
import { writeFileSync } from "node:fs";
import { db } from "./db.js";

type Sessao = { id: number; participante: string; condicao: string; iniciada_em: string };
type Historia = {
  id: number; who: string; what: string; why: string;
  responsavel: string; jira_key: string | null;
};
type Versao = {
  id: number; entrada_original: string; who: string; what: string; why: string;
  responsavel: string; violacoes_json: string; criterios_json: string;
  total_violacoes: number; violacoes_regra: number; violacoes_llm: number;
  criada_em: string;
};

// Garante que as colunas novas existam, mesmo se o servidor ainda não rodou.
function temColuna(tabela: string, coluna: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
  return cols.some((c) => c.name === coluna);
}
const colRespSt = temColuna("stories", "responsavel") ? "COALESCE(responsavel,'')" : "''";
const colRespSv = temColuna("story_versions", "responsavel") ? "COALESCE(responsavel,'')" : "''";
const colJira = temColuna("stories", "jira_key") ? "jira_key" : "NULL";

const linhas: string[] = [];
const out = (t = "") => linhas.push(t);

function json<T>(t: string, padrao: T): T {
  try { return JSON.parse(t) as T; } catch { return padrao; }
}

const todas = process.argv[2] === "todas";
let sessoes: Sessao[];
if (todas) {
  sessoes = db.prepare(
    `SELECT s.id, s.participante, s.condicao, s.iniciada_em FROM sessions s
     WHERE EXISTS (SELECT 1 FROM stories st WHERE st.session_id = s.id)
     ORDER BY s.id`,
  ).all() as Sessao[];
} else {
  const est = db.prepare("SELECT session_id FROM estado_atual WHERE id = 1")
    .get() as { session_id: number } | undefined;
  sessoes = db.prepare(
    "SELECT id, participante, condicao, iniciada_em FROM sessions WHERE id = ?",
  ).all(est?.session_id ?? 0) as Sessao[];
}

out(`RELATÓRIO DE SESSÕES — gerado em ${new Date().toLocaleString("pt-BR")}`);
if (sessoes.length === 0) out("Nenhuma sessão com histórias encontrada.");

for (const s of sessoes) {
  out("");
  out("=".repeat(78));
  out(`SESSÃO ${s.id} | participante: ${s.participante} | condição: ${s.condicao} | início: ${s.iniciada_em}`);
  out("=".repeat(78));

  const historias = db.prepare(
    `SELECT id, who, what, why, ${colRespSt} AS responsavel, ${colJira} AS jira_key
     FROM stories WHERE session_id = ? ORDER BY id`,
  ).all(s.id) as Historia[];

  // Textos de entrada distintos (a transcrição enviada ao LLM aparece uma vez).
  const entradas: string[] = [];
  const idEntrada = (t: string) => {
    if (t === "[edição manual]") return "edição manual";
    let i = entradas.indexOf(t);
    if (i === -1) { entradas.push(t); i = entradas.length - 1; }
    return `E${i + 1}`;
  };

  const blocos: string[] = [];
  for (const h of historias) {
    const versoes = db.prepare(
      `SELECT id, entrada_original, who, what, why, ${colRespSv} AS responsavel,
              violacoes_json, criterios_json, total_violacoes, violacoes_regra,
              violacoes_llm, criada_em
       FROM story_versions WHERE story_id = ? ORDER BY id`,
    ).all(h.id) as Versao[];

    const b: string[] = [];
    b.push("");
    b.push(`CARD #${h.id}${h.jira_key ? ` (Jira ${h.jira_key})` : ""}`);
    b.push(`  persona:     ${h.who || "—"}`);
    b.push(`  responsável: ${h.responsavel || "—"}`);
    b.push(`  quer:        ${h.what || "—"}`);
    b.push(`  para:        ${h.why || "—"}`);
    versoes.forEach((v, i) => {
      b.push(`  v${i + 1} [origem: ${idEntrada(v.entrada_original)}] ` +
        `${v.total_violacoes} alertas (${v.violacoes_regra} regra / ${v.violacoes_llm} IA) — ${v.criada_em}`);
      if (i > 0) {
        b.push(`     persona: ${v.who || "—"} | responsável: ${v.responsavel || "—"}`);
        b.push(`     quer: ${v.what || "—"} | para: ${v.why || "—"}`);
      }
      for (const viol of json<{ criterio: string; origem: string; mensagem: string }[]>(v.violacoes_json, [])) {
        b.push(`     - [${viol.origem === "llm" ? "IA" : "regra"}] ${viol.criterio}: ${viol.mensagem}`);
      }
      const crit = json<string[]>(v.criterios_json, []);
      if (crit.length) {
        b.push("     critérios:");
        crit.forEach((c) => b.push(`       * ${c}`));
      }
    });
    blocos.push(...b);
  }

  out("");
  out("TEXTOS ENVIADOS AO ASSISTENTE:");
  entradas.forEach((t, i) => { out(""); out(`[E${i + 1}] ${t}`); });
  out("");
  out(`CARDS (${historias.length}):`);
  blocos.forEach((l) => out(l));
}

const texto = linhas.join("\n");
console.log(texto);
writeFileSync("relatorio-daily.txt", "\uFEFF" + texto.replace(/\n/g, "\r\n"), "utf-8");
console.log("\nRelatório salvo em relatorio-daily.txt");
