import { askOllama } from "./ollama.js";
import type { UserStory } from "./types.js";

export interface DemandaSegmentada {
  alvo: number | "nova";
  story: UserStory;
  acceptanceCriteria: string[];
}

export interface CardExistente {
  id: number;
  who: string;
  what: string;
  why: string;
}

function montarPrompt(trecho: string, existentes: CardExistente[]): string {
  const listaExistentes =
    existentes.length > 0
      ? existentes
          .map(
            (c) =>
              `- Card #${c.id}: como ${c.who || "?"}, ${c.what || "?"}${
                c.why ? `, para ${c.why}` : ""
              }`,
          )
          .join("\n")
      : "(nenhum card ainda)";

  return `Você é um assistente que escuta uma reunião de daily e mantém um backlog de user stories. O texto abaixo é a transcrição ACUMULADA da conversa até agora (pode conter frases incompletas, repetições e conversa fiada).

CARDS QUE JÁ EXISTEM NO BACKLOG:
${listaExistentes}

REGRAS IMPORTANTES:
- IGNORE saudações e conversa fiada ("bom dia", "vamos à daily", "é isso, obrigado", "então", etc.). Elas NÃO são demandas.
- Só considere uma demanda quando houver uma TAREFA concreta atribuída a alguém (ex.: criar, validar, revisar, configurar, analisar algo).
- A transcrição pode ter cortado ou repetido frases; use o contexto de toda a conversa. NÃO crie um card por fragmento — CONSOLIDE fragmentos da mesma demanda em um único card.
- Uma MESMA PESSOA pode ter VÁRIAS demandas DIFERENTES (tarefas sem relação entre si = cards separados). Ex.: se o Gustavo "cria um relatório" E "revisa o banco de dados", são DOIS cards.
- MAS detalhes/requisitos de uma MESMA tarefa NÃO são cards separados: eles fazem parte do card daquela tarefa. Ex.: "criar o relatório" + "o relatório deve incluir comparação com mês anterior" + "e ser exportável em PDF" = UM único card (criar o relatório, com esses detalhes no what). NÃO crie um card só para "incluir comparação" nem para "exportar em PDF" — isso é detalhe do relatório.
- Regra prática: se a frase só faz sentido como complemento de uma tarefa já citada, é DETALHE (mesmo card), não demanda nova.
- who = a PESSOA responsável por executar (quem "vai fazer"). NÃO confunda com o destinatário: em "criar relatório para o Eduardo", o who é quem cria, e "para o Eduardo" vai no why.

Para cada demanda REAL, decida:
- Se corresponde a um card existente acima (mesma tarefa), use "alvo" com o número do card e reescreva a story enriquecida.
- Se é nova, use "alvo": "nova".

E monte:
- who: pessoa responsável (vazio se não houver).
- what: a tarefa (sem "Como fulano"; apenas a ação).
- why: benefício ou destinatário, se houver (vazio se não houver).
- acceptanceCriteria: 1 a 3 critérios observáveis.

Transcrição acumulada: "${trecho}"

Responda APENAS com um array JSON válido, sem texto antes/depois e sem markdown:
[
  { "alvo": "nova", "story": { "who": "", "what": "", "why": "" }, "acceptanceCriteria": [ "" ] }
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

export async function segmentarDemandas(
  trecho: string,
  existentes: CardExistente[],
): Promise<DemandaSegmentada[]> {
  const respostaBruta = await askOllama(montarPrompt(trecho, existentes));
  const jsonLimpo = extrairArrayJson(respostaBruta);

  const parsed = JSON.parse(jsonLimpo) as {
    alvo: number | string;
    story: { who: string; what: string; why: string };
    acceptanceCriteria: string[];
  }[];

  const idsValidos = new Set(existentes.map((c) => c.id));

  return parsed
    .filter((d) => d.story && (d.story.what?.trim() || d.story.who?.trim()))
    .map((d) => {
      let alvo: number | "nova" = "nova";
      if (typeof d.alvo === "number" && idsValidos.has(d.alvo)) {
        alvo = d.alvo;
      } else if (typeof d.alvo === "string" && d.alvo !== "nova") {
        const n = Number(d.alvo);
        if (!Number.isNaN(n) && idsValidos.has(n)) alvo = n;
      }

      return {
        alvo,
        story: {
          who: d.story.who ?? "",
          what: d.story.what ?? "",
          why: d.story.why ?? "",
        },
        acceptanceCriteria: Array.isArray(d.acceptanceCriteria)
          ? d.acceptanceCriteria
          : [],
      };
    });
}
