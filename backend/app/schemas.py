import time
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    provider: Literal["ollama", "cloud"] | None = None
    agent: str | None = "knowledge"
    conversation_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    idempotency_key: str | None = Field(default=None, max_length=128)
    regenerate: bool = False
    parent_message_id: uuid.UUID | None = None


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    agent: str | None = "knowledge"
    citations: list[str] = Field(default_factory=list)
    conversation_id: uuid.UUID | None = None
    user_message_id: uuid.UUID | None = None
    assistant_message_id: uuid.UUID | None = None
    message_status: str | None = None


# ── Persistent conversation schemas ───────────────────────────────────────

MessageRole = Literal["system", "user", "assistant", "tool"]
MessageStatus = Literal["pending", "streaming", "completed", "interrupted", "failed"]


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    project_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None
    provider: Literal["ollama", "cloud"] | None = None
    model: str | None = Field(default=None, max_length=128)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    project_id: uuid.UUID | None = None
    archived: bool | None = None


class MessageCreate(BaseModel):
    role: Literal["system", "user"] = "user"
    content: str = Field(min_length=1, max_length=100_000)
    idempotency_key: str | None = Field(default=None, max_length=128)
    parent_message_id: uuid.UUID | None = None


class MessageEditRequest(BaseModel):
    content: str = Field(min_length=1, max_length=100_000)


class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    content: str
    message_type: str
    status: str
    model: str | None = None
    provider: str | None = None
    token_usage: dict[str, Any] | None = None
    latency_ms: int | None = None
    parent_message_id: uuid.UUID | None = None
    error_message: str | None = None
    sequence: int
    created_at: datetime
    updated_at: datetime


class MessagePage(BaseModel):
    items: list[MessageOut]
    has_more: bool
    next_before_sequence: int | None = None


class ConversationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    project_id: uuid.UUID | None = None
    title: str
    description: str | None = None
    conversation_type: str
    provider: str | None = None
    model: str | None = None
    status: str
    last_message_at: datetime | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0
    last_message_preview: str | None = None


class ConversationList(BaseModel):
    items: list[ConversationOut]
    page: int
    page_size: int
    total: int
    has_more: bool


class LLMStatus(BaseModel):
    provider: str
    ollama_reachable: bool
    ollama_models: list[str]
    ollama_model_ready: bool
    cloud_configured: bool


# ── Dashboard & Telemetry Schemas ──────────────────────────────────────────

class DashboardMetrics(BaseModel):
    total_documents: int
    indexed_documents: int
    total_queries: int
    agent_executions: int
    pending_approvals: int
    open_tickets: int
    avg_latency_ms: int
    active_model: str
    token_consumption: int
    estimated_api_cost: str
    system_health: Literal["healthy", "degraded", "offline"]
    recent_activity: list[dict]


# ── Document Intelligence Schemas ──────────────────────────────────────────

class DocumentItem(BaseModel):
    id: str
    filename: str
    file_type: str
    size_bytes: int
    chunks_count: int
    indexed: bool
    category: str
    uploaded_at: str
    preview: str


# ── Agent Orchestration Schemas ────────────────────────────────────────────

class AgentItem(BaseModel):
    id: str
    name: str
    role: str
    status: Literal["idle", "running", "waiting_approval", "error"]
    total_runs: int
    success_rate: float
    description: str
    permitted_tools: list[str]


# ── Operations & Human-in-the-Loop Schemas ─────────────────────────────────

class ApprovalItem(BaseModel):
    id: str
    action_type: str
    title: str
    details: str
    requested_by: str
    risk_level: Literal["low", "medium", "high", "critical"]
    status: Literal["pending", "approved", "rejected", "executed"]
    timestamp: str


class ApprovalActionRequest(BaseModel):
    approval_id: str | None = None
    action: Literal["approve", "reject"]
    notes: str | None = None


# ── Support Ticket Schemas ─────────────────────────────────────────────────

class TicketItem(BaseModel):
    id: str
    title: str
    description: str
    priority: Literal["low", "medium", "high", "critical"]
    status: Literal["open", "investigating", "resolved", "closed"]
    assigned_agent: str
    created_at: str
    category: str


