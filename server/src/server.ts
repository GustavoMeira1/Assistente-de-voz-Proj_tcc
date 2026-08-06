import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { askOllama, analisarComLlm } from "./ollama.js";
import { aplicarRegras } from "./rules.js";
import { decomporSimples } from "./parseSimples.js";
import { segmentarDemandas } from "./segmentador.js";
import { transcrever } from "./whisper.js";
import { inicializarBanco } from "./db.js";
import {
  garantirSessao,
  sessaoAtiva,
  iniciarSessao,
  criarHistoria,
  salvarVersao,
  listarHistorias,
  buscarHistoriaComVersoes,
} from "./repository.js";
import type { RefineResult, UserStory, Violation } from "./types.js";

const app = Fastify({ logger: true });

inicializarBanco();

await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(cors, { origin: true });

app.get("/health", async () => {
  return { status: "ok", message: "Servidor do assistente no ar" };
});

app.get("/test-llm", async () => {
  const resposta = await askOllama(
    "Responda em português, em uma frase curta: o que é uma user story?",
  );
  return { resposta };
});

// Inicia uma sessão de experimento (participante + condição).
app.post("/session/start", async (request, reply) => {
  const body = request.body as { participante?: string; condicao?: string };
  if (!body?.participante?.trim()) {
    return reply.status(400).send({ erro: "Informe o participante." });
  }
  const condicao =
    body.condicao === "sem_assistente" ? "sem_assistente" : "com_assistente";
  const id = iniciarSessao(body.participante.trim(), condicao);
  return { sessionId: id, participante: body.participante.trim(), condicao };
});

// Informa a sessão ativa atual (para o front saber a condição).
app.get("/session/current", async () => {
  const ativa = sessaoAtiva();
  return { sessao: ativa };
});

app.post("/transcribe", async (request, reply) => {
  const arquivo = await request.file();
  if (!arquivo) {
    return reply.status(400).send({ erro: "Nenhum áudio enviado." });
  }
  try {
    const buffer = await arquivo.toBuffer();
    const texto = await transcrever(buffer, arquivo.filename);
    return { texto };
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({
      erro: "Falha ao transcrever o áudio.",
      detalhe: err instanceof Error ? err.message : String(err),
    });
  }
});

// Analisa UMA frase e a trata como UMA história (refinamento individual).
// Mantido para compatibilidade e para refinar um card específico.
app.post("/refine", async (request, reply) => {
  const body = request.body as { texto?: string; storyId?: number };

  if (!body?.texto || !body.texto.trim()) {
    return reply
      .status(400)
      .send({ erro: "Envie um campo 'texto' com a frase." });
  }

  try {
    const sessao = garantirSessao();
    const comAssistente = sessao.condicao === "com_assistente";

    let story: UserStory;
    let violations: Violation[] = [];
    let acceptanceCriteria: string[] = [];

    if (comAssistente) {
      const analise = await analisarComLlm(body.texto);
      story = analise.story;
      const violacoesRegras = aplicarRegras(analise.story);
      violations = [...violacoesRegras, ...analise.violations];
      acceptanceCriteria = analise.acceptanceCriteria;
    } else {
      story = decomporSimples(body.texto);
    }

    let storyId = body.storyId;
    if (!storyId) {
      storyId = criarHistoria(sessao.id, story);
    }
    salvarVersao(storyId, body.texto, story, violations, acceptanceCriteria);

    const resultado: RefineResult = {
      storyId,
      story,
      violations,
      acceptanceCriteria,
      condicao: sessao.condicao,
    };
    return resultado;
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({
      erro: "Falha ao analisar a história.",
      detalhe: err instanceof Error ? err.message : String(err),
    });
  }
});

// NOVO: recebe um TRECHO de conversa de daily e extrai MÚLTIPLAS histórias.
// Cada demanda identificada vira um card novo no backlog, já passando pelo
// motor de qualidade (regras + violações do LLM).
app.post("/refine-daily", async (request, reply) => {
  const body = request.body as { texto?: string };

  if (!body?.texto || !body.texto.trim()) {
    return reply
      .status(400)
      .send({ erro: "Envie um campo 'texto' com o trecho." });
  }

  try {
    const sessao = garantirSessao();
    const comAssistente = sessao.condicao === "com_assistente";

    // Na condição de controle, não há segmentação por IA: o trecho inteiro
    // vira uma única história decomposta de forma ingênua (registro do que a
    // pessoa produziria sozinha).
    if (!comAssistente) {
      const story = decomporSimples(body.texto);
      const storyId = criarHistoria(sessao.id, story);
      salvarVersao(storyId, body.texto, story, [], []);
      return {
        condicao: sessao.condicao,
        historias: [{ storyId, story, violations: [], acceptanceCriteria: [] }],
      };
    }

    // COM assistente: segmenta o trecho em N demandas.
    const demandas = await segmentarDemandas(body.texto);

    const historias = [];
    for (const demanda of demandas) {
      // Roda as regras determinísticas em cada história extraída.
      const violacoesRegras = aplicarRegras(demanda.story);

      // Cria o card e salva a primeira versão.
      const storyId = criarHistoria(sessao.id, demanda.story);
      salvarVersao(
        storyId,
        body.texto, // a entrada original é o trecho completo da conversa
        demanda.story,
        violacoesRegras,
        demanda.acceptanceCriteria,
      );

      historias.push({
        storyId,
        story: demanda.story,
        violations: violacoesRegras,
        acceptanceCriteria: demanda.acceptanceCriteria,
      });
    }

    return { condicao: sessao.condicao, historias };
  } catch (err) {
    app.log.error(err);
    return reply.status(500).send({
      erro: "Falha ao processar o trecho da daily.",
      detalhe: err instanceof Error ? err.message : String(err),
    });
  }
});

app.get("/stories", async () => {
  const sessao = garantirSessao();
  return { stories: listarHistorias(sessao.id) };
});

app.get("/stories/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const dados = buscarHistoriaComVersoes(Number(id));
  if (!dados)
    return reply.status(404).send({ erro: "História não encontrada." });
  return dados;
});

const start = async () => {
  try {
    await app.listen({ port: 3333, host: "0.0.0.0" });
    console.log("Servidor rodando em http://localhost:3333");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
