@echo off
echo [Doks Installer] Preparing lightweight release bundle and GUI installer...
call npm run build
call npm run pack:release
call npm run build:exe
call npm run build:setup
echo [Doks Installer] Build complete. Doks.exe and DoksSetup.exe ready for distribution!
pause
