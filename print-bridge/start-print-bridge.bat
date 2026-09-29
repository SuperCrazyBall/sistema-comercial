@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  set "NODE_EXE=node"
) else (
  set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if not "%NODE_EXE%"=="node" if not exist "%NODE_EXE%" (
  echo Node.js nao foi encontrado.
  echo Instale o Node.js ou execute pelo ambiente Codex que possui o runtime empacotado.
  pause
  exit /b 1
)

echo Iniciando ponte local de impressao em http://127.0.0.1:9127
echo Mantenha esta janela aberta enquanto usar a pre-visualizacao do sistema.
"%NODE_EXE%" "%~dp0print-bridge.js"
pause
