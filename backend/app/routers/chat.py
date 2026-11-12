"""Authenticated chat endpoints with PostgreSQL persistence and SSE lifecycle."""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Annotated, Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import llm
from ..auth.deps import get_current_user
from ..auth.service import log_audit
from ..config import Settings, get_settings
from ..db.models import Message, User
from ..db.session import SessionLocal, get_db
from ..schemas import ChatMessage, ChatRequest, ChatResponse, LLMStatus
from ..services.chat import ChatTurn, prepare_turn, usage_dict
from ..services.conversations import assert_conversation_access, latest_user_message, update_message

logger = logging.getLogger("opspilot.chat")
router = APIRouter(prefix="/api", tags=["chat"])
SettingsDep = Annotated[Settings, Depends(get_settings)]
CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[Session, Depends(get_db)]

# Cancellation is process-local. In a multi-worker deployment a dedicated
# pub/sub backend would be required; the client abort still propagates here.
_CANCEL_EVENTS: dict[str, asyncio.Event] = {}


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _safe_error(exc: BaseException) -> str:
    if isinstance(exc, llm.LLMError):
        return str(exc)[:2000]
    return "The AI provider failed while generating this response. Please retry."


def _audit(user_id: uuid.UUID, action: str, target_id: uuid.UUID, ip: str | None, metadata: dict[str, Any]) -> None:
    audit_db = SessionLocal()
    try:
        log_audit(audit_db, user_id, action, "message", str(target_id), ip, metadata)
    except Exception:
        logger.exception("chat_audit_failed action=%s target_id=%s", action, target_id)
        audit_db.rollback()
    finally:
        audit_db.close()


