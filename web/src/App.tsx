import { useState, useEffect, useRef } from "react";
import { useGravador } from "./useGravador";
import { useGravadorContinuo } from "./useGravadorContinuo";
import { useFala } from "./useFala";
import { Backlog } from "./Backlog";
import { ExportBar } from "./ExportBar";

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

interface HistoriaDaily {
  storyId: number;
  story: UserStory;
  violations: Violation[];
  acceptanceCriteria: string[];
  acao: "nova" | "atualizada";
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

function CardDaily({
  h,
  onSalvarEdicao,
}: {
  h: HistoriaDaily;
  onSalvarEdicao: (storyId: number, story: UserStory) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [who, setWho] = useState(h.story.who);
  const [what, setWhat] = useState(h.story.what);
  const [why, setWhy] = useState(h.story.why);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    await onSalvarEdicao(h.storyId, { who, what, why });
    setSalvando(false);
    setEditando(false);
  }

  return (
    <div className="card-daily">
      <div className="card-daily-meta">
        <span className="card-daily-id">#{h.storyId}</span>
        <span className={h.acao === "nova" ? "badge-nova" : "badge-atualizada"}>
          {h.acao === "nova" ? "novo card" : "card atualizado"}
        </span>
        {h.violations.length > 0 && (
          <span className="card-daily-viol">
            {h.violations.length} ponto(s) de atenção
          </span>
        )}
        <button className="editar-link" onClick={() => setEditando((e) => !e)}>
          {editando ? "cancelar" : "editar"}
        </button>
      </div>

      {editando ? (
        <div className="card-edicao">
          <label>Como (quem)</label>
          <input value={who} onChange={(e) => setWho(e.target.value)} />
          <label>eu quero (o quê)</label>
          <input value={what} onChange={(e) => setWhat(e.target.value)} />
          <label>para (benefício)</label>
          <input value={why} onChange={(e) => setWhy(e.target.value)} />
          <button
            className="salvar-edicao"
            onClick={salvar}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar correção"}
          </button>
        </div>
      ) : (
        <div className="card-daily-story">
          <span className="mini-rotulo">Como</span> {h.story.who || "—"}{" "}
          <span className="mini-rotulo">quero</span> {h.story.what || "—"}{" "}
          {h.story.why && (
            <>
              <span className="mini-rotulo">para</span> {h.story.why}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [modo, setModo] = useState<"daily" | "individual">("daily");

  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<RefineResult | null>(null);
  const [historiasDaily, setHistoriasDaily] = useState<HistoriaDaily[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<number | null>(null);
  const [recarregarBacklog, setRecarregarBacklog] = useState(0);
  const [vendoSalva, setVendoSalva] = useState(false);

  const [statusAoVivo, setStatusAoVivo] = useState("");
  const [transcricaoAoVivo, setTranscricaoAoVivo] = useState("");
  const transcricaoRef = useRef("");
  const processandoRef = useRef(false);

  const [editandoInd, setEditandoInd] = useState(false);
  const [edWho, setEdWho] = useState("");
  const [edWhat, setEdWhat] = useState("");
  const [edWhy, setEdWhy] = useState("");
  const [salvandoInd, setSalvandoInd] = useState(false);

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

  // Reprocessa o texto acumulado inteiro e atualiza os cards da daily.
  async function reprocessarAcumulado() {
    if (!transcricaoRef.current.trim()) return;
    try {
      const respD = await fetch("http://localhost:3333/refine-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: transcricaoRef.current }),
      });
      if (respD.ok) {
        const dadosD = await respD.json();
        const novas: HistoriaDaily[] = dadosD.historias ?? [];
        if (novas.length > 0) setHistoriasDaily(novas);
        setRecarregarBacklog((n) => n + 1);
      }
    } catch {
      /* silencioso */
    }
  }

  // Durante a daily ao vivo: apenas transcreve e ACUMULA o texto.
  // Os cards NÃO são gerados durante a fala — só ao encerrar (processamento
  // único do texto completo), o que elimina duplicações por corrida.
  async function processarBlocoAoVivo(audio: Blob) {
    try {
      setStatusAoVivo("Transcrevendo…");
      const form = new FormData();
      form.append("audio", audio, "bloco.webm");
      const respT = await fetch("http://localhost:3333/transcribe", {
        method: "POST",
        body: form,
      });
      if (respT.ok) {
        const dadosT = (await respT.json()) as { texto: string };
        const trecho = (dadosT.texto ?? "").trim();
        if (trecho) {
          transcricaoRef.current = (
            transcricaoRef.current +
            " " +
            trecho
          ).trim();
          setTranscricaoAoVivo(transcricaoRef.current);
        }
      }
      setStatusAoVivo("Ouvindo…");
    } catch {
      setStatusAoVivo("Ouvindo…");
    }
  }

  const gravadorAoVivo = useGravadorContinuo(processarBlocoAoVivo);

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
      transcricaoRef.current = "";
      setTranscricaoAoVivo("");
      setStoryId(null);
      setVendoSalva(false);
      setEditandoInd(false);
      setErro(null);
      setRecarregarBacklog((n) => n + 1);
    } catch {
      setErro("Não foi possível iniciar a sessão.");
    }
  }

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
      const novas: HistoriaDaily[] = dados.historias ?? [];
      setHistoriasDaily((atuais) => {
        const mapa = new Map(atuais.map((h) => [h.storyId, h]));
        for (const nh of novas) mapa.set(nh.storyId, nh);
        return Array.from(mapa.values());
      });
      setRecarregarBacklog((n) => n + 1);
      if (novas.length === 0) {
        setErro("Nenhuma demanda foi identificada neste trecho.");
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "erro ao processar a daily");
    } finally {
      setCarregando(false);
    }
  }

  async function analisar(textoParaAnalisar?: string) {
    const alvo = textoParaAnalisar ?? texto;
    if (!alvo.trim()) return;
    setCarregando(true);
    setErro(null);
    setVendoSalva(false);
    setHistoriasDaily([]);
    setEditandoInd(false);
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

  async function alternarAoVivo() {
    setErro(null);
    if (gravadorAoVivo.gravandoAoVivo) {
      // Encerra a captura. Aguarda o último bloco ser transcrito e então
      // processa o texto COMPLETO uma única vez (gera todos os cards de vez).
      gravadorAoVivo.parar();
      setCarregando(true);
      setStatusAoVivo("Transcrevendo o trecho final…");
      // Espera para o último bloco de áudio terminar de transcrever.
      setTimeout(async () => {
        setStatusAoVivo("Gerando o backlog a partir da conversa…");
        await reprocessarAcumulado();
        setStatusAoVivo("Concluído. Backlog gerado.");
        setCarregando(false);
      }, 3000);
    } else {
      try {
        transcricaoRef.current = "";
        setTranscricaoAoVivo("");
        setHistoriasDaily([]);
        setStatusAoVivo("Ouvindo… (os cards aparecem ao encerrar)");
        await gravadorAoVivo.iniciar();
      } catch {
        setErro("Não foi possível acessar o microfone.");
        setStatusAoVivo("");
      }
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
    setEditandoInd(false);
  }

  async function salvarEdicao(idHistoria: number, story: UserStory) {
    const resp = await fetch(`http://localhost:3333/stories/${idHistoria}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(story),
    });
    if (!resp.ok) throw new Error("falha ao salvar");
    setHistoriasDaily((lista) =>
      lista.map((h) => (h.storyId === idHistoria ? { ...h, story } : h)),
    );
    setRecarregarBacklog((n) => n + 1);
  }

  function abrirEdicaoIndividual() {
    if (!resultado) return;
    setEdWho(resultado.story.who);
    setEdWhat(resultado.story.what);
    setEdWhy(resultado.story.why);
    setEditandoInd(true);
  }

  async function salvarEdicaoIndividual() {
    if (!resultado?.storyId) return;
    setSalvandoInd(true);
    setErro(null);
    try {
      const novaStory: UserStory = { who: edWho, what: edWhat, why: edWhy };
      const resp = await fetch(
        `http://localhost:3333/stories/${resultado.storyId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(novaStory),
        },
      );
      if (!resp.ok) throw new Error(`servidor respondeu ${resp.status}`);
      setResultado({ ...resultado, story: novaStory });
      setEditandoInd(false);
      setRecarregarBacklog((n) => n + 1);
    } catch (e) {
      setErro(
        e instanceof Error
          ? `Não foi possível salvar: ${e.message}`
          : "Não foi possível salvar a edição.",
      );
    } finally {
      setSalvandoInd(false);
    }
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
    setEditandoInd(false);
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

        <ExportBar />

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

        {modo === "daily" && comAssistente && (
          <section className="ao-vivo">
            <div className="ao-vivo-topo">
              <button
                className={
                  gravadorAoVivo.gravandoAoVivo
                    ? "aovivo-btn gravando"
                    : "aovivo-btn"
                }
                onClick={alternarAoVivo}
                disabled={carregando}
              >
                {gravadorAoVivo.gravandoAoVivo
                  ? "⏹ Encerrar daily ao vivo"
                  : "🔴 Iniciar daily ao vivo"}
              </button>
              {statusAoVivo && (
                <span className="ao-vivo-status">{statusAoVivo}</span>
              )}
            </div>
            {gravadorAoVivo.gravandoAoVivo && (
              <p className="dica" style={{ marginTop: 8 }}>
                Fale naturalmente. O assistente transcreve durante a fala e gera
                todos os cards de uma vez quando você encerrar.
              </p>
            )}
            {transcricaoAoVivo && (
              <div className="ao-vivo-transcricoes">
                <p className="versoes-titulo">Transcrição acumulada</p>
                <p className="ao-vivo-trecho">"{transcricaoAoVivo}"</p>
              </div>
            )}
          </section>
        )}

        <section className="composer">
          <label htmlFor="entrada">
            {modo === "daily" && comAssistente
              ? "Ou cole/fale um trecho da daily manualmente"
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
                disabled={
                  transcrevendo || carregando || gravadorAoVivo.gravandoAoVivo
                }
              >
                {gravando ? "● Parar e transcrever" : "🎤 Gravar trecho"}
              </button>
            )}
            <button
              onClick={() => acaoPrincipal()}
              disabled={carregando || !texto.trim()}
            >
              {carregando
                ? "Processando…"
                : modo === "daily" && comAssistente
                  ? "Processar trecho"
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

        {modo === "daily" && historiasDaily.length > 0 && (
          <section className="resultado">
            <div className="painel">
              <h2>
                Demandas no backlog
                <span className="contagem">{historiasDaily.length}</span>
              </h2>
              <p className="dica" style={{ marginTop: 0 }}>
                Os cards abaixo já estão no backlog. Use "editar" para corrigir,
                ou o ✕ no backlog para excluir duplicatas.
              </p>
              <div className="lista-daily">
                {historiasDaily.map((h) => (
                  <CardDaily
                    key={h.storyId}
                    h={h}
                    onSalvarEdicao={salvarEdicao}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {modo === "individual" && resultado && (
          <section className="resultado">
            <div className="story-card">
              <div className="bloco-topo">
                <span className="bloco-titulo">História</span>
                <div className="bloco-acoes">
                  {resultado.storyId && !editandoInd && (
                    <button
                      className="audio-btn"
                      onClick={abrirEdicaoIndividual}
                    >
                      ✎ Editar história
                    </button>
                  )}
                  {comAssistente && !editandoInd && (
                    <BotaoAudio
                      id="historia"
                      texto={falaDaHistoria(resultado)}
                      fala={fala}
                    />
                  )}
                </div>
              </div>

              {editandoInd ? (
                <div className="card-edicao" style={{ padding: "8px 0 16px" }}>
                  <label>Como (quem)</label>
                  <input
                    value={edWho}
                    onChange={(e) => setEdWho(e.target.value)}
                  />
                  <label>eu quero (o quê)</label>
                  <input
                    value={edWhat}
                    onChange={(e) => setEdWhat(e.target.value)}
                  />
                  <label>para (benefício)</label>
                  <input
                    value={edWhy}
                    onChange={(e) => setEdWhy(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      className="salvar-edicao"
                      onClick={salvarEdicaoIndividual}
                      disabled={salvandoInd}
                    >
                      {salvandoInd ? "Salvando…" : "Salvar correção"}
                    </button>
                    <button
                      className="mic"
                      style={{ marginTop: 0 }}
                      onClick={() => setEditandoInd(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}
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
