import { useEffect, useState } from "react";

interface HistoriaResumo {
  id: number;
  who: string;
  what: string;
  why: string;
  criada_em: string;
}

interface Versao {
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

// 'onAbrir' devolve ao App a história e a versão escolhidas para reexibir.
export function Backlog({
  recarregar,
  storyIdAtual,
  onAbrir,
}: {
  recarregar: number;
  storyIdAtual: number | null;
  onAbrir: (storyId: number, versao: Versao) => void;
}) {
  const [historias, setHistorias] = useState<HistoriaResumo[]>([]);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [versoes, setVersoes] = useState<Versao[]>([]);

  useEffect(() => {
    fetch("http://localhost:3333/stories")
      .then((r) => r.json())
      .then((d) => setHistorias(d.stories ?? []))
      .catch(() => setHistorias([]));
  }, [recarregar]);

  async function alternarDetalhe(id: number) {
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
      // Ao abrir uma história, já reexibe a última versão no painel principal.
      if (vs.length > 0) onAbrir(id, vs[vs.length - 1]);
    } catch {
      setVersoes([]);
    }
  }

  return (
    <aside className="backlog">
      <h2 className="backlog-titulo">Backlog</h2>
      {historias.length === 0 ? (
        <p className="vazio">Nenhuma história ainda.</p>
      ) : (
        <ul className="backlog-lista">
          {historias.map((h) => (
            <li
              key={h.id}
              className={`backlog-item ${h.id === storyIdAtual ? "ativa" : ""}`}
            >
              <button
                className="backlog-item-btn"
                onClick={() => alternarDetalhe(h.id)}
              >
                <span className="backlog-id">#{h.id}</span>
                <span className="backlog-what">
                  {h.what || "(sem descrição)"}
                </span>
              </button>

              {expandida === h.id && (
                <div className="versoes">
                  <p className="versoes-titulo">
                    {versoes.length}{" "}
                    {versoes.length === 1 ? "versão" : "versões"} — clique para
                    reabrir
                  </p>
                  {versoes.map((v, i) => (
                    <button
                      key={v.id}
                      className="versao versao-clicavel"
                      onClick={() => onAbrir(h.id, v)}
                    >
                      <div className="versao-topo">
                        <span className="versao-num">v{i + 1}</span>
                        <span className="versao-contagem">
                          {v.total_violacoes} viol. ({v.violacoes_regra}R /{" "}
                          {v.violacoes_llm}IA)
                        </span>
                      </div>
                      <p className="versao-entrada">"{v.entrada_original}"</p>
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
