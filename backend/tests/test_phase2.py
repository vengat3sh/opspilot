"""Phase 2 regression tests: persistence, ownership, streaming, projects, tools.

These tests run against the configured PostgreSQL database using disposable
users and rows. They never truncate or drop existing tables and clean up only
the records they created.
"""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app import llm
from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password
from app.config import get_settings
from app.db.models import (
    AuditLog,
    Conversation,
    Message,
    Project,
    ToolOperation,
    User,
)
from app.db.session import SessionLocal
from app.main import app
from app.routers import chat as chat_router


def _create_user(db, label: str) -> User:
    email = f"phase2-{label}-{uuid.uuid4().hex}@example.test"
    user = User(
        full_name=f"Phase2 {label}",
        email=email,
        normalized_email=email,
        password_hash=hash_password("TestPass123!"),
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.expunge(user)
    return user


@pytest.fixture()
def users():
    db = SessionLocal()
    created = [_create_user(db, "alpha"), _create_user(db, "beta")]
    try:
        yield created
    finally:
        ids = [u.id for u in created]
        db.execute(delete(ToolOperation).where(ToolOperation.user_id.in_(ids)))
        db.execute(delete(Message).where(Message.user_id.in_(ids)))
        db.execute(delete(Conversation).where(Conversation.user_id.in_(ids)))
        db.execute(delete(Project).where(Project.owner_user_id.in_(ids)))
        db.execute(delete(AuditLog).where(AuditLog.actor_user_id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()
        db.close()


@pytest.fixture()
def client_for(users):
    """Return a TestClient factory authenticated with real bearer tokens.

    Real tokens exercise the production authentication path instead of a global
    dependency override, so two clients can safely act as different users.
    """
    def factory(user: User) -> TestClient:
        token = create_access_token(str(user.id))
        return TestClient(app, headers={"Authorization": f"Bearer {token}"})

    return factory


def _workspace_settings(tmp_path, **overrides):
    base = get_settings().model_copy(
        update={
            "project_workspace_root": str(tmp_path),
            "project_max_file_bytes": 1000,
            "project_max_files": 100,
            "sandbox_enabled": False,
            **overrides,
        }
    )
    return base


@pytest.fixture()
def workspace(tmp_path, monkeypatch):
    settings = _workspace_settings(tmp_path)
    app.dependency_overrides[get_settings] = lambda: settings
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    (repo / "node_modules" / "lib").mkdir(parents=True)
    (repo / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
    (repo / "README.md").write_text("# Demo\n", encoding="utf-8")
    (repo / ".gitignore").write_text("secret.txt\n", encoding="utf-8")
    (repo / "secret.txt").write_text("ignored\n", encoding="utf-8")
    (repo / ".env").write_text("SECRET=1\n", encoding="utf-8")
    (repo / "node_modules" / "lib" / "index.js").write_text("x\n", encoding="utf-8")
    (repo / "big.txt").write_text("x" * 5000, encoding="utf-8")
    (repo / "logo.png").write_bytes(b"\x89PNG\x00binary")
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _create_project(client: TestClient, name: str = "demo", **extra) -> dict:
    payload = {
        "name": f"{name}-{uuid.uuid4().hex[:8]}",
        "repo_provider": "local",
        "workspace_path": "repo",
        **extra,
    }
    response = client.post("/api/v1/projects", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_conversation(client: TestClient, **extra) -> dict:
    response = client.post("/api/conversations", json=extra)
    assert response.status_code == 201, response.text
    return response.json()


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for frame in text.split("\n\n"):
        if not frame.strip():
            continue
        name = ""
        data_lines: list[str] = []
        for line in frame.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if not data_lines:
            continue
        try:
            payload = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue
        events.append((name, payload))
    return events


# ── Authentication requirements ────────────────────────────────────────────

def test_phase2_endpoints_require_authentication():
    anonymous = TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)
    assert anonymous.get("/api/conversations").status_code == 401
    assert anonymous.get("/api/v1/projects").status_code == 401
    assert anonymous.get("/api/tools").status_code == 401
    assert anonymous.get("/api/v1/admin/diagnostics/chat").status_code == 401


# ── Conversation persistence, pagination, ownership ────────────────────────

def test_conversation_crud_and_message_idempotency(client_for, users):
    client = client_for(users[0])
    conv = _create_conversation(client, title="Initial title")
    assert conv["title"] == "Initial title"

    listing = client.get("/api/conversations").json()
    assert listing["total"] >= 1
    assert any(item["id"] == conv["id"] for item in listing["items"])

    body = {"role": "user", "content": "hello persistence", "idempotency_key": "idem-1"}
    first = client.post(f"/api/conversations/{conv['id']}/messages", json=body)
    second = client.post(f"/api/conversations/{conv['id']}/messages", json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    page = client.get(f"/api/conversations/{conv['id']}/messages").json()
    assert len(page["items"]) == 1

    renamed = client.patch(f"/api/conversations/{conv['id']}", json={"title": "Renamed"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Renamed"

    archived = client.patch(f"/api/conversations/{conv['id']}", json={"archived": True})
    assert archived.status_code == 200 and archived.json()["archived_at"] is not None
    assert client.get("/api/conversations").json()["total"] == 0
    assert client.get("/api/conversations", params={"archived": True}).json()["total"] == 1

    assert client.delete(f"/api/conversations/{conv['id']}").status_code == 204
    assert client.get(f"/api/conversations/{conv['id']}").status_code == 404


def test_message_pagination_and_edit_branching(client_for, users):
    client = client_for(users[0])
    conv = _create_conversation(client)
    ids = []
    for i in range(5):
        response = client.post(
            f"/api/conversations/{conv['id']}/messages",
            json={"role": "user", "content": f"message {i}", "idempotency_key": f"m-{i}"},
        )
        assert response.status_code == 201
        ids.append(response.json()["id"])

    first_page = client.get(f"/api/conversations/{conv['id']}/messages", params={"limit": 2}).json()
    assert len(first_page["items"]) == 2
    assert first_page["has_more"] is True
    assert first_page["items"][0]["content"] == "message 3"
    assert first_page["items"][1]["content"] == "message 4"

    older = client.get(
        f"/api/conversations/{conv['id']}/messages",
        params={"limit": 2, "before_sequence": first_page["next_before_sequence"]},
    ).json()
    assert [item["content"] for item in older["items"]] == ["message 1", "message 2"]

    edited = client.patch(
        f"/api/conversations/{conv['id']}/messages/{ids[1]}",
        json={"content": "edited message"},
    )
    assert edited.status_code == 200
    assert edited.json()["content"] == "edited message"
    remaining = client.get(f"/api/conversations/{conv['id']}/messages").json()
    assert [item["content"] for item in remaining["items"]] == ["message 0", "edited message"]


def test_conversation_ownership_isolation(client_for, users):
    owner = client_for(users[0])
    intruder = client_for(users[1])
    conv = _create_conversation(owner, title="private")

    assert intruder.get(f"/api/conversations/{conv['id']}").status_code == 404
    assert intruder.get(f"/api/conversations/{conv['id']}/messages").status_code == 404
    assert intruder.patch(f"/api/conversations/{conv['id']}", json={"title": "hijack"}).status_code == 404
    assert intruder.delete(f"/api/conversations/{conv['id']}").status_code == 404
    assert all(item["id"] != conv["id"] for item in intruder.get("/api/conversations").json()["items"])


def test_conversation_requires_authorized_project(client_for, users, workspace):
    owner = client_for(users[0])
    intruder = client_for(users[1])
    project = _create_project(owner)
    response = intruder.post("/api/conversations", json={"project_id": project["id"]})
    assert response.status_code == 404


# ── Project registration, indexing and context ─────────────────────────────

def test_project_indexing_respects_exclusions_and_context(client_for, users, workspace):
    client = client_for(users[0])
    project = _create_project(client)

    indexed = client.post(f"/api/v1/projects/{project['id']}/index")
    assert indexed.status_code == 200, indexed.text
    payload = indexed.json()
    assert payload["indexing_status"] == "indexed"
    assert payload["indexed_files"] >= 3

    files = client.get(f"/api/v1/projects/{project['id']}/files", params={"limit": 200}).json()
    paths = {item["path"] for item in files}
    assert "src/main.py" in paths
    assert "README.md" in paths
    assert ".gitignore" in paths
    assert ".env" not in paths
    assert "secret.txt" not in paths
    assert "node_modules/lib/index.js" not in paths
    assert "big.txt" not in paths
    assert "logo.png" not in paths

    context = client.get(f"/api/v1/projects/{project['id']}/context", params={"q": "main"}).json()
    assert context["repository_inspected"] is True
    assert context["files"]
    assert "src/main.py" in context["context"]

    detail = client.get(f"/api/v1/projects/{project['id']}").json()
    assert detail["repository_inspected"] is True
    assert detail["indexing_status"] == "indexed"


def test_project_workspace_path_traversal_rejected(client_for, users, workspace):
    client = client_for(users[0])
    for bad_path in ("../escape", "C:/Windows", "/etc", "repo/../../escape"):
        response = client.post(
            "/api/v1/projects",
            json={"name": f"bad-{uuid.uuid4().hex[:8]}", "workspace_path": bad_path},
        )
        assert response.status_code == 400, f"{bad_path}: {response.text}"


def test_project_index_requires_configured_root(client_for, users):
    client = client_for(users[0])
    project = _create_project(client)
    response = client.post(f"/api/v1/projects/{project['id']}/index")
    assert response.status_code == 503
    assert "PROJECT_WORKSPACE_ROOT" in response.json()["detail"]


def test_project_ownership_isolation(client_for, users, workspace):
    owner = client_for(users[0])
    intruder = client_for(users[1])
    project = _create_project(owner)
    assert intruder.get(f"/api/v1/projects/{project['id']}").status_code == 404
    assert intruder.post(f"/api/v1/projects/{project['id']}/index").status_code == 404
    assert all(item["id"] != project["id"] for item in intruder.get("/api/v1/projects").json())


# ── Controlled tools, approvals and sandbox honesty ────────────────────────

def test_tool_registry_reports_sandbox_unavailable(client_for, users):
    client = client_for(users[0])
    registry = client.get("/api/tools").json()
    assert registry["sandbox"]["available"] is False
    assert registry["sandbox"]["host_shell_fallback"] is False
    assert "project.read_file" in registry["read_only"]


def test_read_only_tool_and_sandbox_unavailable(client_for, users, workspace):
    client = client_for(users[0])
    project = _create_project(client)
    client.post(f"/api/v1/projects/{project['id']}/index")

    tree = client.post(
        "/api/tools/execute",
        json={"tool": "project.tree", "project_id": project["id"], "input": {}},
    )
    assert tree.status_code == 200, tree.text
    assert tree.json()["status"] == "completed"
    assert any(item["path"] == "src/main.py" for item in tree.json()["output"]["items"])

    tests = client.post(
        "/api/tools/execute",
        json={"tool": "project.run_tests", "project_id": project["id"], "input": {}},
    )
    assert tests.status_code == 200
    assert tests.json()["status"] == "unavailable"
    assert tests.json()["requires_approval"] is True
    assert "SANDBOX_ENABLED" in (tests.json()["error_message"] or "")

    unknown = client.post(
        "/api/tools/execute",
        json={"tool": "host.shell", "project_id": project["id"], "input": {}},
    )
    assert unknown.status_code == 404


def test_write_file_requires_approval_and_stays_in_workspace(client_for, users, workspace, tmp_path):
    client = client_for(users[0])
    project = _create_project(client)

    requested = client.post(
        "/api/tools/execute",
        json={
            "tool": "project.write_file",
            "project_id": project["id"],
            "input": {"path": "src/new_file.py", "content": "print('new')\n"},
        },
    )
    assert requested.status_code == 200
    operation = requested.json()
    assert operation["status"] == "pending_approval"
    assert operation["requires_approval"] is True
    assert not (tmp_path / "repo" / "src" / "new_file.py").exists()

    approved = client.post(
        f"/api/tools/operations/{operation['id']}/approval",
        json={"action": "approve"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "completed"
    assert (tmp_path / "repo" / "src" / "new_file.py").read_text(encoding="utf-8") == "print('new')\n"

    escape = client.post(
        "/api/tools/execute",
        json={
            "tool": "project.write_file",
            "project_id": project["id"],
            "input": {"path": "../escaped.py", "content": "bad"},
        },
    ).json()
    escaped_result = client.post(
        f"/api/tools/operations/{escape['id']}/approval",
        json={"action": "approve"},
    )
    assert escaped_result.status_code == 400
    assert not (tmp_path / "escaped.py").exists()


def test_tool_operations_are_owner_scoped(client_for, users, workspace):
    owner = client_for(users[0])
    intruder = client_for(users[1])
    project = _create_project(owner)
    operation = owner.post(
        "/api/tools/execute",
        json={
            "tool": "project.write_file",
            "project_id": project["id"],
            "input": {"path": "x.txt", "content": "x"},
        },
    ).json()

    assert intruder.get("/api/tools/operations").json() == []
    assert intruder.post(
        f"/api/tools/operations/{operation['id']}/approval",
        json={"action": "approve"},
    ).status_code == 404


# ── SSE streaming lifecycle ────────────────────────────────────────────────

def _completed_stream(settings, messages, provider=None, agent=None, extra_context=None):
    async def generator():
        yield "Hello"
        yield " world"
        yield json.dumps({
            "__done__": True,
            "provider": "test-provider",
            "model": "test-model",
            "latency_ms": 12,
            "prompt_tokens": 3,
            "completion_tokens": 2,
            "agent": "knowledge",
            "citations": [],
        })
    return generator()


def test_stream_persists_completed_assistant_message(client_for, users, monkeypatch):
    client = client_for(users[0])
    monkeypatch.setattr(chat_router.llm, "stream_chat", _completed_stream)

    response = client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "hello stream"}], "provider": "cloud"},
    )
    assert response.status_code == 200, response.text
    events = _sse_events(response.text)
    names = [name for name, _ in events]
    assert "message_started" in names
    assert "token" in names
    assert "message_completed" in names
    started = next(payload for name, payload in events if name == "message_started")

    db = SessionLocal()
    try:
        conversation = db.get(Conversation, uuid.UUID(started["conversation_id"]))
        assert conversation is not None
        messages = db.execute(
            select(Message).where(Message.conversation_id == conversation.id).order_by(Message.sequence)
        ).scalars().all()
        assert [m.role for m in messages] == ["user", "assistant"]
        assistant = messages[-1]
        assert assistant.status == "completed"
        assert assistant.content == "Hello world"
        assert assistant.provider == "test-provider"
        assert assistant.token_usage == {"prompt_tokens": 3, "completion_tokens": 2}
    finally:
        db.close()


def test_stream_failure_marks_message_failed(client_for, users, monkeypatch):
    client = client_for(users[0])

    def failing_stream(settings, messages, provider=None, agent=None, extra_context=None):
        async def generator():
            yield "partial"
            raise llm.LLMError("provider exploded")
        return generator()

    monkeypatch.setattr(chat_router.llm, "stream_chat", failing_stream)
    response = client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "fail please"}]},
    )
    assert response.status_code == 200
    events = _sse_events(response.text)
    assert any(name == "message_failed" for name, _ in events)
    started = next(payload for name, payload in events if name == "message_started")

    db = SessionLocal()
    try:
        assistant = db.execute(
            select(Message).where(
                Message.conversation_id == uuid.UUID(started["conversation_id"]),
                Message.role == "assistant",
            )
        ).scalar_one()
        assert assistant.status == "failed"
        assert assistant.content == "partial"
        assert "provider exploded" in (assistant.error_message or "")
    finally:
        db.close()


def test_stream_cancellation_marks_interrupted(client_for, users, monkeypatch):
    client = client_for(users[0])

    def cancelling_stream(settings, messages, provider=None, agent=None, extra_context=None):
        async def generator():
            for event in chat_router._CANCEL_EVENTS.values():
                event.set()
            yield "partial "
            yield "should not be delivered"
        return generator()

    monkeypatch.setattr(chat_router.llm, "stream_chat", cancelling_stream)
    response = client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "cancel me"}]},
    )
    assert response.status_code == 200
    events = _sse_events(response.text)
    assert any(name == "message_interrupted" for name, _ in events)
    started = next(payload for name, payload in events if name == "message_started")

    db = SessionLocal()
    try:
        assistant = db.execute(
            select(Message).where(
                Message.conversation_id == uuid.UUID(started["conversation_id"]),
                Message.role == "assistant",
            )
        ).scalar_one()
        assert assistant.status == "interrupted"
        assert assistant.content == "partial "
    finally:
        db.close()


