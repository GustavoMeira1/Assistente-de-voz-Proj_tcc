import { useRef, useState } from "react";

// Grava áudio do microfone em BLOCOS e, a cada bloco transcrito, entrega o
// texto para o App acumular. A duração maior (12s) reduz o corte de frases.
export function useGravadorContinuo(onBloco: (audio: Blob) => void) {
  const [gravandoAoVivo, setGravandoAoVivo] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<number | null>(null);

  // 12s: equilíbrio entre latência e frases inteiras. Como o texto é
  // acumulado e reprocessado, um corte eventual é corrigido no ciclo seguinte.
  const DURACAO_BLOCO_MS = 12000;

  async function iniciar() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    setGravandoAoVivo(true);

    const gravarUmBloco = () => {
      if (!streamRef.current) return;
      const recorder = new MediaRecorder(streamRef.current);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size > 2000) onBloco(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;

      timeoutRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
        if (streamRef.current) gravarUmBloco();
      }, DURACAO_BLOCO_MS);
    };

    gravarUmBloco();
  }

  function parar() {
    setGravandoAoVivo(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  return { gravandoAoVivo, iniciar, parar };
}
