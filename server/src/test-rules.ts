import { aplicarRegras } from "./rules.js";
import type { UserStory } from "./types.js";

// Uma história de propósito problemática, para ver as regras reagirem.
const historiaRuim: UserStory = {
  who: "usuário",
  what: "cadastrar e editar produtos de forma rápida",
  why: "",
};

console.log("Violações encontradas:");
console.log(JSON.stringify(aplicarRegras(historiaRuim), null, 2));
