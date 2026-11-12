"""Phase 3 regression tests: persisted operations, ownership and approvals.

These tests use disposable PostgreSQL rows/users and real bearer tokens. They
never truncate or drop existing tables and remove only the rows they create.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app import rag
from app.auth.security import create_access_token, hash_password
from app.config import get_settings
from app.db.models import (
    ApprovalRequest,
    AuditLog,
    Conversation,
    KnowledgeDocument,
    Message,
    Project,
    Ticket,
    ToolOperation,
    User,
)
from app.db.session import SessionLocal
from app.main import app


def _create_user(db, label: str) -> User:
    email = f"phase3-{label}-{uuid.uuid4().hex}@example.test"
    user = User(
        full_name=f"Phase3 {label}",
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
        db.execute(delete(ApprovalRequest).where(ApprovalRequest.owner_user_id.in_(ids)))
        db.execute(delete(ToolOperation).where(ToolOperation.user_id.in_(ids)))
        db.execute(delete(KnowledgeDocument).where(KnowledgeDocument.owner_user_id.in_(ids)))
        db.execute(delete(Ticket).where(Ticket.owner_user_id.in_(ids)))
        db.execute(delete(Message).where(Message.user_id.in_(ids)))
        db.execute(delete(Conversation).where(Conversation.user_id.in_(ids)))
        db.execute(delete(Project).where(Project.owner_user_id.in_(ids)))
        db.execute(delete(AuditLog).where(AuditLog.actor_user_id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()
        db.close()


@pytest.fixture()
def client_for(users):
    def factory(user: User) -> TestClient:
        token = create_access_token(str(user.id))
        return TestClient(app, headers={"Authorization": f"Bearer {token}"})

    return factory


@pytest.fixture()
def workspace(tmp_path):
    settings = get_settings().model_copy(
        update={
            "project_workspace_root": str(tmp_path),
            "project_max_file_bytes": 1000,
            "project_max_files": 100,
            "sandbox_enabled": False,
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _create_project(client: TestClient) -> dict:
    response = client.post(
        "/api/v1/projects",
        json={"name": f"phase3-{uuid.uuid4().hex[:8]}", "workspace_path": "repo"},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ── Authentication ─────────────────────────────────────────────────────────

def test_operations_endpoints_require_authentication():
    anonymous = TestClient(app)
    assert anonymous.get("/api/documents").status_code == 401
    assert anonymous.get("/api/operations/tickets").status_code == 401
    assert anonymous.get("/api/operations/approvals").status_code == 401
    assert anonymous.get("/api/analytics/dashboard").status_code == 401


# ── Documents ──────────────────────────────────────────────────────────────

def test_documents_persist_and_are_user_scoped(client_for, users):
    alpha = client_for(users[0])
    beta = client_for(users[1])

    created = alpha.post(
        "/api/documents/upload",
        params={
            "filename": "VPN-Runbook.md",
            "content": "Step 1: Check the VPN gateway. Step 2: restart the client.",
            "category": "IT Support",
        },
    )
    assert created.status_code == 201, created.text
    doc = created.json()
    assert doc["filename"] == "VPN-Runbook.md"
    assert doc["indexed"] is True
    assert doc["chunks_count"] >= 1

    alpha_docs = alpha.get("/api/documents").json()
    assert any(item["id"] == doc["id"] for item in alpha_docs)
    assert beta.get("/api/documents").json() == []

    assert beta.delete(f"/api/documents/{doc['id']}").status_code == 404

    db = SessionLocal()
    try:
        row = db.get(KnowledgeDocument, uuid.UUID(doc["id"]))
        assert row is not None and row.owner_user_id == users[0].id
        audit = db.execute(
            select(AuditLog).where(
                AuditLog.actor_user_id == users[0].id,
                AuditLog.action == "document.create",
                AuditLog.target_id == doc["id"],
            )
        ).scalar_one_or_none()
        assert audit is not None
    finally:
        db.close()

    assert alpha.delete(f"/api/documents/{doc['id']}").status_code == 200
    assert alpha.get("/api/documents").json() == []


def test_retrieval_only_uses_owned_documents(client_for, users):
    alpha = client_for(users[0])
    alpha.post(
        "/api/documents/upload",
        params={
            "filename": "Payments-Runbook.md",
            "content": "Payments gateway timeout remediation: restart the payments worker and check the queue.",
            "category": "DevOps",
        },
    )

    results, citations = rag.search_knowledge("payments gateway timeout", user_id=users[0].id)
    assert results
    assert any("Payments-Runbook.md" in cite for cite in citations)

    other_results, other_citations = rag.search_knowledge("payments gateway timeout", user_id=users[1].id)
    assert other_results == []
    assert other_citations == []

    anonymous_results, _ = rag.search_knowledge("payments gateway timeout")
    assert anonymous_results == []


# ── Tickets ────────────────────────────────────────────────────────────────

def test_tickets_persist_and_are_user_scoped(client_for, users):
    alpha = client_for(users[0])
    beta = client_for(users[1])

    created = alpha.post(
        "/api/operations/tickets",
        json={
            "title": "VPN timeout in Munich",
            "description": "Gateway not reachable since 09:15 UTC.",
            "priority": "high",
            "category": "IT Support",
        },
    )
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["status"] == "open"
    assert ticket["assigned_agent"] == "Unassigned"

    alpha_tickets = alpha.get("/api/operations/tickets").json()
    assert [item["id"] for item in alpha_tickets] == [ticket["id"]]
    assert beta.get("/api/operations/tickets").json() == []

    db = SessionLocal()
    try:
        row = db.get(Ticket, uuid.UUID(ticket["id"]))
        assert row is not None and row.owner_user_id == users[0].id
    finally:
        db.close()


# ── Approvals ──────────────────────────────────────────────────────────────

def test_approval_requests_persist_and_are_user_scoped(client_for, users):
    db = SessionLocal()
    approval = ApprovalRequest(
        owner_user_id=users[0].id,
        action_type="restart_service",
        title="Restart worker-02 pool",
        details="Connection leak detected.",
        requested_by="Operations Agent",
        risk_level="low",
        status="pending",
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)
    approval_id = approval.id
    db.close()

    alpha = client_for(users[0])
    beta = client_for(users[1])

    alpha_items = alpha.get("/api/operations/approvals").json()
    item = next(item for item in alpha_items if item["id"] == str(approval_id))
    assert item["status"] == "pending"
    assert beta.get("/api/operations/approvals").json() == []

    assert beta.post(
        f"/api/operations/approvals/{approval_id}/action", json={"action": "approve"}
    ).status_code == 404

    approved = alpha.post(
        f"/api/operations/approvals/{approval_id}/action",
        json={"action": "approve", "notes": "verified"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    assert alpha.post(
        f"/api/operations/approvals/{approval_id}/action", json={"action": "reject"}
    ).status_code == 409

    db = SessionLocal()
    try:
        row = db.get(ApprovalRequest, approval_id)
        assert row.status == "approved"
        assert row.decided_by_user_id == users[0].id
        assert row.decision_notes == "verified"
    finally:
        db.close()


def test_tool_operation_is_bridged_into_approval_center(client_for, users, workspace):
    alpha = client_for(users[0])
    project = _create_project(alpha)

    requested = alpha.post(
        "/api/tools/execute",
        json={
            "tool": "project.write_file",
            "project_id": project["id"],
            "input": {"path": "src/bridged.py", "content": "print('bridged')\n"},
        },
    )
    assert requested.status_code == 200, requested.text
    operation = requested.json()
    assert operation["status"] == "pending_approval"

    items = alpha.get("/api/operations/approvals").json()
    bridged = next(item for item in items if item["id"] == operation["id"])
    assert bridged["status"] == "pending"
    assert bridged["action_type"] == "project.write_file"

    approved = alpha.post(
        f"/api/operations/approvals/{operation['id']}/action", json={"action": "approve"}
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "executed"

    db = SessionLocal()
    try:
        row = db.get(ToolOperation, uuid.UUID(operation["id"]))
        assert row.status == "completed"
    finally:
        db.close()


# ── Safety guard ───────────────────────────────────────────────────────────

def test_consequential_guard_persists_real_approval(client_for, users):
    response = rag.intercept_consequential_action("restart postgres now", user_id=users[0].id)
    assert response is not None
    assert "CONSEQUENTIAL ACTION GUARD" in response

    db = SessionLocal()
    try:
        rows = db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.owner_user_id == users[0].id,
                ApprovalRequest.action_type == "infrastructure_modification",
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].status == "pending"
        assert "restart postgres now" in rows[0].details
    finally:
        db.close()

    # Without an authenticated user id the guard must not claim an item exists.
    anonymous = rag.intercept_consequential_action("restart postgres now")
    assert anonymous is not None
    assert "Approval request created" not in anonymous


# ── Dashboard and agents use persisted data ────────────────────────────────

def test_dashboard_and_agents_reflect_persisted_rows(client_for, users, workspace):
    alpha = client_for(users[0])
    project = _create_project(alpha)
    alpha.post(
        "/api/documents/upload",
        params={"filename": "a.md", "content": "alpha beta gamma", "category": "General"},
    )
    alpha.post(
        "/api/operations/tickets",
        json={"title": "Ticket one", "description": "Something broke badly", "priority": "medium"},
    )
    alpha.post(
        "/api/tools/execute",
        json={
            "tool": "project.write_file",
            "project_id": project["id"],
            "input": {"path": "src/pending.py", "content": "x"},
        },
    )

    metrics = alpha.get("/api/analytics/dashboard")
    assert metrics.status_code == 200, metrics.text
    body = metrics.json()
    assert body["total_documents"] == 1
    assert body["indexed_documents"] == 1
    assert body["open_tickets"] == 1
    assert body["pending_approvals"] == 1
    assert body["total_queries"] == 0

    agents = alpha.get("/api/agents")
    assert agents.status_code == 200
    payload = agents.json()
    assert len(payload) == 4
    operations_agent = next(a for a in payload if a["id"] == "agent-operations")
    assert operations_agent["status"] == "waiting_approval"
    assert operations_agent["total_runs"] == 1
