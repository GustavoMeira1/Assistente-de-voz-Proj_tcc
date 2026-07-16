# Assistente de Voz para Facilitação de User Stories

Protótipo de TCC que investiga o uso de um assistente de voz como ferramenta de
apoio à facilitação de *user stories* em metodologias ágeis. O sistema atua como
mediador em sessões de *refinement*, guiando a elicitação de **who/what/why**,
sugerindo critérios de aceite e verificando heurísticas de qualidade
(**INVEST** e **QUS**) por meio de um **motor híbrido** (regras determinísticas
+ LLM).

> Estado atual: **Fase 1 concluída** — o "cérebro" em texto puro está funcional
> de ponta a ponta. A camada de voz (Fase 2) está em desenvolvimento.

---

## Arquitetura

O sistema é composto por peças independentes que rodam localmente (sem custo de
tokens/créditos):

| Peça | Tecnologia | Papel |
|------|-----------|-------|
| Backend | Node + TypeScript + Fastify | Orquestra o fluxo e expõe a API |
| LLM | Ollama + Qwen2.5 7B (GPU) | Decompõe a frase e julga o semântico |
| Regras | TypeScript puro (estilo AQUSA) | Verifica defeitos sintáticos/objetivos |
| ASR | faster-whisper (CPU) | Transcreve voz em texto *(Fase 2)* |
| TTS | SpeechSynthesis do navegador | Retorno auditivo *(Fase 2)* |
| Frontend | React + TypeScript + Vite | Interface multimodal *(Fase 2)* |

### O motor híbrido

O coração do projeto. A análise de uma história é feita em duas metades
complementares, e é isso que dá ao sistema tanto **cobertura** quanto
**rastreabilidade**:

1. **Metade determinística (regras).** Funções puras que checam o que não exige
   IA: template "Como/eu quero/para" completo, atomicidade (indícios de história
   dupla via conectores como "e"/"ou"), tamanho mínimo e vocabulário vago que
   fere a testabilidade. É 100% explicável — cada violação aponta exatamente a
   regra ferida.

2. **Metade do LLM.** Decompõe uma frase livre em who/what/why e julga o que as
   regras não conseguem: se o benefício é um valor real, se há ambiguidade
   semântica, se a capacidade é testável na prática. Também sugere critérios de
   aceite observáveis.

Toda violação carrega o campo `origem` (`"regra"` ou `"llm"`), permitindo medir,
no estudo empírico, quanto cada metade contribuiu para a detecção de defeitos.

> **Por que híbrido?** Durante o desenvolvimento, uma regra baseada em lista de
> termos deixou passar "rápida" porque a lista continha apenas "rápido"
> (flexão de gênero). Esse caso ilustra a limitação fundamental das regras e
> justifica a presença do LLM para os casos linguísticos e semânticos que uma
> lista fixa nunca cobre. (A regra foi depois corrigida com normalização de
> acentos e comparação por radical.)

---

## Pré-requisitos

- **Node.js** 20+ (testado com v20.12.0)
- **Ollama** instalado, com o modelo baixado: `ollama pull qwen2.5:7b`
- **Python** 3.11 (para a Fase 2 — ASR)
- GPU compatível para o Ollama (testado em AMD RX 5500 XT via Vulkan, 100% GPU,
  ~3s por resposta)

---

## Estrutura de pastas

```
tcc-assistente/
├── venv/                     # ambiente virtual Python (ASR)
├── test_whisper.py           # teste isolado do faster-whisper
└── server/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── server.ts         # servidor Fastify e rotas (/health, /test-llm, /refine)
        ├── ollama.ts         # comunicação com o LLM local + análise em JSON
        ├── rules.ts          # regras determinísticas (estilo AQUSA)
        ├── types.ts          # tipos compartilhados (UserStory, Violation, etc.)
        └── test-rules.ts     # teste isolado das regras
```

### O que cada arquivo faz

- **`server.ts`** — sobe o servidor na porta 3333 e define as rotas. A rota
  principal `/refine` executa a sequência do motor híbrido: o LLM quebra a frase
  → as regras analisam a história quebrada → as violações das duas fontes são
  unidas.
- **`ollama.ts`** — `askOllama()` envia um prompt ao modelo local;
  `analisarComLlm()` monta o prompt de análise, chama o modelo, limpa a resposta
  (remove eventuais cercas de markdown) e faz o *parse* do JSON estruturado.
- **`rules.ts`** — cada critério é uma função separada (`verificarTemplate`,
  `verificarAtomicidade`, `verificarTamanho`, `verificarTermosVagos`), orquestradas
  por `aplicarRegras()`. Usa normalização de acentos e comparação por radical
  para robustez em português.
- **`types.ts`** — contratos de dados que circulam pelo sistema.

---

## Como rodar

### 1. Backend (Node)

```bash
cd server
npm install          # apenas na primeira vez
npm run dev          # sobe o servidor com recarga automática (tsx watch)
```

O servidor sobe em `http://localhost:3333`.

### 2. LLM (Ollama)

O serviço do Ollama sobe sozinho após a instalação. Confirme o modelo:

```bash
ollama list          # deve listar qwen2.5:7b
```

---

## Endpoints (Fase 1)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Confirma que o servidor está no ar |
| GET | `/test-llm` | Testa a conexão com o LLM |
| POST | `/refine` | Analisa uma frase e devolve história + violações + critérios de aceite |

### Exemplo de uso do `/refine`

Requisição:

```json
{ "texto": "Como gerente eu quero exportar e imprimir relatórios de forma rápida para acompanhar a equipe" }
```

Resposta (resumida):

```json
{
  "story": { "who": "gerente", "what": "exportar e imprimir relatórios de forma rápida", "why": "para acompanhar a equipe" },
  "violations": [
    { "criterio": "Atomicidade (Small)", "origem": "regra", "mensagem": "..." },
    { "criterio": "Testabilidade (Testable)", "origem": "regra", "mensagem": "..." },
    { "criterio": "INVEST", "origem": "llm", "mensagem": "..." }
  ],
  "acceptanceCriteria": [
    "O sistema deve permitir exportar relatórios em menos de 5 segundos.",
    "..."
  ]
}
```

---

## Roadmap

- [x] **Fase 0** — Setup (Node, LLM em GPU, ASR validado)
- [x] **Fase 1** — Cérebro em texto puro (motor híbrido completo)
- [ ] **Fase 2** — Camada de voz (ASR na entrada, TTS na saída, frontend multimodal)
- [ ] **Fase 3** — Backlog Kanban + logging + modo controle (assistente on/off)
- [ ] **Fase 4** — Piloto e ajustes
- [ ] **Fase 5** — Sessões do experimento e análise dos dados

---

## Referências principais

- LUCASSEN et al. (2016) — *Quality User Story framework and tool* (QUS/AQUSA)
- COHN (2004) — *User Stories Applied*
- SCHWABER; SUTHERLAND (2020) — *The Scrum Guide*
- COHEN; GIANGOLA; BALOGH (2004) — *Voice User Interface Design*
