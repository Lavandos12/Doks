@echo off
setlocal enabledelayedexpansion
title Doks Build and Distribution Suite

echo ==============================================================
echo    ____       _        
echo   ^|  _ \  ___^| ^| _____ 
echo   ^| ^| ^| ^|/ _ \ ^|/ / __^|
echo   ^| ^|_^| ^| (_) ^|   ^\__ \
echo   ^|____/ \___/^|_^|\_\___/  COLLABORATIVE CANVAS
echo ==============================================================
echo.

echo [1/4] Compiling TypeScript workspaces...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] TypeScript compilation failed!
    pause
    exit /b %errorlevel%
)
echo       ^-- TypeScript compiled successfully!
echo.

echo [2/4] Packaging protected server bundle...
call npm run pack:release
echo       ^-- Release package ready!
echo.

echo [3/4] Compiling Doks.exe System Tray Launcher...
call npm run build:exe
echo       ^-- Doks.exe compiled!
echo.

echo [4/4] Compiling DoksSetup.exe GUI Installer...
call npm run build:setup
echo       ^-- DoksSetup.exe compiled!
echo.

echo ==============================================================
echo [SUCCESS] Build completed!
echo.
echo Executables created:
echo   - DoksSetup.exe (Standalone Graphical Windows Installer)
echo   - Doks.exe      (System Tray Daemon and Browser Launcher)
echo.
echo You can now send DoksSetup.exe to your friend for a 1-click install!
echo ==============================================================
echo.
pause
