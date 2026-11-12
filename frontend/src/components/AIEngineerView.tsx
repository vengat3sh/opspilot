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
    { key: "verify", label: "Tests & verification", detail: done ? "Verification checklist ready" : active ? "Preparing checks" : "Pending" },
    { key: "review", label: "Review & approval", detail: done ? "Awaiting approval for consequential actions" : "Pending" },
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
  turns, input, setInput, isPending, onSend, onQuickPrompt, onCancel,
}: {
  turns: Turn[]; input: string; setInput: (v: string) => void; isPending: boolean; onSend: (text: string) => void; onQuickPrompt: (text: string) => void; onCancel?: () => void;
}) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"plan" | "diff" | "checks">("plan");

  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [turns]);
  useEffect(() => { const el = textareaRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px"; }, [input]);

  const stages = useMemo(() => deriveStages(turns, isPending), [turns, isPending]);
  const lastUser = [...turns].reverse().find(t => t.role === "user")?.content || "";
  const lastAssistant = [...turns].reverse().find(t => t.role === "assistant");
  const filesInspected = ["backend/app/main.py", "backend/app/routers/chat.py", "frontend/src/App.tsx", "frontend/src/api.ts", "docker-compose.yml"];
  const filesChanged = lastAssistant && !lastAssistant.streaming ? ["(proposed) targeted backend/frontend changes"] : [];
  const checks = [
    { name: "Static analysis / lint", status: isPending ? "running" : lastAssistant ? "ready" : "pending" },
    { name: "Unit tests (pytest)", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
    { name: "Frontend build (vite)", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
    { name: "Security scan", status: isPending ? "queued" : lastAssistant ? "ready" : "pending" },
  ];
  const diffPreview = lastAssistant?.content
    ? `--- a/backend/app/example.py\n+++ b/backend/app/example.py\n@@ Proposed changes (review required) @@\n+ AI-generated patch preview appears here after sandbox execution.\n`
    : `No active diff yet.\n\nStart a task to generate a plan, proposed changes, and a unified diff for review.`;

  return (
    <div className="engineer-layout">
      <section className="engineer-main">
        <div className="engineer-hero-bar">
          <div>
            <div className="badge badge-info" style={{ marginBottom: 8 }}>OpsPilot AI Engineer</div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 6 }}>Autonomous engineering workspace</h2>
            <p className="muted" style={{ maxWidth: 720 }}>Plan, inspect, modify, test, and review changes with human approval gates for consequential actions.</p>
          </div>
          <div className="card card-pad" style={{ minWidth: 260, padding: 14 }}>
            <div className="context-row"><span className="muted">Project</span><strong>opspilot</strong></div>
            <div className="context-row" style={{ marginTop: 8 }}><span className="muted">Branch</span><strong>main</strong></div>
            <div className="context-row" style={{ marginTop: 8 }}><span className="muted">Policy</span><span className="badge badge-warning">Approval required</span></div>
          </div>
        </div>

        <div className="engineer-chat-shell">
          <div className="engineer-chat-scroll" ref={chatScrollRef} aria-live="polite">
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
                  <div className={`turn-avatar ${t.role === "user" ? "user" : "bot"}`}>{t.role === "user" ? "U" : "AI"}</div>
                  <div className="turn-bubble">
                    {t.role === "user" ? (
                      <div className="bubble-user">{t.content}</div>
                    ) : t.error ? (
                      <div className="bubble-assistant" style={{ borderColor: "var(--error-border)", background: "var(--error-bg)" }}>
                        <span style={{ color: "var(--error)", fontWeight: 600, whiteSpace: "pre-wrap" }}>⚠️ {t.content}</span>
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
                                <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: 10, fontSize: "0.82rem", margin: "10px 0" }} {...props}>
                                  {String(children).replace(/\n$/, "")}
                                </SyntaxHighlighter>
                              ) : <code className={className} {...props}>{children}</code>;
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
              <div className="row-between" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                <span>⏳ Generating response…</span>
                {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
              </div>
            )}
            <div className="chat-input-box">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isPending && input.trim()) onSend(input); } }}
                placeholder="Instruct the AI Engineer (e.g. “Fix login issue”, “Add Docker support”, “Review latest changes”)…"
                rows={1}
                aria-label="Message AI Engineer"
              />
              <button className="send-button" type="button" onClick={() => onSend(input)} disabled={isPending || !input.trim()} title="Send task" aria-label="Send">➤</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Plans and patches are proposals until reviewed. Git pushes, deployments, and destructive operations require explicit approval.</div>
          </div>
        </div>
      </section>

      <aside className="engineer-side">
        <div className="engineer-panel">
          <div className="row-between" style={{ marginBottom: 12 }}><span className="section-title" style={{ margin: 0 }}>Execution stages</span><span className={`badge ${isPending ? "badge-warning" : "badge-success"}`}>{isPending ? "Running" : "Ready"}</span></div>
          <div className="stage-list">
            {stages.map(s => (
              <div key={s.key} className="stage-item">
                <span className={`badge ${s.status === "done" ? "badge-success" : s.status === "active" ? "badge-info" : "badge-neutral"}`} style={{ minWidth: 24, justifyContent: "center" }}>{s.status === "done" ? "✓" : s.status === "active" ? "…" : "•"}</span>
                <div style={{ flex: 1 }}>
                  <div className="stage-label">{s.label}</div>
                  <div className="stage-detail">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="engineer-panel">
          <div className="section-title">Task context</div>
          <div className="context-block"><div className="context-label">Latest request</div><div className="context-value">{lastUser || "No task submitted yet."}</div></div>
          <div className="context-block"><div className="context-label">Files inspected</div><div className="chip-wrap">{filesInspected.map(f => <span key={f} className="tool-chip">{f}</span>)}</div></div>
          <div className="context-block"><div className="context-label">Proposed changes</div><div className="chip-wrap">{filesChanged.length ? filesChanged.map(f => <span key={f} className="tool-chip">{f}</span>) : <span className="context-muted">None yet</span>}</div></div>
        </div>

        <div className="engineer-panel">
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {(["plan", "checks", "diff"] as const).map(t => (
              <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(t)} type="button" style={{ textTransform: "capitalize" }}>{t}</button>
            ))}
          </div>
          {tab === "plan" && (
            <div className="plan-box">
              <ol style={{ paddingLeft: 18, display: "grid", gap: 6, fontSize: 13 }}>
                <li>Understand request and identify target scope.</li>
                <li>Inspect relevant files, dependencies, and architecture.</li>
                <li>Generate minimal, reviewable implementation plan.</li>
                <li>Apply changes in isolated sandbox branch (on approval).</li>
                <li>Run lint/tests/build and produce diff + review report.</li>
                <li>Request approval for commit/PR/deploy actions.</li>
              </ol>
              <div style={{ marginTop: 10, fontSize: 12 }} className="badge badge-warning">⚠️ Consequential actions require explicit approval.</div>
            </div>
          )}
          {tab === "checks" && (
            <div className="checks-list">
              {checks.map(c => (
                <div key={c.name} className="check-row card card-pad" style={{ padding: 10 }}>
                  <span style={{ fontSize: 13 }}>{c.name}</span>
                  <span className={`badge ${c.status === "ready" ? "badge-success" : c.status === "running" ? "badge-info" : "badge-neutral"}`}>{c.status}</span>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Real command execution runs in the sandbox service when connected.</div>
            </div>
          )}
          {tab === "diff" && <pre className="diff-box" style={{ margin: 0, whiteSpace: "pre-wrap" }}><code>{diffPreview}</code></pre>}
        </div>
      </aside>
    </div>
  );
}