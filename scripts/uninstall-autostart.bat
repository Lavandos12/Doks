@echo off
chcp 65001 >nul
echo [Doks] Удаление автозапуска...

set SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Doks.lnk

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo [OK] Ярлык автозапуска удален.
) else (
    echo [INFO] Ярлык автозапуска не был установлен.
)
pause
