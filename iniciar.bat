@echo off
REM Sobe os tres servicos do projeto, cada um em sua propria janela.

echo Iniciando o Assistente de Refinement...

REM 1) Servico Whisper (Python) na porta 5001
start "Whisper (5001)" cmd /k "cd /d C:\tcc-assistente && venv\Scripts\activate && cd whisper-service && python whisper_service.py"

REM 2) Backend Node na porta 3333
start "Backend (3333)" cmd /k "cd /d C:\tcc-assistente\server && npm run dev"

REM 3) Frontend Vite na porta 5173
start "Frontend (5173)" cmd /k "cd /d C:\tcc-assistente\web && npm run dev"

echo.
echo Tres janelas foram abertas. Aguarde alguns segundos e acesse:
echo    http://localhost:5173
echo.
echo Feche esta janela quando quiser (ela nao afeta os servicos).
pause