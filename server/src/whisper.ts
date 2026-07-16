const WHISPER_URL = "http://localhost:5001/transcribe";

// Recebe o áudio (como Buffer) e devolve o texto transcrito pelo serviço Python.
export async function transcrever(
  audio: Buffer,
  nomeArquivo: string,
): Promise<string> {
  // Monta um formulário com o arquivo de áudio, no formato que o Flask espera.
  const form = new FormData();
  const blob = new Blob([audio]);
  form.append("audio", blob, nomeArquivo);

  const response = await fetch(WHISPER_URL, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Serviço Whisper respondeu com status ${response.status}`);
  }

  const data = (await response.json()) as { texto: string; idioma: string };
  return data.texto;
}
