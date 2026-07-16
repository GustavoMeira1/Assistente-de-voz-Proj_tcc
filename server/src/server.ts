import Fastify from "fastify";
import cors from "@fastify/cors";
import { askOllama, analisarComLlm } from "./ollama.js";
import { aplicarRegras } from "./rules.js";
import type { RefineResult } from "./types.js";
import multipart from "@fastify/multipart";
import { transcrever } from "./whisper.js";

const app = Fastify({ logger: true });
// Habilita upload de arquivos (áudio). O limite é generoso porque
// gravações de voz de uma sessão de refinement podem ser longas.
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});
// Permite que o frontend (em outra porta) converse com este servidor.
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

// Endpoint principal: recebe uma frase solta e devolve a análise híbrida.
app.post("/refine", async (request, reply) => {
  const body = request.body as { texto?: string };

  if (!body?.texto || !body.texto.trim()) {
    return reply
      .status(400)
      .send({ erro: "Envie um campo 'texto' com a frase." });
  }

  try {
    // 1) O LLM quebra a frase e analisa o semântico.
    const analise = await analisarComLlm(body.texto);

    // 2) As regras determinísticas analisam a história já quebrada.
    const violacoesRegras = aplicarRegras(analise.story);

    // 3) Junta tudo: violações do LLM + violações das regras.
    const resultado: RefineResult = {
      story: analise.story,
      violations: [...violacoesRegras, ...analise.violations],
      acceptanceCriteria: analise.acceptanceCriteria,
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

// Recebe um áudio e devolve o texto transcrito pelo serviço Whisper.
app.post("/transcribe", async (request, reply) => {
  const arquivo = await request.file(); // pega o arquivo enviado

  if (!arquivo) {
    return reply.status(400).send({ erro: "Nenhum áudio enviado." });
  }

  try {
    const buffer = await arquivo.toBuffer(); // lê o áudio como bytes
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
