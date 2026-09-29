@echo off
setlocal
cd /d "%~dp0"

echo Iniciando ponte local de impressao...
start "Sistema Comercial - Print Bridge" "%~dp0print-bridge\start-print-bridge.bat"

echo Aguardando a ponte ficar disponivel...
for /l %%i in (1,1,20) do (
  powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:9127/status' -TimeoutSec 1; if ($r.ok) { exit 0 } } catch { exit 1 }"
  if not errorlevel 1 goto bridge_ok
  timeout /t 1 /nobreak >nul
)

echo.
echo A ponte pode ainda estar iniciando. O sistema sera aberto mesmo assim.
echo Se aparecer aviso de ponte local, confira a janela "Sistema Comercial - Print Bridge".

:bridge_ok
echo Abrindo Sistema Comercial...
start "" "%~dp0index.html"
exit /b 0