def _persist_assistant(
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
    db = SessionLocal()
    try:
        return update_message(
            db,
            message_id,
            content=content,
            status_value=status_value,
            provider=provider,
            model=model,
            latency_ms=latency_ms,
            token_usage=token_usage,
            error_message=error_message,
        )
    except Exception:
        logger.exception("assistant_persist_failed message_id=%s", message_id)
        db.rollback()
        return None
    finally:
        db.close()


async def _call_chat(settings: Settings, messages, provider, agent, extra_context: str, user_id: uuid.UUID):
    try:
        return await llm.chat(settings, messages, provider, agent, extra_context=extra_context, user_id=user_id)
    except TypeError:
        try:
            return await llm.chat(settings, messages, provider, agent, extra_context=extra_context)
        except TypeError:
            try:
                return await llm.chat(settings, messages, provider, agent)
            except TypeError:
                return await llm.chat(settings, messages, provider)


def _make_stream(settings: Settings, messages, provider, agent, extra_context: str, user_id: uuid.UUID):
    try:
        return llm.stream_chat(settings, messages, provider, agent, extra_context=extra_context, user_id=user_id)
    except TypeError:
        try:
            return llm.stream_chat(settings, messages, provider, agent, extra_context=extra_context)
        except TypeError:
            try:
                return llm.stream_chat(settings, messages, provider, agent)
            except TypeError:
                return llm.stream_chat(settings, messages, provider)


def _reused_response(turn: ChatTurn, settings: Settings) -> ChatResponse | None:
    msg = turn.assistant_message
    if not turn.assistant_reused:
        return None
    if msg.status == "streaming":
        raise HTTPException(status_code=409, detail="This response is already being generated")
    return ChatResponse(
        reply=msg.content or "",
        provider=msg.provider or "",
        model=msg.model or "",
        latency_ms=msg.latency_ms or 0,
        prompt_tokens=(msg.token_usage or {}).get("prompt_tokens"),
        completion_tokens=(msg.token_usage or {}).get("completion_tokens"),
        agent="knowledge",
        citations=[],
        conversation_id=turn.conversation.id,
        user_message_id=turn.user_message.id,
        assistant_message_id=msg.id,
        message_status=msg.status,
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request, settings: SettingsDep, db: DB, user: CurrentUser) -> ChatResponse:
    t_request = time.perf_counter()
    turn = prepare_turn(db, user, req, streaming=False)
    prepare_ms = int((time.perf_counter() - t_request) * 1000)
    reused = _reused_response(turn, settings)
    if reused is not None:
        return reused

    t0 = time.perf_counter()
    try:
        pipeline = await _call_chat(settings, turn.history, req.provider, req.agent, turn.project_context, user.id)
        if isinstance(pipeline, llm.LLMResult):
            result = pipeline
            agent = req.agent or "knowledge"
            citations: list[str] = []
        else:
            result = pipeline.result
            agent = getattr(pipeline, "agent", req.agent or "knowledge")
            citations = getattr(pipeline, "citations", [])
        total_ms = int((time.perf_counter() - t0) * 1000)
        update_message(
            db,
            turn.assistant_message.id,
            content=result.text,
            status_value="completed",
            provider=result.provider,
            model=result.model,
            latency_ms=total_ms,
            token_usage=usage_dict(result),
        )
        log_audit(
            db,
            user.id,
            "chat.complete",
            "message",
            str(turn.assistant_message.id),
            request.client.host if request.client else None,
            {"conversation_id": str(turn.conversation.id), "provider": result.provider, "latency_ms": total_ms},
        )
        logger.info(
            "chat_metrics request_id=%s conversation_id=%s provider=%s prepare_ms=%d total_ms=%d completion_tokens=%s tokens_per_sec=%.2f",
            getattr(request.state, "request_id", "-"),
            turn.conversation.id,
            result.provider,
            prepare_ms,
            total_ms,
            result.completion_tokens,
            (result.completion_tokens or 0) / max(total_ms / 1000, 0.001),
        )
        return ChatResponse(
            reply=result.text,
            provider=result.provider,
            model=result.model,
            latency_ms=total_ms,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            agent=agent,
            citations=citations,
            conversation_id=turn.conversation.id,
            user_message_id=turn.user_message.id,
            assistant_message_id=turn.assistant_message.id,
            message_status="completed",
        )
    except llm.LLMError as exc:
        update_message(
            db,
            turn.assistant_message.id,
            status_value="failed",
            error_message=str(exc)[:2000],
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )
        log_audit(
            db,
            user.id,
            "chat.failed",
            "message",
            str(turn.assistant_message.id),
            request.client.host if request.client else None,
            {"conversation_id": str(turn.conversation.id), "provider_error": type(exc).__name__},
        )
        raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("chat_unhandled_error conversation_id=%s", turn.conversation.id)
        update_message(
            db,
            turn.assistant_message.id,
            status_value="failed",
            error_message="Unexpected generation failure.",
            latency_ms=int((time.perf_counter() - t0) * 1000),
        )
        raise HTTPException(status_code=500, detail="Chat generation failed") from exc


@router.post("/chat/retry/{assistant_message_id}", response_model=ChatResponse)
async def retry_response(
    assistant_message_id: uuid.UUID,
    request: Request,
    settings: SettingsDep,
    db: DB,
    user: CurrentUser,
    provider: str | None = None,
) -> ChatResponse:
    """Retry a failed/interrupted assistant turn without duplicating the user message."""
    old = db.get(Message, assistant_message_id)
    if not old:
        raise HTTPException(status_code=404, detail="Message not found")
    assert_conversation_access(db, user, old.conversation_id)
    if old.role != "assistant":
        raise HTTPException(status_code=422, detail="Only assistant messages can be retried")
    user_message = latest_user_message(db, old.conversation_id)
    if not user_message:
        raise HTTPException(status_code=409, detail="No user message is available for retry")
    req = ChatRequest(
        messages=[ChatMessage(role="user", content=user_message.content)],
        conversation_id=old.conversation_id,
        provider=provider,  # type: ignore[arg-type]
        regenerate=True,
        idempotency_key=uuid.uuid4().hex,
    )
    turn = prepare_turn(db, user, req, streaming=False)
    t0 = time.perf_counter()
    try:
        pipeline = await _call_chat(settings, turn.history, req.provider, req.agent, turn.project_context, user.id)
        result = pipeline if isinstance(pipeline, llm.LLMResult) else pipeline.result
        total_ms = int((time.perf_counter() - t0) * 1000)
        update_message(
            db,
            turn.assistant_message.id,
            content=result.text,
            status_value="completed",
            provider=result.provider,
            model=result.model,
            latency_ms=total_ms,
            token_usage=usage_dict(result),
        )
        return ChatResponse(
            reply=result.text,
            provider=result.provider,
            model=result.model,
            latency_ms=total_ms,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            agent=getattr(pipeline, "agent", req.agent or "knowledge"),
            citations=getattr(pipeline, "citations", []),
            conversation_id=turn.conversation.id,
            user_message_id=turn.user_message.id,
            assistant_message_id=turn.assistant_message.id,
            message_status="completed",
        )
    except llm.LLMError as exc:
        update_message(db, turn.assistant_message.id, status_value="failed", error_message=str(exc)[:2000])
        raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=str(exc)) from exc


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request, settings: SettingsDep, db: DB, user: CurrentUser) -> StreamingResponse:
    """Stream an authenticated, persisted assistant turn using a documented SSE protocol.

    Events: message_started, token, usage, message_completed, message_failed,
    message_interrupted, heartbeat.
    """
    t_request = time.perf_counter()
    turn = prepare_turn(db, user, req, streaming=True)
    prepare_ms = int((time.perf_counter() - t_request) * 1000)
    reused = _reused_response(turn, settings)
    if reused is not None:
        async def replay():
            yield _sse("message_started", {
                "type": "message_started",
                "conversation_id": str(turn.conversation.id),
                "user_message_id": str(turn.user_message.id),
                "assistant_message_id": str(turn.assistant_message.id),
                "reused": True,
            })
            if reused.reply:
                yield _sse("token", {"type": "token", "content": reused.reply})
            yield _sse("message_completed", {
                "type": "message_completed",
                "conversation_id": str(turn.conversation.id),
                "assistant_message_id": str(turn.assistant_message.id),
                "provider": reused.provider,
                "model": reused.model,
                "latency_ms": reused.latency_ms,
                "prompt_tokens": reused.prompt_tokens,
                "completion_tokens": reused.completion_tokens,
                "status": reused.message_status,
                "reused": True,
            })
        return StreamingResponse(replay(), media_type="text/event-stream", headers=_stream_headers())

    cancel_event = asyncio.Event()
    _CANCEL_EVENTS[str(turn.assistant_message.id)] = cancel_event

    async def event_generator():
        partial = ""
        terminal: str | None = None
        meta: dict[str, Any] = {}
        last_persist = time.monotonic()
        stream_started = time.perf_counter()
        first_token_ms: int | None = None
        stream = _make_stream(settings, turn.history, req.provider, req.agent, turn.project_context, user.id)
        yield _sse("message_started", {
            "type": "message_started",
            "conversation_id": str(turn.conversation.id),
            "user_message_id": str(turn.user_message.id),
            "assistant_message_id": str(turn.assistant_message.id),
            "provider": req.provider or settings.llm_provider,
        })
        if turn.project_context:
            yield _sse("context", {
                "type": "context",
                "project_id": str(turn.project_id) if turn.project_id else None,
                "repository_inspected": "retrieved from the authorized repository index" in turn.project_context,
            })
        try:
            while True:
                if await request.is_disconnected() or cancel_event.is_set():
                    terminal = "interrupted"
                    break
                try:
                    chunk = await asyncio.wait_for(stream.__anext__(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield _sse("heartbeat", {"type": "heartbeat", "status": "streaming"})
                    continue
                except StopAsyncIteration:
                    break
                parsed: Any = None
                try:
                    parsed = json.loads(chunk)
                except (json.JSONDecodeError, TypeError, ValueError):
                    parsed = None
                if isinstance(parsed, dict) and parsed.get("__done__"):
                    meta = parsed
                    continue
                if isinstance(parsed, dict) and parsed.get("__error__"):
                    raise llm.LLMError(str(parsed.get("__error__"))[:2000])
                token = parsed if isinstance(parsed, str) else chunk
                if not token:
                    continue
                if first_token_ms is None:
                    first_token_ms = int((time.perf_counter() - stream_started) * 1000)
                partial += token
                yield _sse("token", {"type": "token", "content": token})
                if time.monotonic() - last_persist >= 0.75:
                    _persist_assistant(turn.assistant_message.id, content=partial, status_value="streaming")
                    last_persist = time.monotonic()
            if terminal == "interrupted":
                _persist_assistant(
                    turn.assistant_message.id,
                    content=partial,
                    status_value="interrupted",
                    error_message="Generation was cancelled or the client disconnected.",
                )
                yield _sse("message_interrupted", {
                    "type": "message_interrupted",
                    "conversation_id": str(turn.conversation.id),
                    "assistant_message_id": str(turn.assistant_message.id),
                    "content": partial,
                    "status": "interrupted",
                })
                _audit(
                    user.id,
                    "chat.interrupted",
                    turn.assistant_message.id,
                    request.client.host if request.client else None,
                    {"conversation_id": str(turn.conversation.id), "partial_chars": len(partial)},
                )
                logger.info(
                    "chat_stream_metrics request_id=%s conversation_id=%s status=interrupted prepare_ms=%d ttft_ms=%s total_ms=%d chars=%d",
                    getattr(request.state, "request_id", "-"),
                    turn.conversation.id,
                    prepare_ms,
                    first_token_ms,
                    int((time.perf_counter() - stream_started) * 1000),
                    len(partial),
                )
                return
            if not partial.strip():
                raise llm.LLMError("The provider returned an empty response.")
            provider = str(meta.get("provider") or req.provider or settings.llm_provider)
            model = str(meta.get("model") or "")
            latency_ms = int(meta.get("latency_ms") or 0)
            prompt_tokens = meta.get("prompt_tokens")
            completion_tokens = meta.get("completion_tokens")
            usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            } if prompt_tokens is not None or completion_tokens is not None else None
            _persist_assistant(
                turn.assistant_message.id,
                content=partial,
                status_value="completed",
                provider=provider,
                model=model,
                latency_ms=latency_ms,
                token_usage=usage,
            )
            if usage:
                yield _sse("usage", {"type": "usage", **usage})
            yield _sse("message_completed", {
                "type": "message_completed",
                "conversation_id": str(turn.conversation.id),
                "assistant_message_id": str(turn.assistant_message.id),
                "provider": provider,
                "model": model,
                "latency_ms": latency_ms,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "agent": meta.get("agent"),
                "citations": meta.get("citations") or [],
                "status": "completed",
            })
            _audit(
                user.id,
                "chat.complete",
                turn.assistant_message.id,
                request.client.host if request.client else None,
                {"conversation_id": str(turn.conversation.id), "provider": provider, "latency_ms": latency_ms},
            )
            logger.info(
                "chat_stream_metrics request_id=%s conversation_id=%s status=completed provider=%s prepare_ms=%d ttft_ms=%s total_ms=%d completion_tokens=%s tokens_per_sec=%.2f",
                getattr(request.state, "request_id", "-"),
                turn.conversation.id,
                provider,
                prepare_ms,
                first_token_ms,
                int((time.perf_counter() - stream_started) * 1000),
                completion_tokens,
                (completion_tokens or 0) / max((time.perf_counter() - stream_started), 0.001),
            )
        except asyncio.CancelledError:
            _persist_assistant(
                turn.assistant_message.id,
                content=partial,
                status_value="interrupted",
                error_message="Generation was cancelled.",
            )
            raise
        except llm.LLMError as exc:
            message = _safe_error(exc)
            _persist_assistant(
                turn.assistant_message.id,
                content=partial,
                status_value="failed",
                error_message=message,
            )
            yield _sse("message_failed", {
                "type": "message_failed",
                "conversation_id": str(turn.conversation.id),
                "assistant_message_id": str(turn.assistant_message.id),
                "content": partial,
                "error": message,
                "status": "failed",
            })
            _audit(
                user.id,
                "chat.failed",
                turn.assistant_message.id,
                request.client.host if request.client else None,
                {"conversation_id": str(turn.conversation.id), "provider_error": type(exc).__name__},
            )
        except Exception as exc:
            logger.exception("chat_stream_failed conversation_id=%s", turn.conversation.id)
            message = _safe_error(exc)
            _persist_assistant(
                turn.assistant_message.id,
                content=partial,
                status_value="failed",
                error_message=message,
            )
            yield _sse("message_failed", {
                "type": "message_failed",
                "conversation_id": str(turn.conversation.id),
                "assistant_message_id": str(turn.assistant_message.id),
                "content": partial,
                "error": message,
                "status": "failed",
            })
        finally:
            _CANCEL_EVENTS.pop(str(turn.assistant_message.id), None)
            try:
                await stream.aclose()
            except Exception:
                logger.debug("stream_close_failed", exc_info=True)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_stream_headers())


def _stream_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


@router.post("/chat/cancel/{assistant_message_id}")
async def cancel_generation(assistant_message_id: uuid.UUID, db: DB, user: CurrentUser) -> dict:
    message = db.get(Message, assistant_message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    assert_conversation_access(db, user, message.conversation_id)
    event = _CANCEL_EVENTS.get(str(assistant_message_id))
    if not event:
        raise HTTPException(status_code=409, detail="Generation is not active in this process")
    event.set()
    return {"ok": True, "assistant_message_id": str(assistant_message_id), "status": "cancelling"}


@router.get("/llm/status", response_model=LLMStatus)
async def llm_status(settings: SettingsDep, _user: CurrentUser) -> LLMStatus:
    reachable, models = await llm.ollama_status(settings)
    cloud_ok = bool(settings.cloud_api_key.get_secret_value())
    provider = settings.llm_provider
    if not reachable:
        provider = "cloud"
    return LLMStatus(
        provider=provider,
        ollama_reachable=reachable,
        ollama_models=models,
        ollama_model_ready=settings.ollama_model in models if reachable else False,
        cloud_configured=cloud_ok,
    )
