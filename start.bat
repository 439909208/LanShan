@echo off
setlocal
title LanShan Launcher
cd /d "%~dp0"

where npx >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npx not found. Please install Node.js first.
    pause
    exit /b 1
)

echo [start] Killing old instances (project electron only)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'Name=''electron.exe''' | Where-Object { $_.CommandLine -like '*%~dp0*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
ping -n 3 127.0.0.1 >nul

echo [start] Starting Electron - logs show live in this window...
call npx --yes electron .
set "ec=%ERRORLEVEL%"

echo.
echo [start] Exited with code: %ec%
pause