def test_retry_regenerates_without_duplicating_user_message(client_for, users, monkeypatch):
    client = client_for(users[0])

    def failing_stream(settings, messages, provider=None, agent=None, extra_context=None):
        async def generator():
            yield "broken"
            raise llm.LLMError("temporary failure")
        return generator()

    monkeypatch.setattr(chat_router.llm, "stream_chat", failing_stream)
    first = client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "retry this"}]},
    )
    started = next(payload for name, payload in _sse_events(first.text) if name == "message_started")
    conversation_id = started["conversation_id"]
    failed_assistant_id = started["assistant_message_id"]

    async def fake_chat(settings, messages, provider=None, agent=None, extra_context=None):
        return llm.ChatPipelineResult(
            result=llm.LLMResult(
                text="recovered answer",
                provider="test-provider",
                model="test-model",
                latency_ms=8,
                prompt_tokens=4,
                completion_tokens=3,
            ),
            agent="knowledge",
            citations=[],
        )

    monkeypatch.setattr(chat_router.llm, "chat", fake_chat)
    retried = client.post(f"/api/chat/retry/{failed_assistant_id}")
    assert retried.status_code == 200, retried.text
    payload = retried.json()
    assert payload["reply"] == "recovered answer"
    assert payload["assistant_message_id"] != failed_assistant_id

    db = SessionLocal()
    try:
        messages = db.execute(
            select(Message).where(Message.conversation_id == uuid.UUID(conversation_id)).order_by(Message.sequence)
        ).scalars().all()
        assert sum(1 for m in messages if m.role == "user") == 1
        assistant_statuses = [m.status for m in messages if m.role == "assistant"]
        assert "failed" in assistant_statuses
        assert "completed" in assistant_statuses
    finally:
        db.close()


def test_cancel_endpoint_rejects_inactive_generation(client_for, users):
    client = client_for(users[0])
    response = client.post(f"/api/chat/cancel/{uuid.uuid4()}")
    assert response.status_code == 404


# ── Admin diagnostics authorization ────────────────────────────────────────

def test_diagnostics_requires_admin(client_for, users):
    client = client_for(users[0])
    assert client.get("/api/v1/admin/diagnostics/chat").status_code == 403
