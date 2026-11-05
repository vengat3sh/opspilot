# OpsPilot — Project Status

**Phase:** 1 (Foundation) — code complete, pending verification on your machine.

## Done
- FastAPI backend: `/health`, `/api/llm/status`, `POST /api/chat`
- LLM layer: Ollama (Qwen3 1.7B, thinking disabled) + OpenAI-compatible cloud provider, switchable per request
- React + TS + Vite + Tailwind + React Query + Axios chat UI with status badges and provider selector
- Docker (backend, frontend/nginx, pgvector DB, optional Ollama), GitHub Actions CI
- Tests: 10 backend unit tests (mocked LLM, no network); frontend production build

## Not verified yet (needs your machine)
- Real Qwen3 1.7B inference and GPU use on RTX 3050 (`ollama ps`)
- Cloud provider with a real key
- `docker compose up` end to end

## Key paths
- `backend/app/{main,config,llm,schemas}.py`, `backend/app/routers/chat.py`
- `frontend/src/{App.tsx,api.ts}`

## Next
Phase 2 — Document Intelligence: upload endpoint, PDF/DOCX/TXT/CSV parsing, chunking, BGE embeddings, SQLAlchemy models, pgvector storage. Start only after Phase 1 is verified.
