import time
from typing import Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=50)
    provider: Literal["ollama", "cloud"] | None = None
    agent: str | None = "knowledge"


class ChatResponse(BaseModel):
    reply: str
    provider: str
    model: str
    latency_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    agent: str | None = "knowledge"
    citations: list[str] = Field(default_factory=list)


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
    approval_id: str
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
