"""User-scoped retrieval over persisted knowledge documents and safety guards."""
from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select

from .db.models import ApprovalRequest, KnowledgeDocument
from .db.session import SessionLocal


@dataclass
class RetrievedChunk:
    doc_id: str
    filename: str
    category: str
    chunk_index: int
    text: str
    score: float


# ── Hybrid keyword retrieval over the caller's persisted documents ─────────

def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"\w+", text.lower()))


def chunk_document(doc_id: str, filename: str, category: str, full_text: str, chunk_size: int = 250) -> list[RetrievedChunk]:
    """Split text into overlapping semantic passages."""
    words = full_text.split()
    chunks: list[RetrievedChunk] = []
    step = max(50, chunk_size - 50)
    for i in range(0, max(1, len(words)), step):
        chunk_words = words[i : i + chunk_size]
        if not chunk_words:
            continue
        chunk_text = " ".join(chunk_words)
        chunks.append(
            RetrievedChunk(
                doc_id=doc_id,
                filename=filename,
                category=category,
                chunk_index=len(chunks) + 1,
                text=chunk_text,
                score=0.0,
            )
        )
    return chunks


def search_knowledge(
    query: str,
    user_id: uuid.UUID | None = None,
    top_k: int = 3,
) -> tuple[list[RetrievedChunk], list[str]]:
    """Search only the documents owned by ``user_id``.

    Without a user id there is no safe corpus to search, so retrieval returns
    nothing rather than falling back to another user's documents.
    """
    query_tokens = _tokenize(query)
    if not query_tokens or user_id is None:
        return [], []

    db = SessionLocal()
    try:
        docs = db.execute(
            select(KnowledgeDocument)
            .where(
                KnowledgeDocument.owner_user_id == user_id,
                KnowledgeDocument.indexed.is_(True),
            )
            .order_by(KnowledgeDocument.created_at.desc())
            .limit(200)
        ).scalars().all()
    finally:
        db.close()

    scored_chunks: list[RetrievedChunk] = []
    citations: list[str] = []

    for doc in docs:
        doc_chunks = chunk_document(str(doc.id), doc.filename, doc.category, (doc.content or "")[:4000])
        for chunk in doc_chunks:
            chunk_tokens = _tokenize(chunk.text)
            overlap = len(query_tokens.intersection(chunk_tokens))
            if overlap > 0:
                score = overlap / (math.log(len(chunk_tokens) + 2) + 1.0)
                chunk.score = round(score, 3)
                if len(chunk.text) > 900:
                    chunk.text = chunk.text[:900].rsplit(" ", 1)[0] + "…"
                scored_chunks.append(chunk)

    scored_chunks.sort(key=lambda c: c.score, reverse=True)
    results = scored_chunks[: max(1, min(top_k, 3))]

    for c in results:
        cite = f"[{c.filename} • Chunk {c.chunk_index}]"
        if cite not in citations:
            citations.append(cite)

    return results, citations


# ── Multi-Agent Intent Classifier & Orchestrator ───────────────────────────

AgentType = Literal["knowledge", "research", "operations", "analytics"]


def classify_agent(query: str) -> AgentType:
    q = query.lower()
    if any(k in q for k in ["scale", "restart", "deploy", "firewall", "reboot", "execute", "apply", "kill", "shut"]):
        return "operations"
    if any(k in q for k in ["compare", "difference", "versus", "vs", "contradiction", "synthesize", "evaluate"]):
        return "research"
    if any(k in q for k in ["metric", "latency", "tokens", "cost", "sla", "trend", "report", "stats", "graph"]):
        return "analytics"
    return "knowledge"


