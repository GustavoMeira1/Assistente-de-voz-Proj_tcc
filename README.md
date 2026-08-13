# Assistente de Voz para Facilitação de User Stories em Dailies

Protótipo de TCC que investiga o uso de um assistente de voz como ferramenta de
apoio à facilitação de _user stories_ em metodologias ágeis. O assistente escuta
(ou recebe por texto) trechos de uma reunião de _daily_ e transforma a conversa
em um backlog estruturado: identifica múltiplas demandas em uma fala, cria ou
atualiza cards automaticamente, estrutura cada um em **who/what/why**, verifica
qualidade (**INVEST/QUS**) por um **motor híbrido** (regras + LLM) e registra
tudo para análise.

> Estado atual: **Fase 3 concluída** — o instrumento de pesquisa está completo
> (captura por voz, backlog persistente, modo daily com mesclagem, sessões
> com/sem assistente, export de dados). Pendentes: captura contínua ao vivo e
> execução do experimento.

---

## Arquitetura

Todas as peças rodam localmente, sem custo de tokens/créditos:

| Peça     | Tecnologia                                 | Papel                                  |
| -------- | ------------------------------------------ | -------------------------------------- |
| Frontend | React + TypeScript + Vite                  | Interface multimodal (voz + tela)      |
| Backend  | Node + TypeScript + Fastify                | Orquestra o fluxo e expõe a API        |
| LLM      | Ollama + Qwen2.5 7B (GPU via Vulkan)       | Segmenta demandas, estrutura e julga   |
| Regras   | TypeScript puro (estilo AQUSA)             | Verifica defeitos sintáticos/objetivos |
| ASR      | faster-whisper (serviço Python/Flask, CPU) | Transcreve voz em texto                |
| TTS      | SpeechSynthesis do navegador               | Leitura por voz sob demanda            |
| Banco    | SQLite nativo do Node (`node:sqlite`)      | Persistência e histórico de versões    |

### O motor híbrido

A análise de qualidade combina duas metades complementares, e cada violação
carrega o campo `origem` (`"regra"` ou `"llm"`) para permitir medir a
contribuição de cada uma:

1. **Regras determinísticas** — funções puras que checam template completo,
   atomicidade, tamanho mínimo e vocabulário vago (normalização de acentos e
   comparação por radical para robustez em português). 100% explicável.
2. **LLM** — julga o semântico/pragmático (benefício real, ambiguidade,
   testabilidade) e sugere critérios de aceite.

### O fluxo da daily (modo principal)

1. Um trecho da conversa chega (voz transcrita ou texto colado).
2. O LLM **segmenta**: identifica cada demanda distinta no trecho.
3. Para cada demanda, decide **criar card novo** ou **atualizar um existente**
   (recebe a lista de cards atuais como contexto; ids inválidos viram "nova").
4. Estrutura em who/what/why (o `who` é a pessoa responsável citada na fala).
5. Roda o motor de qualidade e salva cada card como versão no backlog.
6. O usuário pode reabrir, ouvir por voz e **editar manualmente** para corrigir.

---

## Estrutura de pastas

```
tcc-assistente/
├── iniciar.bat / parar.bat       # sobem/encerram os serviços de uma vez
├── venv/                         # ambiente Python (ASR)
├── whisper-service/
│   └── whisper_service.py        # serviço Flask de transcrição (porta 5001)
├── server/                       # backend Node (porta 3333)
│   └── src/
│       ├── server.ts             # servidor e rotas
│       ├── ollama.ts             # comunicação com o LLM
│       ├── segmentador.ts        # extrai N demandas de um trecho (daily)
│       ├── rules.ts              # regras determinísticas (AQUSA)
│       ├── parseSimples.ts       # decomposição ingênua (condição de controle)
│       ├── repository.ts         # operações de banco (sessões, versões, edição)
│       ├── exportador.ts         # geração dos CSVs
│       ├── db.ts                 # esquema SQLite
│       └── types.ts              # tipos compartilhados
└── web/                          # frontend React (porta 5173)
    └── src/
        ├── App.tsx               # tela principal (modos daily e individual)
        ├── Backlog.tsx           # lista de histórias + versões
        ├── ExportBar.tsx         # botões de download dos CSVs
        ├── useGravador.ts        # captura de áudio do microfone
        ├── useFala.ts            # síntese de voz (TTS)
        └── index.css             # estilos
```

---

## Como rodar

**Opção rápida:** duplo-clique em `iniciar.bat` (sobe Whisper, backend e
frontend em janelas separadas). O Ollama sobe sozinho com o Windows.

**Manual (um terminal por serviço):**

1. Whisper: `cd whisper-service` → `python whisper_service.py`
2. Backend: `cd server` → `npm run dev`
3. Frontend: `cd web` → `npm run dev`
4. Acessar `http://localhost:5173`

Pré-requisitos: Node 22+, Python 3.11, Ollama com `qwen2.5:7b`.

---

## Principais endpoints

| Método | Rota                    | Descrição                                           |
| ------ | ----------------------- | --------------------------------------------------- |
| POST   | `/session/start`        | Inicia sessão (participante + condição)             |
| GET    | `/session/current`      | Sessão ativa                                        |
| POST   | `/transcribe`           | Áudio → texto (via Whisper)                         |
| POST   | `/refine`               | Analisa uma frase como uma história                 |
| POST   | `/refine-daily`         | Extrai N demandas de um trecho; cria/atualiza cards |
| PUT    | `/stories/:id`          | Edição manual de um card                            |
| GET    | `/stories`              | Backlog da sessão ativa                             |
| GET    | `/stories/:id`          | História com histórico de versões                   |
| GET    | `/export/versoes.csv`   | Dados detalhados (uma linha por versão)             |
| GET    | `/export/historias.csv` | Resumo (uma linha por história)                     |

---

## O experimento (desenho)

Estudo intra-sujeitos comparando duas condições:

- **Com assistente:** daily processada pelo assistente (segmentação, motor de
  qualidade, voz).
- **Sem assistente (controle):** mesma atividade sem apoio de IA (decomposição
  ingênua, sem violações/critérios), registrando o que a pessoa produz sozinha.

Cada sessão isola participante + condição. Métricas coletadas: completude
who/what/why, violações por origem (regra/IA), número de versões, e material
para usabilidade/aceitação. Os CSVs alimentam a análise estatística.

---

## Roadmap

- [x] **Fase 0** — Setup (Node, LLM em GPU, ASR)
- [x] **Fase 1** — Motor híbrido em texto
- [x] **Fase 2** — Camada de voz (ASR, TTS, frontend multimodal)
- [x] **Fase 3** — Instrumento de pesquisa (banco, daily+mesclagem, sessões, export)
- [ ] **Captura contínua ao vivo** — gravar em blocos e alimentar a daily automaticamente
- [ ] **Fase 4** — Piloto e ajustes
- [ ] **Fase 5** — Sessões do experimento e análise

---

## Referências principais

- LUCASSEN et al. (2016) — _Quality User Story framework and tool_ (QUS/AQUSA)
- COHN (2004) — _User Stories Applied_
- SCHWABER; SUTHERLAND (2020) — _The Scrum Guide_
- COHEN; GIANGOLA; BALOGH (2004) — _Voice User Interface Design_
