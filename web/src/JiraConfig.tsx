import { useEffect, useState } from "react";

interface ConfigPublica {
  ativo: boolean;
  baseUrl: string;
  email: string;
  projectKey: string;
  issueType: string;
  temToken: boolean;
}

// Configuração da integração opcional com o Jira.
// O token é enviado ao backend e nunca retorna para a tela.
export function JiraConfig({ onMudou }: { onMudou?: () => void }) {
  const [cfg, setCfg] = useState<ConfigPublica | null>(null);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    fetch("http://localhost:3333/config/jira")
      .then((r) => r.json())
      .then((d: ConfigPublica) => setCfg(d))
      .catch(() =>
        setMsg({ ok: false, texto: "Não foi possível ler a configuração." }),
      );
  }, []);

  async function salvar(parcial: Partial<ConfigPublica>) {
    if (!cfg) return;
    setSalvando(true);
    setMsg(null);
    try {
      const resp = await fetch("http://localhost:3333/config/jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cfg, ...parcial, token }),
      });
      const d: ConfigPublica = await resp.json();
      setCfg(d);
      setToken("");
      setMsg({ ok: true, texto: "Configuração salva." });
      onMudou?.();
    } catch {
      setMsg({
        ok: false,
        texto: "Não foi possível salvar. Verifique se o servidor está no ar.",
      });
    } finally {
      setSalvando(false);
    }
  }

  async function testar() {
    setMsg(null);
    try {
      const resp = await fetch("http://localhost:3333/config/jira/testar", {
        method: "POST",
      });
      const d = await resp.json();
      setMsg(
        d.ok
          ? { ok: true, texto: `Conectado como ${d.key}.` }
          : { ok: false, texto: d.erro ?? "O Jira recusou a conexão." },
      );
    } catch {
      setMsg({ ok: false, texto: "Não foi possível contatar o servidor." });
    }
  }

  if (!cfg) return <p className="ajuda">Carregando configuração…</p>;

  return (
    <>
      <div className="bloco">
        <div className="bloco-cabeca">
          <h2 className="bloco-titulo">Enviar histórias para o Jira</h2>
        </div>
        <p className="ajuda">
          Com a integração ligada, cada história do backlog ganha um botão para
          criar um card no seu projeto do Jira. As credenciais ficam salvas
          apenas nesta máquina.
        </p>

        <label className="interruptor">
          <input
            type="checkbox"
            checked={cfg.ativo}
            onChange={(e) => salvar({ ativo: e.target.checked })}
          />
          <span className="interruptor-texto">
            {cfg.ativo ? "Integração ligada" : "Integração desligada"}
          </span>
        </label>

        <div className="grade-campos">
          <div className="form-campo">
            <label htmlFor="jira-url">Endereço do Jira</label>
            <input
              id="jira-url"
              placeholder="https://suaempresa.atlassian.net"
              value={cfg.baseUrl}
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
            />
          </div>
          <div className="form-campo">
            <label htmlFor="jira-email">E-mail da conta Atlassian</label>
            <input
              id="jira-email"
              placeholder="voce@email.com"
              value={cfg.email}
              onChange={(e) => setCfg({ ...cfg, email: e.target.value })}
            />
          </div>
          <div className="form-campo">
            <label htmlFor="jira-token">
              Token de API{" "}
              {cfg.temToken && <span className="nota-token">— já salvo</span>}
            </label>
            <input
              id="jira-token"
              type="password"
              placeholder={
                cfg.temToken
                  ? "deixe vazio para manter o atual"
                  : "cole o token aqui"
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="form-campo">
            <label htmlFor="jira-proj">Chave do projeto</label>
            <input
              id="jira-proj"
              placeholder="TCC"
              value={cfg.projectKey}
              onChange={(e) => setCfg({ ...cfg, projectKey: e.target.value })}
            />
          </div>
          <div className="form-campo">
            <label htmlFor="jira-tipo">Tipo de item</label>
            <input
              id="jira-tipo"
              placeholder="Task"
              value={cfg.issueType}
              onChange={(e) => setCfg({ ...cfg, issueType: e.target.value })}
            />
          </div>
        </div>

        <div className="linha-botoes" style={{ marginTop: 14 }}>
          <button
            className="btn"
            onClick={() => salvar({})}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar configuração"}
          </button>
          <button className="btn-sec" onClick={testar}>
            Testar conexão
          </button>
        </div>

        {msg && <p className={msg.ok ? "aviso-ok" : "erro"}>{msg.texto}</p>}
      </div>

      <div className="bloco">
        <div className="bloco-cabeca">
          <h2 className="bloco-titulo">Onde encontrar esses dados</h2>
        </div>
        <p className="ajuda">
          O token de API é criado em id.atlassian.com, na área de segurança da
          sua conta. Ele aparece uma única vez, então copie antes de fechar.
        </p>
        <p className="ajuda">
          A chave do projeto é o prefixo dos cards existentes no Jira: em
          TCC-14, a chave é TCC.
        </p>
        <p className="ajuda">
          Se o envio falhar mencionando o tipo do item, confira como ele se
          chama no seu projeto — em contas em português costuma ser Tarefa em
          vez de Task.
        </p>
      </div>
    </>
  );
}
