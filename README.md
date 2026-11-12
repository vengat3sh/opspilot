# OpsPilot

Enterprise AI knowledge intelligence and autonomous operations platform. Current state: **authenticated Phase 2/3 platform** — FastAPI backend, React chat UI, hybrid local (Ollama) + cloud LLM, PostgreSQL persistence for users, conversations, projects, controlled tools, documents, tickets and approvals.

## Run locally (Windows 11, PowerShell)

Prerequisites: Python 3.11, Node 22, PostgreSQL, and optionally [Ollama](https://ollama.com).

```powershell
# 1. Model (optional if using a cloud provider)
ollama pull qwen3:1.7b

# 2. Backend (terminal 1)
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET_KEY, and either OLLAMA_* or CLOUD_API_KEY
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. Frontend (terminal 2)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, sign up or log in, then send a message. Chat and all user-data endpoints require authentication.

Checks:
```powershell
curl http://127.0.0.1:8000/health
cd backend; pytest -q
python scripts/verify_migrations.py   # disposable DB; never touches the app database
cd frontend; npm run build
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
- Run `alembic upgrade head` before starting the backend when using `backend/Dockerfile` (that image does not copy Alembic files). The root `Dockerfile` used by `render.yaml` does include migrations.

### Public deployment notes
Use HTTPS in front of the app (Caddy, Cloudflare, or a load balancer). Set `COOKIE_SECURE=true`, an explicit `CORS_ORIGINS`, a strong `JWT_SECRET_KEY`, and a managed `DATABASE_URL`. `render.yaml` runs `alembic upgrade head` as a pre-deploy command.

### Honest limitations
- Git push, deployment providers, read-only database connections, attachments and multimodal input are **not connected**. Those endpoints return empty lists, `503`, or an explicit unsupported response instead of simulated data.
- Build/test/shell tools require a reachable Docker sandbox (`SANDBOX_ENABLED=true`); without Docker they return `unavailable` with no host fallback.
- Repository indexing requires `PROJECT_WORKSPACE_ROOT`; otherwise it returns `503`.
- Chat cancellation is process-local; multi-worker deployments need a shared cancellation channel.
- Live Render production behavior must be verified with deployment logs and runtime access.

## Structure
```
backend/   FastAPI app (app/), Alembic migrations, tests, scripts
frontend/  React + TS + Vite
docker-compose.yml, render.yaml, .github/workflows/ci.yml, PROJECT_STATUS.md
```
