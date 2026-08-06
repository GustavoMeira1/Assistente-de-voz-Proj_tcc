import { db } from "./db.js";
import type { UserStory, Violation } from "./types.js";

// Inicia uma nova sessão para um participante numa condição, e a torna ativa.
export function iniciarSessao(participante: string, condicao: string): number {
  const info = db
    .prepare(
      "INSERT INTO sessions (participante, condicao, iniciada_em) VALUES (?, ?, ?)",
    )
    .run(participante, condicao, new Date().toISOString());
  const sessionId = Number(info.lastInsertRowid);

  // Grava/atualiza a sessão ativa (linha única id = 1).
  db.prepare(
    `INSERT INTO estado_atual (id, session_id) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id`,
  ).run(sessionId);

  return sessionId;
}

// Retorna a sessão ativa (id + condição), ou null se não houver.
export function sessaoAtiva(): { id: number; condicao: string } | null {
  const estado = db
    .prepare("SELECT session_id FROM estado_atual WHERE id = 1")
    .get() as { session_id: number } | undefined;

  if (!estado?.session_id) return null;

  const sessao = db
    .prepare("SELECT id, condicao FROM sessions WHERE id = ?")
    .get(estado.session_id) as { id: number; condicao: string } | undefined;

  return sessao ?? null;
}

// Garante que exista ALGUMA sessão ativa (cria uma avulsa se necessário).
export function garantirSessao(): { id: number; condicao: string } {
  const ativa = sessaoAtiva();
  if (ativa) return ativa;
  const id = iniciarSessao("avulsa", "com_assistente");
  return { id, condicao: "com_assistente" };
}

export function criarHistoria(sessionId: number, story: UserStory): number {
  const info = db
    .prepare(
      `INSERT INTO stories (session_id, who, what, why, criada_em)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, story.who, story.what, story.why, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function salvarVersao(
  storyId: number,
  entradaOriginal: string,
  story: UserStory,
  violations: Violation[],
  acceptanceCriteria: string[],
): void {
  const regra = violations.filter((v) => v.origem === "regra").length;
  const llm = violations.filter((v) => v.origem === "llm").length;

  db.prepare(
    `INSERT INTO story_versions
       (story_id, entrada_original, who, what, why, violacoes_json, criterios_json,
        total_violacoes, violacoes_regra, violacoes_llm, criada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    entradaOriginal,
    story.who,
    story.what,
    story.why,
    JSON.stringify(violations),
    JSON.stringify(acceptanceCriteria),
    violations.length,
    regra,
    llm,
    new Date().toISOString(),
  );

  db.prepare(`UPDATE stories SET who = ?, what = ?, why = ? WHERE id = ?`).run(
    story.who,
    story.what,
    story.why,
    storyId,
  );
}

export function listarVersoes(storyId: number) {
  return db
    .prepare("SELECT * FROM story_versions WHERE story_id = ? ORDER BY id ASC")
    .all(storyId);
}

// Lista as histórias da sessão ATIVA (a mais recente primeiro).
export function listarHistorias(sessionId: number) {
  return db
    .prepare(
      `SELECT id, who, what, why, criada_em
       FROM stories WHERE session_id = ? ORDER BY id DESC`,
    )
    .all(sessionId);
}

export function buscarHistoriaComVersoes(storyId: number) {
  const historia = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(storyId);
  if (!historia) return null;

  const versoes = db
    .prepare(
      `SELECT id, entrada_original, who, what, why, violacoes_json,
              criterios_json, total_violacoes, violacoes_regra,
              violacoes_llm, criada_em
       FROM story_versions WHERE story_id = ? ORDER BY id ASC`,
    )
    .all(storyId);

  return { historia, versoes };
}
