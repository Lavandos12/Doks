@echo off
chcp 65001 >nul
title Doks Agent

cd /d "%~dp0"

echo ====================================================
echo             Doks (Eluma) v1.0
echo       Локальная совместная площадка
echo ====================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js не найден в системе!
    echo Установите Node.js 20+ с https://nodejs.org/ и повторите запуск.
    echo.
    pause
    exit /b 1
)

if not exist "agent\dist\index.js" (
    echo [Doks] Сборка проекта...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Не удалось собрать проект.
        pause
        exit /b 1
    )
)

echo [Doks] Запуск локального агента...
echo Для остановки нажмите Ctrl+C или закройте это окно.
echo.

node agent/dist/index.js --open

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Сервер завершил работу с ошибкой (%ERRORLEVEL%).
    pause
)
