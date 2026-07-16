from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import tempfile
import os

app = Flask(__name__)

# O modelo é carregado UMA vez, quando o serviço sobe — não a cada requisição.
# É isso que torna cada transcrição rápida depois.
print("Carregando modelo Whisper... (a primeira vez demora um pouco)")
model = WhisperModel("small", device="cpu", compute_type="int8")
print("Modelo carregado. Serviço pronto na porta 5001.")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    # Espera um arquivo de áudio no campo 'audio'.
    if "audio" not in request.files:
        return jsonify({"erro": "Envie um arquivo no campo 'audio'."}), 400

    audio = request.files["audio"]

    # Salva o áudio recebido num arquivo temporário para o Whisper ler.
    with tempfile.NamedTemporaryFile(delete=False, suffix=".audio") as tmp:
        audio.save(tmp.name)
        caminho = tmp.name

    try:
        segments, info = model.transcribe(caminho, language="pt")
        # Junta todos os trechos num texto único.
        texto = " ".join(seg.text.strip() for seg in segments).strip()
        return jsonify({"texto": texto, "idioma": info.language})
    finally:
        os.remove(caminho)  # limpa o arquivo temporário


if __name__ == "__main__":
    app.run(port=5001)