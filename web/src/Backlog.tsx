import { useEffect, useState } from "react";

interface HistoriaResumo {
  id: number;
  who: string;
  what: string;
  why: string;
  criada_em: string;
  jira_key?: string | null;
}

export interface Versao {
  id: number;
  entrada_original: string;
  who: string;
  what: string;
  why: string;
  violacoes_json: string;
  criterios_json: string;
  total_violacoes: number;
  violacoes_regra: number;
  violacoes_llm: number;
  criada_em: string;
}

export function Backlog({
  recarregar,
  storyIdAtual,
  onAbrir,
  jiraAtivo,
}: {
  recarregar: number;
  storyIdAtual: number | null;
  onAbrir: (storyId: number, versao: Versao) => void;
  jiraAtivo: boolean;
}) {
  const [historias, setHistorias] = useState<HistoriaResumo[]>([]);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [versoes, setVersoes] = useState<Versao[]>([]);
  const [enviando, setEnviando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    fetch("http://localhost:3333/stories")
      .then((r) => r.json())
      .then((d) => setHistorias(d.stories ?? []))
      .catch(() => setHistorias([]));
  }

  useEffect(() => {
    carregar();
  }, [recarregar]);

  async function abrir(id: number) {
    if (expandida === id) {
      setExpandida(null);
      return;
    }
    try {
      const r = await fetch(`http://localhost:3333/stories/${id}`);
      const d = await r.json();
      const vs: Versao[] = d.versoes ?? [];
      setVersoes(vs);
      setExpandida(id);
      if (vs.length > 0) onAbrir(id, vs[vs.length - 1]);
    } catch {
      setVersoes([]);
    }
  }

  async function remover(id: number, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!window.confirm(`Excluir a história #${id}?`)) return;
    try {
      const r = await fetch(`http://localhost:3333/stories/${id}`, {
        method: "DELETE",
      });
      if (r.ok) {
        if (expandida === id) setExpandida(null);
        carregar();
      }
    } catch {
      setErro("Não foi possível excluir a história.");
    }
  }

  async function enviarJira(id: number, ev: React.MouseEvent) {
    ev.stopPropagation();
    setEnviando(id);
    setErro(null);
    try {
      const r = await fetch(`http://localhost:3333/stories/${id}/jira`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) setErro(d.erro ?? "O Jira recusou a criação do card.");
      else carregar();
    } catch {
      setErro("Não foi possível contatar o servidor.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <aside className="lateral">
      <div className="lateral-topo">
        <h2 className="lateral-titulo">Backlog</h2>
        <span className="lateral-contagem">
          {historias.length === 0
            ? "vazio"
            : `${historias.length} ${historias.length === 1 ? "história" : "histórias"}`}
        </span>
      </div>

      {erro && <p className="erro">{erro}</p>}

      {historias.length === 0 ? (
        <div className="vazio-estado">
          Grave uma daily ou escreva uma história para começar a preencher o
          backlog.
        </div>
      ) : (
        <ul className="lista-backlog">
          {historias.map((h) => (
            <li
              key={h.id}
              className={`item ${h.id === storyIdAtual ? "selecionado" : ""}`}
            >
              <div className="item-topo">
                <button className="item-abrir" onClick={() => abrir(h.id)}>
                  <span className="item-meta">
                    <span className="item-id">#{h.id}</span>
                    {h.who && <span className="item-quem">{h.who}</span>}
                    {h.jira_key && (
                      <span className="selo-jira">{h.jira_key}</span>
                    )}
                  </span>
                  <span className="item-texto">
                    {h.what || "Sem descrição"}
                  </span>
                </button>
                <button
                  className="item-remover"
                  title={`Excluir história #${h.id}`}
                  onClick={(e) => remover(h.id, e)}
                >
                  ✕
                </button>
              </div>

              {jiraAtivo && !h.jira_key && (
                <button
                  className="item-jira"
                  onClick={(e) => enviarJira(h.id, e)}
                  disabled={enviando === h.id}
                >
                  {enviando === h.id ? "Enviando…" : "Enviar para o Jira"}
                </button>
              )}

              {expandida === h.id && (
                <div className="versoes">
                  <p className="versoes-rotulo">
                    {versoes.length === 1
                      ? "1 versão registrada"
                      : `${versoes.length} versões registradas`}
                  </p>
                  {versoes.map((v, i) => (
                    <button
                      key={v.id}
                      className="versao"
                      onClick={() => onAbrir(h.id, v)}
                    >
                      <span className="versao-topo">
                        <span className="versao-num">v{i + 1}</span>
                        <span className="versao-nums">
                          {v.total_violacoes} alertas · {v.violacoes_regra}{" "}
                          regra · {v.violacoes_llm} IA
                        </span>
                      </span>
                      <p className="versao-fala">{v.entrada_original}</p>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
