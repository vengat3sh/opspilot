"""Authenticated conversation and message APIs backed by PostgreSQL."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from ..auth.deps import get_current_user
from ..auth.service import log_audit
from ..db.models import User
from ..db.session import get_db
from ..schemas import (
    ConversationCreate,
    ConversationList,
    ConversationOut,
    ConversationUpdate,
    MessageCreate,
    MessageEditRequest,
    MessageOut,
    MessagePage,
)
from ..services.conversations import (
    append_message,
    create_conversation,
    delete_conversation,
    edit_user_message,
    get_conversation,
    list_conversations,
    list_messages,
    message_to_out,
    update_conversation,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[Session, Depends(get_db)]


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create(req: ConversationCreate, request: Request, db: DB, user: CurrentUser) -> ConversationOut:
    conv = create_conversation(db, user, req)
    log_audit(db, user.id, "conversation.create", "conversation", str(conv.id), request.client.host if request.client else None, {"project_id": str(conv.project_id) if conv.project_id else None})
    return get_conversation(db, user, conv.id)


@router.get("", response_model=ConversationList)
def list_all(
    db: DB,
    user: CurrentUser,
    q: str | None = Query(default=None, max_length=200),
    archived: bool = False,
    project_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=30, ge=1, le=100),
) -> ConversationList:
    return list_conversations(db, user, q=q, archived=archived, limit=limit, page=page, project_id=project_id)


@router.get("/{conversation_id}", response_model=ConversationOut)
def retrieve(conversation_id: uuid.UUID, db: DB, user: CurrentUser) -> ConversationOut:
    return get_conversation(db, user, conversation_id)


@router.patch("/{conversation_id}", response_model=ConversationOut)
def update(conversation_id: uuid.UUID, req: ConversationUpdate, request: Request, db: DB, user: CurrentUser) -> ConversationOut:
    out = update_conversation(db, user, conversation_id, req)
    log_audit(db, user.id, "conversation.update", "conversation", str(conversation_id), request.client.host if request.client else None, {"fields": sorted(req.model_dump(exclude_none=True).keys())})
    return out


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(conversation_id: uuid.UUID, request: Request, db: DB, user: CurrentUser) -> Response:
    delete_conversation(db, user, conversation_id)
    log_audit(db, user.id, "conversation.delete", "conversation", str(conversation_id), request.client.host if request.client else None, {})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{conversation_id}/messages", response_model=MessagePage)
def messages(
    conversation_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
    before_sequence: int | None = Query(default=None, ge=1),
) -> MessagePage:
    return list_messages(db, user, conversation_id, limit=limit, before_sequence=before_sequence)


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def add_message(conversation_id: uuid.UUID, req: MessageCreate, request: Request, db: DB, user: CurrentUser) -> MessageOut:
    message = append_message(db, user, conversation_id, req)
    log_audit(db, user.id, "conversation.message.create", "message", str(message.id), request.client.host if request.client else None, {"conversation_id": str(conversation_id), "role": message.role})
    return message_to_out(message)


@router.patch("/{conversation_id}/messages/{message_id}", response_model=MessageOut)
def edit_message(conversation_id: uuid.UUID, message_id: uuid.UUID, req: MessageEditRequest, request: Request, db: DB, user: CurrentUser) -> MessageOut:
    message = edit_user_message(db, user, conversation_id, message_id, req.content)
    log_audit(db, user.id, "conversation.message.edit", "message", str(message.id), request.client.host if request.client else None, {"conversation_id": str(conversation_id)})
    return message_to_out(message)
