// Consulta a análise sintática (spaCy) do serviço Python, na porta 5001.
// Usada pela regra de atomicidade para saber se um "e"/"ou" liga duas ações
// ou qualidades (sinalizar) ou substantivos (não sinalizar).

const URL_SINTAXE = "http://localhost:5001/coordenacao";
const TEMPO_LIMITE_MS = 3000;

export interface Coordenacao {
  conector: string; // "e" ou "ou"
  primeiro: string | null;
  segundo: string;
  classe: string; // classe gramatical do segundo termo (VERB, ADJ, NOUN...)
  sinalizar: boolean;
}

let avisouIndisponivel = false;

// Devolve as coordenações encontradas no texto, ou null se o serviço não
// responder. Com null, a regra de atomicidade usa o comportamento antigo.
export async function analisarCoordenacao(
  texto: string,
): Promise<Coordenacao[] | null> {
  if (!texto.trim()) return [];
  try {
    const resposta = await fetch(URL_SINTAXE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) throw new Error(`status ${resposta.status}`);
    const dados = (await resposta.json()) as { coordenacoes?: Coordenacao[] };
    return dados.coordenacoes ?? [];
  } catch (e) {
    if (!avisouIndisponivel) {
      console.warn(
        "[sintaxe] análise sintática indisponível; a regra de atomicidade usará o conector simples.",
        e instanceof Error ? e.message : e,
      );
      avisouIndisponivel = true;
    }
    return null;
  }
}
