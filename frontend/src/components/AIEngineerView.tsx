import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { StreamMeta } from "../api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  meta?: StreamMeta;
  error?: boolean;
  streaming?: boolean;
}

const QUICK_TASKS = [
  { icon: "🔐", label: "Add authentication", prompt: "Add JWT authentication to this FastAPI backend and integrate login with my React frontend. Provide a step-by-step implementation plan and code changes." },
  { icon: "🐳", label: "Prepare for deployment", prompt: "Analyze this project and prepare it for deployment with Docker, CI checks, and environment configuration recommendations." },
  { icon: "🧪", label: "Fix failing tests", prompt: "Investigate likely failing tests/build issues in this project, propose fixes, and outline verification steps." },
  { icon: "⚡", label: "Optimize API performance", prompt: "Review backend performance bottlenecks and propose targeted optimizations with code examples and rollback-safe steps." },
];

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
};

function deriveStages(turns: Turn[], isPending: boolean) {
  const hasUser = turns.some(t => t.role === "user");
  const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
  const done = hasUser && !!lastAssistant && !lastAssistant.streaming && !lastAssistant.error;
  const active = hasUser && isPending;
  const stages = [
    { key: "understand", label: "Task understanding", detail: hasUser ? "Request received and context scoped" : "Waiting for instruction" },
    { key: "plan", label: "Execution plan", detail: hasUser ? "Plan drafted with risks and dependencies" : "No active task" },
    { key: "inspect", label: "Files inspected", detail: hasUser ? "Relevant modules and config identified" : "—" },
    { key: "changes", label: "Code changes", detail: active ? "Generating targeted implementation guidance" : done ? "Proposed changes prepared for review" : "Pending" },
    { key: "verify", label: "Tests & verification", detail: done ? "Verification checklist ready (run in sandbox)" : active ? "Preparing checks" : "Pending" },
    { key: "review", label: "Review & approval", detail: done ? "Awaiting user approval for consequential actions" : "Pending" },
  ];
  return stages.map((s, i) => {
    let status: "pending" | "active" | "done" = "pending";
    if (!hasUser) status = i === 0 ? "active" : "pending";
    else if (done) status = "done";
    else if (active) status = i <= 3 ? (i === 3 ? "active" : "done") : "pending";
    else status = i === 0 ? "done" : "pending";
    return { ...s, status };
  });
}

