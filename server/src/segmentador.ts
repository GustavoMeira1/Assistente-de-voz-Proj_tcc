import { askOllama } from "./ollama.js";
import { limparStory } from "./historia.js";
import {
  separarFalas,
  dividirEmTrechos,
  numerarUnidades,
  type Fala,
} from "./transcricao.js";
import type { UserStory } from "./types.js";

// A segmentação é feita em DUAS ETAPAS, porque um único prompt que precisava
// achar as demandas e, ao mesmo tempo, escrever cada história fazia o modelo
// de 7B perder demandas (sobretudo trabalho anunciado em primeira pessoa e
// tarefas lembradas no fim da reunião):
//   Etapa 1: lista as demandas, o responsável e as falas em que cada uma aparece.
//   Etapa 2: para cada demanda, escreve a user story usando só essas falas.
//
// IMPORTANTE: os prompts NÃO usam exemplos com valores concretos. O modelo
// copia exemplos para a resposta (primeiro copiou frases do roteiro de teste;
// depois, os de um domínio neutro). Por isso as instruções usam apenas modelos
// com marcadores entre < >, e a resposta é filtrada por marcadorParaVazio().

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

type Perguntar = (prompt: string) => Promise<string>;

interface DemandaEtapa1 {
  alvo: number | "nova";
  responsavel: string;
  tarefa: string;
  falas: number[]; // índices a partir de 1
}

// ---------- utilitários ----------

function marcadorParaVazio(valor: unknown): string {
  const v = String(valor ?? "").trim();
  return /[<>]/.test(v) ? "" : v;
}

function extrairJson(texto: string, abre: "[" | "{"): string {
  const fecha = abre === "[" ? "]" : "}";
  const inicio = texto.indexOf(abre);
  const fim = texto.lastIndexOf(fecha);
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error("O modelo não retornou um JSON reconhecível.");
  }
  return texto.slice(inicio, fim + 1);
}

function descreverCards(existentes: CardExistente[]): string {
  return existentes.length > 0
    ? existentes
        .map(
          (c) =>
            `- Card #${c.id}: como ${c.who || "?"}, eu quero ${c.what || "?"}${
              c.why ? `, para ${c.why}` : ""
            } (responsável: ${c.responsavel || "?"})`,
        )
        .join("\n")
    : "(nenhum card ainda)";
}

// ---------- etapa 1: segmentação ----------

function promptEtapa1(
  unidades: Fala[],
  comFalantes: boolean,
  existentes: CardExistente[],
): string {
  const rotulo = comFalantes ? "fala" : "trecho";
  const cabecalho = comFalantes
    ? "TRANSCRIÇÃO, dividida em falas numeradas, com o nome de quem falou:"
    : "TRANSCRIÇÃO, dividida em trechos numerados (ela não identifica quem fala; deduza pelo contexto, por exemplo pelo nome que o facilitador chama):";

  return `Você analisa a transcrição de uma reunião ágil (daily ou refinamento) e lista as DEMANDAS de trabalho discutidas. Nesta etapa, NÃO escreva user stories: apenas identifique cada demanda, quem vai executá-la e em quais ${rotulo}s ela aparece. A transcrição pode ter erros de reconhecimento de fala.

CARDS QUE JÁ EXISTEM NO BACKLOG:
${descreverCards(existentes)}

O QUE É UMA DEMANDA:
- Todo trabalho que alguém vai FAZER ou CONTINUAR fazendo a partir de agora é uma demanda, inclusive quando a própria pessoa anuncia em primeira pessoa: "hoje vou começar X", "sigo com X", "tô travado em X, hoje fico nisso", "vou configurar X". Nesses casos, o responsável é QUEM ESTÁ FALANDO.
- Quando alguém chama uma pessoa pelo nome ("<nome>?", "<nome>, consegue?"), a fala seguinte normalmente é dessa pessoa.
- Quando uma tarefa passa para outra pessoa ("então fica com <nome>"), o responsável é a ÚLTIMA pessoa designada.
- Quando alguém pede algo a um colega e o colega aceita, a demanda é do colega.
- Quando o facilitador diz "preciso que <nome> faça X", o responsável é <nome>, e não o facilitador.
- Pessoas citadas como ausentes (de férias, de folga) NÃO são responsáveis; a tarefa é de quem for designado no lugar delas.

O QUE NÃO É DEMANDA:
- Trabalho já concluído ("ontem terminei X").
- Tarefas canceladas ou adiadas ("pode esquecer", "adiamos", "não entra nessa sprint").
- Dúvidas, combinados de conversa ("depois falo com você"), avisos de agenda e saudações.

DETALHES:
- Um detalhe dito mais tarde, mesmo por outra pessoa, pertence à demanda original: inclua o número desse ${rotulo} na lista da demanda original. NÃO crie demanda nova para um detalhe.
- Tarefas sem relação entre si são demandas separadas, mesmo que sejam da mesma pessoa.

Percorra TODOS os ${rotulo}s, do primeiro ao último, antes de responder. Atenção ao FINAL da reunião: tarefas costumam ser lembradas e atribuídas na última fala.

${cabecalho}
${numerarUnidades(unidades, comFalantes)}

Para cada demanda, informe:
- "alvo": o número do card existente, se for a mesma tarefa; senão, "nova".
- "responsavel": o nome de quem vai executar (vazio se não for possível saber).
- "tarefa": uma frase curta com a tarefa, nas palavras da reunião.
- "falas": os números dos ${rotulo}s em que a demanda e seus detalhes aparecem.

Responda APENAS com um array JSON válido, sem texto antes ou depois e sem markdown:
[
  { "alvo": "nova", "responsavel": "", "tarefa": "", "falas": [ 0 ] }
]

Se não houver nenhuma demanda, retorne []. Escreva em português.`;
}

