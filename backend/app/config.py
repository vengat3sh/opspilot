from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_provider: Literal["ollama", "cloud"] = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:1.7b"

    cloud_base_url: str = "https://api.openai.com/v1"
    cloud_model: str = "gpt-4o-mini"
    cloud_api_key: SecretStr = SecretStr("")

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    llm_timeout_seconds: float = 120.0
    log_level: str = "INFO"
    system_prompt: str = (
        "You are OpsPilot, an expert AI assistant specialising in software engineering, "
        "DevOps, cloud infrastructure, and general programming. "
        "Always respond in clean, well-structured Markdown: use headings, bullet points, "
        "bold for key terms, and fenced code blocks with the correct language tag. "
        "Be precise, concise, and accurate. Avoid waffle. "
        "If writing code, always include a brief explanation of what it does and any important caveats. "
        "If a question is ambiguous, state your assumption before answering."
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
