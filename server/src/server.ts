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
  listarCardsResumidos,
  editarHistoria,
  buscarHistoriaComVersoes,
} from "./repository.js";
import type { RefineResult, UserStory, Violation } from "./types.js";

const app = Fastify({ logger: true });

inicializarBanco();

await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
});

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

// Refina UMA frase como UMA história (refinamento individual de um card).
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

// Processa um TRECHO de daily: extrai várias demandas e, para cada uma,
// cria um card novo OU atualiza um card existente (decisão do LLM).
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

    // Condição de controle: sem IA, o trecho vira uma história ingênua.
    if (!comAssistente) {
      const story = decomporSimples(body.texto);
      const storyId = criarHistoria(sessao.id, story);
      salvarVersao(storyId, body.texto, story, [], []);
      return {
        condicao: sessao.condicao,
        historias: [
          {
            storyId,
            story,
            violations: [],
            acceptanceCriteria: [],
            acao: "nova",
          },
        ],
      };
    }

    // Envia os cards existentes como contexto para o LLM decidir mesclagem.
    const existentes = listarCardsResumidos(sessao.id);
    const demandas = await segmentarDemandas(body.texto, existentes);

    const historias = [];
    for (const demanda of demandas) {
      const violacoesRegras = aplicarRegras(demanda.story);

      let storyId: number;
      let acao: "nova" | "atualizada";

      if (demanda.alvo === "nova") {
        storyId = criarHistoria(sessao.id, demanda.story);
        acao = "nova";
      } else {
        storyId = demanda.alvo; // id de card existente validado no segmentador
        acao = "atualizada";
      }

      salvarVersao(
        storyId,
        body.texto,
        demanda.story,
        violacoesRegras,
        demanda.acceptanceCriteria,
      );

      historias.push({
        storyId,
        story: demanda.story,
        violations: violacoesRegras,
        acceptanceCriteria: demanda.acceptanceCriteria,
        acao,
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

// Edição manual de um card (corrige who/what/why).
app.put("/stories/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { who?: string; what?: string; why?: string };

  const resultado = editarHistoria(Number(id), {
    who: body.who ?? "",
    what: body.what ?? "",
    why: body.why ?? "",
  });

  if (!resultado.ok) {
    return reply.status(404).send({ erro: "História não encontrada." });
  }
  return { ok: true };
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
