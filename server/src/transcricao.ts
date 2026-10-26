// Reconhece transcrições em que cada fala vem identificada pelo nome de quem
// falou, como as exportadas por ferramentas de reunião (Meet, Teams).
// Formatos aceitos, um por linha:
//   [Ana] Hoje vou começar a tela de estoque.
//   Ana: Hoje vou começar a tela de estoque.
//   <v Ana>Hoje vou começar a tela de estoque.</v>   (legenda .vtt do Teams)
// Também separa um texto corrido com os nomes entre colchetes no meio
// ("[Ana] Bom dia. [Paulo] Bom dia..."). Se nenhum formato for reconhecido,
// o texto segue como veio (é o caso do ditado pelo microfone).

export interface Fala {
  falante: string;
  texto: string;
}

export interface ResultadoFalas {
  temFalantes: boolean;
  falas: Fala[];
}

const COLCHETES = /^\s*\[([^\]\n]{1,40})\]\s*:?\s*(.*)$/u;
const VTT = /^\s*<v\s+([^>\n]{1,40})>(.*?)(?:<\/v>)?\s*$/u;
// "Nome: fala": nome com até 4 palavras e inicial maiúscula. Exige espaço após
// os dois-pontos, o que evita confundir horários como "10:30".
const DOIS_PONTOS = /^\s*(\p{Lu}[\p{L}'.-]*(?:\s+[\p{L}'.-]+){0,3})\s*:\s+(.+)$/u;

// Linhas de metadados de arquivos .vtt, que não são falas.
function ehMetadado(linha: string): boolean {
  const l = linha.trim();
  return (
    l === "WEBVTT" ||
    /^NOTE\b/.test(l) ||
    /^\d+$/.test(l) ||
    /^\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\s*-->/.test(l)
  );
}

function limparFalante(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

// Texto corrido com dois ou mais "[Nome]" no meio: quebra antes de cada nome.
function quebrarColchetesEmLinha(texto: string): string {
  const ocorrencias = texto.match(/\[[^\]\n]{1,40}\]/g) ?? [];
  if (ocorrencias.length < 2) return texto;
  return texto.replace(/\s*(\[[^\]\n]{1,40}\])/g, "\n$1");
}

export function separarFalas(textoOriginal: string): ResultadoFalas {
  const texto = quebrarColchetesEmLinha(textoOriginal ?? "");
  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !ehMetadado(l));

  const falas: Fala[] = [];
  let reconhecidas = 0;

  for (const linha of linhas) {
    const m = linha.match(COLCHETES) ?? linha.match(VTT) ?? linha.match(DOIS_PONTOS);
    if (m) {
      reconhecidas++;
      const falante = limparFalante(m[1]);
      const fala = (m[2] ?? "").replace(/<\/v>\s*$/, "").trim();
      // Falas seguidas da mesma pessoa viram uma só.
      const anterior = falas[falas.length - 1];
      if (anterior && anterior.falante === falante) {
        anterior.texto = `${anterior.texto} ${fala}`.trim();
      } else {
        falas.push({ falante, texto: fala });
      }
    } else if (falas.length > 0) {
      // Linha sem nome: continuação da fala anterior.
      const anterior = falas[falas.length - 1];
      anterior.texto = `${anterior.texto} ${linha}`.trim();
    } else {
      falas.push({ falante: "", texto: linha });
    }
  }

  // Só considera que há falantes quando a maioria das linhas segue o padrão.
  const temFalantes =
    reconhecidas >= 2 && reconhecidas / Math.max(linhas.length, 1) > 0.5;

  if (!temFalantes) {
    return { temFalantes: false, falas: [{ falante: "", texto: textoOriginal.trim() }] };
  }
  return { temFalantes: true, falas: falas.filter((f) => f.texto.length > 0) };
}

// Formata as falas numeradas para o prompt: "Fala 3 — Ana: texto".
export function formatarFalas(falas: Fala[]): string {
  return falas
    .map((f, i) => `Fala ${i + 1} — ${f.falante || "(sem nome)"}: ${f.texto}`)
    .join("\n");
}

// Divide um texto sem identificação de falantes (ex.: ditado pelo microfone)
// em trechos numeráveis, uma frase por trecho, para que o modelo possa indicar
// em quais trechos cada demanda aparece.
export function dividirEmTrechos(texto: string): Fala[] {
  return (texto ?? "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => ({ falante: "", texto: t }));
}

// Numera falas ou trechos para os prompts.
// Com falantes: "Fala 3 — Ana: texto". Sem falantes: "Trecho 3: texto".
export function numerarUnidades(unidades: Fala[], comFalantes: boolean): string {
  return unidades
    .map((u, i) =>
      comFalantes
        ? `Fala ${i + 1} — ${u.falante || "(sem nome)"}: ${u.texto}`
        : `Trecho ${i + 1}: ${u.texto}`,
    )
    .join("\n");
}
