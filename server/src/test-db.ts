import { db, inicializarBanco } from "./db.js";

inicializarBanco();

// Insere uma sessão de teste.
const info = db
  .prepare(
    "INSERT INTO sessions (participante, condicao, iniciada_em) VALUES (?, ?, ?)",
  )
  .run("participante_teste", "com_assistente", new Date().toISOString());

console.log("Sessão criada com id:", info.lastInsertRowid);

// Lê de volta o que foi inserido.
const linhas = db.prepare("SELECT * FROM sessions").all();
console.log("Sessões no banco:", linhas);