function lerEtapa1(
  resposta: string,
  totalUnidades: number,
  existentes: CardExistente[],
): DemandaEtapa1[] {
  const bruto = JSON.parse(extrairJson(resposta, "[")) as {
    alvo?: unknown;
    responsavel?: unknown;
    tarefa?: unknown;
    falas?: unknown;
  }[];
  const idsValidos = new Set(existentes.map((c) => c.id));

  return bruto
    .map((d) => {
      // Salvaguarda: só aceita como destino um id que exista na sessão.
      let alvo: number | "nova" = "nova";
      const n = typeof d.alvo === "number" ? d.alvo : Number(d.alvo);
      if (d.alvo !== "nova" && !Number.isNaN(n) && idsValidos.has(n)) alvo = n;

      const falas = Array.isArray(d.falas)
        ? [...new Set((d.falas as unknown[]).map((x) => Number(x)))]
            .filter((x) => Number.isInteger(x) && x >= 1 && x <= totalUnidades)
            .sort((a, b) => a - b)
        : [];

      return {
        alvo,
        responsavel: marcadorParaVazio(d.responsavel),
        tarefa: marcadorParaVazio(d.tarefa),
        falas,
      };
    })
    .filter((d) => d.tarefa.length > 0);
}

// ---------- etapa 2: escrita da user story ----------

function promptEtapa2(
  demanda: DemandaEtapa1,
  trechos: string,
  cardAtual: CardExistente | undefined,
): string {
  const atual = cardAtual
    ? `\nCARD ATUAL, que deve ser enriquecido com as novas informações: como ${cardAtual.who || "?"}, eu quero ${cardAtual.what || "?"}${cardAtual.why ? `, para ${cardAtual.why}` : ""}.\n`
    : "";

  return `Você escreve UMA user story a partir de trechos de uma reunião ágil. A transcrição pode ter erros de reconhecimento de fala.

TAREFA IDENTIFICADA: "${demanda.tarefa}" (responsável: ${demanda.responsavel || "não informado"})
${atual}
TRECHOS DA REUNIÃO SOBRE ESTA TAREFA:
${trechos}

COMO ESCREVER (use só o que foi dito nos trechos acima):
- persona: o tipo de pessoa que vai usar a funcionalidade ou que é afetada pelo problema, conforme mencionado nos trechos. Escreva só o substantivo que designa esse tipo de usuário, no singular e sem artigo. Nunca use o nome de uma pessoa da equipe nem o nome de uma equipe. Se nenhum trecho mencionar quem usa ou quem é afetado, deixe vazio.
- what: uma ação que a persona realiza no sistema, começando por um verbo no infinitivo, incluindo os detalhes ditos nos trechos. Não descreva o problema, não repita a fala e não comece com "eu quero".
- why: o resultado que a persona quer obter, somente se ele for dito nos trechos (em geral aparece depois de "para", "pra" ou "porque"). Comece por um verbo no infinitivo e não comece com a palavra "para". Se os trechos não disserem para que serve, deixe vazio. Não escreva benefícios genéricos.
- acceptanceCriteria: de 1 a 3 critérios observáveis, apenas com fatos ditos nos trechos. Prefira menos critérios a inventar. Cada detalhe dito nos trechos deve aparecer em algum critério. Não acrescente canais, formatos, frequências, tecnologias ou comportamentos que ninguém pediu, e não escreva critérios sobre a organização do trabalho da equipe (quem faz, quando faz, quem avisar). Não invente números; quando um critério precisar de um limite que não foi dito, escreva "[definir valor]" no lugar do número.

Responda APENAS com um objeto JSON válido, sem texto antes ou depois e sem markdown:
{ "persona": "", "what": "", "why": "", "acceptanceCriteria": [ "" ] }

Escreva em português.`;
}

