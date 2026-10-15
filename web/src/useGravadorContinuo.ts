import { useRef, useState } from "react";

// Grava áudio do microfone em BLOCOS e entrega cada bloco ao App, que o
// transcreve e acumula. A duração de 12s reduz o corte de frases.
export function useGravadorContinuo(onBloco: (audio: Blob) => void) {
  const [gravandoAoVivo, setGravandoAoVivo] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // Finalizador do encerramento, associado ao gravador do ÚLTIMO bloco. Só é
  // chamado depois que esse bloco foi entregue ao App (ver parar()).
  const finalRef = useRef<{ recorder: MediaRecorder; fn: () => void } | null>(
    null,
  );

  const DURACAO_BLOCO_MS = 12000;

  async function iniciar() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    setGravandoAoVivo(true);

    const gravarUmBloco = () => {
      if (!streamRef.current) return;
      const recorder = new MediaRecorder(streamRef.current);
      const chunks: Blob[] = []; // pedaços deste bloco (um array por gravador)

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 2000) onBloco(blob);
        // Se este é o gravador do último bloco, avisa que ele foi entregue.
        if (finalRef.current?.recorder === recorder) {
          const fn = finalRef.current.fn;
          finalRef.current = null;
          fn();
        }
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

  // Encerra a captura. A promessa só se resolve DEPOIS que o último bloco de
  // áudio foi entregue ao App, para que nenhum trecho final se perca.
  function parar(): Promise<void> {
    setGravandoAoVivo(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    const stream = streamRef.current;
    streamRef.current = null; // impede que um novo bloco seja iniciado

    return new Promise<void>((resolve) => {
      const encerrar = () => {
        stream?.getTracks().forEach((t) => t.stop()); // desliga o microfone
        resolve();
      };

      if (recorder && recorder.state !== "inactive") {
        finalRef.current = { recorder, fn: encerrar };
        recorder.stop();
        // Segurança: se o evento de fim não chegar em 5 s, encerra mesmo assim.
        window.setTimeout(() => {
          if (finalRef.current?.fn === encerrar) {
            finalRef.current = null;
            encerrar();
          }
        }, 5000);
      } else {
        encerrar();
      }
    });
  }

  return { gravandoAoVivo, iniciar, parar };
}
