@echo off
chcp 65001 >nul
echo [Doks] Настройка автозапуска в Windows...

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT_DIR=%~dp0..
set LAUNCHER=%SCRIPT_DIR%\start.bat

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP_DIR%\Doks.lnk'); $s.TargetPath = '%LAUNCHER%'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.WindowStyle = 7; $s.Save()"

if %ERRORLEVEL% equ 0 (
    echo [OK] Ярлык автозапуска успешно создан в Startup!
    echo Doks будет запускаться автоматически при входе в Windows.
) else (
    echo [ERROR] Не удалось создать ярлык автозапуска.
)
pause
