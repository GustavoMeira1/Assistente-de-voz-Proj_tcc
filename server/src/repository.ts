import { db } from "./db.js";
import { aplicarRegras } from "./rules.js";
import { limparStory } from "./historia.js";
import type { UserStory, Violation } from "./types.js";

// Acrescenta uma coluna a uma tabela, se ela ainda não existir.
function garantirColuna(tabela: string, coluna: string, tipo: string): void {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all() as {
    name: string;
  }[];
  if (!colunas.some((c) => c.name === coluna)) {
    db.prepare(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`).run();
  }
}

// Migrações leves do banco. IMPORTANTE: deve ser chamada DEPOIS de
// inicializarBanco(), para que as tabelas já existam. Funciona tanto em banco
// novo quanto em banco antigo.
export function migrarBanco(): void {
  try {
    garantirColuna("stories", "jira_key", "TEXT");
    garantirColuna("stories", "responsavel", "TEXT");
    garantirColuna("story_versions", "responsavel", "TEXT");
  } catch (e) {
    console.error("Falha ao migrar o banco:", e);
  }
}

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
      `INSERT INTO stories (session_id, who, what, why, responsavel, criada_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      story.who,
      story.what,
      story.why,
      story.responsavel ?? "",
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

// Grava uma versão da história e atualiza o estado atual do card.
function inserirVersao(
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
       (story_id, entrada_original, who, what, why, responsavel, violacoes_json,
        criterios_json, total_violacoes, violacoes_regra, violacoes_llm, criada_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    storyId,
    entradaOriginal,
    story.who,
    story.what,
    story.why,
    story.responsavel ?? "",
    JSON.stringify(violations),
    JSON.stringify(acceptanceCriteria),
    violations.length,
    regra,
    llm,
    new Date().toISOString(),
  );

  db.prepare(
    `UPDATE stories SET who = ?, what = ?, why = ?, responsavel = ? WHERE id = ?`,
  ).run(story.who, story.what, story.why, story.responsavel ?? "", storyId);
}

export function salvarVersao(
  storyId: number,
  entradaOriginal: string,
  story: UserStory,
  violations: Violation[],
  acceptanceCriteria: string[],
): void {
  inserirVersao(storyId, entradaOriginal, story, violations, acceptanceCriteria);
}

export function listarVersoes(storyId: number) {
  return db
    .prepare("SELECT * FROM story_versions WHERE story_id = ? ORDER BY id ASC")
    .all(storyId);
}

export function listarHistorias(sessionId: number) {
  return db
    .prepare(
      `SELECT id, who, what, why, responsavel, criada_em, jira_key
       FROM stories WHERE session_id = ? ORDER BY id DESC`,
    )
    .all(sessionId);
}

export function listarCardsResumidos(sessionId: number): {
  id: number;
  who: string;
  what: string;
  why: string;
  responsavel: string;
}[] {
  return db
    .prepare(
      `SELECT id, who, what, why, COALESCE(responsavel, '') AS responsavel
       FROM stories WHERE session_id = ? ORDER BY id ASC`,
    )
    .all(sessionId) as {
    id: number;
    who: string;
    what: string;
    why: string;
    responsavel: string;
  }[];
}

// Edição manual: grava uma nova versão marcada como "[edição manual]".
// As regras determinísticas são reaplicadas à versão editada, para que o
// histórico mostre o efeito da correção (antes e depois). Os critérios de
// aceite da última versão são mantidos. Alertas do LLM não são recalculados
// aqui; para isso, a história pode ser reanalisada no modo individual.
export function editarHistoria(
  storyId: number,
  entrada: Partial<UserStory>,
): { ok: boolean; story?: UserStory; violations?: Violation[] } {
  const existe = db.prepare("SELECT id FROM stories WHERE id = ?").get(storyId);
  if (!existe) return { ok: false };

  const story = limparStory(entrada);
  const violations = aplicarRegras(story);

  const ultima = db
    .prepare(
      `SELECT criterios_json FROM story_versions
       WHERE story_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(storyId) as { criterios_json: string } | undefined;
  let criterios: string[] = [];
  try {
    criterios = JSON.parse(ultima?.criterios_json ?? "[]");
  } catch {
    criterios = [];
  }

  inserirVersao(storyId, "[edição manual]", story, violations, criterios);
  return { ok: true, story, violations };
}

export function excluirHistoria(storyId: number): { ok: boolean } {
  const existe = db.prepare("SELECT id FROM stories WHERE id = ?").get(storyId);
  if (!existe) return { ok: false };

  db.prepare("DELETE FROM story_versions WHERE story_id = ?").run(storyId);
  try {
    db.prepare("DELETE FROM metrics WHERE story_id = ?").run(storyId);
  } catch {
    /* tabela metrics pode não existir/estar vazia */
  }
  db.prepare("DELETE FROM stories WHERE id = ?").run(storyId);
  return { ok: true };
}

export function buscarHistoriaParaEnvio(storyId: number) {
  const h = db
    .prepare(
      `SELECT id, who, what, why, COALESCE(responsavel, '') AS responsavel,
              jira_key
       FROM stories WHERE id = ?`,
    )
    .get(storyId) as
    | {
        id: number;
        who: string;
        what: string;
        why: string;
        responsavel: string;
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
    story: { who: h.who, what: h.what, why: h.why, responsavel: h.responsavel },
    jiraKey: h.jira_key,
    criterios,
    entradaOriginal: ultima?.entrada_original ?? "",
  };
}

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
      `SELECT id, entrada_original, who, what, why,
              COALESCE(responsavel, '') AS responsavel, violacoes_json,
              criterios_json, total_violacoes, violacoes_regra,
              violacoes_llm, criada_em
       FROM story_versions WHERE story_id = ? ORDER BY id ASC`,
    )
    .all(storyId);

  return { historia, versoes };
}
