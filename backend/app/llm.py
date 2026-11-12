"""LLM provider layer: local Ollama and any OpenAI-compatible cloud API."""
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings
from .schemas import ChatMessage
from . import rag
from .routers.operations import _METRICS

logger = logging.getLogger("opspilot.llm")

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_THINK_OPEN_RE = re.compile(r"<think>", re.IGNORECASE)
_THINK_CLOSE_RE = re.compile(r"</think>", re.IGNORECASE)

# Note: avoid a long-lived global client here because FastAPI/TestClient and
# pytest-asyncio may run across different event loops in tests/local runs.
# httpx.AsyncClient connection reuse is still enabled per request context below.
def _client_timeout(timeout: float) -> httpx.Timeout:
    return httpx.Timeout(timeout, connect=min(10.0, timeout))


class _ClientFactory:
    """Simple indirection so tests can monkeypatch llm.httpx.AsyncClient as before."""

    @staticmethod
    def make(timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=_client_timeout(timeout),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
        )


def _get_client(timeout: float) -> httpx.AsyncClient:
    # For now create a client per call; callers using stream contexts manage lifecycle.
    # This keeps behavior safe across event loops. Performance can be improved later via app lifespan.
    return _ClientFactory.make(timeout)


class LLMError(Exception):
    """Raised when a provider call fails; message is safe to show to clients."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class LLMResult:
    text: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


def strip_thinking(text: str) -> str:
    if not text:
        return ""
    cleaned = _THINK_RE.sub("", text)
    # Remove any stray/unclosed think markers defensively
    cleaned = _THINK_OPEN_RE.sub("", cleaned)
    cleaned = _THINK_CLOSE_RE.sub("", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# Non-streaming helpers
# ---------------------------------------------------------------------------

def _inject_system(settings: Settings, messages: list[ChatMessage], custom_prompt: str | None = None) -> list[dict]:
    """Prepend the system prompt (or grounded RAG agent prompt) unless provided."""
    dicts = [m.model_dump() for m in messages]
    prompt = custom_prompt or settings.system_prompt
    if not dicts or dicts[0].get("role") != "system":
        dicts.insert(0, {"role": "system", "content": prompt})
    elif custom_prompt:
        dicts[0]["content"] = custom_prompt
    return dicts


def _ollama_payload(settings: Settings, messages: list[ChatMessage], custom_prompt: str | None, stream: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.ollama_model,
        "messages": _inject_system(settings, messages, custom_prompt),
        "stream": stream,
        # Qwen3 / Ollama: suppress reasoning/thinking traces where supported
        "think": False,
        "options": {
            "temperature": 0.2,
        },
    }
    return payload


async def _ollama_chat(settings: Settings, messages: list[ChatMessage], custom_prompt: str | None = None) -> LLMResult:
    payload = _ollama_payload(settings, messages, custom_prompt, stream=False)
    url = f"{settings.ollama_base_url}/api/chat"
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=_client_timeout(settings.llm_timeout_seconds)) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code == 404:
                raise LLMError(
                    f"Ollama model '{settings.ollama_model}' not found. Run `ollama pull {settings.ollama_model}` and retry.",
                    status_code=404,
                )
            resp.raise_for_status()
            data = resp.json()
    except LLMError:
        raise
    except httpx.TimeoutException as exc:
        raise LLMError(
            f"Ollama request timed out after {int(settings.llm_timeout_seconds)}s. Try a shorter prompt or increase LLM_TIMEOUT_SECONDS.",
            status_code=504,
        ) from exc
    except httpx.ConnectError as exc:
        raise LLMError("Ollama is not reachable. Is `ollama serve` running?", status_code=503) from exc
    except httpx.HTTPStatusError as exc:
        detail = (exc.response.text or "")[:200]
        raise LLMError(f"Ollama error {exc.response.status_code}: {detail}", status_code=502) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ollama request failed: {type(exc).__name__}", status_code=502) from exc

    latency = int((time.perf_counter() - start) * 1000)
    return LLMResult(
        text=strip_thinking((data.get("message", {}) or {}).get("content", "") or ""),
        provider="ollama",
        model=settings.ollama_model,
        latency_ms=latency,
        prompt_tokens=data.get("prompt_eval_count"),
        completion_tokens=data.get("eval_count"),
    )


# High-performance zero-cost models with verified $0.00 pricing on OpenRouter
FREE_MODEL_FALLBACKS = [
    "nvidia/nemotron-3.5-lightning:free",
    "cohere/north-mini-code:free",
    "liquid/lfm-2.5-2.6b:free",
    "xingchen-agi/xing4.0-29b-a4b:free",
]


def _format_quota_error(detail: str = "") -> str:
    return (
        "⚠️ FREE TOKEN LIMIT REACHED / RATE-LIMITED\n\n"
        "🛡️ Zero-Charge Safety Guard: The cloud provider's free tier has temporarily reached its token or request limit. "
        "OpsPilot has automatically cut off the connection to ensure you are NEVER charged.\n\n"
        "🕒 When it resets:\n"
        "• Minute limits refresh in ~60 seconds.\n"
        "• Daily quotas reset at 00:00 UTC.\n\n"
        "💡 You can retry in 1 minute, or switch to 'Local (Ollama)' in the sidebar for unlimited local queries."
    )


async def _cloud_chat(settings: Settings, messages: list[ChatMessage], custom_prompt: str | None = None) -> LLMResult:
    api_key = settings.cloud_api_key.get_secret_value()
    if not api_key:
        raise LLMError("Cloud provider is not configured (CLOUD_API_KEY is empty).", status_code=503)

    if "openrouter" in settings.cloud_base_url.lower() and not settings.cloud_model.endswith(":free"):
        raise LLMError("Only free-tier models (:free) are permitted for cloud requests in this configuration.", status_code=403)

    models_to_try = [settings.cloud_model]
    if settings.cloud_model in FREE_MODEL_FALLBACKS:
        for fb in FREE_MODEL_FALLBACKS:
            if fb not in models_to_try:
                models_to_try.append(fb)

    last_error: LLMError | None = None
    async with httpx.AsyncClient(timeout=_client_timeout(settings.llm_timeout_seconds)) as client:
        for model_name in models_to_try:
            payload = {
                "model": model_name,
                "messages": _inject_system(settings, messages, custom_prompt),
            }
            url = f"{settings.cloud_base_url.rstrip('/')}/chat/completions"
            start = time.perf_counter()
            try:
                resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}"})
                if resp.status_code == 429:
                    logger.warning("Model %s rate-limited (429), trying fallback...", model_name)
                    last_error = LLMError(_format_quota_error(), status_code=429)
                    continue
                if resp.status_code == 402:
                    raise LLMError("Payment-required model blocked by safety guard.", status_code=402)
                if resp.status_code == 404:
                    last_error = LLMError(f"Cloud model '{model_name}' not found.", status_code=404)
                    continue
                resp.raise_for_status()
                data = resp.json()

                latency = int((time.perf_counter() - start) * 1000)
                usage = data.get("usage") or {}
                text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                return LLMResult(
                    text=strip_thinking(text),
                    provider="cloud",
                    model=model_name,
                    latency_ms=latency,
                    prompt_tokens=usage.get("prompt_tokens"),
                    completion_tokens=usage.get("completion_tokens"),
                )
            except LLMError as exc:
                if exc.status_code in {429, 404} and model_name != models_to_try[-1]:
                    last_error = exc
                    continue
                raise
            except httpx.TimeoutException as exc:
                last_error = LLMError(f"Cloud request timed out after {int(settings.llm_timeout_seconds)}s.", status_code=504)
                if model_name != models_to_try[-1]:
                    continue
                raise last_error from exc
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_error = LLMError(_format_quota_error(), status_code=429)
                    continue
                if exc.response.status_code == 402:
                    raise LLMError("Payment-required model blocked by safety guard.", status_code=402) from exc
                raise LLMError(f"Cloud API error {exc.response.status_code}", status_code=502) from exc
            except httpx.HTTPError as exc:
                if model_name != models_to_try[-1]:
                    last_error = LLMError(f"Cloud request failed: {type(exc).__name__}", status_code=502)
                    continue
                raise LLMError(f"Cloud request failed: {type(exc).__name__}", status_code=502) from exc

    if last_error:
        raise last_error
    raise LLMError("Cloud request failed.", status_code=502)


@dataclass
class ChatPipelineResult:
    result: LLMResult
    agent: str
    citations: list[str]

    @property
    def text(self) -> str:
        return self.result.text

    @property
    def provider(self) -> str:
        return self.result.provider

    @property
    def model(self) -> str:
        return self.result.model

    @property
    def latency_ms(self) -> int:
        return self.result.latency_ms

    @property
    def prompt_tokens(self) -> int | None:
        return self.result.prompt_tokens

    @property
    def completion_tokens(self) -> int | None:
        return self.result.completion_tokens


async def chat(settings: Settings, messages: list[ChatMessage], provider: str | None, agent: str | None = None):
    """
    Returns ChatPipelineResult for the app pipeline. Also compatible with legacy
    monkeypatches/tests that expect (settings, messages, provider) -> LLMResult.
    """
    # Support monkeypatched legacy callables in tests by trying flexible arity
    # (this function itself is the implementation; compatibility handled in router/helpers if patched)
    chosen = provider or settings.llm_provider
    t0 = time.perf_counter()
    _METRICS["queries_count"] += 1
    user_text = messages[-1].content if messages else ""

    interception = rag.intercept_consequential_action(user_text)
    if interception:
        latency = int((time.perf_counter() - t0) * 1000)
        return ChatPipelineResult(
            result=LLMResult(text=interception, provider="system_guard", model="SOC2-Safety-Sentinel", latency_ms=latency),
            agent="Operations Agent (Guard)",
            citations=[],
        )

    t_route = time.perf_counter()
    active_agent = agent if agent and agent != "auto" else rag.classify_agent(user_text)
    chunks, citations = rag.search_knowledge(user_text)
    custom_prompt = rag.build_agent_system_prompt(active_agent, chunks)
    agent_display = f"{active_agent.capitalize()} Agent"
    t_prep = time.perf_counter()
    logger.info(
        "chat provider=%s agent=%s messages=%d prep_ms=%d citations=%d",
        chosen, active_agent, len(messages), int((t_prep - t_route) * 1000), len(citations),
    )

    if chosen == "cloud":
        api_key = settings.cloud_api_key.get_secret_value()
        if not api_key:
            raise LLMError("Cloud AI is selected but CLOUD_API_KEY is not configured.", status_code=503)
        result = await _cloud_chat(settings, messages, custom_prompt=custom_prompt)
        result.latency_ms = int((time.perf_counter() - t0) * 1000)
        _record_metrics(result)
        return ChatPipelineResult(result=result, agent=agent_display, citations=citations)

    try:
        result = await _ollama_chat(settings, messages, custom_prompt=custom_prompt)
        result.latency_ms = int((time.perf_counter() - t0) * 1000)
        _record_metrics(result)
        return ChatPipelineResult(result=result, agent=agent_display, citations=citations)
    except LLMError as exc:
        api_key = settings.cloud_api_key.get_secret_value()
        msg = str(exc)
        if "Ollama is not reachable" in msg and api_key:
            logger.info("Ollama unreachable, auto-falling back to cloud")
            result = await _cloud_chat(settings, messages, custom_prompt=custom_prompt)
            result.latency_ms = int((time.perf_counter() - t0) * 1000)
            _record_metrics(result)
            return ChatPipelineResult(result=result, agent=agent_display, citations=citations)
        if "Ollama is not reachable" in msg and not api_key:
            raise LLMError(
                "Ollama is not running and no cloud API key is configured. Start `ollama serve` or set CLOUD_API_KEY and LLM_PROVIDER=cloud.",
                status_code=503,
            ) from exc
        raise


async def chat_compat(settings: Settings, messages: list[ChatMessage], provider: str | None, agent: str | None = None) -> ChatPipelineResult:
    """Compatibility wrapper: supports monkeypatched llm.chat with legacy signature/return."""
    fn = chat
    # If tests monkeypatched llm.chat, this wrapper won't see it; router should call through module attr.
    try:
        out = fn(settings, messages, provider, agent)
    except TypeError:
        out = fn(settings, messages, provider)
    if hasattr(out, "__await__"):
        out = await out
    if isinstance(out, ChatPipelineResult):
        return out
    if isinstance(out, LLMResult):
        return ChatPipelineResult(result=out, agent=agent or "knowledge", citations=[])
    raise LLMError("Invalid chat result", status_code=500)


def _record_metrics(result: LLMResult) -> None:
    _METRICS["total_latency_ms"] += result.latency_ms
    if result.completion_tokens:
        _METRICS["total_tokens"] += result.completion_tokens


# ---------------------------------------------------------------------------
# Streaming helpers — yields raw token strings, then a final "[DONE]" sentinel
# ---------------------------------------------------------------------------

async def stream_ollama(
    settings: Settings,
    messages: list[ChatMessage],
    custom_prompt: str | None = None,
    citations: list[str] | None = None,
    agent_name: str = "knowledge",
) -> AsyncIterator[str]:
    """Yield text tokens from Ollama streaming API, then a JSON stats line."""
    payload = _ollama_payload(settings, messages, custom_prompt, stream=True)
    url = f"{settings.ollama_base_url}/api/chat"
    start = time.perf_counter()
    inside_think = False
    buffer = ""
    try:
        async with httpx.AsyncClient(timeout=_client_timeout(settings.llm_timeout_seconds)) as client:
            async with client.stream("POST", url, json=payload) as resp:
                if resp.status_code == 404:
                    raise LLMError(
                        f"Ollama model '{settings.ollama_model}' not found. Run `ollama pull {settings.ollama_model}` and retry.",
                        status_code=404,
                    )
                resp.raise_for_status()
                prompt_tokens: int | None = None
                completion_tokens: int | None = None
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token: str = (chunk.get("message", {}) or {}).get("content", "") or ""
                    if token:
                        buffer += token
                        while True:
                            if inside_think:
                                end = _THINK_CLOSE_RE.search(buffer)
                                if not end:
                                    buffer = ""
                                    break
                                buffer = buffer[end.end():]
                                inside_think = False
                                continue
                            start_tag = _THINK_OPEN_RE.search(buffer)
                            if not start_tag:
                                if buffer:
                                    yield buffer
                                    buffer = ""
                                break
                            pre = buffer[:start_tag.start()]
                            if pre:
                                yield pre
                            buffer = buffer[start_tag.end():]
                            inside_think = True
                    if chunk.get("done"):
                        prompt_tokens = chunk.get("prompt_eval_count")
                        completion_tokens = chunk.get("eval_count")
                if buffer and not inside_think:
                    tail = strip_thinking(buffer)
                    if tail:
                        yield tail
        latency = int((time.perf_counter() - start) * 1000)
        _METRICS["total_latency_ms"] += latency
        if completion_tokens:
            _METRICS["total_tokens"] += completion_tokens
        yield json.dumps({
            "__done__": True,
            "provider": "ollama",
            "model": settings.ollama_model,
            "latency_ms": latency,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "agent": agent_name,
            "citations": citations or [],
        })
    except LLMError:
        raise
    except httpx.TimeoutException as exc:
        raise LLMError(f"Ollama request timed out after {int(settings.llm_timeout_seconds)}s.", status_code=504) from exc
    except httpx.ConnectError as exc:
        raise LLMError("Ollama is not reachable. Is `ollama serve` running?", status_code=503) from exc
    except httpx.HTTPStatusError as exc:
        raise LLMError(f"Ollama error {exc.response.status_code}", status_code=502) from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ollama request failed: {type(exc).__name__}", status_code=502) from exc


async def stream_cloud(
    settings: Settings,
    messages: list[ChatMessage],
    custom_prompt: str | None = None,
    citations: list[str] | None = None,
    agent_name: str = "knowledge",
) -> AsyncIterator[str]:
    """Yield text tokens from an OpenAI-compatible streaming API with zero-cost protection."""
    api_key = settings.cloud_api_key.get_secret_value()
    if not api_key:
        raise LLMError("Cloud provider is not configured (CLOUD_API_KEY is empty).", status_code=503)

    if "openrouter" in settings.cloud_base_url.lower() and not settings.cloud_model.endswith(":free"):
        raise LLMError("Only free-tier models (:free) are permitted for cloud requests in this configuration.", status_code=403)

    models_to_try = [settings.cloud_model]
    if settings.cloud_model in FREE_MODEL_FALLBACKS:
        for fb in FREE_MODEL_FALLBACKS:
            if fb not in models_to_try:
                models_to_try.append(fb)

    last_error: LLMError | None = None
    async with httpx.AsyncClient(timeout=_client_timeout(settings.llm_timeout_seconds)) as client:
        for model_name in models_to_try:
            payload = {
                "model": model_name,
                "messages": _inject_system(settings, messages, custom_prompt),
                "stream": True,
            }
            url = f"{settings.cloud_base_url.rstrip('/')}/chat/completions"
            start = time.perf_counter()
            streamed_any = False
            try:
                async with client.stream("POST", url, json=payload, headers={"Authorization": f"Bearer {api_key}"}) as resp:
                    if resp.status_code == 429:
                        logger.warning("Stream model %s rate-limited (429), trying fallback...", model_name)
                        last_error = LLMError(_format_quota_error(), status_code=429)
                        continue
                    if resp.status_code == 402:
                        raise LLMError("Payment-required model blocked by safety guard.", status_code=402)
                    if resp.status_code == 404:
                        last_error = LLMError(f"Cloud model '{model_name}' not found.", status_code=404)
                        continue
                    resp.raise_for_status()

                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        token = ((chunk.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
                        if token:
                            token = strip_thinking(token)
                            if token:
                                streamed_any = True
                                yield token

                latency = int((time.perf_counter() - start) * 1000)
                _METRICS["total_latency_ms"] += latency
                yield json.dumps({
                    "__done__": True,
                    "provider": "cloud",
                    "model": model_name,
                    "latency_ms": latency,
                    "prompt_tokens": None,
                    "completion_tokens": None,
                    "agent": agent_name,
                    "citations": citations or [],
                })
                return
            except LLMError as exc:
                if exc.status_code in {429, 404} and not streamed_any and model_name != models_to_try[-1]:
                    last_error = exc
                    continue
                raise
            except httpx.TimeoutException as exc:
                if not streamed_any and model_name != models_to_try[-1]:
                    last_error = LLMError(f"Cloud request timed out after {int(settings.llm_timeout_seconds)}s.", status_code=504)
                    continue
                raise LLMError(f"Cloud request timed out after {int(settings.llm_timeout_seconds)}s.", status_code=504) from exc
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429 and not streamed_any:
                    last_error = LLMError(_format_quota_error(), status_code=429)
                    continue
                if exc.response.status_code == 402:
                    raise LLMError("Payment-required model blocked by safety guard.", status_code=402) from exc
                raise LLMError(f"Cloud API error {exc.response.status_code}", status_code=502) from exc
            except httpx.HTTPError as exc:
                if not streamed_any and model_name != models_to_try[-1]:
                    last_error = LLMError(f"Cloud request failed: {type(exc).__name__}", status_code=502)
                    continue
                raise LLMError(f"Cloud request failed: {type(exc).__name__}", status_code=502) from exc

    if last_error:
        raise last_error
    raise LLMError("All free cloud model endpoints are currently busy. Please retry shortly.", status_code=503)


async def stream_chat(
    settings: Settings,
    messages: list[ChatMessage],
    provider: str | None = None,
    agent: str | None = None,
) -> AsyncIterator[str]:
    """Route streaming to the correct provider with enterprise RAG & safety guards."""
    chosen = provider or settings.llm_provider
    t0 = time.perf_counter()
    _METRICS["queries_count"] += 1
    logger.info("stream_chat provider=%s messages=%d agent=%s", chosen, len(messages), agent)

    user_text = messages[-1].content if messages else ""

    interception = rag.intercept_consequential_action(user_text)
    if interception:
        yield interception
        yield json.dumps({
            "__done__": True,
            "provider": "system_guard",
            "model": "SOC2-Safety-Sentinel",
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "prompt_tokens": None,
            "completion_tokens": None,
            "agent": "Operations Agent (Guard)",
            "citations": [],
        })
        return

    t_route = time.perf_counter()
    active_agent = agent if agent and agent != "auto" else rag.classify_agent(user_text)
    chunks, citations = rag.search_knowledge(user_text)
    custom_prompt = rag.build_agent_system_prompt(active_agent, chunks)
    agent_display = f"{active_agent.capitalize()} Agent"
    logger.info(
        "stream_chat prep agent=%s route_ms=%d rag_ms=%d citations=%d",
        active_agent,
        int((t_route - t0) * 1000),
        int((time.perf_counter() - t_route) * 1000),
        len(citations),
    )

    if chosen == "cloud":
        api_key = settings.cloud_api_key.get_secret_value()
        if not api_key:
            yield json.dumps({"__error__": "Cloud AI is selected but CLOUD_API_KEY is not configured. Set CLOUD_API_KEY or switch to Ollama."})
            return
        async for token in stream_cloud(settings, messages, custom_prompt, citations, agent_display):
            yield token
        return

    try:
        async for token in stream_ollama(settings, messages, custom_prompt, citations, agent_display):
            yield token
    except LLMError as exc:
        api_key = settings.cloud_api_key.get_secret_value()
        msg = str(exc)
        if "Ollama is not reachable" in msg and api_key:
            logger.info("Ollama unreachable, auto-falling back to cloud stream")
            async for token in stream_cloud(settings, messages, custom_prompt, citations, agent_display):
                yield token
            return
        if "Ollama is not reachable" in msg and not api_key:
            yield json.dumps({"__error__": "Ollama is not reachable and no cloud API key is configured. Start `ollama serve` or set CLOUD_API_KEY."})
            return
        yield json.dumps({"__error__": msg})
        return


async def ollama_status(settings: Settings) -> tuple[bool, list[str]]:
    try:
        async with httpx.AsyncClient(timeout=_client_timeout(5.0)) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            resp.raise_for_status()
            names = [m.get("name", "") for m in resp.json().get("models", []) if isinstance(m, dict)]
            return True, [n for n in names if n]
    except (httpx.HTTPError, KeyError, ValueError, TypeError):
        return False, []
