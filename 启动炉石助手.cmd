@echo off
setlocal

set "APP_DIR=%~dp0apps\overlay"

if exist "%APP_DIR%\package.json" goto start_app

echo package.json not found:
echo "%APP_DIR%\package.json"
pause
exit /b 1

:start_app
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*apps\overlay\node_modules\electron\dist\electron.exe' } | Stop-Process -Force"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$wd = $env:APP_DIR; $p = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','start:floating') -WorkingDirectory $wd -WindowStyle Hidden -PassThru; Write-Host ('Started PID: ' + $p.Id)"

if errorlevel 1 goto failed

powershell -NoProfile -Command "Start-Sleep -Seconds 2"
exit /b 0

:failed
echo start failed. Try this first:
echo cd /d "%APP_DIR%"
echo npm.cmd install
pause
exit /b 1
