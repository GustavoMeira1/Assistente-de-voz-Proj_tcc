import requests

# Use o áudio de teste que você gravou na Fase 0.
# Ajuste o caminho/extensão para o seu arquivo real.
caminho_audio = r"C:\tcc-assistente\teste.wav"

with open(caminho_audio, "rb") as f:
    resposta = requests.post(
        "http://localhost:5001/transcribe",
        files={"audio": f},
    )

print("Status:", resposta.status_code)
print("Resposta:", resposta.json())