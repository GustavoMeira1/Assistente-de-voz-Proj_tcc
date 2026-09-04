import { useState, useEffect, useRef } from "react";
import { useGravador } from "./useGravador";
import { useGravadorContinuo } from "./useGravadorContinuo";
import { useFala } from "./useFala";
import { Backlog, type Versao } from "./Backlog";
import { JiraConfig } from "./JiraConfig";

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

type Vista = "daily" | "historia" | "sessao" | "config";

const API = "http://localhost:3333";

/* ---------- Helpers de fala ---------- */

function frase(story: UserStory): string {
  const partes = [
    story.who ? `Como ${story.who}` : null,
    story.what ? `eu quero ${story.what}` : null,
    story.why ? `para ${story.why}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") + "." : "A história está vazia.";
}

function falaViolacoes(v: Violation[]): string {
  if (v.length === 0) return "Nenhum ponto de atenção.";
  const intro =
    v.length === 1 ? "Um ponto de atenção." : `${v.length} pontos de atenção.`;
  return (
    intro +
    " " +
    v.map((x, i) => `${i + 1}. ${x.criterio}. ${x.mensagem}`).join(" ")
  );
}

function falaCriterios(c: string[]): string {
  if (c.length === 0) return "Nenhum critério de aceite sugerido.";
  const intro =
    c.length === 1
      ? "Um critério de aceite."
      : `${c.length} critérios de aceite.`;
  return intro + " " + c.map((x, i) => `${i + 1}. ${x}`).join(" ");
}

/* ---------- Botão de áudio ---------- */

function BotaoOuvir({
  id,
  texto,
  fala,
}: {
  id: string;
  texto: string;
  fala: ReturnType<typeof useFala>;
}) {
  const ativo = fala.blocoAtivo === id;
  const rotulo = ativo ? (fala.pausado ? "Retomar" : "Pausar") : "Ouvir";
  return (
    <button
      className="btn-min"
      onClick={() => {
        if (ativo && !fala.pausado) fala.pausar();
        else if (ativo && fala.pausado) fala.retomar();
        else fala.falar(texto, id);
      }}
    >
      {rotulo}
    </button>
  );
}

/* ---------- Cartão de demanda extraída ---------- */

function CartaoDemanda({
  h,
  onSalvar,
}: {
  h: HistoriaDaily;
  onSalvar: (id: number, s: UserStory) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [who, setWho] = useState(h.story.who);
  const [what, setWhat] = useState(h.story.what);
  const [why, setWhy] = useState(h.story.why);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    await onSalvar(h.storyId, { who, what, why });
    setSalvando(false);
    setEditando(false);
  }

  return (
    <div className="demanda">
      <div className="demanda-meta">
        <span className="demanda-id">#{h.storyId}</span>
        <span className={h.acao === "nova" ? "selo novo" : "selo atualizado"}>
          {h.acao === "nova" ? "novo" : "atualizado"}
        </span>
        {h.violations.length > 0 && (
          <span className="selo alerta">
            {h.violations.length}{" "}
            {h.violations.length === 1 ? "alerta" : "alertas"}
          </span>
        )}
        <span className="demanda-editar">
          <button className="btn-min" onClick={() => setEditando((e) => !e)}>
            {editando ? "Cancelar" : "Editar"}
          </button>
        </span>
      </div>

      {editando ? (
        <div className="form-edicao">
          <div className="form-campo">
            <label>Quem faz</label>
            <input value={who} onChange={(e) => setWho(e.target.value)} />
          </div>
          <div className="form-campo">
            <label>O que precisa ser feito</label>
            <input value={what} onChange={(e) => setWhat(e.target.value)} />
          </div>
          <div className="form-campo">
            <label>Para quê ou para quem</label>
            <input value={why} onChange={(e) => setWhy(e.target.value)} />
          </div>
          <div className="linha-botoes">
            <button className="btn" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar correção"}
            </button>
          </div>
        </div>
      ) : (
        <p className="historia-linha" style={{ margin: 0 }}>
          <span className="marca">Como</span> {h.story.who || "—"}{" "}
          <span className="marca">eu quero</span> {h.story.what || "—"}
          {h.story.why && (
            <>
              {" "}
              <span className="marca">para</span> {h.story.why}
            </>
          )}
        </p>
      )}
    </div>
  );
}

/* ========================= APP ========================= */

export default function App() {
  const [vista, setVista] = useState<Vista>("daily");

  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<RefineResult | null>(null);
  const [demandas, setDemandas] = useState<HistoriaDaily[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<number | null>(null);
  const [recarregar, setRecarregar] = useState(0);

  const [statusVivo, setStatusVivo] = useState("");
  const [transcricao, setTranscricao] = useState("");
  const transcricaoRef = useRef("");
  const processandoRef = useRef(false);

  const [editandoStory, setEditandoStory] = useState(false);
  const [edWho, setEdWho] = useState("");
  const [edWhat, setEdWhat] = useState("");
  const [edWhy, setEdWhy] = useState("");
  const [salvandoStory, setSalvandoStory] = useState(false);

  const [participante, setParticipante] = useState("");
  const [condicao, setCondicao] = useState<"com_assistente" | "sem_assistente">(
    "com_assistente",
  );
  const [sessao, setSessao] = useState<{
    participante: string;
    condicao: string;
  } | null>(null);
  const [jiraAtivo, setJiraAtivo] = useState(false);

  const { gravando, transcrevendo, iniciar, pararEEnviar } = useGravador();
  const fala = useFala();

  const comAssistente = sessao?.condicao !== "sem_assistente";

  /* ----- carga inicial ----- */
  useEffect(() => {
    fetch(`${API}/session/current`)
      .then((r) => r.json())
      .then((d) => {
        if (d.sessao) {
          setSessao({
            participante: d.sessao.participante ?? "sessão avulsa",
            condicao: d.sessao.condicao,
          });
        }
      })
      .catch(() => {});

    fetch(`${API}/config/jira`)
      .then((r) => r.json())
      .then((d) => setJiraAtivo(Boolean(d?.ativo)))
      .catch(() => {});
  }, []);

  function recarregarJira() {
    fetch(`${API}/config/jira`)
      .then((r) => r.json())
      .then((d) => setJiraAtivo(Boolean(d?.ativo)))
      .catch(() => {});
  }

  /* ----- sessão ----- */
  async function iniciarSessao() {
    if (!participante.trim()) {
      setErro("Informe quem vai participar desta sessão.");
      return;
    }
    try {
      const r = await fetch(`${API}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participante, condicao }),
      });
      const d = await r.json();
      setSessao({ participante: d.participante, condicao: d.condicao });
      limpar();
      setRecarregar((n) => n + 1);
      setVista("daily");
    } catch {
      setErro("Não foi possível iniciar a sessão.");
    }
  }

  /* ----- daily ----- */
  async function reprocessar() {
    if (!transcricaoRef.current.trim()) return;
    try {
      const r = await fetch(`${API}/refine-daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: transcricaoRef.current }),
      });
      if (r.ok) {
        const d = await r.json();
        const novas: HistoriaDaily[] = d.historias ?? [];
        if (novas.length > 0) setDemandas(novas);
        setRecarregar((n) => n + 1);
      }
    } catch {
      /* silencioso: o usuário vê o status */
    }
  }

  async function aoFecharBloco(audio: Blob) {
    try {
      setStatusVivo("Transcrevendo o que foi dito…");
      const form = new FormData();
      form.append("audio", audio, "bloco.webm");
      const r = await fetch(`${API}/transcribe`, {
        method: "POST",
        body: form,
      });
      if (r.ok) {
        const d = (await r.json()) as { texto: string };
        const trecho = (d.texto ?? "").trim();
        if (trecho) {
          transcricaoRef.current = (
            transcricaoRef.current +
            " " +
            trecho
          ).trim();
          setTranscricao(transcricaoRef.current);
        }
      }
      setStatusVivo("Ouvindo a reunião");
    } catch {
      setStatusVivo("Ouvindo a reunião");
    }
  }

  const gravadorVivo = useGravadorContinuo(aoFecharBloco);

  async function alternarDaily() {
    setErro(null);
    if (gravadorVivo.gravandoAoVivo) {
      gravadorVivo.parar();
      setCarregando(true);
      setStatusVivo("Fechando a transcrição…");
      setTimeout(async () => {
        setStatusVivo("Montando o backlog a partir da conversa…");
        await reprocessar();
        setStatusVivo("Backlog atualizado.");
        setCarregando(false);
      }, 3000);
    } else {
      try {
        transcricaoRef.current = "";
        setTranscricao("");
        setDemandas([]);
        setStatusVivo("Ouvindo a reunião");
        await gravadorVivo.iniciar();
      } catch {
        setErro(
          "Não foi possível acessar o microfone. Verifique a permissão no navegador.",
        );
        setStatusVivo("");
      }
    }
  }

  async function processarTexto(alvo?: string) {
    const conteudo = alvo ?? texto;
    if (!conteudo.trim()) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`${API}/refine-daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: conteudo }),
      });
      if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
      const d = await r.json();
      const novas: HistoriaDaily[] = d.historias ?? [];
      setDemandas((atuais) => {
        const mapa = new Map(atuais.map((h) => [h.storyId, h]));
        novas.forEach((n) => mapa.set(n.storyId, n));
        return Array.from(mapa.values());
      });
      setRecarregar((n) => n + 1);
      if (novas.length === 0)
        setErro("Nenhuma demanda foi identificada neste trecho.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao processar o trecho.");
    } finally {
      setCarregando(false);
    }
  }

  /* ----- história individual ----- */
  async function analisarHistoria(alvo?: string) {
    const conteudo = alvo ?? texto;
    if (!conteudo.trim()) return;
    setCarregando(true);
    setErro(null);
    setEditandoStory(false);
    try {
      const r = await fetch(`${API}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: conteudo, storyId }),
      });
      if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
      const d: RefineResult = await r.json();
      setResultado(d);
      if (typeof d.storyId === "number") setStoryId(d.storyId);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao analisar a história.");
    } finally {
      setCarregando(false);
    }
  }

  async function gravarTrecho() {
    setErro(null);
    try {
      if (gravando) {
        const t = await pararEEnviar();
        setTexto(t);
        if (t.trim()) {
          if (vista === "daily") await processarTexto(t);
          else await analisarHistoria(t);
        }
      } else {
        await iniciar();
      }
    } catch {
      setErro("Não foi possível usar o microfone.");
    }
  }

  function limpar() {
    fala.parar();
    setTexto("");
    setResultado(null);
    setDemandas([]);
    setStoryId(null);
    setErro(null);
    setEditandoStory(false);
    transcricaoRef.current = "";
    setTranscricao("");
    setStatusVivo("");
  }

  async function salvarEdicao(id: number, story: UserStory) {
    const r = await fetch(`${API}/stories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(story),
    });
    if (!r.ok) throw new Error("falha ao salvar");
    setDemandas((lista) =>
      lista.map((h) => (h.storyId === id ? { ...h, story } : h)),
    );
    setRecarregar((n) => n + 1);
  }

  async function salvarStory() {
    if (!resultado?.storyId) return;
    setSalvandoStory(true);
    setErro(null);
    try {
      const nova: UserStory = { who: edWho, what: edWhat, why: edWhy };
      const r = await fetch(`${API}/stories/${resultado.storyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nova),
      });
      if (!r.ok) throw new Error(`o servidor respondeu ${r.status}`);
      setResultado({ ...resultado, story: nova });
      setEditandoStory(false);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(
        e instanceof Error
          ? `Não foi possível salvar: ${e.message}`
          : "Não foi possível salvar.",
      );
    } finally {
      setSalvandoStory(false);
    }
  }

  function abrirDoBacklog(id: number, v: Versao) {
    fala.parar();
    let violations: Violation[] = [];
    let criterios: string[] = [];
    try {
      violations = JSON.parse(v.violacoes_json ?? "[]");
    } catch {
      violations = [];
    }
    try {
      criterios = JSON.parse(v.criterios_json ?? "[]");
    } catch {
      criterios = [];
    }
    setVista("historia");
    setDemandas([]);
    setEditandoStory(false);
    setResultado({
      storyId: id,
      story: { who: v.who, what: v.what, why: v.why },
      violations,
      acceptanceCriteria: criterios,
    });
    setStoryId(id);
    setTexto(v.entrada_original ?? "");
    setErro(null);
  }

  /* ========================= RENDER ========================= */

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-dot" />
          Assistente de daily
          <span className="brand-sub">user stories com INVEST e QUS</span>
        </span>

        <span className="topbar-espaco" />

        <button className="chip-sessao" onClick={() => setVista("sessao")}>
          <span className="chip-nome">
            {sessao?.participante ?? "sem sessão"}
          </span>
          <span
            className={`chip-cond ${sessao?.condicao === "sem_assistente" ? "sem" : "com"}`}
          >
            {sessao?.condicao === "sem_assistente"
              ? "controle"
              : "com assistente"}
          </span>
        </button>

        <button
          className={vista === "config" ? "btn-icone ativo" : "btn-icone"}
          onClick={() => setVista("config")}
        >
          Configurações
        </button>
      </header>

      <div className="corpo">
        <Backlog
          recarregar={recarregar}
          storyIdAtual={storyId}
          onAbrir={abrirDoBacklog}
          jiraAtivo={jiraAtivo}
        />

        <main className="area">
          <div className="area-interna">
            {(vista === "daily" || vista === "historia") && comAssistente && (
              <div className="abas">
                <button
                  className={vista === "daily" ? "aba ativa" : "aba"}
                  onClick={() => {
                    setVista("daily");
                    limpar();
                  }}
                >
                  Daily
                </button>
                <button
                  className={vista === "historia" ? "aba ativa" : "aba"}
                  onClick={() => {
                    setVista("historia");
                    limpar();
                  }}
                >
                  História avulsa
                </button>
              </div>
            )}

            {/* ---------- DAILY ---------- */}
            {vista === "daily" && (
              <>
                {comAssistente && (
                  <section className="bloco">
                    <div className="captura">
                      <button
                        className={
                          gravadorVivo.gravandoAoVivo
                            ? "btn-gravar gravando"
                            : "btn-gravar"
                        }
                        onClick={alternarDaily}
                        disabled={carregando && !gravadorVivo.gravandoAoVivo}
                      >
                        <span className="ponto" />
                        {gravadorVivo.gravandoAoVivo
                          ? "Encerrar e gerar backlog"
                          : "Gravar daily"}
                      </button>
                      {statusVivo && (
                        <span
                          className={
                            gravadorVivo.gravandoAoVivo
                              ? "status-captura ativo"
                              : "status-captura"
                          }
                        >
                          {statusVivo}
                        </span>
                      )}
                    </div>

                    {!gravadorVivo.gravandoAoVivo && !transcricao && (
                      <p
                        className="ajuda"
                        style={{ marginTop: 12, marginBottom: 0 }}
                      >
                        Fale a reunião normalmente. A conversa é transcrita
                        durante a fala e vira histórias quando você encerrar.
                      </p>
                    )}

                    {transcricao && (
                      <div className="transcricao">
                        <p className="transcricao-rotulo">
                          Transcrição da reunião
                        </p>
                        <p className="transcricao-texto">{transcricao}</p>
                      </div>
                    )}
                  </section>
                )}

                <section className="bloco">
                  <div className="bloco-cabeca">
                    <h2 className="bloco-titulo">
                      {comAssistente ? "Trecho escrito" : "Escrever história"}
                    </h2>
                  </div>
                  <textarea
                    className="campo-texto"
                    rows={4}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder={
                      comAssistente
                        ? "Cole aqui um trecho da reunião, se preferir não usar o microfone."
                        : "Como [quem], eu quero [o quê], para [benefício]."
                    }
                  />
                  <div className="linha-botoes" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      onClick={() => processarTexto()}
                      disabled={carregando || !texto.trim()}
                    >
                      {carregando
                        ? "Processando…"
                        : comAssistente
                          ? "Extrair demandas"
                          : "Salvar história"}
                    </button>
                    {comAssistente && (
                      <button
                        className="btn-sec"
                        onClick={gravarTrecho}
                        disabled={
                          transcrevendo ||
                          carregando ||
                          gravadorVivo.gravandoAoVivo
                        }
                      >
                        {gravando
                          ? "Parar e transcrever"
                          : transcrevendo
                            ? "Transcrevendo…"
                            : "Gravar trecho"}
                      </button>
                    )}
                    <button
                      className="btn-sec"
                      onClick={limpar}
                      disabled={carregando}
                    >
                      Limpar
                    </button>
                  </div>
                  {erro && <p className="erro">{erro}</p>}
                </section>

                {demandas.length > 0 && (
                  <section className="bloco">
                    <div className="bloco-cabeca">
                      <h2 className="bloco-titulo">Demandas encontradas</h2>
                      <span className="contador">{demandas.length}</span>
                    </div>
                    <p className="ajuda">
                      Todas já estão no backlog. Corrija aqui o que o assistente
                      entendeu errado.
                    </p>
                    <div className="lista-demandas">
                      {demandas.map((h) => (
                        <CartaoDemanda
                          key={h.storyId}
                          h={h}
                          onSalvar={salvarEdicao}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* ---------- HISTÓRIA AVULSA ---------- */}
            {vista === "historia" && (
              <>
                <section className="bloco">
                  <div className="bloco-cabeca">
                    <h2 className="bloco-titulo">Descrever uma história</h2>
                  </div>
                  <textarea
                    className="campo-texto"
                    rows={3}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    placeholder="Ex.: o gerente precisa exportar relatórios para acompanhar a equipe."
                  />
                  <div className="linha-botoes" style={{ marginTop: 10 }}>
                    <button
                      className="btn"
                      onClick={() => analisarHistoria()}
                      disabled={carregando || !texto.trim()}
                    >
                      {carregando ? "Analisando…" : "Analisar história"}
                    </button>
                    {comAssistente && (
                      <button
                        className="btn-sec"
                        onClick={gravarTrecho}
                        disabled={transcrevendo || carregando}
                      >
                        {gravando
                          ? "Parar e transcrever"
                          : transcrevendo
                            ? "Transcrevendo…"
                            : "Gravar trecho"}
                      </button>
                    )}
                    <button
                      className="btn-sec"
                      onClick={limpar}
                      disabled={carregando}
                    >
                      Limpar
                    </button>
                  </div>
                  {storyId && (
                    <p
                      className="ajuda"
                      style={{ marginTop: 10, marginBottom: 0 }}
                    >
                      Editando a história #{storyId}.
                    </p>
                  )}
                  {erro && <p className="erro">{erro}</p>}
                </section>

                {resultado && (
                  <>
                    <section className="bloco">
                      <div className="bloco-cabeca">
                        <h2 className="bloco-titulo">História</h2>
                        <div className="bloco-acoes">
                          {resultado.storyId && !editandoStory && (
                            <button
                              className="btn-min"
                              onClick={() => {
                                setEdWho(resultado.story.who);
                                setEdWhat(resultado.story.what);
                                setEdWhy(resultado.story.why);
                                setEditandoStory(true);
                              }}
                            >
                              Editar
                            </button>
                          )}
                          {comAssistente && !editandoStory && (
                            <BotaoOuvir
                              id="historia"
                              texto={frase(resultado.story)}
                              fala={fala}
                            />
                          )}
                        </div>
                      </div>

                      {editandoStory ? (
                        <div className="form-edicao">
                          <div className="form-campo">
                            <label>Quem faz</label>
                            <input
                              value={edWho}
                              onChange={(e) => setEdWho(e.target.value)}
                            />
                          </div>
                          <div className="form-campo">
                            <label>O que precisa ser feito</label>
                            <input
                              value={edWhat}
                              onChange={(e) => setEdWhat(e.target.value)}
                            />
                          </div>
                          <div className="form-campo">
                            <label>Para quê ou para quem</label>
                            <input
                              value={edWhy}
                              onChange={(e) => setEdWhy(e.target.value)}
                            />
                          </div>
                          <div className="linha-botoes">
                            <button
                              className="btn"
                              onClick={salvarStory}
                              disabled={salvandoStory}
                            >
                              {salvandoStory ? "Salvando…" : "Salvar correção"}
                            </button>
                            <button
                              className="btn-sec"
                              onClick={() => setEditandoStory(false)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="story-campos">
                          <div className="story-campo">
                            <span className="story-rotulo">Como</span>
                            <span className="story-valor">
                              {resultado.story.who || "—"}
                            </span>
                          </div>
                          <div className="story-campo">
                            <span className="story-rotulo">eu quero</span>
                            <span className="story-valor">
                              {resultado.story.what || "—"}
                            </span>
                          </div>
                          <div className="story-campo">
                            <span className="story-rotulo">para</span>
                            <span className="story-valor">
                              {resultado.story.why || "—"}
                            </span>
                          </div>
                        </div>
                      )}
                    </section>

                    {comAssistente && (
                      <>
                        <section className="bloco">
                          <div className="bloco-cabeca">
                            <h2 className="bloco-titulo">Pontos de atenção</h2>
                            <span className="contador">
                              {resultado.violations.length}
                            </span>
                            <div className="bloco-acoes">
                              <BotaoOuvir
                                id="viol"
                                texto={falaViolacoes(resultado.violations)}
                                fala={fala}
                              />
                            </div>
                          </div>
                          {resultado.violations.length === 0 ? (
                            <p className="ajuda">
                              A história passou nas verificações de template,
                              clareza e testabilidade.
                            </p>
                          ) : (
                            <ul className="lista-violacoes">
                              {resultado.violations.map((v, i) => (
                                <li key={i} className={`violacao ${v.origem}`}>
                                  <div className="violacao-topo">
                                    <span className="violacao-criterio">
                                      {v.criterio}
                                    </span>
                                    <span className="violacao-origem">
                                      {v.origem === "regra" ? "regra" : "IA"}
                                    </span>
                                  </div>
                                  <p className="violacao-msg">{v.mensagem}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section className="bloco">
                          <div className="bloco-cabeca">
                            <h2 className="bloco-titulo">
                              Critérios de aceite
                            </h2>
                            <div className="bloco-acoes">
                              <BotaoOuvir
                                id="crit"
                                texto={falaCriterios(
                                  resultado.acceptanceCriteria,
                                )}
                                fala={fala}
                              />
                            </div>
                          </div>
                          {resultado.acceptanceCriteria.length === 0 ? (
                            <p className="ajuda">
                              Nenhum critério sugerido para esta história.
                            </p>
                          ) : (
                            <ul className="lista-criterios">
                              {resultado.acceptanceCriteria.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ---------- SESSÃO ---------- */}
            {vista === "sessao" && (
              <>
                <section className="bloco">
                  <div className="bloco-cabeca">
                    <h2 className="bloco-titulo">Sessão do experimento</h2>
                    <div className="bloco-acoes">
                      <button
                        className="btn-min"
                        onClick={() => setVista("daily")}
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                  <p className="ajuda">
                    Cada sessão separa as histórias de um participante em uma
                    das duas condições comparadas no estudo.
                  </p>
                  <div className="grade-campos">
                    <div className="form-campo">
                      <label htmlFor="part">Participante</label>
                      <input
                        id="part"
                        placeholder="P01"
                        value={participante}
                        onChange={(e) => setParticipante(e.target.value)}
                      />
                    </div>
                    <div className="form-campo">
                      <label htmlFor="cond">Condição</label>
                      <select
                        id="cond"
                        value={condicao}
                        onChange={(e) =>
                          setCondicao(e.target.value as typeof condicao)
                        }
                      >
                        <option value="com_assistente">Com assistente</option>
                        <option value="sem_assistente">
                          Sem assistente (controle)
                        </option>
                      </select>
                    </div>
                  </div>
                  <div className="linha-botoes" style={{ marginTop: 14 }}>
                    <button className="btn" onClick={iniciarSessao}>
                      Iniciar sessão
                    </button>
                  </div>
                  {sessao && (
                    <p
                      className="ajuda"
                      style={{ marginTop: 12, marginBottom: 0 }}
                    >
                      Em andamento: {sessao.participante} —{" "}
                      {sessao.condicao === "sem_assistente"
                        ? "sem assistente"
                        : "com assistente"}
                      . Iniciar outra sessão começa um backlog novo.
                    </p>
                  )}
                  {erro && <p className="erro">{erro}</p>}
                </section>

                <section className="bloco">
                  <div className="bloco-cabeca">
                    <h2 className="bloco-titulo">Dados para análise</h2>
                  </div>
                  <p className="ajuda">
                    Os arquivos saem em CSV, prontos para abrir na planilha.
                  </p>
                  <div className="linha-botoes">
                    <button
                      className="btn-sec"
                      onClick={() =>
                        window.open(`${API}/export/versoes.csv`, "_blank")
                      }
                    >
                      Baixar versões
                    </button>
                    <button
                      className="btn-sec"
                      onClick={() =>
                        window.open(`${API}/export/historias.csv`, "_blank")
                      }
                    >
                      Baixar histórias
                    </button>
                  </div>
                  <p
                    className="ajuda"
                    style={{ marginTop: 12, marginBottom: 0 }}
                  >
                    Versões traz uma linha por alteração, com as violações
                    separadas por origem. Histórias traz o resumo final de cada
                    card.
                  </p>
                </section>
              </>
            )}

            {/* ---------- CONFIGURAÇÕES ---------- */}
            {vista === "config" && (
              <>
                <div className="linha-botoes" style={{ marginBottom: 16 }}>
                  <button className="btn-min" onClick={() => setVista("daily")}>
                    Voltar
                  </button>
                </div>
                <JiraConfig onMudou={recarregarJira} />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
