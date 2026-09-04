import { db } from "./db.js";
import type { UserStory, Violation } from "./types.js";

// Garante a coluna jira_key na tabela stories (migração leve e idempotente).
// Se a coluna já existir, o SQLite lança erro e nós ignoramos.
function garantirColunaJira(): void {
  try {
    db.prepare("ALTER TABLE stories ADD COLUMN jira_key TEXT").run();
  } catch {
    /* coluna já existe — segue normalmente */
  }
}
garantirColunaJira();

export function iniciarSessao(participante: string, condicao: string): number {
  const info = db
    .prepare(
      "INSERT INTO sessions (participante, condicao, iniciada_em) VALUES (?, ?, ?)",
    )
    .run(participante, condicao, new Date().toISOString());
  const sessionId = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO estado_atual (id, session_id) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id`,
  ).run(sessionId);

  return sessionId;
}

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

export function listarHistorias(sessionId: number) {
  return db
    .prepare(
      `SELECT id, who, what, why, criada_em, jira_key
       FROM stories WHERE session_id = ? ORDER BY id DESC`,
    )
    .all(sessionId);
}

export function listarCardsResumidos(
  sessionId: number,
): { id: number; who: string; what: string; why: string }[] {
  return db
    .prepare(
      `SELECT id, who, what, why FROM stories WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as { id: number; who: string; what: string; why: string }[];
}

export function editarHistoria(
  storyId: number,
  story: UserStory,
): { ok: boolean } {
  const existe = db.prepare("SELECT id FROM stories WHERE id = ?").get(storyId);
  if (!existe) return { ok: false };

  db.prepare(
    `INSERT INTO story_versions
       (story_id, entrada_original, who, what, why, violacoes_json, criterios_json,
        total_violacoes, violacoes_regra, violacoes_llm, criada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    "[edição manual]",
    story.who,
    story.what,
    story.why,
    "[]",
    "[]",
    0,
    0,
    0,
    new Date().toISOString(),
  );

  db.prepare(`UPDATE stories SET who = ?, what = ?, why = ? WHERE id = ?`).run(
    story.who,
    story.what,
    story.why,
    storyId,
  );

  return { ok: true };
}

export function excluirHistoria(storyId: number): { ok: boolean } {
  const existe = db.prepare("SELECT id FROM stories WHERE id = ?").get(storyId);
  if (!existe) return { ok: false };

  db.prepare("DELETE FROM story_versions WHERE story_id = ?").run(storyId);
  try {
    db.prepare("DELETE FROM metrics WHERE story_id = ?").run(storyId);
  } catch {
    /* tabela metrics pode não ter registros/estrutura usada */
  }
  db.prepare("DELETE FROM stories WHERE id = ?").run(storyId);
  return { ok: true };
}

// Busca uma história (para envio ao Jira) com seus critérios mais recentes.
export function buscarHistoriaParaEnvio(storyId: number) {
  const h = db
    .prepare("SELECT id, who, what, why, jira_key FROM stories WHERE id = ?")
    .get(storyId) as
    | {
        id: number;
        who: string;
        what: string;
        why: string;
        jira_key: string | null;
      }
    | undefined;
  if (!h) return null;

  const ultima = db
    .prepare(
      `SELECT criterios_json, entrada_original FROM story_versions
       WHERE story_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(storyId) as
    | { criterios_json: string; entrada_original: string }
    | undefined;

  let criterios: string[] = [];
  try {
    criterios = JSON.parse(ultima?.criterios_json ?? "[]");
  } catch {
    criterios = [];
  }

  return {
    story: { who: h.who, what: h.what, why: h.why },
    jiraKey: h.jira_key,
    criterios,
    entradaOriginal: ultima?.entrada_original ?? "",
  };
}

// Grava a chave do card criado no Jira (ex.: TCC-42).
export function registrarJiraKey(storyId: number, key: string): void {
  db.prepare("UPDATE stories SET jira_key = ? WHERE id = ?").run(key, storyId);
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
