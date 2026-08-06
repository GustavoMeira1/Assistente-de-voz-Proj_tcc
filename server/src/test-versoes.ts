import { db } from "./db.js";

console.log("Histórias:");
console.log(db.prepare("SELECT * FROM stories").all());

console.log("\nVersões:");
console.log(
  db
    .prepare(
      "SELECT id, story_id, entrada_original, what, total_violacoes FROM story_versions ORDER BY id",
    )
    .all(),
);
