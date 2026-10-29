@echo off
echo [Doks Installer] Preparing lightweight release bundle...
call npm run build
call npm run pack:release
call npm run build:exe
echo [Doks Installer] Build complete. Ready for distribution!
pause
