from functools import lru_cache
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Cloud-first default; Ollama remains optional/local fallback when explicitly enabled/configured.
    llm_provider: Literal["ollama", "cloud"] = "cloud"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:1.7b"

    cloud_base_url: str = "https://openrouter.ai/api/v1"
    cloud_model: str = "nvidia/nemotron-3.5-lightning:free"
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

    # Database
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/opspilot_db"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Auth / Security
    jwt_secret_key: SecretStr = SecretStr("change-this-to-a-long-random-secret")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    session_cookie_name: str = "opspilot_session"
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    app_env: str = "development"
    frontend_base_url: str = "http://localhost:5173"

    # Bootstrap Super Admin
    bootstrap_super_admin_email: str = ""
    bootstrap_super_admin_password: SecretStr = SecretStr("")
    bootstrap_super_admin_name: str = "OpsPilot Super Admin"

    # OAuth
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_redirect_uri: str = "http://localhost:5173/auth/google/callback"
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")
    github_redirect_uri: str = "http://localhost:5173/auth/github/callback"

    # Diagnostics (optional, non-public; set to enable protected diagnostics endpoint)
    diagnostics_token: SecretStr = SecretStr("")

    # Project/repository indexing. PROJECT_WORKSPACE_ROOT must be explicitly
    # configured before a local workspace can be indexed. Paths are resolved
    # relative to this root and can never escape it.
    project_workspace_root: str = ""
    project_max_file_bytes: int = 262_144
    project_max_files: int = 2_000
    project_index_excerpt_chars: int = 4_000

    # Developer tool execution. Consequential/build/test tools never run on the
    # host. They require an explicitly enabled Docker sandbox.
    sandbox_enabled: bool = False
    sandbox_docker_bin: str = "docker"
    sandbox_image: str = "python:3.12-slim"
    sandbox_timeout_seconds: int = 60
    sandbox_memory_limit: str = "512m"
    sandbox_cpu_limit: str = "1.0"
    sandbox_network_disabled: bool = True
    tool_command_allowlist: str = "pytest,npm,python,node,git"

    # Chat context budgeting.
    llm_max_history_messages: int = 20
    llm_max_message_chars: int = 6_000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
