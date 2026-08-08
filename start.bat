@echo off
cd /d "%~dp0"
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 2 /nobreak >nul
start "" /MIN cmd /c "npx electron . > lanshan.log 2>&1"
