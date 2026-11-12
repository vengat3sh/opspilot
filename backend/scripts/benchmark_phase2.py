"""Repeatable local Phase 2 performance measurements.

Measures real PostgreSQL/API latency for conversation persistence, message
pagination, conversation listing, SSE streaming overhead (with a deterministic
fake provider, so provider latency is excluded), and repository indexing.

Usage (from backend/, with the project venv):
    python scripts/benchmark_phase2.py

Results are local-machine measurements only. They are not production capacity
claims. The script creates and removes only its own throwaway rows/files.
"""
from __future__ import annotations

import json
import statistics
import sys
import tempfile
import time
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.auth.security import create_access_token, hash_password  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db.models import AuditLog, Conversation, Message, Project, ToolOperation, User  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import chat as chat_router  # noqa: E402
from app.schemas import ProjectCreateRequest  # noqa: E402
from app.services.projects import create_project, index_project  # noqa: E402
from sqlalchemy import delete  # noqa: E402


def _stats(samples_ms: list[float]) -> dict:
    ordered = sorted(samples_ms)
    p95_index = max(0, min(len(ordered) - 1, int(len(ordered) * 0.95) - 1))
    return {
        "samples": len(ordered),
        "avg_ms": round(statistics.fmean(ordered), 2),
        "p50_ms": round(statistics.median(ordered), 2),
        "p95_ms": round(ordered[p95_index], 2),
        "min_ms": round(ordered[0], 2),
        "max_ms": round(ordered[-1], 2),
    }


def _timed(fn):
    start = time.perf_counter()
    result = fn()
    return result, (time.perf_counter() - start) * 1000


def _fake_stream(settings, messages, provider=None, agent=None, extra_context=None):
    async def generator():
        for i in range(20):
            yield f"token{i} "
        yield json.dumps({
            "__done__": True,
            "provider": "benchmark-fake",
            "model": "deterministic",
            "latency_ms": 0,
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "agent": "knowledge",
            "citations": [],
        })
    return generator()


def main() -> int:
    db = SessionLocal()
    email = f"benchmark-{uuid.uuid4().hex}@example.test"
    user = User(
        full_name="Benchmark User",
        email=email,
        normalized_email=email,
        password_hash=hash_password("TestPass123!"),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user_id = user.id
    token = create_access_token(str(user_id))
    client = TestClient(app, headers={"Authorization": f"Bearer {token}"})
    results: dict[str, object] = {}
    temp_project_id: uuid.UUID | None = None

    try:
        create_latencies: list[float] = []
        conversation_id: str | None = None
        for _ in range(20):
            response, elapsed = _timed(lambda: client.post("/api/conversations", json={"title": "benchmark"}))
            assert response.status_code == 201, response.text
            create_latencies.append(elapsed)
            conversation_id = conversation_id or response.json()["id"]
        results["conversation_create_api"] = _stats(create_latencies)

        append_latencies: list[float] = []
        for i in range(100):
            response, elapsed = _timed(lambda i=i: client.post(
                f"/api/conversations/{conversation_id}/messages",
                json={
                    "role": "user",
                    "content": f"benchmark message {i} with a little payload",
                    "idempotency_key": f"bench-{i}",
                },
            ))
            assert response.status_code == 201, response.text
            append_latencies.append(elapsed)
        results["message_append_api"] = _stats(append_latencies)

        page_latencies: list[float] = []
        for _ in range(50):
            response, elapsed = _timed(lambda: client.get(
                f"/api/conversations/{conversation_id}/messages", params={"limit": 50}
            ))
            assert response.status_code == 200
            page_latencies.append(elapsed)
        results["message_page_50_api"] = _stats(page_latencies)

        list_latencies: list[float] = []
        for _ in range(50):
            response, elapsed = _timed(lambda: client.get("/api/conversations", params={"limit": 30}))
            assert response.status_code == 200
            list_latencies.append(elapsed)
        results["conversation_list_api"] = _stats(list_latencies)

        original_stream = chat_router.llm.stream_chat
        chat_router.llm.stream_chat = _fake_stream
        stream_latencies: list[float] = []
        stream_event_counts: list[int] = []
        try:
            for i in range(15):
                response, elapsed = _timed(lambda i=i: client.post(
                    "/api/chat/stream",
                    json={
                        "messages": [{"role": "user", "content": f"stream benchmark {i}"}],
                        "idempotency_key": f"stream-bench-{i}",
                    },
                ))
                assert response.status_code == 200, response.text
                stream_latencies.append(elapsed)
                stream_event_counts.append(response.text.count("event:"))
        finally:
            chat_router.llm.stream_chat = original_stream
        results["sse_stream_fake_provider_api"] = {
            **_stats(stream_latencies),
            "events_per_stream": stream_event_counts[0] if stream_event_counts else 0,
            "note": "Deterministic fake provider; excludes real LLM latency.",
        }

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            for directory in range(10):
                folder = root / f"pkg{directory}"
                folder.mkdir(parents=True)
                for file_index in range(25):
                    (folder / f"module_{file_index}.py").write_text(
                        f"# module {directory}/{file_index}\n" + "x = 1\n" * 40,
                        encoding="utf-8",
                    )
            settings = get_settings().model_copy(update={
                "project_workspace_root": tmp,
                "project_max_files": 1000,
                "project_max_file_bytes": 262_144,
            })
            project = create_project(
                db,
                user,
                ProjectCreateRequest(name=f"benchmark-{uuid.uuid4().hex[:8]}", workspace_path="repo"),
                settings,
            )
            temp_project_id = project.id
            indexed, index_ms = _timed(lambda: index_project(db, user, project.id, settings))
            results["repository_indexing"] = {
                "files": indexed.indexed_files,
                "duration_ms": round(index_ms, 2),
                "files_per_second": round(indexed.indexed_files / max(index_ms / 1000, 0.001), 1),
                "note": "250 synthetic text files, local disk, read-only indexing.",
            }
    finally:
        db.execute(delete(ToolOperation).where(ToolOperation.user_id == user_id))
        db.execute(delete(Message).where(Message.user_id == user_id))
        db.execute(delete(Conversation).where(Conversation.user_id == user_id))
        db.execute(delete(Project).where(Project.owner_user_id == user_id))
        db.execute(delete(AuditLog).where(AuditLog.actor_user_id == user_id))
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
        db.close()

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
