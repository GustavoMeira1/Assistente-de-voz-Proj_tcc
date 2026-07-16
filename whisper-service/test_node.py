import requests

caminho_audio = r"C:\tcc-assistente\teste.wav"  # ajuste para seu arquivo

with open(caminho_audio, "rb") as f:
    resposta = requests.post(
        "http://localhost:3333/transcribe",  # agora aponta para o NODE
        files={"audio": f},
    )

print("Status:", resposta.status_code)
print("Resposta:", resposta.json())