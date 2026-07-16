import type { UserStory, Violation } from "./types.js";

// Remove acentos e coloca em minúsculas, para comparação robusta.
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Radicais de termos vagos (sem acento). O startsWith cobre flexões de
// gênero/número (rápido/rápida/rápidos) e derivações (eficiente/eficiência).
const RADICAIS_VAGOS = [
  "rapid", // rápido, rápida, rapidamente
  "facil", // fácil, facilmente, fáceis
  "amigav", // amigável, amigáveis
  "intuitiv", // intuitivo, intuitiva
  "eficien", // eficiente, eficiência
  "simpl", // simples, simplificado
  "adequad", // adequado, adequada
];

// Termos vagos que exigem correspondência exata, para evitar falsos
// positivos (ex.: não queremos que "melhor" capture o verbo "melhorar").
const PALAVRAS_VAGAS_EXATAS = [
  "bom",
  "boa",
  "bons",
  "boas",
  "melhor",
  "melhores",
];

// Palavras que ligam duas ideias, sugerindo história não-atômica.
const CONECTORES = [" e ", " ou ", " além de ", "&", ";"];

// Regra 1: as três partes do template estão preenchidas?
function verificarTemplate(story: UserStory): Violation[] {
  const violacoes: Violation[] = [];
  if (!story.who.trim()) {
    violacoes.push({
      criterio: "Template - Perfil (who)",
      origem: "regra",
      mensagem: "A história não especifica o perfil ('Como [quem]').",
    });
  }
  if (!story.what.trim()) {
    violacoes.push({
      criterio: "Template - Capacidade (what)",
      origem: "regra",
      mensagem:
        "A história não especifica a capacidade desejada ('eu quero [o quê]').",
    });
  }
  if (!story.why.trim()) {
    violacoes.push({
      criterio: "Template - Benefício (why)",
      origem: "regra",
      mensagem: "A história não especifica o benefício ('para [por quê]').",
    });
  }
  return violacoes;
}

// Regra 2: a capacidade parece conter mais de uma coisa? (Atomicidade)
function verificarAtomicidade(story: UserStory): Violation[] {
  const texto = story.what.toLowerCase();
  const encontrou = CONECTORES.find((c) => texto.includes(c));
  if (encontrou) {
    return [
      {
        criterio: "Atomicidade (Small)",
        origem: "regra",
        mensagem: `A capacidade contém '${encontrou.trim()}', indício de que pode ser dividida em duas histórias.`,
      },
    ];
  }
  return [];
}

// Regra 3: as partes têm conteúdo mínimo?
function verificarTamanho(story: UserStory): Violation[] {
  const violacoes: Violation[] = [];
  if (story.what.trim().length > 0 && story.what.trim().length < 5) {
    violacoes.push({
      criterio: "Tamanho mínimo",
      origem: "regra",
      mensagem: "A capacidade é curta demais para descrever algo concreto.",
    });
  }
  return violacoes;
}

// Regra 4: há termos vagos que ferem a testabilidade?
function verificarTermosVagos(story: UserStory): Violation[] {
  const texto = `${story.what} ${story.why}`;
  // Extrai palavras respeitando letras acentuadas (\p{L} = qualquer letra).
  const palavras = texto.match(/[\p{L}]+/gu) ?? [];

  const encontrados = new Set<string>();
  for (const palavra of palavras) {
    const norm = normalizar(palavra);
    const bateRadical = RADICAIS_VAGOS.some((r) => norm.startsWith(r));
    const bateExata = PALAVRAS_VAGAS_EXATAS.includes(norm);
    if (bateRadical || bateExata) {
      encontrados.add(palavra); // guarda a palavra original para a mensagem
    }
  }

  return [...encontrados].map((termo) => ({
    criterio: "Testabilidade (Testable)",
    origem: "regra" as const,
    mensagem: `O termo '${termo}' é vago e dificulta a verificação objetiva da história.`,
  }));
}

// Executa todas as regras e junta as violações.
export function aplicarRegras(story: UserStory): Violation[] {
  return [
    ...verificarTemplate(story),
    ...verificarAtomicidade(story),
    ...verificarTamanho(story),
    ...verificarTermosVagos(story),
  ];
}
