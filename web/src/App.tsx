import { useState, useEffect } from "react";
import { useGravador } from "./useGravador";
import { useFala } from "./useFala";
import { Backlog } from "./Backlog";

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
  storyId?: number;
  story: UserStory;
  violations: Violation[];
  acceptanceCriteria: string[];
  condicao?: string;
}

// Uma história extraída da daily (mesmo formato de RefineResult, sem condicao).
interface HistoriaDaily {
  storyId: number;
  story: UserStory;
  violations: Violation[];
  acceptanceCriteria: string[];
}

interface VersaoBanco {
  id: number;
  entrada_original: string;
  who: string;
  what: string;
  why: string;
  violacoes_json: string;
  criterios_json: string;
}

function falaDaHistoria(r: RefineResult): string {
  const partes: string[] = [];
  if (r.story.who) partes.push(`Como ${r.story.who}`);
  if (r.story.what) partes.push(`eu quero ${r.story.what}`);
  if (r.story.why) partes.push(`para ${r.story.why}`);
  return partes.length ? partes.join(", ") + "." : "A história está vazia.";
}

function falaDasViolacoes(r: RefineResult): string {
  const n = r.violations.length;
  if (n === 0) return "Nenhum ponto de atenção encontrado.";
  const intro = n === 1 ? "Um ponto de atenção." : `${n} pontos de atenção.`;
  const itens = r.violations
    .map((v, i) => `${i + 1}. ${v.criterio}. ${v.mensagem}`)
    .join(" ");
  return `${intro} ${itens}`;
}

function falaDosCriterios(r: RefineResult): string {
  const n = r.acceptanceCriteria.length;
  if (n === 0) return "Nenhum critério de aceite sugerido.";
  const intro =
    n === 1 ? "Um critério de aceite." : `${n} critérios de aceite.`;
  const itens = r.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join(" ");
  return `${intro} ${itens}`;
}

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
    if (ativo && !fala.pausado) fala.pausar();
    else if (ativo && fala.pausado) fala.retomar();
    else fala.falar(texto, id);
  }
  let rotulo = "▶ Ouvir";
  if (ativo && !fala.pausado) rotulo = "⏸ Pausar";
  else if (ativo && fala.pausado) rotulo = "▶ Retomar";
  return (
    <button className="audio-btn" onClick={aoClicar}>
      {rotulo}
    </button>
  );
}

