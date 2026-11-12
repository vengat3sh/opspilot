"""Authenticated developer tool execution and approval APIs."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..config import Settings, get_settings
from ..db.models import User
from ..db.session import get_db
from ..schemas import ToolApprovalRequest, ToolExecuteRequest, ToolOperationOut
from ..services.sandbox import sandbox_available
from ..services.tools import APPROVAL_TOOLS, READ_ONLY_TOOLS, approve_operation, execute_tool, list_operations

router = APIRouter(prefix="/api/tools", tags=["tools"])
DB = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("")
def registry(settings: SettingsDep, _user: CurrentUser) -> dict:
    available, reason = sandbox_available(settings)
    return {
        "read_only": sorted(READ_ONLY_TOOLS),
        "approval_required": sorted(APPROVAL_TOOLS),
        "sandbox": {
            "available": available,
            "message": reason,
            "host_shell_fallback": False,
        },
    }


@router.post("/execute", response_model=ToolOperationOut)
def execute(req: ToolExecuteRequest, db: DB, user: CurrentUser, settings: SettingsDep) -> ToolOperationOut:
    return execute_tool(db, user, req, settings)


@router.get("/operations", response_model=list[ToolOperationOut])
def operations(
    db: DB,
    user: CurrentUser,
    conversation_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[ToolOperationOut]:
    return list_operations(db, user, conversation_id=conversation_id, project_id=project_id, limit=limit)


@router.post("/operations/{operation_id}/approval", response_model=ToolOperationOut)
def approval(
    operation_id: uuid.UUID,
    req: ToolApprovalRequest,
    db: DB,
    user: CurrentUser,
    settings: SettingsDep,
) -> ToolOperationOut:
    return approve_operation(db, user, operation_id, req.action, req.notes, settings)