def build_agent_system_prompt(agent: AgentType, retrieved_chunks: list[RetrievedChunk]) -> str:
    """Build role-specific grounded instructions for the active agent."""
    rag_context = ""
    if retrieved_chunks:
        rag_context = "\n\n=== RETRIEVED ENTERPRISE KNOWLEDGE ===\n"
        for c in retrieved_chunks:
            rag_context += f"Source [{c.filename} • Chunk {c.chunk_index} ({c.category})]:\n{c.text}\n\n"
        rag_context += (
            "=== CITATION RULES ===\n"
            "1. Ground answers in retrieved facts above and available project context.\n"
            "2. When using retrieved policy/runbook facts, cite the exact source as `[Filename • Chunk #]`.\n"
        )

    grounding = (
        "\n\n=== ACCURACY & GROUNDING ===\n"
        "- Base technical answers on actual project code, API routes, documentation, and retrieved knowledge available in this conversation.\n"
        "- Do NOT invent endpoints, infrastructure capabilities, deployment status, integrations, metrics, or file contents.\n"
        "- If information is unavailable or cannot be verified from available context, explicitly say so and state what evidence is missing.\n"
        "- Keep answers concise, structured, and technically accurate. Return only the final assistant response (no internal reasoning/thinking).\n"
    )

    if agent == "knowledge":
        return (
            "You are OpsPilot's Knowledge Agent for enterprise documentation, policies, and runbooks. "
            "Provide clear, structured answers with citations where supported."
            f"{rag_context}{grounding}"
        )

    if agent == "research":
        return (
            "You are OpsPilot's Research Agent for cross-document analysis and synthesis. "
            "Compare only what is supported by evidence; highlight unknowns explicitly."
            f"{rag_context}{grounding}"
        )

    if agent == "operations":
        return (
            "You are OpsPilot's Operations Agent for DevOps/IT guidance. "
            "For consequential or high-risk actions, state that human approval is required/queued by policy when applicable. "
            "Provide step-by-step, safe, rollback-aware guidance based on verified context only."
            f"{rag_context}{grounding}"
        )

    if agent == "analytics":
        return (
            "You are OpsPilot's Analytics Agent for telemetry and operational reporting. "
            "Use only provided metrics/data; do not fabricate numbers, trends, or system state."
            f"{rag_context}{grounding}"
        )

    return "You are OpsPilot, the enterprise AI operations platform." + grounding


# ── Consequential Action Guard ──────────────────────────────────────────────

_HIGH_RISK_MARKERS = (
    "scale",
    "restart database",
    "restart postgres",
    "firewall",
    "reboot server",
    "drop table",
    "truncate",
)


def intercept_consequential_action(query: str, user_id: uuid.UUID | None = None) -> str | None:
    """Block high-risk requests and optionally persist a real approval request.

    No infrastructure action is executed. When a user id is available the
    request is stored in ``approval_requests`` so it appears in the approval
    center; otherwise the response states that nothing was executed and does
    not claim an approval item exists.
    """
    q = query.lower()
    if not any(k in q for k in _HIGH_RISK_MARKERS):
        return None

    approval_id: str | None = None
    if user_id is not None:
        db = SessionLocal()
        try:
            approval = ApprovalRequest(
                owner_user_id=user_id,
                action_type="infrastructure_modification",
                title=f"Autonomous action requested: {query[:60]}",
                details=(
                    f"User prompted: '{query}'. The Operations Agent intercepted this "
                    "consequential operation to enforce enterprise safety boundaries. "
                    "No infrastructure action was executed."
                ),
                requested_by="Operations Agent (Autonomous Guard)",
                risk_level="high",
                status="pending",
            )
            db.add(approval)
            db.commit()
            db.refresh(approval)
            approval_id = str(approval.id)
        except Exception:
            db.rollback()
            approval_id = None
        finally:
            db.close()

    if approval_id:
        return (
            "🛡️ **CONSEQUENTIAL ACTION GUARD INTERCEPTED**\n\n"
            f"The Operations Agent detected a consequential infrastructure request: *\"{query}\"*.\n\n"
            "To prevent accidental downtime and comply with SOC-2/enterprise safety policy, "
            "this action cannot run automatically. No action was executed.\n\n"
            f"📋 **Approval request created:** `#{approval_id}`\n"
            "• **Risk Level:** `HIGH`\n"
            "• **Status:** `Pending Human Review`\n\n"
            "👉 Open the **Approvals** tab to review this request."
        )

    return (
        "🛡️ **CONSEQUENTIAL ACTION GUARD INTERCEPTED**\n\n"
        f"The Operations Agent detected a consequential infrastructure request: *\"{query}\"*.\n\n"
        "This action cannot run automatically and **no action was executed**. "
        "Use the controlled tool workflow to request it, which will require human approval."
    )
