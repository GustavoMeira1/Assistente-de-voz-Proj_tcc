import { useRef, useState } from "react";

// Encapsula a lógica de gravar áudio do microfone e enviar para transcrição.
export function useGravador() {
  const [gravando, setGravando] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Começa a gravar: pede o microfone e liga o MediaRecorder.
  async function iniciar() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];

    // Cada pedaço de áudio capturado é guardado.
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setGravando(true);
  }

  // Para a gravação, monta o áudio e envia para o backend transcrever.
  // Retorna o texto transcrito.
  function pararEEnviar(): Promise<string> {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        reject(new Error("Nenhuma gravação em andamento."));
        return;
      }

      // Quando o recorder efetivamente parar, montamos e enviamos o áudio.
      recorder.onstop = async () => {
        setGravando(false);
        setTranscrevendo(true);
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const form = new FormData();
          form.append("audio", blob, "gravacao.webm");

          const resp = await fetch("http://localhost:3333/transcribe", {
            method: "POST",
            body: form,
          });
          if (!resp.ok) throw new Error(`servidor respondeu ${resp.status}`);

          const dados = (await resp.json()) as { texto: string };

          // Libera o microfone (apaga o indicador de "gravando" do navegador).
          recorder.stream.getTracks().forEach((t) => t.stop());

          resolve(dados.texto);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("erro ao transcrever"));
        } finally {
          setTranscrevendo(false);
        }
      };

      recorder.stop();
    });
  }

  return { gravando, transcrevendo, iniciar, pararEEnviar };
}
