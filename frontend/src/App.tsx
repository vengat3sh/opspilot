import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  getLLMStatus,
  getApprovals,
  getTickets,
  streamChat,
  type ChatMessage,
  type Provider,
  type StreamMeta,
  type TicketItem,
} from "./api";

import DashboardView from "./components/DashboardView";
import DocumentsView from "./components/DocumentsView";
import AgentsView from "./components/AgentsView";
import ApprovalsView from "./components/ApprovalsView";
import TicketsView from "./components/TicketsView";
import AIEngineerView from "./components/AIEngineerView";

type NavTab = "engineer" | "dashboard" | "documents" | "agents" | "approvals" | "tickets";

interface Turn {
  role: "user" | "assistant";
  content: string;
  meta?: StreamMeta;
  error?: boolean;
  streaming?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  turns: Turn[];
}

function loadSavedSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem("opspilot_sessions");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]) {
  try {
    localStorage.setItem("opspilot_sessions", JSON.stringify(sessions));
  } catch {}
}

// ── Icons ───────────────────────────────────────────────────────────────────
const I = {
  plus: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
    </svg>
  ),
  msg: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

export default function App() {
  const [activeTab, setActiveTabState] = useState<NavTab>("engineer");
  const [tabHistory, setTabHistory]     = useState<NavTab[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [sessions, setSessions]       = useState<ChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turns, setTurns]             = useState<Turn[]>([]);
  const [input, setInput]             = useState("");
  const [provider, setProvider]       = useState<Provider>("cloud");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isPendingRef                  = useRef(false);
  const [isPendingUI, setIsPendingUI] = useState(false);
  const abortRef                      = useRef<AbortController | null>(null);

  function setActiveTab(next: NavTab) {
    setActiveTabState(prev => {
      if (prev !== next) setTabHistory(h => [...h, prev].slice(-10));
      return next;
    });
  }

  function goBack() {
    setTabHistory(h => {
      if (h.length === 0) {
        setActiveTabState("engineer");
        return h;
      }
      const prev = h[h.length - 1];
      setActiveTabState(prev);
      return h.slice(0, -1);
    });
  }

  const status = useQuery({ queryKey: ["llm-status"], queryFn: getLLMStatus, refetchInterval: 15_000 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, refetchInterval: 15_000 });
  const ticketsQuery = useQuery({ queryKey: ["tickets"], queryFn: getTickets, refetchInterval: 15_000 });

  // Auto-switch to cloud provider in production/render
  useEffect(() => {
    if (status.data) {
      if (!status.data.ollama_reachable) {
        setProvider("cloud");
      } else if (status.data.provider) {
        setProvider(status.data.provider as Provider);
      }
    }
  }, [status.data]);

  // AI Engineer view manages its own scroll/textarea behavior.

  function setPending(v: boolean) {
    isPendingRef.current = v;
    setIsPendingUI(v);
  }

  function startNewChat() {
    abortRef.current?.abort();
    setActiveSessionId(null);
    setTurns([]);
    setInput("");
    setPending(false);
    setActiveTabState("engineer");
    setSidebarOpen(false);
  }

  function switchSession(session: ChatSession) {
    abortRef.current?.abort();
    setActiveSessionId(session.id);
    setTurns(session.turns);
    setInput("");
    setPending(false);
    setActiveTabState("engineer");
    setSidebarOpen(false);
  }

  function deleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (activeSessionId === id) {
      startNewChat();
    }
  }

  function updateSavedHistory(updatedTurns: Turn[], promptText?: string) {
    setSessions(prev => {
      let currentId = activeSessionId;
      let list = [...prev];

      if (!currentId) {
        currentId = Date.now().toString();
        setActiveSessionId(currentId);
        const title = promptText
          ? (promptText.slice(0, 30) + (promptText.length > 30 ? "..." : ""))
          : "Conversation";
        list.unshift({ id: currentId, title, createdAt: Date.now(), turns: updatedTurns });
      } else {
        const idx = list.findIndex(s => s.id === currentId);
        if (idx !== -1) {
          list[idx] = { ...list[idx], turns: updatedTurns };
        }
      }

      saveSessions(list);
      return list;
    });
  }

  function sendMessage(text: string) {
    if (!text.trim() || isPendingRef.current) return;
    abortRef.current?.abort();

    const messages: ChatMessage[] = [
      ...turns.filter(t => !t.error).map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: text.trim() },
    ];

    const newTurns: Turn[] = [
      ...turns,
      { role: "user", content: text.trim() },
      { role: "assistant", content: "", streaming: true },
    ];

    setTurns(newTurns);
    updateSavedHistory(newTurns, text.trim());
    setInput("");
    setPending(true);
    setActiveTab("engineer");
    setSidebarOpen(false);

    abortRef.current = streamChat(
      messages,
      provider,
      selectedAgent,
      token => setTurns(prev => {
        const c = [...prev], l = c[c.length - 1];
        if (l?.streaming) c[c.length - 1] = { ...l, content: l.content + token };
        return c;
      }),
      meta => {
        setTurns(prev => {
          const c = [...prev], l = c[c.length - 1];
          if (l?.streaming) {
            c[c.length - 1] = { ...l, streaming: false, meta };
          }
          updateSavedHistory(c);
          return c;
        });
        setPending(false);
      },
      msg => {
        setTurns(prev => {
          const c = [...prev], l = c[c.length - 1];
          if (l?.streaming) {
            c[c.length - 1] = { role: "assistant", content: msg, error: true };
          }
          updateSavedHistory(c);
          return c;
        });
        setPending(false);
      },
    );
  }

  function handleSelectAgent(agentId: string) {
    const raw = agentId.replace("agent-", "");
    setSelectedAgent(raw);
    setActiveTab("engineer");
    sendMessage(`Hello! You are operating as the ${raw.toUpperCase()} Agent. What engineering or operations task can you assist with right now?`);
  }

  function exportChatMarkdown() {
    if (turns.length === 0) return;
    const content = turns.map(t => `### ${t.role.toUpperCase()}\n\n${t.content}\n\n`).join("\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OpsPilot-Session-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleInvestigateTicket(ticket: TicketItem) {
    setActiveTab("engineer");
    sendMessage(`Investigate ticket ${ticket.id}: "${ticket.title}". Category: ${ticket.category}. Priority: ${ticket.priority}. Symptoms: ${ticket.description}. Please provide root-cause analysis and recommended remediation plan.`);
  }

  const isCloudOnline = status.data?.cloud_configured;
  const isOllamaOnline = status.data?.ollama_reachable;
  const pendingApprovalsCount = approvalsQuery.data?.filter(a => a.status === "pending").length || 0;
  const openTicketsCount = ticketsQuery.data?.filter(t => t.status !== "resolved" && t.status !== "closed").length || 0;

  const tabTitles: Record<NavTab, string> = {
    engineer: "AI Engineer Workspace",
    dashboard: "Enterprise Intelligence Dashboard",
    documents: "Document Intelligence Center",
    agents: "Multi-Agent AI Orchestrator",
    approvals: "Human-in-the-Loop Approval Center",
    tickets: "IT Support Automation",
  };

  return (
    <div className="app-container">
      {/* ── Mobile Backdrop Overlay ── */}
      <div
        className={`mobile-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── App Sidebar ── */}
      <aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-header-left">
            <div className="brand-icon">⚡</div>
            <div>
              <div className="brand-name">OpsPilot</div>
              <span className="brand-tag">ENTERPRISE AI PLATFORM</span>
            </div>
          </div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} type="button" title="Close navigation" aria-label="Close navigation">✕</button>
        </div>

        <div className="sidebar-content">
          {/* Main Navigation Tabs */}
          <div className="section-label">Platform Navigation</div>
          <div className="sidebar-tabs">
            <button
              className={`nav-tab ${activeTab === "engineer" ? "active" : ""}`}
              onClick={() => { setActiveTab("engineer"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">🧠</span>
                <span>AI Engineer</span>
              </div>
              <span className="tab-badge">New</span>
            </button>

            <button
              className={`nav-tab ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => { setActiveTab("dashboard"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">📊</span>
                <span>Dashboard</span>
              </div>
            </button>

            <button
              className={`nav-tab ${activeTab === "documents" ? "active" : ""}`}
              onClick={() => { setActiveTab("documents"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">📁</span>
                <span>Knowledge Base</span>
              </div>
            </button>

            <button
              className={`nav-tab ${activeTab === "agents" ? "active" : ""}`}
              onClick={() => { setActiveTab("agents"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">🤖</span>
                <span>Agents</span>
              </div>
              <span className="tab-badge">4</span>
            </button>

            <button
              className={`nav-tab ${activeTab === "approvals" ? "active" : ""}`}
              onClick={() => { setActiveTab("approvals"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">🛡️</span>
                <span>Approvals</span>
              </div>
              {pendingApprovalsCount > 0 && (
                <span className="tab-badge highlight">{pendingApprovalsCount}</span>
              )}
            </button>

            <button
              className={`nav-tab ${activeTab === "tickets" ? "active" : ""}`}
              onClick={() => { setActiveTab("tickets"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">🎫</span>
                <span>IT Support</span>
              </div>
              {openTicketsCount > 0 && (
                <span className="tab-badge">{openTicketsCount}</span>
              )}
            </button>
          </div>

          {/* Action button inside workspace */}
          <button className="new-chat-btn" onClick={startNewChat} type="button">
            {I.plus} New Task Session
          </button>

          {/* Chat History Section */}
          <div className="history-section">
            <div className="section-label">Recent Conversations</div>
            <div className="history-list">
              {sessions.length === 0 ? (
                <div style={{ padding: "6px 8px", fontSize: 11.5, color: "#64748b", fontStyle: "italic" }}>
                  No saved conversations yet
                </div>
              ) : (
                sessions.map(s => (
                  <button
                    key={s.id}
                    className={`history-item ${activeTab === "engineer" && activeSessionId === s.id ? "active" : ""}`}
                    onClick={() => switchSession(s)}
                    type="button"
                  >
                    <span style={{ marginRight: 6, display: "flex", alignItems: "center" }}>{I.msg}</span>
                    <span className="history-title">{s.title}</span>
                    <span
                      className="history-del-btn"
                      onClick={e => deleteSession(e, s.id)}
                      title="Delete chat"
                    >
                      {I.trash}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* System Status Card */}
          <div className="section-label">Engine Telemetry</div>
          <div className="status-card">
            <div className="status-row">
              <span>Cloud Engine</span>
              <div className="status-indicator">
                <span className={`dot ${isCloudOnline ? "green" : "amber"}`} />
                <span style={{ fontWeight: 600, color: isCloudOnline ? "#34d399" : "#fbbf24" }}>
                  {isCloudOnline ? "Active" : "Ready"}
                </span>
              </div>
            </div>
            <div className="status-row" style={{ marginTop: 4 }}>
              <span>Local Ollama</span>
              <div className="status-indicator">
                <span className={`dot ${isOllamaOnline ? "green" : "amber"}`} />
                <span style={{ fontWeight: 600, color: isOllamaOnline ? "#34d399" : "rgba(255,255,255,0.4)" }}>
                  {isOllamaOnline ? "Connected" : "Offline"}
                </span>
              </div>
            </div>
            <div className="status-row" style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 11 }}>Zero-Cost Guard</span>
              <span style={{ color: "#818cf8", fontWeight: 700, fontSize: 11 }}>100% Free Tier</span>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          OpsPilot v0.2.0 • Enterprise Cloud
        </div>
      </aside>

      {/* ── Main Workspace Area ── */}
      <main className="app-main">
        {/* Navigation Topbar */}
        <header className="chat-navbar">
          <div className="navbar-left">
            <button className="nav-icon-btn" onClick={goBack} type="button" title="Go back" aria-label="Go back" disabled={tabHistory.length === 0} style={tabHistory.length === 0 ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>←</button>
            <button className="nav-icon-btn" onClick={() => setSidebarOpen(true)} type="button" title="Open navigation" aria-label="Open navigation">☰</button>
            <button className="nav-icon-btn nav-close-inline" onClick={() => setSidebarOpen(false)} type="button" title="Close navigation" aria-label="Close navigation">✕</button>
            <div className="nav-brand">
              <span className="brand-icon-sm">⚡</span>
              <span className="brand-text-sm">OpsPilot</span>
            </div>
            <span className="nav-active-pill">{tabTitles[activeTab]}</span>
          </div>

          <div className="navbar-right">
            <div className="nav-pill">
              <span className={`dot ${isCloudOnline || isOllamaOnline ? "green" : "amber"}`} />
              <span className="nav-pill-text">{isCloudOnline ? "24/7 Cloud" : isOllamaOnline ? "Local Ollama" : "Connecting..."}</span>
            </div>

            {activeTab === "engineer" && turns.length > 0 && (
              <button className="clear-btn" onClick={exportChatMarkdown} type="button" title="Export Session to Markdown">
                ⬇️ <span className="btn-label-desktop">Export</span>
              </button>
            )}

            {activeTab === "engineer" && (
              <button className="clear-btn" onClick={startNewChat} type="button" title="New Task Session">
                {I.plus} <span className="btn-label-desktop">New Task</span>
              </button>
            )}
          </div>
        </header>

        {/* ── View Router Content ── */}
        {activeTab === "dashboard" && <DashboardView />}
        {activeTab === "documents" && <DocumentsView />}
        {activeTab === "agents" && <AgentsView onSelectAgent={handleSelectAgent} />}
        {activeTab === "approvals" && <ApprovalsView />}
        {activeTab === "tickets" && <TicketsView onInvestigate={handleInvestigateTicket} />}

        {/* ── AI Engineer View ── */}
        {activeTab === "engineer" && (
          <AIEngineerView
            turns={turns}
            input={input}
            setInput={setInput}
            isPending={isPendingUI}
            onSend={sendMessage}
            onQuickPrompt={sendMessage}
          />
        )}
      </main>
    </div>
  );
}
