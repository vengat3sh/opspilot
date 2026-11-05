# OpsPilot - Automated Service Runner
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "               OpsPilot - Launching Platform             " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Start Ollama if not running
$ollamaProc = Get-Process ollama -ErrorAction SilentlyContinue
if (-not $ollamaProc) {
    Write-Host "[*] Starting Ollama server in background..." -ForegroundColor Yellow
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
} else {
    Write-Host "[OK] Ollama is already active." -ForegroundColor Green
}

# 2. Start FastAPI Backend (Port 8000)
Write-Host "[*] Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
$uvicornExe = Join-Path $backendPath ".venv\Scripts\uvicorn.exe"
Start-Process $uvicornExe -ArgumentList "app.main:app --port 8000" -WorkingDirectory $backendPath -WindowStyle Hidden

# 3. Start Frontend Dev server (Port 5173)
Write-Host "[*] Starting Frontend Dev server on http://localhost:5173 ..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process npm -ArgumentList "run dev" -WorkingDirectory $frontendPath -WindowStyle Hidden

Start-Sleep -Seconds 2
Write-Host "[OK] OpsPilot is live and available anytime!" -ForegroundColor Green
Write-Host "Production URL: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Live Dev URL:   http://localhost:5173" -ForegroundColor Cyan

# Open browser
Start-Process "http://localhost:5173"
