from faster_whisper import WhisperModel

# device="cpu" porque sua placa AMD não acelera o Whisper — e tudo bem,
# para clipes curtos por turno a CPU dá conta.
model = WhisperModel("small", device="cpu", compute_type="int8")

segments, info = model.transcribe("teste.wav", language="pt")

print(f"Idioma detectado: {info.language} (confiança {info.language_probability:.2f})")
for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")