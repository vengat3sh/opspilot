import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

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

type NavTab = "workspace" | "dashboard" | "documents" | "agents" | "approvals" | "tickets";

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
  send: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  bot: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="8.5" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <line x1="12" y1="2" x2="12" y2="4" />
    </svg>
  ),
  user: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  menu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
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

// ── Quick Topics ─────────────────────────────────────────────────────────────
const QUICK_TOPICS = [
  { icon: "🚨", label: "Incident Triage", prompt: "An API endpoint is suddenly throwing 500 Internal Server Errors under high load. Give me a step-by-step triage runbook." },
  { icon: "🐳", label: "Docker Multi-stage", prompt: "Write an optimized, secure multi-stage Dockerfile for a FastAPI Python 3.11 application." },
  { icon: "☸️", label: "K8s HPA Scaling", prompt: "How do I configure Horizontal Pod Autoscaling (HPA) based on CPU and memory metrics in Kubernetes with YAML?" },
  { icon: "⚡", label: "FastAPI Async", prompt: "Explain how FastAPI handles async def vs normal def route handlers with threadpools and event loops." },
  { icon: "🛡️", label: "Linux Hardening", prompt: "Give me the top 7 essential security hardening checklist steps for a production Ubuntu/Debian server." },
];

export default function App() {
  const [activeTab, setActiveTab]     = useState<NavTab>("workspace");
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [sessions, setSessions]       = useState<ChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turns, setTurns]             = useState<Turn[]>([]);
  const [input, setInput]             = useState("");
  const [provider, setProvider]       = useState<Provider>("cloud");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isPendingRef                  = useRef(false);
  const [isPendingUI, setIsPendingUI] = useState(false);
  const chatScrollRef                 = useRef<HTMLDivElement>(null);
  const abortRef                      = useRef<AbortController | null>(null);
  const textareaRef                   = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    if (activeTab === "workspace" && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [turns, activeTab]);

  // Dynamic textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

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
    setActiveTab("workspace");
    setSidebarOpen(false);
  }

  function switchSession(session: ChatSession) {
    abortRef.current?.abort();
    setActiveSessionId(session.id);
    setTurns(session.turns);
    setInput("");
    setPending(false);
    setActiveTab("workspace");
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
    setActiveTab("workspace");
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
    setActiveTab("workspace");
    sendMessage(`Hello! You are operating as the ${raw.toUpperCase()} Agent. What operations or investigations can you assist me with right now?`);
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
    setActiveTab("workspace");
    sendMessage(`Investigate ticket ${ticket.id}: "${ticket.title}". Category: ${ticket.category}. Priority: ${ticket.priority}. Symptoms: ${ticket.description}. Please provide root-cause analysis and recommended runbook remediation.`);
  }

  const isCloudOnline = status.data?.cloud_configured;
  const isOllamaOnline = status.data?.ollama_reachable;
  const pendingApprovalsCount = approvalsQuery.data?.filter(a => a.status === "pending").length || 0;
  const openTicketsCount = ticketsQuery.data?.filter(t => t.status !== "resolved" && t.status !== "closed").length || 0;

  const tabTitles: Record<NavTab, string> = {
    workspace: "AI Operations Workspace",
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
          <div className="brand-icon">⚡</div>
          <div>
            <div className="brand-name">OpsPilot</div>
            <span className="brand-tag">ENTERPRISE AI PLATFORM</span>
          </div>
        </div>

        <div className="sidebar-content">
          {/* Main Navigation Tabs */}
          <div className="section-label">Platform Navigation</div>
          <div className="sidebar-tabs">
            <button
              className={`nav-tab ${activeTab === "workspace" ? "active" : ""}`}
              onClick={() => { setActiveTab("workspace"); setSidebarOpen(false); }}
              type="button"
            >
              <div className="nav-tab-left">
                <span className="nav-tab-icon">💬</span>
                <span>AI Workspace</span>
              </div>
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
            {I.plus} New Conversation
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
                    className={`history-item ${activeTab === "workspace" && activeSessionId === s.id ? "active" : ""}`}
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
            <button
              className="nav-toggle-btn"
              onClick={() => setSidebarOpen(prev => !prev)}
              type="button"
              aria-label="Open Navigation Menu"
              title="Open Navigation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
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

            {activeTab === "workspace" && turns.length > 0 && (
              <button className="clear-btn" onClick={exportChatMarkdown} type="button" title="Export Conversation to Markdown">
                ⬇️ <span className="btn-label-desktop">Export</span>
              </button>
            )}

            {activeTab === "workspace" && (
              <button className="clear-btn" onClick={startNewChat} type="button" title="New Conversation">
                {I.plus} <span className="btn-label-desktop">New</span>
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

        {/* ── AI Workspace View ── */}
        {activeTab === "workspace" && (
          <>
            <div className="chat-scroll" ref={chatScrollRef}>
              <div className="chat-center">
                {turns.length === 0 ? (
                  <div className="empty-hero">
                    <div className="hero-avatar">🚀</div>
                    <h1 className="hero-title">How can I assist your operations today?</h1>
                    <p className="hero-subtitle">
                      Chat with OpsPilot to investigate incidents, generate runbooks, review infrastructure changes, and coordinate multi-agent enterprise operations.
                    </p>
                    <div className="hero-chips">
                      {QUICK_TOPICS.map(item => (
                        <button
                          key={item.label}
                          className="hero-chip"
                          onClick={() => sendMessage(item.prompt)}
                          type="button"
                        >
                          <span style={{ marginRight: 6 }}>{item.icon}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  turns.map((t, idx) => (
                    <div key={idx} className={`turn-row ${t.role === "user" ? "user" : "bot"}`}>
                      <div className={`turn-avatar ${t.role === "user" ? "user" : "bot"}`}>
                        {t.role === "user" ? I.user : I.bot}
                      </div>

                      <div className="turn-bubble">
                        {t.role === "user" ? (
                          <div className="bubble-user">{t.content}</div>
                        ) : t.error ? (
                          <div className="bubble-assistant" style={{ borderColor: "#fca5a5", background: "#fef2f2" }}>
                            <span style={{ color: "#dc2626", fontWeight: 600, whiteSpace: "pre-wrap" }}>⚠️ {t.content}</span>
                          </div>
                        ) : (
                          <div className="bubble-assistant">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                code({ inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || "");
                                  return !inline && match ? (
                                    <SyntaxHighlighter
                                      style={oneDark}
                                      language={match[1]}
                                      PreTag="div"
                                      customStyle={{ borderRadius: 10, fontSize: "0.8rem", margin: "10px 0" }}
                                      {...props}
                                    >
                                      {String(children).replace(/\n$/, "")}
                                    </SyntaxHighlighter>
                                  ) : (
                                    <code {...props}>{children}</code>
                                  );
                                },
                              }}
                            >
                              {t.content}
                            </ReactMarkdown>
                            {t.streaming && <span className="typing-cursor" />}
                            {t.meta && (
                              <div className="bubble-meta">
                                <span>🤖 {t.meta.model}</span>
                                <span>⚡ {t.meta.latency_ms} ms</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Floating Input Capsule */}
            <div className="chat-input-wrapper">
              <div className="chat-input-box">
                <textarea
                  ref={textareaRef}
                  className="chat-textarea"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder="Ask OpsPilot or instruct an agent… (Enter to send)"
                  rows={1}
                />
                <button
                  className="send-button"
                  type="button"
                  onClick={() => sendMessage(input)}
                  disabled={isPendingUI || !input.trim()}
                  title="Send message"
                >
                  {I.send}
                </button>
              </div>
              <div className="input-disclaimer">
                OpsPilot Enterprise • Secure cloud routing • Human-in-the-loop safeguards
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
