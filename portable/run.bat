@echo off
REM Arranca sicr3p portatil desde esta carpeta (pendrive). Requiere Node 22.5+.
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias (solo la primera vez)...
  call npm install --omit=dev
)
echo Abriendo sicr3p portatil en http://localhost:4100
node --no-warnings server.js
pause
