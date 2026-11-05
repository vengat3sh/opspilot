import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  getLLMStatus, streamChat,
  type ChatMessage, type Provider, type StreamMeta,
} from "./api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  meta?: StreamMeta;
  error?: boolean;
  streaming?: boolean;
}

// ── SVG icons ───────────────────────────────────────────────────────────────
const I = {
  send: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
  bot: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 10 4a2 2 0 0 1 2-2z"/>
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>
      <circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/>
    </svg>
  ),
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  ),
  plus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  cpu: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/>
      <line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/>
      <line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/>
      <line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/>
      <line x1="1" y1="14" x2="4" y2="14"/>
    </svg>
  ),
  menu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
};

// ── Markdown renderer ────────────────────────────────────────────────────────
function AssistantContent({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ inline, className, children, ...props }: any) {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            return !inline && lang ? (
              <SyntaxHighlighter
                style={oneDark} language={lang} PreTag="div"
                customStyle={{ borderRadius: 12, fontSize: "0.76rem", margin: "0.6rem 0", border: "1px solid rgba(255,255,255,.06)" }}
                {...props}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code {...props}>{children}</code>
            );
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && <span className="cursor" />}
    </div>
  );
}

// ── Quick Topics ─────────────────────────────────────────────────────────────
const QUICK_TOPICS = [
  { icon: "🚨", label: "Incident Triage", prompt: "An API endpoint is suddenly throwing 500 Internal Server Errors under high load. Give me a step-by-step triage runbook." },
  { icon: "🐳", label: "Docker Multi-stage", prompt: "Write an optimized, secure multi-stage Dockerfile for a FastAPI Python 3.11 application." },
  { icon: "☸️", label: "K8s HPA Scaling", prompt: "How do I configure Horizontal Pod Autoscaling (HPA) based on CPU and memory metrics in Kubernetes with YAML?" },
  { icon: "⚡", label: "FastAPI Async", prompt: "Explain how FastAPI handles async def vs normal def route handlers with threadpools and event loops." },
  { icon: "🛡️", label: "Linux Hardening", prompt: "Give me the top 7 essential security hardening checklist steps for a production Ubuntu/Debian server." },
];

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [turns, setTurns]           = useState<Turn[]>([]);
  const [input, setInput]           = useState("");
  const [provider, setProvider]     = useState<Provider>("ollama");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isPendingRef                = useRef(false);
  const [isPendingUI, setIsPendingUI] = useState(false);
  const bottomRef                   = useRef<HTMLDivElement>(null);
  const abortRef                    = useRef<AbortController | null>(null);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);

  const status = useQuery({ queryKey: ["llm-status"], queryFn: getLLMStatus, refetchInterval: 15_000 });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [input]);

  function setPending(v: boolean) { isPendingRef.current = v; setIsPendingUI(v); }

  function clearChat() { abortRef.current?.abort(); setTurns([]); setInput(""); setPending(false); }

  function sendMessage(text: string) {
    if (!text.trim() || isPendingRef.current) return;
    abortRef.current?.abort();

    const messages: ChatMessage[] = [
      ...turns.filter(t => !t.error).map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: text.trim() },
    ];

    setTurns(prev => [...prev,
      { role: "user", content: text.trim() },
      { role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setPending(true);

    abortRef.current = streamChat(messages, provider,
      token => setTurns(prev => {
        const c = [...prev], l = c[c.length - 1];
        if (l?.streaming) c[c.length - 1] = { ...l, content: l.content + token };
        return c;
      }),
      meta => {
        setTurns(prev => {
          const c = [...prev], l = c[c.length - 1];
          if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, meta };
          return c;
        });
        setPending(false);
      },
      msg => {
        setTurns(prev => {
          const c = [...prev], l = c[c.length - 1];
          if (l?.streaming) c[c.length - 1] = { role: "assistant", content: msg, error: true };
          return c;
        });
        setPending(false);
      },
    );
  }

  const apiOk   = !!status.data;
  const modelOk = !!status.data?.ollama_model_ready;
  const msgCount = Math.ceil(turns.filter(t => t.role === "user").length);
  const isActive = isPendingUI || input.trim().length > 0;

  return (
    <>
      <div className="app-bg" />
      <div className="shell">

        {/* ── SIDEBAR OVERLAY FOR MOBILE ───────────── */}
        <div
          className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* ── SIDEBAR ─────────────────────────────────────── */}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          {/* Logo */}
          <div className="sidebar-logo">
            <div className="logo-mark">🚀</div>
            <div>
              <div className="logo-text">OpsPilot</div>
              <div className="logo-sub">AI Operations · Phase 1</div>
            </div>
          </div>

          <div className="sidebar-body">
            {/* New chat */}
            <button className="btn-new" onClick={clearChat}>
              {I.plus} New Conversation
            </button>

            {/* Status */}
            <div className="sidebar-section-label">System Status</div>
            {[
              { label: "API Server",    ok: apiOk },
              { label: "Ollama Model",  ok: modelOk },
            ].map(({ label, ok }) => (
              <div className="status-row" key={label}>
                <span className={`status-dot ${ok ? "on" : "off"}`} />
                <span className="status-label">{label}</span>
                <span className={`status-val ${ok ? "on" : "off"}`}>{ok ? "Online" : "Offline"}</span>
              </div>
            ))}

            {/* Quick Topics */}
            <div className="sidebar-section-label" style={{ marginTop: 18 }}>Quick Topics</div>
            {QUICK_TOPICS.map(item => (
              <button
                key={item.label}
                className="topic-btn"
                onClick={() => { sendMessage(item.prompt); setSidebarOpen(false); }}
                title={item.prompt}
              >
                <span className="topic-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}

            {/* Provider Segmented Tabs */}
            <div className="sidebar-section-label" style={{ marginTop: 18 }}>Inference Engine</div>
            <div className="provider-tabs">
              <button
                type="button"
                className={`provider-tab ${provider === "ollama" ? "active" : ""}`}
                onClick={() => setProvider("ollama")}
              >
                🖥️ Local Ollama
              </button>
              <button
                type="button"
                className={`provider-tab ${provider === "cloud" ? "active" : ""}`}
                onClick={() => setProvider("cloud")}
                disabled={status.data ? !status.data.cloud_configured : false}
                title={status.data?.cloud_configured ? "Cloud API ready" : "Set CLOUD_API_KEY in backend/.env"}
              >
                ☁️ Cloud API
              </button>
            </div>

            {/* Models */}
            {!!status.data?.ollama_models?.length && (
              <>
                <div className="sidebar-section-label" style={{ marginTop: 18 }}>Loaded Models</div>
                {status.data.ollama_models.map((m, i) => (
                  <div className={`model-chip ${i === 0 ? "active" : ""}`} key={m}>
                    <div className="model-chip-dot" style={{ background: i === 0 ? "var(--brand)" : "#d1d5db" }} />
                    <span className="model-chip-name">{m}</span>
                    {i === 0 && (
                      <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "var(--brand)", letterSpacing: ".05em" }}>
                        READY
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Live Diagnostics Card */}
            <div className="engine-card">
              <div className="engine-header">
                <span className="engine-title">Ops Engine</span>
                <span className="engine-badge">Active</span>
              </div>
              <div className="engine-meta">
                <span>⚡ Stream: SSE</span>
                <span style={{ margin: "0 4px" }}>•</span>
                <span>Port 8000</span>
              </div>
            </div>
          </div>

          <div className="sidebar-footer">OpsPilot v0.1.0 • Enterprise Operations</div>
        </aside>

        {/* ── MAIN ────────────────────────────────────────── */}
        <div className="main">

          {/* Top bar */}
          <div className="topbar">
            <div style={{ display: "flex", alignItems: "center" }}>
              <button
                className="mobile-toggle"
                onClick={() => setSidebarOpen(prev => !prev)}
                title="Toggle menu"
                type="button"
              >
                {I.menu}
              </button>
              <span className="topbar-title">
                {turns.length === 0 ? "New Conversation" : "Chat"}
              </span>
              {msgCount > 0 && (
                <span className="topbar-sub">
                  {msgCount} message{msgCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {turns.length > 0 && (
              <button className="btn-clear" onClick={clearChat}>
                {I.trash} Clear chat
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="messages-wrap">
            <div className="messages-inner">

              {/* Empty state */}
              {turns.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">🤖</div>
                  <h1 className="empty-title">What can I help with?</h1>
                  <p className="empty-sub">
                    Expert answers on DevOps, infrastructure, code, debugging,<br />
                    and anything engineering — all running locally.
                  </p>
                  <div className="chips-grid">
                    {QUICK_TOPICS.map(({ icon, label, prompt }) => (
                      <button className="chip" key={label} onClick={() => sendMessage(prompt)}>
                        <span style={{ marginRight: 7 }}>{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Turn list */}
              {turns.map((t, i) => {
                const showTyping = t.streaming && t.content === "";
                return (
                  <div key={i} className={`msg-row msg-enter ${t.role === "user" ? "user" : ""}`}>
                    {/* Avatar */}
                    <div className={`avatar ${t.role === "user" ? "user" : t.error ? "err" : "bot"}`}>
                      {t.role === "user" ? I.user : I.bot}
                    </div>

                    {/* Bubble */}
                    <div className="bubble">
                      {t.role === "user" ? (
                        <div className="bubble-user">{t.content}</div>
                      ) : showTyping ? (
                        <div className="typing-bubble">
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                        </div>
                      ) : t.error ? (
                        <div className="bubble-err">⚠️ {t.content}</div>
                      ) : (
                        <div className="bubble-bot">
                          <AssistantContent content={t.content} streaming={t.streaming} />
                          {t.meta && (
                            <div className="bubble-meta">
                              <span>{I.cpu} {t.meta.model}</span>
                              <span>⚡ {t.meta.latency_ms} ms</span>
                              {t.meta.completion_tokens != null && (
                                <span>📝 {t.meta.completion_tokens} tokens</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div ref={bottomRef} />
            </div>
          </div>

          {/* Input bar */}
          <div className="input-wrap">
            <div className="input-inner">
              <form
                onSubmit={e => { e.preventDefault(); sendMessage(input); }}
              >
                <div className="input-box">
                  <textarea
                    ref={textareaRef}
                    className="input-textarea"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
                    }}
                    placeholder="Ask anything… (Enter ↵ to send, Shift+Enter for newline)"
                    maxLength={8000}
                    rows={1}
                    autoFocus
                  />
                  <button
                    type="submit"
                    className={`send-btn ${isActive ? "active" : "disabled"}`}
                    disabled={isPendingUI || !input.trim()}
                  >
                    {I.send}
                  </button>
                </div>
              </form>
              <p className="input-hint">
                OpsPilot runs locally via Ollama · no data leaves your machine
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
