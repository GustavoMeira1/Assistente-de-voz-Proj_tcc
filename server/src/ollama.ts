import { limparStory } from "./historia.js";
import type { LlmAnalysis } from "./types.js";

// Endereço padrão da API local do Ollama.
const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";

// Janela de contexto pedida ao Ollama, em tokens. Sem esse valor, o Ollama usa
// uma janela padrão definida pela memória da GPU (4096 nesta máquina), que uma
// reunião longa pode ultrapassar. O modelo suporta até 32768.
const NUM_CTX = 8192;

// Envia um prompt ao modelo e retorna o texto da resposta.
// Os parâmetros de amostragem (temperatura etc.) são os padrões do Ollama.
export async function askOllama(prompt: string): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      stream: false, // resposta de uma vez só, não em pedaços
      options: { num_ctx: NUM_CTX },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama respondeu com status ${response.status}`);
  }

  const data = (await response.json()) as { response: string };
  return data.response;
}

// Monta o prompt que instrui o modelo a analisar a história e responder em JSON.
function montarPromptAnalise(fraseUsuario: string): string {
  return `Você é um assistente especialista em metodologias ágeis que ajuda a refinar user stories segundo os critérios INVEST e QUS.

Analise a frase do usuário abaixo e faça o seguinte:
1. Decomponha a frase em:
   - persona: o tipo de pessoa que vai usar a funcionalidade ou que é afetada pelo problema, conforme mencionado na frase. Escreva só o substantivo, no singular e sem artigo. Nunca o nome de uma pessoa da equipe. Se a frase não mencionar um usuário, deixe vazio.
   - responsavel: o nome da pessoa da equipe que vai executar, se for citado.
   - what: o que a persona quer poder fazer (sem começar com "eu quero").
   - why: o benefício dito na frase, SEM começar com a palavra "para". Se a frase não disser para que serve, deixe vazio.
   Se alguma parte não existir na frase, deixe a string vazia. NÃO invente conteúdo que o usuário não disse.
2. Aponte problemas SEMÂNTICOS (não sintáticos), como: o benefício apenas repete a capacidade; o benefício não é um valor real; a história é ambígua; a capacidade não é testável na prática; o papel é uma pessoa e não um tipo de usuário.
3. Sugira de 1 a 3 critérios de aceite observáveis e testáveis. NÃO invente números (tempos, percentuais, quantidades) que não estejam na frase; quando um critério precisar de um limite não informado, escreva "[definir valor]" no lugar do número.

Frase do usuário: "${fraseUsuario}"

Responda APENAS com um objeto JSON válido, sem nenhum texto antes ou depois, sem markdown, exatamente neste formato:
{
  "persona": "", "responsavel": "", "what": "", "why": "",
  "violations": [ { "criterio": "", "mensagem": "" } ],
  "acceptanceCriteria": [ "" ]
}

Se não houver problemas semânticos, retorne "violations": []. Use só o que foi dito na frase. Escreva tudo em português.`;
}

// Remove cercas de markdown e texto extra, deixando só o JSON.
function extrairJson(texto: string): string {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio === -1 || fim === -1) {
    throw new Error("O modelo não retornou um JSON reconhecível.");
  }
  return texto.slice(inicio, fim + 1);
}

// Envia a frase ao modelo e devolve a análise já estruturada.
export async function analisarComLlm(
  fraseUsuario: string,
): Promise<LlmAnalysis> {
  const respostaBruta = await askOllama(montarPromptAnalise(fraseUsuario));
  const jsonLimpo = extrairJson(respostaBruta);

  // Aceita o formato novo e, por robustez, o antigo ({ story: {...} }).
  const parsed = JSON.parse(jsonLimpo) as {
    persona?: string;
    responsavel?: string;
    what?: string;
    why?: string;
    story?: { who?: string; what?: string; why?: string };
    violations?: { criterio: string; mensagem: string }[];
    acceptanceCriteria?: string[];
  };

  // Se o modelo devolver o próprio marcador do prompt (ex.: "<usuário>"), o
  // campo fica vazio.
  const semMarcador = (v?: string) => {
    const t = (v ?? "").trim();
    return /[<>]/.test(t) ? "" : t;
  };
  const story = limparStory({
    who: semMarcador(parsed.persona ?? parsed.story?.who),
    what: semMarcador(parsed.what ?? parsed.story?.what),
    why: semMarcador(parsed.why ?? parsed.story?.why),
    responsavel: semMarcador(parsed.responsavel),
  });

  // Marca cada violação do LLM com origem "llm" (as regras marcam "regra").
  return {
    story,
    violations: (parsed.violations ?? [])
      .filter((v) => v && (v.criterio || v.mensagem))
      .map((v) => ({
        criterio: v.criterio,
        origem: "llm" as const,
        mensagem: v.mensagem,
      })),
    acceptanceCriteria: (parsed.acceptanceCriteria ?? [])
      .map((c) => String(c ?? "").trim())
      .filter((c) => c.length > 0),
  };
}
