import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync("dados.db");

db.exec("PRAGMA journal_mode = WAL;");

export function inicializarBanco() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participante TEXT NOT NULL,
      condicao TEXT NOT NULL,
      iniciada_em TEXT NOT NULL,
      finalizada_em TEXT
    );

    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      who TEXT,
      what TEXT,
      why TEXT,
      criada_em TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS story_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      entrada_original TEXT,
      who TEXT,
      what TEXT,
      why TEXT,
      violacoes_json TEXT,
      criterios_json TEXT,
      total_violacoes INTEGER,
      violacoes_regra INTEGER,
      violacoes_llm INTEGER,
      criada_em TEXT NOT NULL,
      FOREIGN KEY (story_id) REFERENCES stories(id)
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      tempo_segundos INTEGER,
      num_versoes INTEGER,
      violacoes_inicio INTEGER,
      violacoes_fim INTEGER,
      completude_final INTEGER,
      FOREIGN KEY (story_id) REFERENCES stories(id)
    );

    -- Guarda qual sessão está ativa no momento (uma linha só, id = 1).
    CREATE TABLE IF NOT EXISTS estado_atual (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      session_id INTEGER
    );
  `);
}
