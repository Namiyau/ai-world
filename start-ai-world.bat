@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ai-world.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please review the error above.
  pause
)
