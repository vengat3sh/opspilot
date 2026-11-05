from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    provider: Literal["ollama", "cloud"] | None = None


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMStatus(BaseModel):
    provider: str
    ollama_reachable: bool
    ollama_models: list[str]
    ollama_model_ready: bool
    cloud_configured: bool
