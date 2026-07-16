// Endereço padrão da API local do Ollama.
const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";

// Envia um prompt ao modelo e retorna o texto da resposta.
export async function askOllama(prompt: string): Promise<string> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      stream: false, // resposta de uma vez só, não em pedaços
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama respondeu com status ${response.status}`);
  }

  const data = (await response.json()) as { response: string };
  return data.response;
}

import type { LlmAnalysis } from "./types.js";

// Monta o prompt que instrui o modelo a analisar a história e responder em JSON.
function montarPromptAnalise(fraseUsuario: string): string {
  return `Você é um assistente especialista em metodologias ágeis que ajuda a refinar user stories segundo os critérios INVEST e QUS.

Analise a frase do usuário abaixo e faça o seguinte:
1. Decomponha em who (perfil), what (capacidade) e why (benefício). Se alguma parte não existir na frase, deixe a string vazia. NÃO invente conteúdo que o usuário não disse.
2. Aponte problemas SEMÂNTICOS (não sintáticos), como: o benefício apenas repete a capacidade; o benefício não é um valor real; a história é ambígua; a capacidade não é testável na prática.
3. Sugira de 1 a 3 critérios de aceite observáveis e testáveis.

Frase do usuário: "${fraseUsuario}"

Responda APENAS com um objeto JSON válido, sem nenhum texto antes ou depois, sem markdown, exatamente neste formato:
{
  "story": { "who": "", "what": "", "why": "" },
  "violations": [ { "criterio": "", "mensagem": "" } ],
  "acceptanceCriteria": [ "" ]
}

Se não houver problemas semânticos, retorne "violations": []. Escreva tudo em português.`;
}

// Remove cercas de markdown e texto extra, deixando só o JSON.
function extrairJson(texto: string): string {
  // Pega do primeiro "{" até o último "}", descartando qualquer enfeite.
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

  const parsed = JSON.parse(jsonLimpo) as {
    story: { who: string; what: string; why: string };
    violations: { criterio: string; mensagem: string }[];
    acceptanceCriteria: string[];
  };

  // Marca cada violação do LLM com origem "llm" (as regras marcam "regra").
  return {
    story: parsed.story,
    violations: parsed.violations.map((v) => ({
      criterio: v.criterio,
      origem: "llm" as const,
      mensagem: v.mensagem,
    })),
    acceptanceCriteria: parsed.acceptanceCriteria,
  };
}
