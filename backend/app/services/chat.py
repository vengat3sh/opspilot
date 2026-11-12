"""Chat turn orchestration: persistence, history, project context and retry."""
from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import Conversation, Message, User
from ..schemas import ChatMessage, ChatRequest, MessageCreate
from .conversations import (
    append_message,
    assert_conversation_access,
    create_assistant_message,
    latest_user_message,
    conversation_history_messages,
)
from .projects import assert_project_access, build_project_context


@dataclass
class ChatTurn:
    conversation: Conversation
    user_message: Message
    assistant_message: Message
    history: list[ChatMessage]
    project_context: str
    project_id: uuid.UUID | None
    assistant_reused: bool = False


def _title_from(text: str) -> str:
    clean = " ".join((text or "").split())
    return (clean[:70] + ("…" if len(clean) > 70 else "")) or "New conversation"


def _idempotency_key(req: ChatRequest, content: str) -> str | None:
    if req.idempotency_key:
        return req.idempotency_key
    return None


def prepare_turn(db: Session, user: User, req: ChatRequest, *, streaming: bool) -> ChatTurn:
    if not req.messages:
        raise HTTPException(status_code=422, detail="At least one message is required")
    last = req.messages[-1]
    if last.role != "user":
        raise HTTPException(status_code=422, detail="The last message must have role 'user'")
    content = last.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Message content cannot be empty")

    project_id = req.project_id
    if req.conversation_id:
        conversation = assert_conversation_access(db, user, req.conversation_id)
        if project_id is None:
            project_id = conversation.project_id
    else:
        if project_id is not None:
            assert_project_access(db, user, project_id)
        conversation = Conversation(
            user_id=user.id,
            project_id=project_id,
            title=_title_from(content),
            provider=req.provider,
            model=None,
            status="active",
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

    if project_id is not None:
        assert_project_access(db, user, project_id)
        if conversation.project_id != project_id:
            conversation.project_id = project_id
            db.commit()

    if req.regenerate:
        user_message = latest_user_message(db, conversation.id)
        if not user_message:
            raise HTTPException(status_code=409, detail="There is no previous user message to regenerate")
        # Regeneration must never create a duplicate user message.
    else:
        user_message = append_message(
            db,
            user,
            conversation.id,
            MessageCreate(
                role="user",
                content=content,
                idempotency_key=_idempotency_key(req, content),
                parent_message_id=req.parent_message_id,
            ),
        )

    context = ""
    if project_id is not None:
        context, _, _ = build_project_context(db, user, project_id, query=content)
    history_rows = conversation_history_messages(db, conversation.id, limit=20)
    history = [
        ChatMessage(role=row.role, content=row.content)  # type: ignore[arg-type]
        for row in history_rows
        if row.role in {"user", "assistant"} and (row.content or "").strip()
    ]
    if not history:
        history = [ChatMessage(role="user", content=content)]
    assistant_key = f"{req.idempotency_key}:assistant" if req.idempotency_key else None
    existing_assistant = None
    if assistant_key:
        existing_assistant = db.execute(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.idempotency_key == assistant_key,
            )
        ).scalar_one_or_none()
    assistant_message = existing_assistant or create_assistant_message(
        db,
        user,
        conversation.id,
        parent_message_id=user_message.id,
        provider=req.provider,
        idempotency_key=assistant_key,
    )
    return ChatTurn(
        conversation=conversation,
        user_message=user_message,
        assistant_message=assistant_message,
        history=history,
        project_context=context,
        project_id=project_id,
        assistant_reused=existing_assistant is not None,
    )


def usage_dict(result: Any) -> dict[str, Any] | None:
    prompt = getattr(result, "prompt_tokens", None)
    completion = getattr(result, "completion_tokens", None)
    if prompt is None and completion is None:
        return None
    return {"prompt_tokens": prompt, "completion_tokens": completion}
