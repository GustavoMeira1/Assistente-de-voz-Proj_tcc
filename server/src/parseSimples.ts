import type { UserStory } from "./types.js";

// Decompõe a frase SEM IA, apenas procurando os marcadores do template.
// Usado na condição de controle (sem assistente): mede o que a pessoa
// escreveu por conta própria, sem ajuda do LLM.
export function decomporSimples(texto: string): UserStory {
  const t = texto.trim();
  const minus = t.toLowerCase();

  // Procura as posições dos marcadores clássicos do template.
  const iComo = minus.indexOf("como ");
  const iQuero = minus.indexOf("quero ");
  const iPara = minus.lastIndexOf("para ");

  // Se não há marcadores reconhecíveis, guarda tudo em 'what' (cru).
  if (iComo === -1 && iQuero === -1) {
    return { who: "", what: t, why: "" };
  }

  let who = "";
  let what = "";
  let why = "";

  if (iComo !== -1) {
    const fimWho = iQuero !== -1 ? iQuero : t.length;
    who = t
      .slice(iComo + 5, fimWho)
      .replace(/[,;]/g, " ")
      .trim();
  }
  if (iQuero !== -1) {
    const fimWhat = iPara !== -1 && iPara > iQuero ? iPara : t.length;
    what = t.slice(iQuero + 6, fimWhat).trim();
  }
  if (iPara !== -1) {
    why = t.slice(iPara + 5).trim();
  }
  // Se sobrou vazio o what mas há texto, usa o texto todo como fallback.
  if (!what && !who) what = t;

  return { who, what, why };
}