class TicketCreateRequest(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=5, max_length=2000)
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    category: str = "IT Support"


# ── OpsPilot 3.0 Project / Cloud / Deployment Schemas ───────────────────────

class ProjectItem(BaseModel):
    id: str
    name: str
    repo_provider: str
    repo_url: str
    default_branch: str
    status: str
    language: str
    framework: str
    last_synced: str
    health: str
    environments: int
    open_prs: int
    pending_changes: int


class ProjectCreateRequest(BaseModel):
    name: str
    repo_provider: str = "github"
    repo_url: str
    default_branch: str = "main"


class EnvironmentItem(BaseModel):
    id: str
    project_id: str
    name: str
    provider: str
    status: str
    url: str | None = None
    branch: str = "main"
    last_deploy: str | None = None


class DeploymentItem(BaseModel):
    id: str
    project_id: str
    environment: str
    status: str
    commit: str
    branch: str
    created_at: str
    summary: str
    url: str | None = None


class IncidentItem(BaseModel):
    id: str
    project_id: str
    title: str
    severity: Literal["low", "medium", "high", "critical"]
    status: Literal["open", "investigating", "mitigated", "resolved"]
    service: str
    detected_at: str
    summary: str
    recommendation: str


class WorkflowStage(BaseModel):
    name: str
    status: Literal["pending", "active", "done", "failed"]


class ProjectWorkflow(BaseModel):
    project_id: str
    stages: list[WorkflowStage]
    current_step: str
    approvals_required: int


# ── Persistent project & repository context schemas ────────────────────────

class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    repo_provider: str = Field(default="local", max_length=64)
    repo_url: str | None = Field(default=None, max_length=1024)
    default_branch: str = Field(default="main", max_length=128)
    description: str | None = Field(default=None, max_length=4000)
    workspace_path: str | None = Field(default=None, max_length=1024)
    tech_stack: list[str] | None = None
    organization_id: uuid.UUID | None = None
    workspace_id: uuid.UUID | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    repo_url: str | None = Field(default=None, max_length=1024)
    default_branch: str | None = Field(default=None, max_length=128)
    workspace_path: str | None = Field(default=None, max_length=1024)
    tech_stack: list[str] | None = None
    archived: bool | None = None


class ProjectItem(BaseModel):
    id: str
    name: str
    repo_provider: str = "local"
    repo_url: str = ""
    default_branch: str = "main"
    status: str = "connected"
    language: str = "Unknown"
    framework: str = "Unknown"
    last_synced: str = "Never"
    health: str = "unknown"
    environments: int = 0
    open_prs: int = 0
    pending_changes: int = 0
    description: str | None = None
    workspace_path: str | None = None
    indexing_status: str = "not_indexed"
    indexed_files: int = 0
    last_indexed_at: str | None = None
    repository_inspected: bool = False
    repo_connected: bool = False


class ProjectFileItem(BaseModel):
    path: str
    size_bytes: int
    language: str | None = None
    indexed: bool
    is_binary: bool
    excerpt: str | None = None


class ProjectTreeItem(BaseModel):
    path: str
    type: Literal["file", "directory"]
    size_bytes: int | None = None


class ProjectIndexResponse(BaseModel):
    project_id: str
    indexing_status: str
    indexed_files: int
    skipped_files: int
    root_configured: bool
    message: str


class ProjectContextResponse(BaseModel):
    project_id: str
    project_name: str
    indexing_status: str
    repository_inspected: bool
    files: list[ProjectFileItem]
    context: str


# ── Controlled developer tools / approvals ─────────────────────────────────

class ToolExecuteRequest(BaseModel):
    tool: str = Field(min_length=1, max_length=128)
    project_id: uuid.UUID
    conversation_id: uuid.UUID | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, max_length=128)


class ToolOperationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    project_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    tool_name: str
    action: str
    risk_level: str
    status: str
    requires_approval: bool
    input: dict[str, Any] | None = None
    output: dict[str, Any] | None = None
    error_message: str | None = None
    created_at: datetime
    approved_at: datetime | None = None
    executed_at: datetime | None = None


class ToolApprovalRequest(BaseModel):
    action: Literal["approve", "reject"]
    notes: str | None = Field(default=None, max_length=2000)
