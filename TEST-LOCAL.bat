@echo off
setlocal
cd /d "%~dp0"

set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON_CMD=py"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PYTHON_CMD=python"
  ) else (
    echo.
    echo Python n'a pas ete trouve sur ce PC.
    echo Installe Python 3, puis relance TEST-LOCAL.bat.
    echo.
    pause
    exit /b 1
  )
)

echo ============================================
echo  Le Sceau des Quatre Passages - TEST LOCAL
echo ============================================
echo.
echo Adresse : http://localhost:%PORT%/?test=1
echo Fermez cette fenetre ou faites Ctrl+C pour arreter le serveur.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 800; Start-Process 'http://localhost:%PORT%/?test=1'"
%PYTHON_CMD% -m http.server %PORT% --bind 127.0.0.1

endlocal
