import { askOllama } from "./ollama.js";
import type { UserStory } from "./types.js";

// Uma demanda extraída de um trecho, com a decisão de criar ou atualizar.
export interface DemandaSegmentada {
  // "nova" = criar card; ou o id de um card existente para atualizar.
  alvo: number | "nova";
  story: UserStory;
  acceptanceCriteria: string[];
}

// Resumo de um card já existente, enviado ao LLM para ele decidir a mesclagem.
export interface CardExistente {
  id: number;
  who: string;
  what: string;
  why: string;
}

// Monta o prompt de segmentação COM contexto dos cards já existentes.
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

  return `Você é um assistente que escuta reuniões de daily e mantém um backlog de user stories.

CARDS QUE JÁ EXISTEM NO BACKLOG:
${listaExistentes}

Chegou um novo trecho da conversa. Sua tarefa:
1. Identifique CADA demanda/tarefa distinta mencionada no trecho.
2. Para cada demanda, decida:
   - Se ela se refere a um card que JÁ existe acima (mesma pessoa e mesma tarefa, apenas com mais detalhes), marque "alvo" com o número daquele card e reescreva a story JÁ ENRIQUECIDA (combinando o que o card tinha com o detalhe novo).
   - Se for uma demanda NOVA, marque "alvo" como "nova".
3. Para cada demanda, monte a story:
   - who: a PESSOA responsável (nome citado). Vazio se não houver.
   - what: a capacidade/tarefa.
   - why: o benefício ou destinatário, se houver. Vazio se não houver.
4. Sugira de 1 a 3 critérios de aceite observáveis por demanda.

Trecho novo: "${trecho}"

Responda APENAS com um array JSON válido, sem texto antes/depois e sem markdown, neste formato:
[
  {
    "alvo": "nova",
    "story": { "who": "", "what": "", "why": "" },
    "acceptanceCriteria": [ "" ]
  }
]

Use o número do card (ex.: "alvo": 3) quando for atualização, ou "nova" quando for demanda nova. Se o trecho não tiver demanda clara, retorne []. Não invente. Escreva em português.`;
}

function extrairArrayJson(texto: string): string {
  const inicio = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (inicio === -1 || fim === -1) {
    throw new Error("O modelo não retornou um array JSON reconhecível.");
  }
  return texto.slice(inicio, fim + 1);
}

// Segmenta o trecho considerando os cards existentes, devolvendo as decisões.
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

  // Conjunto de ids válidos, para validar o "alvo" retornado pelo LLM.
  const idsValidos = new Set(existentes.map((c) => c.id));

  return parsed
    .filter((d) => d.story && (d.story.what?.trim() || d.story.who?.trim()))
    .map((d) => {
      // Normaliza o alvo: só aceita id que realmente existe; senão, vira "nova".
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
