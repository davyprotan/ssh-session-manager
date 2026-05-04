@echo off
:: Check if server is already running
curl -s -o NUL http://localhost:3005 >NUL 2>&1
if %errorlevel% == 0 goto open

:: Start the server in the background
start /B cmd /c "cd /d "%~dp0" && npm start > "%TEMP%\ssh-manager.log" 2>&1"

:: Wait for server to be ready
:wait
timeout /t 1 /nobreak >NUL
curl -s -o NUL http://localhost:3005 >NUL 2>&1
if %errorlevel% neq 0 goto wait

:open
start "" "http://localhost:3005"
