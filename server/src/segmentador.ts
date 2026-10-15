import { askOllama } from "./ollama.js";
import { limparStory } from "./historia.js";
import type { UserStory } from "./types.js";

export interface DemandaSegmentada {
  alvo: number | "nova";
  story: UserStory; // who = persona; responsavel = quem executa
  acceptanceCriteria: string[];
}

export interface CardExistente {
  id: number;
  who: string;
  what: string;
  why: string;
  responsavel: string;
}

function montarPrompt(trecho: string, existentes: CardExistente[]): string {
  const listaExistentes =
    existentes.length > 0
      ? existentes
          .map(
            (c) =>
              `- Card #${c.id}: como ${c.who || "?"}, eu quero ${c.what || "?"}${
                c.why ? `, para ${c.why}` : ""
              } (responsável: ${c.responsavel || "?"})`,
          )
          .join("\n")
      : "(nenhum card ainda)";

  return `Você é um assistente que escuta uma reunião ágil (daily ou refinamento) e mantém um backlog de user stories. O texto abaixo é a transcrição ACUMULADA da conversa (pode conter frases incompletas, repetições e conversa sem conteúdo de tarefa).

CARDS QUE JÁ EXISTEM NO BACKLOG:
${listaExistentes}

REGRAS PARA IDENTIFICAR AS DEMANDAS:
- IGNORE saudações e trechos sem conteúdo de tarefa ("bom dia", "vamos à daily", "é isso, obrigado", "então", etc.).
- Só considere uma demanda quando houver uma TAREFA concreta atribuída a alguém (criar, validar, revisar, configurar, corrigir, analisar algo).
- A transcrição pode ter cortado ou repetido frases; use o contexto de toda a conversa. NÃO crie um card por fragmento.
- Uma MESMA PESSOA pode ter VÁRIAS demandas DIFERENTES (tarefas sem relação entre si = cards separados).
- Detalhes ou requisitos de uma MESMA tarefa NÃO são cards separados: entram no card daquela tarefa (no what ou nos critérios de aceite). Se a frase só faz sentido como complemento de uma tarefa já citada, é DETALHE, não demanda nova.

COMO ESCREVER CADA USER STORY:
- persona: o TIPO DE USUÁRIO do sistema que se beneficia da demanda (ex.: "aluno", "coordenação", "cliente", "administrador"). Procure na fala quem se beneficia: em "para os alunos encontrarem o material", a persona é "aluno". NUNCA use o nome de uma pessoa da equipe como persona. Se a fala não permitir identificar o usuário, deixe vazio.
- responsavel: o NOME da pessoa da equipe que vai executar a tarefa (ex.: "Larissa"). Vazio se não for citado.
- what: o que a persona quer poder fazer, do ponto de vista dela, sempre que possível (ex.: "buscar livros por título e autor", em vez de "desenvolver a tela de busca"). Não comece com "eu quero".
- why: o benefício para a persona, SEM começar com a palavra "para" (ex.: "encontrar o material mais rápido"). Vazio se não houver.
- acceptanceCriteria: 1 a 3 critérios observáveis. NÃO invente números (tempos, percentuais, quantidades) que não foram ditos na reunião; quando um critério precisar de um limite que não foi dito, escreva "[definir valor]" no lugar do número.

Para cada demanda REAL, decida:
- Se corresponde a um card existente acima (mesma tarefa), use "alvo" com o número do card e reescreva a story enriquecida.
- Se é nova, use "alvo": "nova".

Transcrição acumulada: "${trecho}"

Responda APENAS com um array JSON válido, sem texto antes/depois e sem markdown:
[
  { "alvo": "nova", "persona": "", "responsavel": "", "what": "", "why": "", "acceptanceCriteria": [ "" ] }
]

Se não houver nenhuma demanda concreta, retorne []. Não invente. Escreva em português.`;
}

function extrairArrayJson(texto: string): string {
  const inicio = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (inicio === -1 || fim === -1) {
    throw new Error("O modelo não retornou um array JSON reconhecível.");
  }
  return texto.slice(inicio, fim + 1);
}

// Formato bruto devolvido pelo modelo. Aceita também o formato antigo
// ({ story: { who, what, why } }) por robustez.
interface ItemBruto {
  alvo?: number | string;
  persona?: string;
  responsavel?: string;
  what?: string;
  why?: string;
  story?: { who?: string; what?: string; why?: string };
  acceptanceCriteria?: unknown;
}

export async function segmentarDemandas(
  trecho: string,
  existentes: CardExistente[],
): Promise<DemandaSegmentada[]> {
  const respostaBruta = await askOllama(montarPrompt(trecho, existentes));
  const jsonLimpo = extrairArrayJson(respostaBruta);
  const parsed = JSON.parse(jsonLimpo) as ItemBruto[];

  const idsValidos = new Set(existentes.map((c) => c.id));

  return parsed
    .map((d) => {
      // Salvaguarda: só aceita como destino um id que exista na sessão.
      let alvo: number | "nova" = "nova";
      const n = typeof d.alvo === "number" ? d.alvo : Number(d.alvo);
      if (d.alvo !== "nova" && !Number.isNaN(n) && idsValidos.has(n)) alvo = n;

      const story = limparStory({
        who: d.persona ?? d.story?.who ?? "",
        what: d.what ?? d.story?.what ?? "",
        why: d.why ?? d.story?.why ?? "",
        responsavel: d.responsavel ?? "",
      });

      const acceptanceCriteria = Array.isArray(d.acceptanceCriteria)
        ? (d.acceptanceCriteria as unknown[])
            .map((c) => String(c ?? "").trim())
            .filter((c) => c.length > 0)
        : [];

      return { alvo, story, acceptanceCriteria };
    })
    .filter((d) => d.story.what || d.story.who || d.story.responsavel);
}
