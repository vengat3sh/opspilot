# OpsPilot

Enterprise AI knowledge intelligence and autonomous operations platform. This is **Phase 1 (Foundation)**: FastAPI backend, React chat UI, hybrid local (Ollama) + cloud LLM.

## Run locally (Windows 11, PowerShell)

Prerequisites: Python 3.11, Node 22, [Ollama](https://ollama.com).

```powershell
# 1. Model
ollama pull qwen3:1.7b

# 2. Backend (terminal 1)
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000

# 3. Frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Both badges should be green; send a message.

Checks:
```powershell
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/llm/status
cd backend; pytest -q
ollama ps          # shows whether the model runs on GPU or CPU
```

## Cloud LLM
Edit `backend/.env`: set `CLOUD_API_KEY` (and optionally `CLOUD_BASE_URL`, `CLOUD_MODEL`; any OpenAI-compatible API works, e.g. Groq or OpenRouter). Then pick **Cloud** in the UI or set `LLM_PROVIDER=cloud`. The key is never sent to the browser.

## Deploy with Docker
```powershell
docker compose up -d --build
```
App: http://localhost:8080 (nginx serves the UI and proxies `/api` to the backend).

- Default expects Ollama running on your host (`host.docker.internal:11434`).
- To run Ollama in Docker instead (needs NVIDIA container toolkit for GPU): create a root `.env` with `OLLAMA_BASE_URL=http://ollama:11434`, then `docker compose --profile ollama up -d --build` and `docker compose exec ollama ollama pull qwen3:1.7b`.
- Set `POSTGRES_PASSWORD` in a root `.env` before exposing anything beyond localhost.

### Public deployment notes
A 1.7B local model on a cloud VM is CPU-only and slow. For a public demo, deploy to any Docker host (VPS, AWS EC2, Render, Railway) with `LLM_PROVIDER=cloud` and your API key in the backend environment. Put HTTPS in front (Caddy, Cloudflare, or a load balancer). There is no authentication yet (Phase 6), so don't leave it open to the internet with a paid API key.

## Structure
```
backend/   FastAPI app (app/), tests/
frontend/  React + TS + Vite + Tailwind
docker-compose.yml, .github/workflows/ci.yml, PROJECT_STATUS.md
```
