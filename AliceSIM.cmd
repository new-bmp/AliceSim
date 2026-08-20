@echo off
setlocal
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo AliceSIM requires Windows PowerShell.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "ALICESIM_EXIT=%ERRORLEVEL%"
if not "%ALICESIM_EXIT%"=="0" (
  echo.
  echo AliceSIM failed to start. Review the message above, then press any key to close.
  pause >nul
)
exit /b %ALICESIM_EXIT%
