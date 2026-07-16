import { useState, useEffect } from "react";

// Encapsula a síntese de fala (TTS) com controle de pausa/retomada
// e rastreio de qual bloco está sendo lido.
export function useFala() {
  const [falando, setFalando] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [blocoAtivo, setBlocoAtivo] = useState<string | null>(null);
  const [vozPt, setVozPt] = useState<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    function carregarVozes() {
      const vozes = window.speechSynthesis.getVoices();
      const pt = vozes.find((v) => v.lang.toLowerCase().startsWith("pt"));
      if (pt) setVozPt(pt);
    }
    carregarVozes();
    window.speechSynthesis.onvoiceschanged = carregarVozes;
  }, []);

  // Lê um texto. O 'id' identifica qual bloco está falando (para a interface).
  function falar(texto: string, id: string) {
    if (!texto.trim()) return;
    window.speechSynthesis.cancel();

    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    if (vozPt) fala.voice = vozPt;
    fala.rate = 1.0;

    fala.onstart = () => {
      setFalando(true);
      setPausado(false);
      setBlocoAtivo(id);
    };
    fala.onend = () => {
      setFalando(false);
      setPausado(false);
      setBlocoAtivo(null);
    };
    fala.onerror = () => {
      setFalando(false);
      setPausado(false);
      setBlocoAtivo(null);
    };

    window.speechSynthesis.speak(fala);
  }

  function pausar() {
    window.speechSynthesis.pause();
    setPausado(true);
  }

  function retomar() {
    window.speechSynthesis.resume();
    setPausado(false);
  }

  function parar() {
    window.speechSynthesis.cancel();
    setFalando(false);
    setPausado(false);
    setBlocoAtivo(null);
  }

  return { falar, pausar, retomar, parar, falando, pausado, blocoAtivo };
}
