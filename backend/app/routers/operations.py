import time
from datetime import datetime
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException

from ..config import Settings, get_settings
from ..schemas import (
    ApprovalActionRequest,
    ApprovalItem,
    AgentItem,
    DashboardMetrics,
    DocumentItem,
    TicketCreateRequest,
    TicketItem,
)

router = APIRouter(prefix="/api", tags=["enterprise"])
SettingsDep = Annotated[Settings, Depends(get_settings)]

# ── Dynamic In-Memory Store (with realistic simulated enterprise data) ──────

_METRICS = {
    "queries_count": 42,
    "total_latency_ms": 42 * 850,
    "total_tokens": 12840,
}

_DOCUMENTS: list[DocumentItem] = [
    DocumentItem(
        id="doc-01",
        filename="IT-VPN-Troubleshooting-Runbook.md",
        file_type="markdown",
        size_bytes=14200,
        chunks_count=18,
        indexed=True,
        category="IT Support",
        uploaded_at="2026-11-10 14:22",
        preview="Step 1: Check GlobalProtect client status. Step 2: Clear cached SAML tokens in %APPDATA%\\PaloAltoNetworks\\GlobalProtect. Step 3: Verify DNS 10.0.0.2 resolution.",
    ),
    DocumentItem(
        id="doc-02",
        filename="DevOps-SLA-and-Incident-Triage-Policy.pdf",
        file_type="pdf",
        size_bytes=86400,
        chunks_count=42,
        indexed=True,
        category="DevOps",
        uploaded_at="2026-11-09 11:05",
        preview="P1 incidents require under 15 minute MTTA and under 1 hour MTTR. Mandatory notification to #ops-incident-command and pager rotation kickoff.",
    ),
    DocumentItem(
        id="doc-03",
        filename="HR-Remote-Work-and-Equipment-Policy-2026.docx",
        file_type="docx",
        size_bytes=45200,
        chunks_count=24,
        indexed=True,
        category="HR",
        uploaded_at="2026-11-08 09:30",
        preview="Full-time employees receive a $1,200 home office stipend every 2 years. Laptop replacements are scheduled on a 36-month refresh cycle.",
    ),
    DocumentItem(
        id="doc-04",
        filename="Finance-Travel-and-Reimbursement-Guidelines.csv",
        file_type="csv",
        size_bytes=32100,
        chunks_count=16,
        indexed=True,
        category="Finance",
        uploaded_at="2026-11-07 16:45",
        preview="Per-diem meals capped at $75/day. Hotel stays requiring over $250/night require manager pre-approval. Expense reports must be submitted within 30 days.",
    ),
]

_AGENTS: list[AgentItem] = [
    AgentItem(
        id="agent-knowledge",
        name="Knowledge Agent",
        role="RAG & Document Intelligence",
        status="idle",
        total_runs=128,
        success_rate=98.5,
        description="Retrieves company knowledge, answers compliance/policy questions, and attaches grounded citations.",
        permitted_tools=["search_knowledge", "retrieve_document", "read_chunk"],
    ),
    AgentItem(
        id="agent-research",
        name="Research Agent",
        role="Multi-Document Synthesis",
        status="idle",
        total_runs=64,
        success_rate=96.2,
        description="Compares multiple policies, highlights contradictions, and synthesizes cross-department briefs.",
        permitted_tools=["compare_documents", "summarize_findings", "diff_versions"],
    ),
    AgentItem(
        id="agent-operations",
        name="Operations Agent",
        role="Autonomous Infrastructure & Tool Execution",
        status="waiting_approval",
        total_runs=82,
        success_rate=94.0,
        description="Prepares infrastructure changes, resets VPN profiles, restarts pods, and requests Human Approval for high-risk actions.",
        permitted_tools=["restart_service", "reset_vpn", "scale_deployment", "create_ticket"],
    ),
    AgentItem(
        id="agent-analytics",
        name="Analytics Agent",
        role="Telemetry & Quantitative Reporting",
        status="idle",
        total_runs=47,
        success_rate=99.1,
        description="Analyzes incident metrics, token consumption, latency trends, and generates structured CSV/PDF reports.",
        permitted_tools=["query_metrics", "generate_report", "compute_mttr"],
    ),
]

_APPROVALS: list[ApprovalItem] = [
    ApprovalItem(
        id="appr-101",
        action_type="scale_deployment",
        title="Scale auth-service replicas from 3 to 8",
        details="Operations Agent detected 85% CPU load spike on auth-service-prod following high login traffic. Requires manager approval to scale up.",
        requested_by="Operations Agent (Autonomous)",
        risk_level="medium",
        status="pending",
        timestamp="10 minutes ago",
    ),
    ApprovalItem(
        id="appr-102",
        action_type="network_firewall_rule",
        title="Allow outbound port 443 to external LLM provider",
        details="Agent requested egress firewall exception to connect to OpenRouter endpoint https://openrouter.ai/api/v1 for fallback inference.",
        requested_by="Security Sentinel",
        risk_level="high",
        status="pending",
        timestamp="25 minutes ago",
    ),
    ApprovalItem(
        id="appr-103",
        action_type="restart_service",
        title="Restart Postgres connection pool on worker-02",
        details="Idle client connection leak detected in background queue worker. Restart will drop ~4 idle stale connections.",
        requested_by="Operations Agent",
        risk_level="low",
        status="approved",
        timestamp="2 hours ago",
    ),
]

