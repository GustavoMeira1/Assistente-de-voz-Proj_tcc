import type { UserStory } from "./types.js";

// Remove do início do texto um dos prefixos informados (sem diferenciar
// maiúsculas), repetidamente: "para para evitar" -> "evitar".
function removerPrefixos(texto: string, prefixos: string[]): string {
  let t = (texto ?? "").trim();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const p of prefixos) {
      if (t.toLowerCase().startsWith(p)) {
        t = t.slice(p.length).trim();
        mudou = true;
      }
    }
  }
  return t;
}

// Padroniza os campos de uma história vinda do LLM ou da edição manual.
// O LLM às vezes devolve o benefício já começando por "para" e a interface
// acrescentava outro "para", gerando "para para ...". A limpeza é feita aqui,
// na origem, para que banco, interface, CSV e Jira recebam o texto sem prefixo.
export function limparStory(story: Partial<UserStory>): UserStory {
  const semPontoFinal = (t: string) => t.replace(/[.;,\s]+$/u, "").trim();
  return {
    who: semPontoFinal(removerPrefixos(story.who ?? "", ["como "])),
    what: semPontoFinal(
      removerPrefixos(story.what ?? "", ["eu quero ", "quero ", "eu gostaria de "]),
    ),
    why: semPontoFinal(
      removerPrefixos(story.why ?? "", ["para ", "pra "]),
    ),
    responsavel: semPontoFinal(story.responsavel ?? ""),
  };
}
