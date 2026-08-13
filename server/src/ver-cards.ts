import { db } from "./db.js";

const sessao = db
  .prepare("SELECT session_id FROM estado_atual WHERE id = 1")
  .get() as { session_id: number } | undefined;

console.log("=== HISTÓRIAS (estado atual) ===");
console.log(
  db
    .prepare(
      "SELECT id, who, what, why FROM stories WHERE session_id = ? ORDER BY id",
    )
    .all(sessao?.session_id),
);

console.log("\n=== VERSÕES (evolução, com trecho de origem) ===");
console.log(
  db
    .prepare(
      `SELECT sv.story_id, sv.who, sv.what, sv.entrada_original
     FROM story_versions sv
     JOIN stories st ON st.id = sv.story_id
     WHERE st.session_id = ?
     ORDER BY sv.story_id, sv.id`,
    )
    .all(sessao?.session_id),
);
