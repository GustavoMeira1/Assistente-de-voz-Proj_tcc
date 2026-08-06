import { askOllama } from "./ollama.js";
import type { UserStory } from "./types.js";

// Uma demanda extraída de um trecho de conversa, já estruturada.
export interface DemandaExtraida {
  story: UserStory;
  acceptanceCriteria: string[];
}

// Monta o prompt que instrui o modelo a IDENTIFICAR e SEPARAR as demandas
// mencionadas num trecho de conversa de daily, estruturando cada uma.
function montarPromptSegmentacao(trecho: string): string {
  return `Você é um assistente que escuta reuniões de daily/planejamento ágil e transforma a conversa em user stories para o backlog.

A fala abaixo é um trecho de uma reunião onde as pessoas discutem demandas. Uma mesma fala pode conter VÁRIAS demandas diferentes, ou pode não conter nenhuma demanda clara.

Sua tarefa:
1. Identifique CADA demanda/tarefa distinta mencionada no trecho.
2. Para cada demanda, monte uma user story com:
   - who: a PESSOA responsável por executar a demanda (o nome citado, ex.: "Gustavo"). Se ninguém for citado, deixe vazio.
   - what: a capacidade/tarefa a ser feita (ex.: "criar um relatório de vendas").
   - why: o benefício ou para quem se destina, se mencionado (ex.: "para o Eduardo"). Se não houver, deixe vazio.
3. Para cada demanda, sugira de 1 a 3 critérios de aceite observáveis, quando fizer sentido.

Trecho da conversa: "${trecho}"

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown, exatamente neste formato:
[
  {
    "story": { "who": "", "what": "", "why": "" },
    "acceptanceCriteria": [ "" ]
  }
]

Se o trecho não contiver nenhuma demanda clara, retorne um array vazio: []. Não invente demandas que não foram ditas. Escreva tudo em português.`;
}

// Extrai o array JSON da resposta do modelo, descartando enfeites.
function extrairArrayJson(texto: string): string {
  const inicio = texto.indexOf("[");
  const fim = texto.lastIndexOf("]");
  if (inicio === -1 || fim === -1) {
    throw new Error("O modelo não retornou um array JSON reconhecível.");
  }
  return texto.slice(inicio, fim + 1);
}

// Recebe um trecho de conversa e devolve a lista de demandas estruturadas.
export async function segmentarDemandas(
  trecho: string,
): Promise<DemandaExtraida[]> {
  const respostaBruta = await askOllama(montarPromptSegmentacao(trecho));
  const jsonLimpo = extrairArrayJson(respostaBruta);

  const parsed = JSON.parse(jsonLimpo) as {
    story: { who: string; what: string; why: string };
    acceptanceCriteria: string[];
  }[];

  // Garante formato consistente e descarta itens sem conteúdo útil.
  return parsed
    .filter((d) => d.story && (d.story.what?.trim() || d.story.who?.trim()))
    .map((d) => ({
      story: {
        who: d.story.who ?? "",
        what: d.story.what ?? "",
        why: d.story.why ?? "",
      },
      acceptanceCriteria: Array.isArray(d.acceptanceCriteria)
        ? d.acceptanceCriteria
        : [],
    }));
}
