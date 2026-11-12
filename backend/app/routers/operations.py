"""Authenticated operations APIs backed by PostgreSQL.

Documents, tickets and approval requests are user-owned rows. Approval requests
created by the safety guard live in ``approval_requests``; consequential tool
operations created by the controlled tool framework live in ``tool_operations``
and are bridged into the same approval center view.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..auth.service import log_audit
from ..config import Settings, get_settings
from ..db.models import ApprovalRequest, AuditLog, KnowledgeDocument, Message, Ticket, ToolOperation, User
from ..db.session import get_db
from ..rag import chunk_document
from ..schemas import (
    AgentItem,
    ApprovalActionRequest,
    ApprovalItem,
    DashboardMetrics,
    DocumentItem,
    TicketCreateRequest,
    TicketItem,
)
from ..services.tools import approve_operation

router = APIRouter(prefix="/api", tags=["enterprise"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[Session, Depends(get_db)]


# ── Helpers ────────────────────────────────────────────────────────────────

def _fmt(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _document_to_item(doc: KnowledgeDocument) -> DocumentItem:
    return DocumentItem(
        id=str(doc.id),
        filename=doc.filename,
        file_type=doc.file_type,
        size_bytes=doc.size_bytes,
        chunks_count=doc.chunks_count,
        indexed=doc.indexed,
        category=doc.category,
        uploaded_at=_fmt(doc.created_at),
        preview=(doc.content or "")[:200] or "No content was provided for this document.",
    )


def _ticket_to_item(ticket: Ticket) -> TicketItem:
    return TicketItem(
        id=str(ticket.id),
        title=ticket.title,
        description=ticket.description or "",
        priority=ticket.priority,  # type: ignore[arg-type]
        status=ticket.status,  # type: ignore[arg-type]
        assigned_agent=ticket.assigned_agent or "Unassigned",
        created_at=_fmt(ticket.created_at),
        category=ticket.category,
    )


_TOOL_STATUS_TO_APPROVAL = {
    "pending_approval": "pending",
    "running": "approved",
    "completed": "executed",
    "failed": "rejected",
    "rejected": "rejected",
}


def _tool_operation_to_approval(op: ToolOperation) -> ApprovalItem:
    data = op.input_json or {}
    target = data.get("path") or data.get("command") or ""
    target_text = f" ({target})" if isinstance(target, str) and target else ""
    details = f"Controlled tool request `{op.tool_name}`{target_text}."
    if op.project_id:
        details += f" Project: {op.project_id}."
    if op.error_message:
        details += f" Result: {op.error_message[:500]}"
    return ApprovalItem(
        id=str(op.id),
        action_type=op.tool_name,
        title=f"Tool operation: {op.tool_name}{target_text}",
        details=details,
        requested_by="OpsPilot controlled tool framework",
        risk_level=op.risk_level,  # type: ignore[arg-type]
        status=_TOOL_STATUS_TO_APPROVAL.get(op.status, "pending"),  # type: ignore[arg-type]
        timestamp=_fmt(op.created_at),
    )


def _approval_request_to_item(req: ApprovalRequest) -> ApprovalItem:
    return ApprovalItem(
        id=str(req.id),
        action_type=req.action_type,
        title=req.title,
        details=req.details,
        requested_by=req.requested_by,
        risk_level=req.risk_level,  # type: ignore[arg-type]
        status=req.status,  # type: ignore[arg-type]
        timestamp=_fmt(req.created_at),
    )


def _success_rate(completed: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round((completed / total) * 100, 1)


# ── Dashboard telemetry ────────────────────────────────────────────────────

@router.get("/analytics/dashboard", response_model=DashboardMetrics)
def get_dashboard_metrics(db: DB, user: CurrentUser, settings: SettingsDep) -> DashboardMetrics:
    doc_total = db.execute(
        select(func.count()).select_from(KnowledgeDocument).where(KnowledgeDocument.owner_user_id == user.id)
    ).scalar() or 0
    doc_indexed = db.execute(
        select(func.count())
        .select_from(KnowledgeDocument)
        .where(KnowledgeDocument.owner_user_id == user.id, KnowledgeDocument.indexed.is_(True))
    ).scalar() or 0
    query_total = db.execute(
        select(func.count()).select_from(Message).where(Message.user_id == user.id, Message.role == "user")
    ).scalar() or 0
    assistant_total = db.execute(
        select(func.count()).select_from(Message).where(Message.user_id == user.id, Message.role == "assistant")
    ).scalar() or 0
    pending_tool = db.execute(
        select(func.count())
        .select_from(ToolOperation)
        .where(
            ToolOperation.user_id == user.id,
            ToolOperation.requires_approval.is_(True),
            ToolOperation.status == "pending_approval",
        )
    ).scalar() or 0
    pending_requests = db.execute(
        select(func.count())
        .select_from(ApprovalRequest)
        .where(ApprovalRequest.owner_user_id == user.id, ApprovalRequest.status == "pending")
    ).scalar() or 0
    open_tickets = db.execute(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.owner_user_id == user.id, Ticket.status.in_(["open", "investigating"]))
    ).scalar() or 0
    avg_latency = db.execute(
        select(func.avg(Message.latency_ms)).where(
            Message.user_id == user.id, Message.role == "assistant", Message.latency_ms.is_not(None)
        )
    ).scalar()
    token_expr = cast(Message.token_usage["completion_tokens"].astext, Integer)
    token_total = db.execute(
        select(func.coalesce(func.sum(token_expr), 0)).where(
            Message.user_id == user.id, Message.role == "assistant", Message.token_usage.is_not(None)
        )
    ).scalar() or 0

    recent = db.execute(
        select(AuditLog)
        .where(AuditLog.actor_user_id == user.id)
        .order_by(AuditLog.timestamp.desc())
        .limit(6)
    ).scalars().all()
    recent_activity = [
        {
            "time": _fmt(row.timestamp),
            "action": row.action.replace(".", " ").replace("_", " ").title(),
            "user": "You",
            "agent": "OpsPilot",
        }
        for row in recent
    ]

    active_model = settings.cloud_model if settings.llm_provider == "cloud" else settings.ollama_model
    free_tier = settings.llm_provider == "cloud" and settings.cloud_model.endswith(":free")

    return DashboardMetrics(
        total_documents=int(doc_total),
        indexed_documents=int(doc_indexed),
        total_queries=int(query_total),
        agent_executions=int(assistant_total),
        pending_approvals=int(pending_tool) + int(pending_requests),
        open_tickets=int(open_tickets),
        avg_latency_ms=int(avg_latency or 0),
        active_model=active_model,
        token_consumption=int(token_total),
        estimated_api_cost="$0.00 (free-tier model)" if free_tier else "Not tracked for this provider",
        system_health="healthy",
        recent_activity=recent_activity,
    )


# ── Knowledge documents ────────────────────────────────────────────────────

@router.get("/documents", response_model=list[DocumentItem])
def list_documents(db: DB, user: CurrentUser) -> list[DocumentItem]:
    rows = db.execute(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.owner_user_id == user.id)
        .order_by(KnowledgeDocument.created_at.desc())
    ).scalars().all()
    return [_document_to_item(row) for row in rows]


@router.post("/documents/upload", response_model=DocumentItem, status_code=status.HTTP_201_CREATED)
def upload_document(
    request: Request,
    db: DB,
    user: CurrentUser,
    filename: str = Query(min_length=1, max_length=512),
    content: str = Query(default="", max_length=200_000),
    category: str = Query(default="General", max_length=128),
) -> DocumentItem:
    name = filename.strip()
    if not name:
        raise HTTPException(status_code=422, detail="filename cannot be empty")
    chunks = len(chunk_document("pending", name, category, content)) if content.strip() else 0
    doc = KnowledgeDocument(
        owner_user_id=user.id,
        filename=name,
        file_type=name.rsplit(".", 1)[-1].lower() if "." in name else "txt",
        size_bytes=len(content.encode("utf-8")),
        chunks_count=chunks,
        indexed=bool(content.strip()),
        category=category.strip() or "General",
        content=content,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    log_audit(
        db,
        user.id,
        "document.create",
        "knowledge_document",
        str(doc.id),
        request.client.host if request.client else None,
        {"filename": doc.filename, "category": doc.category, "size_bytes": doc.size_bytes},
    )
    return _document_to_item(doc)


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: uuid.UUID, request: Request, db: DB, user: CurrentUser) -> dict[str, str]:
    doc = db.get(KnowledgeDocument, doc_id)
    if not doc or doc.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(doc)
    db.commit()
    log_audit(
        db,
        user.id,
        "document.delete",
        "knowledge_document",
        str(doc_id),
        request.client.host if request.client else None,
        {"filename": doc.filename},
    )
    return {"status": "deleted", "doc_id": str(doc_id)}


# ── Agents ─────────────────────────────────────────────────────────────────

_AGENT_DEFINITIONS = [
    {
        "id": "agent-knowledge",
        "name": "Knowledge Agent",
        "role": "RAG & Document Intelligence",
        "description": "Retrieves your indexed knowledge documents, answers policy questions, and attaches grounded citations.",
        "permitted_tools": ["search_knowledge", "retrieve_document", "read_chunk"],
    },
    {
        "id": "agent-research",
        "name": "Research Agent",
        "role": "Multi-Document Synthesis",
        "description": "Compares multiple indexed documents and highlights contradictions. Runs only when invoked with document context.",
        "permitted_tools": ["compare_documents", "summarize_findings", "diff_versions"],
    },
    {
        "id": "agent-operations",
        "name": "Operations Agent",
        "role": "Controlled Tool Execution",
        "description": "Requests consequential project operations. Execution requires human approval; unavailable integrations are reported honestly.",
        "permitted_tools": ["project.write_file", "project.run_tests", "project.run_build", "git.status", "git.diff"],
    },
    {
        "id": "agent-analytics",
        "name": "Analytics Agent",
        "role": "Telemetry & Reporting",
        "description": "Reports persisted message latency, token usage, and tool-operation counts for your account.",
        "permitted_tools": ["query_metrics", "compute_mttr"],
    },
]


@router.get("/agents", response_model=list[AgentItem])
def list_agents(db: DB, user: CurrentUser) -> list[AgentItem]:
    assistant_total = db.execute(
        select(func.count()).select_from(Message).where(Message.user_id == user.id, Message.role == "assistant")
    ).scalar() or 0
    assistant_completed = db.execute(
        select(func.count())
        .select_from(Message)
        .where(Message.user_id == user.id, Message.role == "assistant", Message.status == "completed")
    ).scalar() or 0
    tool_total = db.execute(
        select(func.count()).select_from(ToolOperation).where(ToolOperation.user_id == user.id)
    ).scalar() or 0
    tool_completed = db.execute(
        select(func.count())
        .select_from(ToolOperation)
        .where(ToolOperation.user_id == user.id, ToolOperation.status == "completed")
    ).scalar() or 0
    pending_tool = db.execute(
        select(func.count())
        .select_from(ToolOperation)
        .where(ToolOperation.user_id == user.id, ToolOperation.status == "pending_approval")
    ).scalar() or 0

    runs = {
        "agent-knowledge": (int(assistant_total), _success_rate(int(assistant_completed), int(assistant_total))),
        "agent-research": (0, 0.0),
        "agent-operations": (int(tool_total), _success_rate(int(tool_completed), int(tool_total))),
        "agent-analytics": (0, 0.0),
    }
    agents: list[AgentItem] = []
    for definition in _AGENT_DEFINITIONS:
        total_runs, success_rate = runs[definition["id"]]
        agent_status = "waiting_approval" if definition["id"] == "agent-operations" and pending_tool else "idle"
        agents.append(
            AgentItem(
                id=definition["id"],
                name=definition["name"],
                role=definition["role"],
                status=agent_status,  # type: ignore[arg-type]
                total_runs=total_runs,
                success_rate=success_rate,
                description=definition["description"],
                permitted_tools=definition["permitted_tools"],
            )
        )
    return agents


# ── Approval center (approval_requests + tool_operations) ──────────────────

@router.get("/operations/approvals", response_model=list[ApprovalItem])
def list_approvals(db: DB, user: CurrentUser) -> list[ApprovalItem]:
    tool_rows = db.execute(
        select(ToolOperation)
        .where(
            ToolOperation.user_id == user.id,
            ToolOperation.requires_approval.is_(True),
            ToolOperation.status.in_(["pending_approval", "running", "completed", "failed", "rejected"]),
        )
        .order_by(ToolOperation.created_at.desc())
        .limit(200)
    ).scalars().all()
    request_rows = db.execute(
        select(ApprovalRequest)
        .where(ApprovalRequest.owner_user_id == user.id)
        .order_by(ApprovalRequest.created_at.desc())
        .limit(200)
    ).scalars().all()
    items = [_tool_operation_to_approval(row) for row in tool_rows]
    items.extend(_approval_request_to_item(row) for row in request_rows)
    items.sort(key=lambda item: item.timestamp, reverse=True)
    return items


@router.post("/operations/approvals/{approval_id}/action", response_model=ApprovalItem)
def handle_approval(
    approval_id: uuid.UUID,
    req: ApprovalActionRequest,
    request: Request,
    db: DB,
    user: CurrentUser,
    settings: SettingsDep,
) -> ApprovalItem:
    if req.approval_id and req.approval_id != str(approval_id):
        raise HTTPException(status_code=422, detail="approval_id does not match the path parameter")

    operation = db.get(ToolOperation, approval_id)
    if operation is not None:
        if operation.user_id != user.id:
            raise HTTPException(status_code=404, detail="Approval request not found")
        if operation.status == "unavailable":
            raise HTTPException(
                status_code=409,
                detail="This integration is unavailable. Configure the provider before approving.",
            )
        out = approve_operation(db, user, approval_id, req.action, req.notes, settings)
        log_audit(
            db,
            user.id,
            f"approval.{req.action}",
            "tool_operation",
            str(approval_id),
            request.client.host if request.client else None,
            {"tool": out.tool_name, "status": out.status},
        )
        fresh = db.get(ToolOperation, approval_id)
        return _tool_operation_to_approval(fresh or operation)

    approval = db.get(ApprovalRequest, approval_id)
    if approval is None or approval.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if approval.status != "pending":
        raise HTTPException(status_code=409, detail=f"Approval request is already {approval.status}")
    approval.status = "approved" if req.action == "approve" else "rejected"
    approval.decided_by_user_id = user.id
    approval.decided_at = datetime.now(timezone.utc)
    approval.decision_notes = req.notes
    approval.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(approval)
    log_audit(
        db,
        user.id,
        f"approval.{req.action}",
        "approval_request",
        str(approval.id),
        request.client.host if request.client else None,
        {"action_type": approval.action_type, "status": approval.status},
    )
    return _approval_request_to_item(approval)


# ── Tickets ────────────────────────────────────────────────────────────────

@router.get("/operations/tickets", response_model=list[TicketItem])
def list_tickets(db: DB, user: CurrentUser) -> list[TicketItem]:
    rows = db.execute(
        select(Ticket).where(Ticket.owner_user_id == user.id).order_by(Ticket.created_at.desc())
    ).scalars().all()
    return [_ticket_to_item(row) for row in rows]


@router.post("/operations/tickets", response_model=TicketItem, status_code=status.HTTP_201_CREATED)
def create_ticket(req: TicketCreateRequest, request: Request, db: DB, user: CurrentUser) -> TicketItem:
    ticket = Ticket(
        owner_user_id=user.id,
        title=req.title.strip(),
        description=req.description.strip(),
        priority=req.priority,
        status="open",
        category=req.category.strip() or "IT Support",
        assigned_agent=None,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    log_audit(
        db,
        user.id,
        "ticket.create",
        "ticket",
        str(ticket.id),
        request.client.host if request.client else None,
        {"priority": ticket.priority, "category": ticket.category},
    )
    return _ticket_to_item(ticket)
