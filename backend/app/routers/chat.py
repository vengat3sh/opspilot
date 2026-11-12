import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from .. import llm
from ..config import Settings, get_settings
from ..schemas import ChatRequest, ChatResponse, LLMStatus

router = APIRouter(prefix="/api", tags=["chat"])
SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, settings: SettingsDep) -> ChatResponse:
    try:
        try:
            out = llm.chat(settings, req.messages, req.provider, req.agent)
        except TypeError:
            out = llm.chat(settings, req.messages, req.provider)
        pipeline = await out
        # Compatibility: legacy monkeypatches may return LLMResult
        if isinstance(pipeline, llm.LLMResult):
            result = pipeline
            agent = req.agent or "knowledge"
            citations: list[str] = []
        else:
            result = pipeline.result
            agent = getattr(pipeline, "agent", req.agent or "knowledge")
            citations = getattr(pipeline, "citations", [])
    except llm.LLMError as exc:
        raise HTTPException(status_code=getattr(exc, "status_code", 502), detail=str(exc)) from exc
    return ChatResponse(
        reply=result.text,
        provider=result.provider,
        model=result.model,
        latency_ms=result.latency_ms,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        agent=agent,
        citations=citations,
    )


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, settings: SettingsDep) -> StreamingResponse:
    """Server-Sent Events endpoint — streams tokens as they're generated."""

    async def event_generator():
        try:
            async for token in llm.stream_chat(settings, req.messages, req.provider, req.agent):
                # Control tokens (__done__, __error__) are already JSON-encoded
                # dicts from llm.py — pass them through raw so the frontend
                # receives a JSON object, not a double-encoded string.
                try:
                    parsed = json.loads(token)
                    if isinstance(parsed, dict):
                        yield f"data: {token}\n\n"
                        await asyncio.sleep(0)
                        continue
                except (json.JSONDecodeError, ValueError):
                    pass
                # Regular text token — encode as a JSON string
                yield f"data: {json.dumps(token)}\n\n"
                await asyncio.sleep(0)  # yield control to event loop
        except llm.LLMError as exc:
            yield f"data: {json.dumps({'__error__': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.get("/llm/status", response_model=LLMStatus)
async def llm_status(settings: SettingsDep) -> LLMStatus:
    reachable, models = await llm.ollama_status(settings)
    cloud_ok = bool(settings.cloud_api_key.get_secret_value())
    # If Ollama is down but cloud is configured (or on cloud deployment), report cloud
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
