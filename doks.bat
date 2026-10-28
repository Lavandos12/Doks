@echo off
cd /d "%~dp0"
if exist "%~dp0Doks.exe" (
  start "" "%~dp0Doks.exe"
  exit /b 0
)
if not exist "%~dp0node_modules" (
  echo Installing dependencies...
  call npm install
)
if not exist "%~dp0agent\dist\index.js" (
  echo Building Doks...
  call npm run build
)
node "%~dp0agent\dist\index.js" --open
