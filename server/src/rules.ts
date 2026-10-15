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
      mensagem:
        "A história não especifica a persona ('Como [tipo de usuário]').",
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

// Papéis genéricos de usuário que podem aparecer com inicial maiúscula sem
// serem nomes de pessoas (comparados sem acento e em minúsculas).
const PAPEIS_GENERICOS = [
  "usuario", "usuaria", "usuarios", "cliente", "clientes", "aluno", "aluna",
  "alunos", "estudante", "estudantes", "professor", "professora", "gerente",
  "gestor", "gestora", "administrador", "administradora", "coordenador",
  "coordenadora", "coordenacao", "visitante", "comprador", "vendedor",
  "paciente", "medico", "medica", "atendente", "operador", "operadora",
  "funcionario", "funcionaria", "colaborador", "colaboradora", "leitor",
  "leitora", "bibliotecario", "bibliotecaria", "secretaria", "diretor",
  "diretora", "desenvolvedor", "analista", "equipe", "time",
];

// Regra 5: o papel parece ser uma pessoa da equipe, e não um tipo de usuário?
// No QUS, o papel de uma user story deve ser um tipo de usuário do sistema.
// Usar o nome de quem executa a tarefa a transforma em tarefa atribuída.
// Heurística: (a) o papel coincide com o responsável; ou (b) o papel tem até
// três palavras, todas com inicial maiúscula, e não é um papel genérico.
function verificarPapelNomeProprio(story: UserStory): Violation[] {
  const papel = story.who.trim();
  if (!papel) return []; // ausência já é tratada pela regra de template

  const responsavel = (story.responsavel ?? "").trim();
  const igualAoResponsavel =
    responsavel.length > 0 && normalizar(papel) === normalizar(responsavel);

  const palavras = papel.split(/\s+/);
  const pareceNome =
    palavras.length <= 3 &&
    palavras.every((p) => /^\p{Lu}/u.test(p)) &&
    !PAPEIS_GENERICOS.includes(normalizar(palavras[0]));

  if (igualAoResponsavel || pareceNome) {
    return [
      {
        criterio: "Papel - Nome de pessoa (QUS: bem formada)",
        origem: "regra",
        mensagem: `O papel '${papel}' parece ser uma pessoa da equipe, e não um tipo de usuário do sistema. Quem executa a tarefa deve ir no campo Responsável.`,
      },
    ];
  }
  return [];
}

// Executa todas as regras e junta as violações.
export function aplicarRegras(story: UserStory): Violation[] {
  return [
    ...verificarTemplate(story),
    ...verificarAtomicidade(story),
    ...verificarTamanho(story),
    ...verificarTermosVagos(story),
    ...verificarPapelNomeProprio(story),
  ];
}