// Card compacto para exibir cada história extraída da daily.
function CardDaily({ h }: { h: HistoriaDaily }) {
  return (
    <div className="card-daily">
      <div className="card-daily-story">
        <span className="mini-rotulo">Como</span> {h.story.who || "—"}{" "}
        <span className="mini-rotulo">quero</span> {h.story.what || "—"}{" "}
        {h.story.why && (
          <>
            <span className="mini-rotulo">para</span> {h.story.why}
          </>
        )}
      </div>
      <div className="card-daily-meta">
        <span className="card-daily-id">#{h.storyId}</span>
        {h.violations.length > 0 && (
          <span className="card-daily-viol">
            {h.violations.length} ponto(s) de atenção
          </span>
        )}
        {h.acceptanceCriteria.length > 0 && (
          <span className="card-daily-crit">
            {h.acceptanceCriteria.length} critério(s)
          </span>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // Modo de trabalho: 'daily' (extrai várias) ou 'individual' (refina uma).
  const [modo, setModo] = useState<"daily" | "individual">("daily");

  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<RefineResult | null>(null);
  const [historiasDaily, setHistoriasDaily] = useState<HistoriaDaily[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<number | null>(null);
  const [recarregarBacklog, setRecarregarBacklog] = useState(0);
  const [vendoSalva, setVendoSalva] = useState(false);

  // Sessão de experimento.
  const [participante, setParticipante] = useState("");
  const [condicao, setCondicao] = useState<"com_assistente" | "sem_assistente">(
    "com_assistente",
  );
  const [sessaoAtiva, setSessaoAtiva] = useState<{
    participante: string;
    condicao: string;
  } | null>(null);

  const { gravando, transcrevendo, iniciar, pararEEnviar } = useGravador();
  const fala = useFala();

  const comAssistente = sessaoAtiva?.condicao !== "sem_assistente";

  useEffect(() => {
    fetch("http://localhost:3333/session/current")
      .then((r) => r.json())
      .then((d) => {
        if (d.sessao) {
          setSessaoAtiva({
            participante: d.sessao.participante ?? "?",
            condicao: d.sessao.condicao,
          });
        }
      })
      .catch(() => {});
  }, []);

  async function iniciarSessao() {
    if (!participante.trim()) {
      setErro("Informe o identificador do participante.");
      return;
    }
    try {
      const resp = await fetch("http://localhost:3333/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participante, condicao }),
      });
      const d = await resp.json();
      setSessaoAtiva({ participante: d.participante, condicao: d.condicao });
      setTexto("");
      setResultado(null);
      setHistoriasDaily([]);
      setStoryId(null);
      setVendoSalva(false);
      setErro(null);
      setRecarregarBacklog((n) => n + 1);
    } catch {
      setErro("Não foi possível iniciar a sessão.");
    }
  }

  // MODO DAILY: extrai várias histórias de um trecho de conversa.
  async function processarDaily(textoParaProcessar?: string) {
    const alvo = textoParaProcessar ?? texto;
    if (!alvo.trim()) return;
    setCarregando(true);
    setErro(null);
    setResultado(null);
    setVendoSalva(false);
    try {
      const resp = await fetch("http://localhost:3333/refine-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: alvo }),
      });
      if (!resp.ok) throw new Error(`servidor respondeu ${resp.status}`);
      const dados = await resp.json();
      setHistoriasDaily(dados.historias ?? []);
      setRecarregarBacklog((n) => n + 1);
      if ((dados.historias ?? []).length === 0) {
        setErro("Nenhuma demanda foi identificada neste trecho.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro ao processar a daily");
    } finally {
      setCarregando(false);
    }
  }

  // MODO INDIVIDUAL: refina uma única história (fluxo antigo).
  async function analisar(textoParaAnalisar?: string) {
    const alvo = textoParaAnalisar ?? texto;
    if (!alvo.trim()) return;
    setCarregando(true);
    setErro(null);
    setVendoSalva(false);
    setHistoriasDaily([]);
    try {
      const resp = await fetch("http://localhost:3333/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: alvo, storyId }),
      });
      if (!resp.ok) throw new Error(`servidor respondeu ${resp.status}`);
      const dados: RefineResult = await resp.json();
      setResultado(dados);
      if (typeof dados.storyId === "number") setStoryId(dados.storyId);
      setRecarregarBacklog((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro desconhecido");
    } finally {
      setCarregando(false);
    }
  }

  // Ação principal do botão, depende do modo atual.
  async function acaoPrincipal(textoAlvo?: string) {
    if (modo === "daily") await processarDaily(textoAlvo);
    else await analisar(textoAlvo);
  }

  async function alternarGravacao() {
    setErro(null);
    try {
      if (gravando) {
        const textoTranscrito = await pararEEnviar();
        setTexto(textoTranscrito);
        if (textoTranscrito.trim()) await acaoPrincipal(textoTranscrito);
      } else {
        await iniciar();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro no microfone");
    }
  }

  function novaHistoria() {
    fala.parar();
    setTexto("");
    setResultado(null);
    setHistoriasDaily([]);
    setStoryId(null);
    setErro(null);
    setVendoSalva(false);
  }

  function abrirVersaoSalva(idHistoria: number, versao: VersaoBanco) {
    fala.parar();
    let violations: Violation[] = [];
    let acceptanceCriteria: string[] = [];
    try {
      violations = JSON.parse(versao.violacoes_json ?? "[]");
    } catch {
      violations = [];
    }
    try {
      acceptanceCriteria = JSON.parse(versao.criterios_json ?? "[]");
    } catch {
      acceptanceCriteria = [];
    }
    setModo("individual");
    setHistoriasDaily([]);
    setResultado({
      storyId: idHistoria,
      story: { who: versao.who, what: versao.what, why: versao.why },
      violations,
      acceptanceCriteria,
    });
    setStoryId(idHistoria);
    setTexto(versao.entrada_original ?? "");
    setVendoSalva(true);
    setErro(null);
  }

  return (
    <div className="layout">
      <Backlog
        recarregar={recarregarBacklog}
        storyIdAtual={storyId}
        onAbrir={abrirVersaoSalva}
      />

      <div className="app">
        <header className="topbar">
          <span className="mark">US</span>
          <div>
            <h1>Assistente de Refinement</h1>
            <p className="sub">Facilitação de user stories com INVEST + QUS</p>
          </div>
        </header>

        {/* Painel de sessão do experimento */}
        <section className="sessao">
          <div className="sessao-linha">
            <input
              className="sessao-input"
              placeholder="Identificador do participante (ex.: P01)"
              value={participante}
              onChange={(e) => setParticipante(e.target.value)}
            />
            <select
              className="sessao-select"
              value={condicao}
              onChange={(e) =>
                setCondicao(
                  e.target.value as "com_assistente" | "sem_assistente",
                )
              }
            >
              <option value="com_assistente">Com assistente</option>
              <option value="sem_assistente">Sem assistente (controle)</option>
            </select>
            <button className="sessao-btn" onClick={iniciarSessao}>
              Iniciar sessão
            </button>
          </div>
          {sessaoAtiva && (
            <p className="sessao-ativa">
              Sessão ativa: <strong>{sessaoAtiva.participante}</strong> —{" "}
              <span
                className={
                  sessaoAtiva.condicao === "sem_assistente"
                    ? "cond-controle"
                    : "cond-assistente"
                }
              >
                {sessaoAtiva.condicao === "sem_assistente"
                  ? "sem assistente (controle)"
                  : "com assistente"}
              </span>
            </p>
          )}
        </section>

        {/* Seletor de modo (só faz sentido com assistente) */}
        {comAssistente && (
          <div className="modo-tabs">
            <button
              className={modo === "daily" ? "modo-tab ativa" : "modo-tab"}
              onClick={() => {
                setModo("daily");
                novaHistoria();
              }}
            >
              Modo Daily (várias demandas)
            </button>
            <button
              className={modo === "individual" ? "modo-tab ativa" : "modo-tab"}
              onClick={() => {
                setModo("individual");
                novaHistoria();
              }}
            >
              História individual
            </button>
          </div>
        )}

        <section className="composer">
          <label htmlFor="entrada">
            {modo === "daily" && comAssistente
              ? "Cole ou fale um trecho da daily — o assistente extrai as demandas"
              : comAssistente
                ? "Descreva a história em uma frase"
                : "Escreva a user story (formato: Como… eu quero… para…)"}
          </label>
          <textarea
            id="entrada"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={
              modo === "daily"
                ? "Ex.: Preciso que o Gustavo crie um relatório de vendas para o Eduardo, e o Guilherme precisa validar o filtro de dados"
                : "Ex.: Como gerente eu quero exportar relatórios para acompanhar a equipe"
            }
            rows={modo === "daily" ? 4 : 3}
          />
          <div className="botoes">
            {comAssistente && (
              <button
                className={gravando ? "mic gravando" : "mic"}
                onClick={alternarGravacao}
                disabled={transcrevendo || carregando}
              >
                {gravando ? "● Parar e transcrever" : "🎤 Gravar"}
              </button>
            )}
            <button
              onClick={() => acaoPrincipal()}
              disabled={carregando || !texto.trim()}
            >
              {carregando
                ? "Processando…"
                : modo === "daily" && comAssistente
                  ? "Processar trecho da daily"
                  : comAssistente
                    ? "Analisar história"
                    : "Salvar história"}
            </button>
            <button
              className="mic"
              onClick={novaHistoria}
              disabled={carregando}
            >
              Limpar
            </button>
          </div>
          {transcrevendo && <p className="dica">Transcrevendo o áudio…</p>}
          {storyId && !vendoSalva && modo === "individual" && (
            <p className="dica">Trabalhando na história #{storyId}</p>
          )}
          {vendoSalva && (
            <p className="dica">Vendo versão salva da história #{storyId}.</p>
          )}
          {erro && <p className="erro">{erro}</p>}
        </section>

        {/* Resultado do MODO DAILY: lista de cards extraídos */}
        {modo === "daily" && historiasDaily.length > 0 && (
          <section className="resultado">
            <div className="painel">
              <h2>
                Demandas identificadas
                <span className="contagem">{historiasDaily.length}</span>
              </h2>
              <p className="dica" style={{ marginTop: 0 }}>
                Todos os cards abaixo já foram adicionados ao backlog.
              </p>
              <div className="lista-daily">
                {historiasDaily.map((h) => (
                  <CardDaily key={h.storyId} h={h} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Resultado do MODO INDIVIDUAL: uma história detalhada */}
        {modo === "individual" && resultado && (
          <section className="resultado">
            <div className="story-card">
              <div className="bloco-topo">
                <span className="bloco-titulo">História</span>
                {comAssistente && (
                  <BotaoAudio
                    id="historia"
                    texto={falaDaHistoria(resultado)}
                    fala={fala}
                  />
                )}
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

            {comAssistente && (
              <>
                <div className="painel">
                  <h2>
                    Pontos de atenção
                    <span className="contagem">
                      {resultado.violations.length}
                    </span>
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
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
