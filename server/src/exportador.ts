import { db } from "./db.js";

// Escapa um valor para CSV: envolve em aspas e duplica aspas internas.
// Garante que vírgulas, quebras de linha e aspas no texto não quebrem o arquivo.
function csvCampo(valor: unknown): string {
  const s = valor === null || valor === undefined ? "" : String(valor);
  return `"${s.replace(/"/g, '""')}"`;
}

// Monta uma linha CSV a partir de um array de valores.
function csvLinha(valores: unknown[]): string {
  return valores.map(csvCampo).join(",");
}

// CSV DETALHADO: uma linha por versão de história, com dados da sessão.
// É a base para a comparação com/sem assistente.
export function gerarCsvVersoes(): string {
  const linhas = db
    .prepare(
      `SELECT
         s.participante        AS participante,
         s.condicao            AS condicao,
         st.id                 AS historia_id,
         sv.id                 AS versao_id,
         sv.entrada_original   AS entrada_original,
         sv.who                AS who,
         sv.what               AS what,
         sv.why                AS why,
         sv.total_violacoes    AS total_violacoes,
         sv.violacoes_regra    AS violacoes_regra,
         sv.violacoes_llm      AS violacoes_llm,
         sv.criada_em          AS criada_em
       FROM story_versions sv
       JOIN stories st  ON st.id = sv.story_id
       JOIN sessions s  ON s.id = st.session_id
       ORDER BY s.participante, s.condicao, st.id, sv.id`,
    )
    .all() as Record<string, unknown>[];

  const cabecalho = [
    "participante",
    "condicao",
    "historia_id",
    "versao_id",
    "entrada_original",
    "who",
    "what",
    "why",
    "total_violacoes",
    "violacoes_regra",
    "violacoes_llm",
    "criada_em",
  ];

  const corpo = linhas.map((l) =>
    csvLinha([
      l.participante,
      l.condicao,
      l.historia_id,
      l.versao_id,
      l.entrada_original,
      l.who,
      l.what,
      l.why,
      l.total_violacoes,
      l.violacoes_regra,
      l.violacoes_llm,
      l.criada_em,
    ]),
  );

  // BOM (\uFEFF) no início: faz o Excel abrir acentos corretamente.
  return "\uFEFF" + [csvLinha(cabecalho), ...corpo].join("\r\n");
}

// CSV RESUMO: uma linha por história, com números finais e nº de versões.
export function gerarCsvHistorias(): string {
  const linhas = db
    .prepare(
      `SELECT
         s.participante  AS participante,
         s.condicao      AS condicao,
         st.id           AS historia_id,
         st.who          AS who_final,
         st.what         AS what_final,
         st.why          AS why_final,
         COUNT(sv.id)                              AS num_versoes,
         MIN(sv.total_violacoes)                   AS violacoes_min,
         MAX(sv.total_violacoes)                   AS violacoes_max,
         (SELECT total_violacoes FROM story_versions
            WHERE story_id = st.id ORDER BY id ASC  LIMIT 1) AS violacoes_inicio,
         (SELECT total_violacoes FROM story_versions
            WHERE story_id = st.id ORDER BY id DESC LIMIT 1) AS violacoes_fim,
         -- completude final: quantos dos 3 campos (who/what/why) estão preenchidos
         ((CASE WHEN TRIM(COALESCE(st.who,''))  <> '' THEN 1 ELSE 0 END) +
          (CASE WHEN TRIM(COALESCE(st.what,'')) <> '' THEN 1 ELSE 0 END) +
          (CASE WHEN TRIM(COALESCE(st.why,''))  <> '' THEN 1 ELSE 0 END)) AS completude_final
       FROM stories st
       JOIN sessions s ON s.id = st.session_id
       LEFT JOIN story_versions sv ON sv.story_id = st.id
       GROUP BY st.id
       ORDER BY s.participante, s.condicao, st.id`,
    )
    .all() as Record<string, unknown>[];

  const cabecalho = [
    "participante",
    "condicao",
    "historia_id",
    "who_final",
    "what_final",
    "why_final",
    "num_versoes",
    "violacoes_inicio",
    "violacoes_fim",
    "completude_final",
  ];

  const corpo = linhas.map((l) =>
    csvLinha([
      l.participante,
      l.condicao,
      l.historia_id,
      l.who_final,
      l.what_final,
      l.why_final,
      l.num_versoes,
      l.violacoes_inicio,
      l.violacoes_fim,
      l.completude_final,
    ]),
  );

  return "\uFEFF" + [csvLinha(cabecalho), ...corpo].join("\r\n");
}
