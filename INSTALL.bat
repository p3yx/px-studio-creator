@echo off
setlocal
cd /d "%~dp0"
echo PX STUDIO CREATOR - Auto Install
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0INSTALL.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Instalasi gagal. Periksa pesan di atas.
  pause
  exit /b 1
)
endlocal
