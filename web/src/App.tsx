import { useState } from "react";
import { useGravador } from "./useGravador";
import { useFala } from "./useFala";

interface UserStory {
  who: string;
  what: string;
  why: string;
}

interface Violation {
  criterio: string;
  origem: "regra" | "llm";
  mensagem: string;
}

interface RefineResult {
  story: UserStory;
  violations: Violation[];
  acceptanceCriteria: string[];
}

// Texto falado do bloco da história (who/what/why por extenso).
function falaDaHistoria(r: RefineResult): string {
  const partes: string[] = [];
  if (r.story.who) partes.push(`Como ${r.story.who}`);
  if (r.story.what) partes.push(`eu quero ${r.story.what}`);
  if (r.story.why) partes.push(`para ${r.story.why}`);
  return partes.length ? partes.join(", ") + "." : "A história está vazia.";
}

// Texto falado do bloco de pontos de atenção (lê todos).
function falaDasViolacoes(r: RefineResult): string {
  const n = r.violations.length;
  if (n === 0) return "Nenhum ponto de atenção encontrado.";
  const intro = n === 1 ? "Um ponto de atenção." : `${n} pontos de atenção.`;
  const itens = r.violations
    .map((v, i) => `${i + 1}. ${v.criterio}. ${v.mensagem}`)
    .join(" ");
  return `${intro} ${itens}`;
}

// Texto falado do bloco de critérios de aceite (lê todos).
function falaDosCriterios(r: RefineResult): string {
  const n = r.acceptanceCriteria.length;
  if (n === 0) return "Nenhum critério de aceite sugerido.";
  const intro =
    n === 1 ? "Um critério de aceite." : `${n} critérios de aceite.`;
  const itens = r.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join(" ");
  return `${intro} ${itens}`;
}

// Botão de áudio de um bloco: toca, pausa e retoma a leitura daquele bloco.
function BotaoAudio({
  id,
  texto,
  fala,
}: {
  id: string;
  texto: string;
  fala: ReturnType<typeof useFala>;
}) {
  const ativo = fala.blocoAtivo === id;

  function aoClicar() {
    if (ativo && !fala.pausado) {
      fala.pausar();
    } else if (ativo && fala.pausado) {
      fala.retomar();
    } else {
      fala.falar(texto, id);
    }
  }

  // Rótulo muda conforme o estado deste bloco.
  let rotulo = "▶ Ouvir";
  if (ativo && !fala.pausado) rotulo = "⏸ Pausar";
  else if (ativo && fala.pausado) rotulo = "▶ Retomar";

  return (
    <button className="audio-btn" onClick={aoClicar}>
      {rotulo}
    </button>
  );
}

export default function App() {
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<RefineResult | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fala = useFala();

  const { gravando, transcrevendo, iniciar, pararEEnviar } = useGravador();

  // Alterna entre iniciar e parar a gravação. Ao parar, o texto transcrito
  // cai no mesmo campo de texto que você já usa para digitar.
  async function alternarGravacao() {
    setErro(null);
    try {
      if (gravando) {
        const textoTranscrito = await pararEEnviar();
        setTexto(textoTranscrito);
        // Encadeia: assim que transcreve, já analisa — sem clique extra.
        if (textoTranscrito.trim()) {
          await analisar(textoTranscrito);
        }
      } else {
        await iniciar();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro no microfone");
    }
  }

  async function analisar(textoParaAnalisar?: string) {
    const alvo = textoParaAnalisar ?? texto;
    if (!alvo.trim()) return;
    setCarregando(true);
    setErro(null);
    setResultado(null);
    try {
      const resp = await fetch("http://localhost:3333/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: alvo }),
      });
      if (!resp.ok) throw new Error(`servidor respondeu ${resp.status}`);
      const dados: RefineResult = await resp.json();
      setResultado(dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="mark">US</span>
        <div>
          <h1>Assistente de Refinement</h1>
          <p className="sub">Facilitação de user stories com INVEST + QUS</p>
        </div>
      </header>

      <section className="composer">
        <label htmlFor="entrada">Descreva a história em uma frase</label>
        <textarea
          id="entrada"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: Como gerente eu quero exportar relatórios para acompanhar a equipe"
          rows={3}
        />
        <div className="botoes">
          <button
            className={gravando ? "mic gravando" : "mic"}
            onClick={alternarGravacao}
            disabled={transcrevendo || carregando}
          >
            {gravando ? "● Parar e transcrever" : "🎤 Gravar"}
          </button>
          <button
            onClick={() => analisar()}
            disabled={carregando || !texto.trim()}
          >
            {carregando ? "Analisando…" : "Analisar história"}
          </button>
        </div>
        {transcrevendo && <p className="dica">Transcrevendo o áudio…</p>}
        {erro && <p className="erro">Não foi possível analisar: {erro}</p>}
      </section>

      {resultado && (
        <section className="resultado">
          <div className="story-card">
            <div className="bloco-topo">
              <span className="bloco-titulo">História</span>
              <BotaoAudio
                id="historia"
                texto={falaDaHistoria(resultado)}
                fala={fala}
              />
            </div>
            <div className="story-part">
              <span className="rotulo">Como</span>
              <span className="valor">{resultado.story.who || "—"}</span>
            </div>
            <div className="story-part">
              <span className="rotulo">eu quero</span>
              <span className="valor">{resultado.story.what || "—"}</span>
            </div>
            <div className="story-part">
              <span className="rotulo">para</span>
              <span className="valor">{resultado.story.why || "—"}</span>
            </div>
          </div>

          <div className="painel">
            <h2>
              Pontos de atenção
              <span className="contagem">{resultado.violations.length}</span>
              <BotaoAudio
                id="violacoes"
                texto={falaDasViolacoes(resultado)}
                fala={fala}
              />
            </h2>
            {resultado.violations.length === 0 ? (
              <p className="vazio">Nenhuma violação detectada.</p>
            ) : (
              <ul className="lista-violacoes">
                {resultado.violations.map((v, i) => (
                  <li key={i} className={`violacao origem-${v.origem}`}>
                    <div className="violacao-topo">
                      <span className="criterio">{v.criterio}</span>
                      <span className={`tag tag-${v.origem}`}>
                        {v.origem === "regra" ? "regra" : "IA"}
                      </span>
                    </div>
                    <p className="mensagem">{v.mensagem}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="painel">
            <h2>
              Critérios de aceite sugeridos
              <BotaoAudio
                id="criterios"
                texto={falaDosCriterios(resultado)}
                fala={fala}
              />
            </h2>
            {resultado.acceptanceCriteria.length === 0 ? (
              <p className="vazio">Nenhum critério sugerido.</p>
            ) : (
              <ul className="lista-criterios">
                {resultado.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