export default function AIEngineerView({
  turns,
  input,
  setInput,
  isPending,
  onSend,
  onQuickPrompt,
  onCancel,
}: {
  turns: Turn[];
  input: string;
  setInput: (v: string) => void;
  isPending: boolean;
  onSend: (text: string) => void;
  onQuickPrompt: (text: string) => void;
  onCancel?: () => void;
}) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"plan" | "diff" | "checks">("plan");

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [turns]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  const stages = useMemo(() => deriveStages(turns, isPending), [turns, isPending]);
  const lastUser = [...turns].reverse().find(t => t.role === "user")?.content || "";
  const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
  const filesInspected = ["backend/app/main.py", "backend/app/routers/chat.py", "frontend/src/App.tsx", "frontend/src/api.ts", "docker-compose.yml"];
  const filesChanged = lastAssistant && !lastAssistant.streaming ? ["(proposed) backend/app/auth.py", "(proposed) frontend/src/components/Login.tsx", "(proposed) backend/app/config.py"] : [];
  const checks = [
    { name: "Static analysis / lint", status: isPending ? "running" : lastAssistant ? "ready" : "pending" },
    { name: "Unit tests (pytest)", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
    { name: "Frontend build (vite)", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
    { name: "Security scan (deps/config)", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
  ];

  const diffPreview = lastAssistant?.content
    ? `--- a/backend/app/example.py\n+++ b/backend/app/example.py\n@@ Proposed changes (review required) @@\n+ # AI-generated patch preview will appear here after sandbox execution\n+ # Current response includes implementation guidance and code snippets\n`
    : `No active diff yet.\n\nStart a task to generate a plan, proposed changes, and a unified diff for review.`;

  return (
    <div className="engineer-layout">
      <section className="engineer-main">
        <div className="engineer-hero-bar">
          <div>
            <div className="engineer-kicker">OpsPilot AI Engineer</div>
            <h2 className="engineer-heading">Autonomous software engineering workspace</h2>
            <p className="engineer-subheading">Plan, inspect, modify, test, and review changes with human approval gates for consequential actions.</p>
          </div>
          <div className="engineer-context-card">
            <div className="context-row"><span>Project</span><strong>opspilot (connected)</strong></div>
            <div className="context-row"><span>Branch</span><strong>main</strong></div>
            <div className="context-row"><span>Sandbox</span><strong>Policy: approval required</strong></div>
          </div>
        </div>

        <div className="engineer-chat-shell">
          <div className="engineer-chat-scroll" ref={chatScrollRef}>
            {turns.length === 0 ? (
              <div className="engineer-empty">
                <div className="hero-avatar" style={{ marginBottom: 16 }}>🧠</div>
                <h1 className="hero-title">What should the AI Engineer do?</h1>
                <p className="hero-subtitle">Describe a coding, refactoring, testing, or deployment-prep task. OpsPilot will plan, inspect context, propose changes, and prepare review artifacts.</p>
                <div className="hero-chips">
                  {QUICK_TASKS.map(item => (
                    <button key={item.label} className="hero-chip" onClick={() => onQuickPrompt(item.prompt)} type="button">
                      <span style={{ marginRight: 6 }}>{item.icon}</span>{item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t, idx) => (
                <div key={idx} className={`turn-row ${t.role === "user" ? "user" : "bot"}`}>
                  <div className={`turn-avatar ${t.role === "user" ? "user" : "bot"}`}>{t.role === "user" ? I.user : I.bot}</div>
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
                                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: 10, fontSize: "0.8rem", margin: "10px 0" }} {...props}>
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
                            <span>🤖 {t.meta.agent || t.meta.model}</span>
                            <span>⚡ {t.meta.latency_ms} ms</span>
                            {t.meta.citations && t.meta.citations.length > 0 && <span>📎 {t.meta.citations.length} citations</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="engineer-input-wrap">
            {isPending && (
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span>⏳ Generating response…</span>
                {onCancel && <button type="button" className="dcc-btn dcc-btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancel}>Cancel</button>}
              </div>
            )}
            <div className="chat-input-box">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!isPending && input.trim()) onSend(input);
                  }
                }}
                placeholder="Instruct the AI Engineer (e.g. “Fix login issue”, “Add Docker support”, “Review latest changes”)…"
                rows={1}
              />
              <button className="send-button" type="button" onClick={() => onSend(input)} disabled={isPending || !input.trim()} title="Send task">
                {I.send}
              </button>
            </div>
            <div className="input-disclaimer">Plans and patches are proposals until reviewed. Commands, Git pushes, and deployments require explicit approval.</div>
          </div>
        </div>
      </section>

      <aside className="engineer-side">
        <div className="engineer-panel">
          <div className="panel-title"><span>Execution stages</span><span className={`status-pill ${isPending ? "warning" : "active"}`}>{isPending ? "Running" : "Ready"}</span></div>
          <div className="stage-list">
            {stages.map(s => (
              <div key={s.key} className={`stage-item ${s.status}`}>
                <div className="stage-dot" />
                <div>
                  <div className="stage-label">{s.label}</div>
                  <div className="stage-detail">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="engineer-panel">
          <div className="panel-title">Task context</div>
          <div className="context-block"><div className="context-label">Latest request</div><div className="context-value">{lastUser || "No task submitted yet."}</div></div>
          <div className="context-block"><div className="context-label">Files inspected</div><div className="chip-wrap">{filesInspected.map(f => <span key={f} className="tool-chip">{f}</span>)}</div></div>
          <div className="context-block"><div className="context-label">Proposed changed files</div><div className="chip-wrap">{filesChanged.length ? filesChanged.map(f => <span key={f} className="tool-chip">{f}</span>) : <span className="context-muted">None yet</span>}</div></div>
        </div>

        <div className="engineer-panel">
          <div className="engineer-tabs">
            <button className={`engineer-tab ${tab === "plan" ? "active" : ""}`} onClick={() => setTab("plan")} type="button">Plan</button>
            <button className={`engineer-tab ${tab === "checks" ? "active" : ""}`} onClick={() => setTab("checks")} type="button">Checks</button>
            <button className={`engineer-tab ${tab === "diff" ? "active" : ""}`} onClick={() => setTab("diff")} type="button">Diff</button>
          </div>
          {tab === "plan" && (
            <div className="plan-box">
              <ol>
                <li>Understand request and identify target project scope.</li>
                <li>Inspect relevant files, dependencies, and architecture.</li>
                <li>Generate minimal, reviewable implementation plan and risks.</li>
                <li>Apply changes in isolated sandbox branch (on approval).</li>
                <li>Run lint/tests/build and produce diff + review report.</li>
                <li>Request approval for commit/PR/deploy actions.</li>
              </ol>
              <div className="approval-note">⚠️ Consequential actions (push, merge, infra, deploy, destructive ops) are blocked pending explicit approval.</div>
            </div>
          )}
          {tab === "checks" && (
            <div className="checks-list">
              {checks.map(c => (
                <div key={c.name} className="check-row">
                  <span>{c.name}</span>
                  <span className={`check-status ${c.status}`}>{c.status}</span>
                </div>
              ))}
              <div className="context-muted" style={{ marginTop: 8 }}>Real command execution runs in the sandbox service once connected.</div>
            </div>
          )}
          {tab === "diff" && (
            <pre className="diff-box"><code>{diffPreview}</code></pre>
          )}
        </div>
      </aside>
    </div>
  );
}
