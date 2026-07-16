// Uma user story decomposta em suas três partes.
export interface UserStory {
  who: string; // o perfil: "Como [quem]"
  what: string; // a capacidade: "eu quero [o quê]"
  why: string; // o benefício: "para [por quê]"
}

// Uma violação detectada em uma história.
export interface Violation {
  criterio: string; // qual critério foi ferido (ex: "Atomicidade")
  origem: "regra" | "llm"; // veio de regra determinística ou do LLM
  mensagem: string; // explicação legível do problema
}

// O que o LLM retorna após analisar a frase do usuário.
export interface LlmAnalysis {
  story: UserStory; // a frase quebrada em who/what/why
  violations: Violation[]; // problemas semânticos que o LLM percebeu
  acceptanceCriteria: string[]; // critérios de aceite sugeridos
}

// O resultado completo do endpoint /refine.
export interface RefineResult {
  story: UserStory;
  violations: Violation[]; // regras + LLM juntas
  acceptanceCriteria: string[];
}
