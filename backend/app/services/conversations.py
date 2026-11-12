"""Persistent, ownership-checked conversation and message operations."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db.models import Conversation, Message, User
from ..schemas import (
    ConversationCreate,
    ConversationList,
    ConversationOut,
    ConversationUpdate,
    MessageCreate,
    MessageOut,
    MessagePage,
)
from .projects import assert_project_access


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_admin(db: Session, user: User) -> bool:
    from ..auth.deps import get_user_role_names

    return bool(set(get_user_role_names(db, user)).intersection({"Super Admin", "Admin"}))


def assert_conversation_access(db: Session, user: User, conversation_id: uuid.UUID) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if not conv or conv.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    if conv.user_id != user.id and not _is_admin(db, user):
        # Do not disclose whether another user's conversation exists.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conv


def message_to_out(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        user_id=message.user_id,
        role=message.role,
        content=message.content or "",
        message_type=message.message_type,
        status=message.status,
        model=message.model,
        provider=message.provider,
        token_usage=message.token_usage,
        latency_ms=message.latency_ms,
        parent_message_id=message.parent_message_id,
        error_message=message.error_message,
        sequence=message.sequence,
        created_at=message.created_at,
        updated_at=message.updated_at,
    )


def conversation_to_out(db: Session, conv: Conversation) -> ConversationOut:
    count = db.execute(
        select(func.count()).select_from(Message).where(Message.conversation_id == conv.id)
    ).scalar() or 0
    last = db.execute(
        select(Message.content)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.sequence.desc())
        .limit(1)
    ).scalar_one_or_none()
    preview = (last or "").strip().replace("\n", " ")[:180] or None
    return ConversationOut(
        id=conv.id,
        user_id=conv.user_id,
        project_id=conv.project_id,
        title=conv.title,
        description=conv.description,
        conversation_type=conv.conversation_type,
        provider=conv.provider,
        model=conv.model,
        status=conv.status,
        last_message_at=conv.last_message_at,
        archived_at=conv.archived_at,
        created_at=conv.created_at,
        updated_at=conv.updated_at,
        message_count=count,
        last_message_preview=preview,
    )


def create_conversation(db: Session, user: User, req: ConversationCreate) -> Conversation:
    if req.project_id is not None:
        assert_project_access(db, user, req.project_id)
    title = (req.title or "").strip() or "New conversation"
    conv = Conversation(
        user_id=user.id,
        project_id=req.project_id,
        organization_id=req.organization_id,
        workspace_id=req.workspace_id,
        title=title[:255],
        description=(req.description or "").strip() or None,
        provider=req.provider,
        model=req.model,
        status="active",
    )
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def list_conversations(
    db: Session,
    user: User,
    q: str | None = None,
    archived: bool = False,
    limit: int = 30,
    page: int = 1,
    project_id: uuid.UUID | None = None,
) -> ConversationList:
    page = max(1, page)
    limit = max(1, min(limit, 100))
    stmt = select(Conversation).where(
        Conversation.user_id == user.id,
        Conversation.deleted_at.is_(None),
    )
    if archived:
        stmt = stmt.where(Conversation.archived_at.is_not(None))
    else:
        stmt = stmt.where(Conversation.archived_at.is_(None))
    if project_id is not None:
        assert_project_access(db, user, project_id)
        stmt = stmt.where(Conversation.project_id == project_id)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Conversation.title).like(like), func.lower(Conversation.description).like(like)))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar() or 0
    rows = db.execute(
        stmt.order_by(Conversation.last_message_at.desc().nullslast(), Conversation.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).scalars().all()
    return ConversationList(
        items=[conversation_to_out(db, c) for c in rows],
        page=page,
        page_size=limit,
        total=total,
        has_more=page * limit < total,
    )


def get_conversation(db: Session, user: User, conversation_id: uuid.UUID) -> ConversationOut:
    conv = assert_conversation_access(db, user, conversation_id)
    return conversation_to_out(db, conv)


def update_conversation(db: Session, user: User, conversation_id: uuid.UUID, req: ConversationUpdate) -> ConversationOut:
    conv = assert_conversation_access(db, user, conversation_id)
    if conv.user_id != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Only the conversation owner can modify it")
    # Detect explicitly supplied null so a project link can be cleared, while an
    # omitted field leaves the existing link untouched.
    if "project_id" in req.model_fields_set:
        if req.project_id is not None:
            assert_project_access(db, user, req.project_id)
        conv.project_id = req.project_id
    if req.title is not None:
        conv.title = req.title.strip()[:255]
    if req.description is not None:
        conv.description = req.description.strip() or None
    if req.archived is not None:
        conv.archived_at = _now() if req.archived else None
        conv.status = "archived" if req.archived else "active"
    conv.updated_at = _now()
    db.commit()
    db.refresh(conv)
    return conversation_to_out(db, conv)


def delete_conversation(db: Session, user: User, conversation_id: uuid.UUID) -> None:
    conv = assert_conversation_access(db, user, conversation_id)
    if conv.user_id != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Only the conversation owner can delete it")
    # Soft-delete preserves an audit trail and avoids destructive production
    # data loss. The record and messages are excluded from all normal queries.
    conv.deleted_at = _now()
    conv.status = "deleted"
    conv.updated_at = _now()
    db.commit()


def _next_sequence(db: Session, conversation_id: uuid.UUID) -> int:
    current = db.execute(
        select(func.max(Message.sequence)).where(Message.conversation_id == conversation_id)
    ).scalar()
    return int(current or 0) + 1


def append_message(
    db: Session,
    user: User,
    conversation_id: uuid.UUID,
    req: MessageCreate,
    *,
    role: str | None = None,
    message_type: str = "text",
    status_value: str = "completed",
    parent_message_id: uuid.UUID | None = None,
) -> Message:
    conv = assert_conversation_access(db, user, conversation_id)
    if conv.user_id != user.id and not _is_admin(db, user):
        raise HTTPException(status_code=403, detail="Only the conversation owner can add messages")
    if req.idempotency_key:
        existing = db.execute(
            select(Message).where(
                Message.conversation_id == conv.id,
                Message.idempotency_key == req.idempotency_key,
            )
        ).scalar_one_or_none()
        if existing:
            return existing
    # Lock the conversation row so concurrent requests cannot allocate the same
    # sequence number. This is a per-conversation serialization point.
    db.execute(select(Conversation.id).where(Conversation.id == conv.id).with_for_update())
    message = Message(
        conversation_id=conv.id,
        user_id=user.id,
        role=role or req.role,
        content=req.content,
        message_type=message_type,
        status=status_value,
        idempotency_key=req.idempotency_key,
        parent_message_id=parent_message_id or req.parent_message_id,
        sequence=_next_sequence(db, conv.id),
    )
    db.add(message)
    conv.last_message_at = _now()
    conv.updated_at = _now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if req.idempotency_key:
            existing = db.execute(
                select(Message).where(
                    Message.conversation_id == conv.id,
                    Message.idempotency_key == req.idempotency_key,
                )
            ).scalar_one_or_none()
            if existing:
                return existing
        raise
    db.refresh(message)
    return message


def create_assistant_message(
    db: Session,
    user: User,
    conversation_id: uuid.UUID,
    *,
    parent_message_id: uuid.UUID | None = None,
    provider: str | None = None,
    model: str | None = None,
    idempotency_key: str | None = None,
) -> Message:
    conv = assert_conversation_access(db, user, conversation_id)
    if idempotency_key:
        existing = db.execute(
            select(Message).where(
                Message.conversation_id == conv.id,
                Message.idempotency_key == idempotency_key,
            )
        ).scalar_one_or_none()
        if existing:
            return existing
    db.execute(select(Conversation.id).where(Conversation.id == conv.id).with_for_update())
    message = Message(
        conversation_id=conv.id,
        user_id=user.id,
        role="assistant",
        content="",
        message_type="text",
        status="streaming",
        provider=provider,
        model=model,
        parent_message_id=parent_message_id,
        idempotency_key=idempotency_key,
        sequence=_next_sequence(db, conv.id),
    )
    db.add(message)
    conv.last_message_at = _now()
    conv.updated_at = _now()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if idempotency_key:
            existing = db.execute(
                select(Message).where(
                    Message.conversation_id == conv.id,
                    Message.idempotency_key == idempotency_key,
                )
            ).scalar_one_or_none()
            if existing:
                return existing
        raise
    db.refresh(message)
    return message


def update_message(
    db: Session,
    message_id: uuid.UUID,
    *,
    content: str | None = None,
    status_value: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    latency_ms: int | None = None,
    token_usage: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> Message | None:
    message = db.get(Message, message_id)
    if not message:
        return None
    if content is not None:
        message.content = content
    if status_value is not None:
        message.status = status_value
    if provider is not None:
        message.provider = provider
    if model is not None:
        message.model = model
    if latency_ms is not None:
        message.latency_ms = latency_ms
    if token_usage is not None:
        message.token_usage = token_usage
    if error_message is not None:
        message.error_message = error_message[:2000]
    message.updated_at = _now()
    db.commit()
    db.refresh(message)
    return message


def list_messages(
    db: Session,
    user: User,
    conversation_id: uuid.UUID,
    limit: int = 50,
    before_sequence: int | None = None,
) -> MessagePage:
    conv = assert_conversation_access(db, user, conversation_id)
    limit = max(1, min(limit, 200))
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if before_sequence is not None:
        stmt = stmt.where(Message.sequence < before_sequence)
    rows = db.execute(stmt.order_by(Message.sequence.desc()).limit(limit + 1)).scalars().all()
    has_more = len(rows) > limit
    page_rows = list(reversed(rows[:limit]))
    next_before = page_rows[0].sequence if has_more and page_rows else None
    return MessagePage(
        items=[message_to_out(m) for m in page_rows],
        has_more=has_more,
        next_before_sequence=next_before,
    )


def edit_user_message(
    db: Session,
    user: User,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    content: str,
) -> Message:
    message = get_message(db, user, conversation_id, message_id)
    if message.role != "user":
        raise HTTPException(status_code=422, detail="Only user messages can be edited")
    message.content = content
    message.updated_at = _now()
    # Editing a turn invalidates later generated output. This is an explicit,
    # user-requested branch operation and is audited by the router.
    db.execute(
        Message.__table__.delete().where(
            Message.conversation_id == conversation_id,
            Message.sequence > message.sequence,
        )
    )
    conv = assert_conversation_access(db, user, conversation_id)
    conv.last_message_at = _now()
    conv.updated_at = _now()
    db.commit()
    db.refresh(message)
    return message


def get_message(db: Session, user: User, conversation_id: uuid.UUID, message_id: uuid.UUID) -> Message:
    conv = assert_conversation_access(db, user, conversation_id)
    message = db.execute(
        select(Message).where(Message.id == message_id, Message.conversation_id == conv.id)
    ).scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


def latest_user_message(db: Session, conversation_id: uuid.UUID) -> Message | None:
    return db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.role == "user")
        .order_by(Message.sequence.desc())
        .limit(1)
    ).scalar_one_or_none()


def conversation_history_messages(db: Session, conversation_id: uuid.UUID, limit: int = 20) -> list[Message]:
    rows = db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.role.in_(["user", "assistant"]))
        .order_by(Message.sequence.desc())
        .limit(max(1, limit))
    ).scalars().all()
    return list(reversed(rows))
