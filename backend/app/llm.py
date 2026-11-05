"""LLM provider layer: local Ollama and any OpenAI-compatible cloud API."""
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from .config import Settings
from .schemas import ChatMessage

logger = logging.getLogger("opspilot.llm")

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class LLMError(Exception):
    """Raised when a provider call fails; message is safe to show to clients."""


@dataclass
class LLMResult:
    text: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


def strip_thinking(text: str) -> str:
    return _THINK_RE.sub("", text).strip()


# ---------------------------------------------------------------------------
# Non-streaming helpers
# ---------------------------------------------------------------------------

def _inject_system(settings: Settings, messages: list[ChatMessage]) -> list[dict]:
    """Prepend the system prompt unless the caller already provided one."""
    dicts = [m.model_dump() for m in messages]
    if not dicts or dicts[0].get("role") != "system":
        dicts.insert(0, {"role": "system", "content": settings.system_prompt})
    return dicts


async def _ollama_chat(settings: Settings, messages: list[ChatMessage]) -> LLMResult:
    payload = {
        "model": settings.ollama_model,
        "messages": _inject_system(settings, messages),
        "stream": False,
        "think": False,  # Qwen3: skip reasoning trace for faster replies
    }
    url = f"{settings.ollama_base_url}/api/chat"
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.ConnectError as exc:
        raise LLMError("Ollama is not reachable. Is `ollama serve` running?") from exc
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:200]
        raise LLMError(f"Ollama error {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ollama request failed: {type(exc).__name__}") from exc

    latency = int((time.perf_counter() - start) * 1000)
    return LLMResult(
        text=strip_thinking(data.get("message", {}).get("content", "")),
        provider="ollama",
        model=settings.ollama_model,
        latency_ms=latency,
        prompt_tokens=data.get("prompt_eval_count"),
        completion_tokens=data.get("eval_count"),
    )


async def _cloud_chat(settings: Settings, messages: list[ChatMessage]) -> LLMResult:
    api_key = settings.cloud_api_key.get_secret_value()
    if not api_key:
        raise LLMError("Cloud provider is not configured (CLOUD_API_KEY is empty).")
    payload = {
        "model": settings.cloud_model,
        "messages": _inject_system(settings, messages),
    }
    url = f"{settings.cloud_base_url.rstrip('/')}/chat/completions"
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(
                url, json=payload, headers={"Authorization": f"Bearer {api_key}"}
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        # Never echo request headers; only a short slice of the response body.
        raise LLMError(f"Cloud API error {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Cloud request failed: {type(exc).__name__}") from exc

    latency = int((time.perf_counter() - start) * 1000)
    usage = data.get("usage") or {}
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected cloud API response format.") from exc
    return LLMResult(
        text=strip_thinking(text),
        provider="cloud",
        model=settings.cloud_model,
        latency_ms=latency,
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )


async def chat(settings: Settings, messages: list[ChatMessage], provider: str | None) -> LLMResult:
    chosen = provider or settings.llm_provider
    logger.info("chat provider=%s messages=%d", chosen, len(messages))
    if chosen == "cloud":
        return await _cloud_chat(settings, messages)
    return await _ollama_chat(settings, messages)


# ---------------------------------------------------------------------------
# Streaming helpers — yields raw token strings, then a final "[DONE]" sentinel
# ---------------------------------------------------------------------------

async def stream_ollama(settings: Settings, messages: list[ChatMessage]) -> AsyncIterator[str]:
    """Yield text tokens from Ollama streaming API, then a JSON stats line."""
    payload = {
        "model": settings.ollama_model,
        "messages": _inject_system(settings, messages),
        "stream": True,
        "think": False,
    }
    url = f"{settings.ollama_base_url}/api/chat"
    start = time.perf_counter()
    inside_think = False
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            async with client.stream("POST", url, json=payload) as resp:
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
                    token: str = chunk.get("message", {}).get("content", "")
                    # Strip <think>…</think> blocks on-the-fly
                    if inside_think:
                        if "</think>" in token:
                            inside_think = False
                            token = token.split("</think>", 1)[1]
                        else:
                            continue
                    if "<think>" in token:
                        parts = token.split("<think>", 1)
                        pre = parts[0]
                        if pre:
                            yield pre
                        inside_think = True
                        continue
                    if token:
                        yield token
                    if chunk.get("done"):
                        prompt_tokens = chunk.get("prompt_eval_count")
                        completion_tokens = chunk.get("eval_count")
        latency = int((time.perf_counter() - start) * 1000)
        # Final SSE event carries metadata
        yield json.dumps({
            "__done__": True,
            "provider": "ollama",
            "model": settings.ollama_model,
            "latency_ms": latency,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        })
    except httpx.ConnectError as exc:
        raise LLMError("Ollama is not reachable. Is `ollama serve` running?") from exc
    except httpx.HTTPStatusError as exc:
        raise LLMError(f"Ollama error {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Ollama request failed: {type(exc).__name__}") from exc


async def stream_cloud(settings: Settings, messages: list[ChatMessage]) -> AsyncIterator[str]:
    """Yield text tokens from an OpenAI-compatible streaming API."""
    api_key = settings.cloud_api_key.get_secret_value()
    if not api_key:
        raise LLMError("Cloud provider is not configured (CLOUD_API_KEY is empty).")
    payload = {
        "model": settings.cloud_model,
        "messages": _inject_system(settings, messages),
        "stream": True,
    }
    url = f"{settings.cloud_base_url.rstrip('/')}/chat/completions"
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            async with client.stream(
                "POST", url, json=payload,
                headers={"Authorization": f"Bearer {api_key}"}
            ) as resp:
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
                    token = chunk.get("choices", [{}])[0].get("delta", {}).get("content") or ""
                    if token:
                        yield token
        latency = int((time.perf_counter() - start) * 1000)
        yield json.dumps({
            "__done__": True,
            "provider": "cloud",
            "model": settings.cloud_model,
            "latency_ms": latency,
            "prompt_tokens": None,
            "completion_tokens": None,
        })
    except httpx.HTTPStatusError as exc:
        raise LLMError(f"Cloud API error {exc.response.status_code}") from exc
    except httpx.HTTPError as exc:
        raise LLMError(f"Cloud request failed: {type(exc).__name__}") from exc


async def stream_chat(
    settings: Settings, messages: list[ChatMessage], provider: str | None
) -> AsyncIterator[str]:
    chosen = provider or settings.llm_provider
    logger.info("stream_chat provider=%s messages=%d", chosen, len(messages))
    if chosen == "cloud":
        async for token in stream_cloud(settings, messages):
            yield token
    else:
        async for token in stream_ollama(settings, messages):
            yield token


async def ollama_status(settings: Settings) -> tuple[bool, list[str]]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            resp.raise_for_status()
            names = [m["name"] for m in resp.json().get("models", [])]
            return True, names
    except (httpx.HTTPError, KeyError, ValueError):
        return False, []
