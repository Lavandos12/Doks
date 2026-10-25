@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo [ERROR] Node.js 20+ is required to run Doks.
  echo Please install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "agent\dist\index.js" (
  echo [Doks] First-time build...
  call npm run build
  if %ERRORLEVEL% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)

node agent/dist/index.js --open %*
if %ERRORLEVEL% neq 0 (
  pause
)
