"""Admin-only, non-sensitive operational diagnostics backed by real data."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import llm
from ..auth.deps import require_admin
from ..config import Settings, get_settings
from ..db.models import (
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
from ..db.session import get_db

router = APIRouter(prefix="/api/v1/admin", tags=["admin-diagnostics"])
DB = Annotated[Session, Depends(get_db)]
Admin = Annotated[User, Depends(require_admin)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/diagnostics/chat")
async def chat_diagnostics(db: DB, _admin: Admin, settings: SettingsDep) -> dict:
    migration_version = None
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
        row = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).fetchone()
        migration_version = row[0] if row else None
    except Exception:
        db_ok = False

    latency_rows = db.execute(
        select(Message.latency_ms)
        .where(Message.role == "assistant", Message.latency_ms.is_not(None))
        .order_by(Message.created_at.desc())
        .limit(200)
    ).scalars().all()
    latencies = [int(v) for v in latency_rows if v is not None]
    avg_latency = int(sum(latencies) / len(latencies)) if latencies else 0
    sorted_latencies = sorted(latencies)
    p95 = sorted_latencies[max(0, int(len(sorted_latencies) * 0.95) - 1)] if sorted_latencies else 0

    token_rows = db.execute(
        select(Message.token_usage)
        .where(Message.role == "assistant", Message.token_usage.is_not(None))
        .order_by(Message.created_at.desc())
        .limit(500)
    ).scalars().all()
    completion_tokens = sum(int((row or {}).get("completion_tokens") or 0) for row in token_rows)

    recent_errors = db.execute(
        select(AuditLog).where(AuditLog.action.in_(["chat.failed", "tool.execute.failed", "tool.execution.unavailable"]))
        .order_by(AuditLog.timestamp.desc()).limit(10)
    ).scalars().all()
    recent_ops = db.execute(select(ToolOperation).order_by(ToolOperation.created_at.desc()).limit(10)).scalars().all()

    ollama_reachable, ollama_models = await llm.ollama_status(settings)
    counts = {
        "users": db.execute(select(func.count()).select_from(User)).scalar() or 0,
        "conversations": db.execute(select(func.count()).select_from(Conversation).where(Conversation.deleted_at.is_(None))).scalar() or 0,
        "messages": db.execute(select(func.count()).select_from(Message)).scalar() or 0,
        "failed_messages": db.execute(select(func.count()).select_from(Message).where(Message.status == "failed")).scalar() or 0,
        "interrupted_messages": db.execute(select(func.count()).select_from(Message).where(Message.status == "interrupted")).scalar() or 0,
        "projects": db.execute(select(func.count()).select_from(Project).where(Project.archived_at.is_(None))).scalar() or 0,
        "indexed_projects": db.execute(select(func.count()).select_from(Project).where(Project.indexing_status == "indexed")).scalar() or 0,
        "pending_tool_approvals": db.execute(select(func.count()).select_from(ToolOperation).where(ToolOperation.status == "pending_approval")).scalar() or 0,
        "unavailable_tool_operations": db.execute(select(func.count()).select_from(ToolOperation).where(ToolOperation.status == "unavailable")).scalar() or 0,
        "knowledge_documents": db.execute(select(func.count()).select_from(KnowledgeDocument)).scalar() or 0,
        "tickets": db.execute(select(func.count()).select_from(Ticket)).scalar() or 0,
        "pending_approval_requests": db.execute(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.status == "pending")).scalar() or 0,
    }
    return {
        "status": "ok" if db_ok else "degraded",
        "database": {"connected": db_ok, "migration_version": migration_version},
        "llm": {
            "configured_provider": settings.llm_provider,
            "cloud_configured": bool(settings.cloud_api_key.get_secret_value()),
            "ollama_reachable": ollama_reachable,
            "ollama_models": ollama_models,
        },
        "counts": counts,
        "performance": {
            "assistant_latency_samples": len(latencies),
            "avg_latency_ms": avg_latency,
            "p95_latency_ms": p95,
            "recent_completion_tokens": completion_tokens,
            "note": "Process-local request timing is logged with request IDs; these values are persisted message measurements.",
        },
        "recent_errors": [
            {
                "action": row.action,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "timestamp": row.timestamp,
                "metadata": row.metadata_json or {},
            }
            for row in recent_errors
        ],
        "recent_tool_operations": [
            {
                "id": str(op.id),
                "tool": op.tool_name,
                "status": op.status,
                "risk": op.risk_level,
                "project_id": str(op.project_id) if op.project_id else None,
                "created_at": op.created_at,
            }
            for op in recent_ops
        ],
    }