async function escreverHistoria(
  demanda: DemandaEtapa1,
  unidades: Fala[],
  comFalantes: boolean,
  existentes: CardExistente[],
  perguntar: Perguntar,
): Promise<DemandaSegmentada> {
  // Usa só as falas apontadas na etapa 1; sem indicação, usa a reunião inteira.
  const selecionadas =
    demanda.falas.length > 0
      ? demanda.falas.map((i) => ({ indice: i, fala: unidades[i - 1] }))
      : unidades.map((fala, i) => ({ indice: i + 1, fala }));
  const trechos = selecionadas
    .map(({ indice, fala }) =>
      comFalantes
        ? `Fala ${indice} — ${fala.falante || "(sem nome)"}: ${fala.texto}`
        : `Trecho ${indice}: ${fala.texto}`,
    )
    .join("\n");

  const cardAtual =
    demanda.alvo === "nova" ? undefined : existentes.find((c) => c.id === demanda.alvo);

  let persona = "";
  let what = "";
  let why = "";
  let criterios: string[] = [];
  try {
    const resposta = await perguntar(promptEtapa2(demanda, trechos, cardAtual));
    const obj = JSON.parse(extrairJson(resposta, "{")) as {
      persona?: unknown;
      what?: unknown;
      why?: unknown;
      acceptanceCriteria?: unknown;
    };
    persona = marcadorParaVazio(obj.persona);
    what = marcadorParaVazio(obj.what);
    why = marcadorParaVazio(obj.why);
    criterios = Array.isArray(obj.acceptanceCriteria)
      ? (obj.acceptanceCriteria as unknown[])
          .map((c) => marcadorParaVazio(c))
          .filter((c) => c.length > 0)
      : [];
  } catch (e) {
    // Se a etapa 2 falhar, a demanda não se perde: a tarefa da etapa 1 vira a
    // capacidade, e as regras sinalizam os campos vazios.
    console.error(`[segmentação] etapa 2 falhou para "${demanda.tarefa}":`, e);
  }

  const story = limparStory({
    who: persona,
    what: what || demanda.tarefa,
    why,
    responsavel: demanda.responsavel,
  });
  return { alvo: demanda.alvo, story, acceptanceCriteria: criterios };
}

// ---------- função principal ----------

export async function segmentarDemandas(
  trecho: string,
  existentes: CardExistente[],
  perguntar: Perguntar = askOllama,
): Promise<DemandaSegmentada[]> {
  const { temFalantes, falas } = separarFalas(trecho);
  const unidades = temFalantes ? falas : dividirEmTrechos(trecho);
  if (unidades.length === 0) return [];

  const respostaEtapa1 = await perguntar(promptEtapa1(unidades, temFalantes, existentes));
  const demandas = lerEtapa1(respostaEtapa1, unidades.length, existentes);
  console.log(
    `[segmentação] etapa 1: ${demandas.length} demanda(s)\n` +
      demandas
        .map((d) => `  - ${d.responsavel || "?"}: ${d.tarefa} (${temFalantes ? "falas" : "trechos"} ${d.falas.join(", ") || "?"})`)
        .join("\n"),
  );

  // Etapa 2 em sequência: o Ollama atende uma requisição por vez.
  const resultado: DemandaSegmentada[] = [];
  for (const d of demandas) {
    resultado.push(await escreverHistoria(d, unidades, temFalantes, existentes, perguntar));
  }
  return resultado;
}
