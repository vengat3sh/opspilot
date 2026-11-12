import math
import re
from dataclasses import dataclass
from typing import Literal

from .routers.operations import _DOCUMENTS, _APPROVALS, _TICKETS
from .schemas import ApprovalItem, TicketItem


@dataclass
class RetrievedChunk:
    doc_id: str
    filename: str
    category: str
    chunk_index: int
    text: str
    score: float


# ── In-Memory Hybrid Keyword & Semantic RAG Index ────────────────────────────

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


def search_knowledge(query: str, top_k: int = 3) -> tuple[list[RetrievedChunk], list[str]]:
    """Hybrid BM25-style keyword search over all indexed enterprise documents."""
    query_tokens = _tokenize(query)
    if not query_tokens:
        return [], []

    scored_chunks: list[RetrievedChunk] = []
    citations: list[str] = []

    for doc in _DOCUMENTS:
        # Use full_text/preview as available; limit chunking work on large previews
        doc_chunks = chunk_document(doc.id, doc.filename, doc.category, (doc.preview or "")[:4000])
        for chunk in doc_chunks:
            chunk_tokens = _tokenize(chunk.text)
            overlap = len(query_tokens.intersection(chunk_tokens))
            if overlap > 0:
                score = overlap / (math.log(len(chunk_tokens) + 2) + 1.0)
                chunk.score = round(score, 3)
                # Trim chunk text to reduce prompt tokens
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

def intercept_consequential_action(query: str) -> str | None:
    """Detect high-risk operations and queue an approval item in the Approval Center."""
    q = query.lower()
    if any(k in q for k in ["scale", "restart database", "restart postgres", "firewall", "reboot server", "drop table", "truncate"]):
        appr_id = f"appr-{len(_APPROVALS) + 101}"
        new_appr = ApprovalItem(
            id=appr_id,
            action_type="infrastructure_modification",
            title=f"Autonomous action requested: {query[:60]}...",
            details=f"User prompted: '{query}'. Operations Agent intercepted this consequential operation to enforce enterprise safety boundaries.",
            requested_by="Operations Agent (Autonomous Guard)",
            risk_level="high",
            status="pending",
            timestamp="Just now",
        )
        _APPROVALS.insert(0, new_appr)

        return (
            f"🛡️ **CONSEQUENTIAL ACTION GUARD INTERCEPTED**\n\n"
            f"The Operations Agent detected a consequential infrastructure request: *\"{query}\"*.\n\n"
            f"To prevent accidental downtime and comply with SOC-2/enterprise safety policy, this action cannot run automatically.\n\n"
            f"📋 **Approval Item Generated:** `#{appr_id}`\n"
            f"• **Risk Level:** `HIGH`\n"
            f"• **Status:** `Pending Human Review`\n\n"
            f"👉 Please open the **Approvals** tab in the sidebar to review and approve or reject this operation."
        )
    return None