_TICKETS: list[TicketItem] = [
    TicketItem(
        id="TICK-8041",
        title="GlobalProtect VPN connection timeout from Munich office",
        description="User unable to connect through Munich gateway with error 'Gateway not reachable'.",
        priority="high",
        status="investigating",
        assigned_agent="Knowledge Agent",
        created_at="2026-11-11 09:15",
        category="IT Support",
    ),
    TicketItem(
        id="TICK-8040",
        title="Kubernetes HPA thrashing on payments-api during batch sync",
        description="Horizontal Pod Autoscaler rapidly oscillating between 2 and 10 pods every 3 minutes.",
        priority="medium",
        status="open",
        assigned_agent="Operations Agent",
        created_at="2026-11-11 08:30",
        category="DevOps",
    ),
    TicketItem(
        id="TICK-8039",
        title="Q3 Home Office reimbursement tax documentation clarification",
        description="Finance flagged expense claim #9822 requiring revised equipment vendor receipt.",
        priority="low",
        status="resolved",
        assigned_agent="Analytics Agent",
        created_at="2026-11-10 16:40",
        category="Finance",
    ),
]


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/analytics/dashboard", response_model=DashboardMetrics)
async def get_dashboard_metrics(settings: SettingsDep) -> DashboardMetrics:
    queries = _METRICS["queries_count"]
    avg_latency = int(_METRICS["total_latency_ms"] / max(queries, 1))
    pending_appr = sum(1 for a in _APPROVALS if a.status == "pending")
    open_tickets = sum(1 for t in _TICKETS if t.status in ("open", "investigating"))

    return DashboardMetrics(
        total_documents=len(_DOCUMENTS),
        indexed_documents=sum(1 for d in _DOCUMENTS if d.indexed),
        total_queries=queries,
        agent_executions=sum(a.total_runs for a in _AGENTS),
        pending_approvals=pending_appr,
        open_tickets=open_tickets,
        avg_latency_ms=avg_latency,
        active_model=settings.cloud_model if settings.llm_provider == "cloud" else settings.ollama_model,
        token_consumption=_METRICS["total_tokens"],
        estimated_api_cost="$0.00 (Zero-Cost Free Tier)",
        system_health="healthy",
        recent_activity=[
            {"time": "2 mins ago", "action": "Query processed", "user": "Employee", "agent": "Knowledge Agent"},
            {"time": "12 mins ago", "action": "Approval requested", "user": "Operations Agent", "agent": "Operations Agent"},
            {"time": "35 mins ago", "action": "Document indexed", "user": "System", "agent": "RAG Engine"},
            {"time": "1 hour ago", "action": "Support ticket auto-triaged", "user": "IT Portal", "agent": "Support Agent"},
        ],
    )


@router.get("/documents", response_model=list[DocumentItem])
async def list_documents() -> list[DocumentItem]:
    return _DOCUMENTS


@router.post("/documents/upload", response_model=DocumentItem)
async def upload_document(
    filename: str,
    content: str = "",
    category: str = "General",
) -> DocumentItem:
    new_doc = DocumentItem(
        id=f"doc-{int(time.time())}",
        filename=filename,
        file_type=filename.split(".")[-1] if "." in filename else "txt",
        size_bytes=len(content.encode("utf-8")) if content else 2048,
        chunks_count=max(1, len(content) // 400) if content else 4,
        indexed=True,
        category=category,
        uploaded_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        preview=content[:200] if content else "Uploaded document ready for RAG semantic search.",
    )
    _DOCUMENTS.insert(0, new_doc)
    return new_doc


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, str]:
    global _DOCUMENTS
    _DOCUMENTS = [d for d in _DOCUMENTS if d.id != doc_id]
    return {"status": "deleted", "doc_id": doc_id}


@router.get("/agents", response_model=list[AgentItem])
async def list_agents() -> list[AgentItem]:
    return _AGENTS


@router.get("/operations/approvals", response_model=list[ApprovalItem])
async def list_approvals() -> list[ApprovalItem]:
    return _APPROVALS


@router.post("/operations/approvals/{approval_id}/action", response_model=ApprovalItem)
async def handle_approval(approval_id: str, req: ApprovalActionRequest) -> ApprovalItem:
    for item in _APPROVALS:
        if item.id == approval_id:
            item.status = "approved" if req.action == "approve" else "rejected"
            return item
    raise HTTPException(status_code=404, detail="Approval request not found")


@router.get("/operations/tickets", response_model=list[TicketItem])
async def list_tickets() -> list[TicketItem]:
    return _TICKETS


@router.post("/operations/tickets", response_model=TicketItem)
async def create_ticket(req: TicketCreateRequest) -> TicketItem:
    new_ticket = TicketItem(
        id=f"TICK-{int(time.time()) % 10000}",
        title=req.title,
        description=req.description,
        priority=req.priority,
        status="open",
        assigned_agent="Knowledge Agent",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        category=req.category,
    )
    _TICKETS.insert(0, new_ticket)
    return new_ticket
