@echo off
title OpsPilot - Starting Services...
echo ========================================================
echo               OpsPilot - Launching Platform
echo ========================================================

:: 1. Start Ollama in background if not running
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Ollama is already running.
) else (
    echo [*] Starting Ollama in background...
    start /B ollama serve > nul 2>&1
    timeout /t 3 /nobreak > nul
)

:: 2. Start FastAPI Backend + Production Frontend (Port 8000)
echo [*] Starting OpsPilot Backend on http://localhost:8000 ...
cd /d "%~dp0backend"
start "OpsPilot Server" /B "%~dp0backend\.venv\Scripts\uvicorn.exe" app.main:app --port 8000

:: 3. Start Frontend Dev server as well (Port 5173) for live changes
cd /d "%~dp0frontend"
start "OpsPilot Frontend" /B npm run dev

:: 4. Open in default browser
timeout /t 2 /nobreak > nul
echo [OK] Opening OpsPilot in browser...
start http://localhost:5173

echo.
echo ========================================================
echo   OpsPilot is running and ready to answer!
echo   Production App: http://localhost:8000
echo   Dev Studio:     http://localhost:5173
echo ========================================================
