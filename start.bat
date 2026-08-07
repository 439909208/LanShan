@echo off
cd /d "C:\Users\Administrator\Desktop\澜山"
REM 启动前先结束旧进程（开发版 electron / 打包版 exe），防止旧版本残留导致看不到新功能
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM "澜山 0.1.0.exe" >nul 2>&1
timeout /t 1 /nobreak >nul
start "" /B npx electron . >nul 2>&1
