@echo off
setlocal

rem Resolve the project root from this script's location.
set "ROOT=%~dp0"
set "DOCS=%ROOT%docs"
set "PORT=8000"

if not exist "%DOCS%\index.html" (
    echo ERROR: Demo page not found: "%DOCS%\index.html"
    pause
    exit /b 1
)

rem Start the server minimized. Close its window to stop it.
start "OpenCC PurePy Web - Close to Stop" /MIN /D "%DOCS%" cmd /k "py -m http.server %PORT% --bind 127.0.0.1"

rem Give the server a moment to start before opening the browser.
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%/"

endlocal
