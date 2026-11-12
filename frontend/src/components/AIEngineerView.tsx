import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type {
  ConversationItem,
  ProjectItem,
  StreamMeta,
  ToolOperation,
} from "../api";

export interface Turn {
  id?: string;
  role: "user" | "assistant";
  content: string;
  meta?: StreamMeta;
  error?: boolean;
  streaming?: boolean;
  interrupted?: boolean;
  createdAt?: string;
  status?: string;
}

interface Props {
  turns: Turn[];
  input: string;
  setInput: (v: string) => void;
  isPending: boolean;
  onSend: (text: string) => void;
  onQuickPrompt: (text: string) => void;
  onCancel?: () => void;
  conversations: ConversationItem[];
  conversationsLoading: boolean;
  conversationsTotal: number;
  activeConversationId: string | null;
  onNewConversation: () => void;
  onOpenConversation: (conv: ConversationItem) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onArchiveConversation: (id: string, archived: boolean) => void;
  conversationSearch: string;
  setConversationSearch: (v: string) => void;
  conversationPage: number;
  setConversationPage: (page: number) => void;
  conversationsHasMore: boolean;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
  projects: ProjectItem[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  toolOps: ToolOperation[];
  onRegenerate: () => void;
  onEditTurn: (index: number) => void;
  onLoadOlder: () => void;
  hasOlder: boolean;
  loadingMessages: boolean;
  contextNotice: string | null;
  editingIndex: number | null;
  onCancelEdit: () => void;
}

const QUICK_TASKS = [
  { icon: "🔐", label: "Add authentication", prompt: "Add JWT authentication to this FastAPI backend and integrate login with my React frontend. Provide a step-by-step implementation plan and code changes." },
  { icon: "🐳", label: "Prepare for deployment", prompt: "Analyze this project and prepare it for deployment with Docker, CI checks, and environment configuration recommendations." },
  { icon: "🧪", label: "Fix failing tests", prompt: "Investigate likely failing tests/build issues in this project, propose fixes, and outline verification steps." },
  { icon: "⚡", label: "Optimize API performance", prompt: "Review backend performance bottlenecks and propose targeted optimizations with code examples and rollback-safe steps." },
];

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusBadge(status?: string) {
  switch (status) {
    case "completed":
      return <span className="badge badge-success">completed</span>;
    case "streaming":
      return <span className="badge badge-info">streaming</span>;
    case "interrupted":
      return <span className="badge badge-warning">interrupted</span>;
    case "failed":
      return <span className="badge badge-error">failed</span>;
    default:
      return null;
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm turn-action"
      onClick={async () => {
        const ok = await copyText(text);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={label}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function ToolStatus({ status }: { status: string }) {
  const cls =
    status === "completed" ? "badge-success"
      : status === "failed" ? "badge-error"
      : status === "pending_approval" ? "badge-warning"
      : status === "unavailable" ? "badge-neutral"
      : "badge-info";
  return <span className={`badge ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

function DiffView({ ops }: { ops: ToolOperation[] }) {
  const patch = useMemo(
    () => ops.find(op => typeof op.output?.diff === "string" && (op.output.diff as string).trim().length > 0),
    [ops],
  );
  const diff = (patch?.output?.diff as string | undefined) || "";
  if (!diff) {
    return (
      <div className="diff-empty muted">
        No patch has been proposed in this session. Diffs appear here only after a
        <code> project.propose_patch </code> tool operation returns a real unified diff.
      </div>
    );
  }
  return (
    <div className="diff-view">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>{String(patch?.output?.path ?? "proposed patch")}</span>
        <CopyButton text={diff} label="Copy diff" />
      </div>
      <pre className="diff-box" style={{ margin: 0 }}>
        <code>
          {diff.split("\n").map((line, i) => (
            <span
              key={i}
              className={
                line.startsWith("+") && !line.startsWith("+++") ? "diff-add"
                  : line.startsWith("-") && !line.startsWith("---") ? "diff-del"
                  : line.startsWith("@@") ? "diff-hunk"
                  : undefined
              }
            >
              {line}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export default function AIEngineerView({
  turns,
  input,
  setInput,
  isPending,
  onSend,
  onQuickPrompt,
  onCancel,
  conversations,
  conversationsLoading,
  conversationsTotal,
  activeConversationId,
  onNewConversation,
  onOpenConversation,
  onRenameConversation,
  onDeleteConversation,
  onArchiveConversation,
  conversationSearch,
  setConversationSearch,
  conversationPage,
  setConversationPage,
  conversationsHasMore,
  showArchived,
  setShowArchived,
  projects,
  selectedProjectId,
  onSelectProject,
  toolOps,
  onRegenerate,
  onEditTurn,
  onLoadOlder,
  hasOlder,
  loadingMessages,
  contextNotice,
  editingIndex,
  onCancelEdit,
}: Props) {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"tools" | "diff">("tools");

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [turns]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;
  const lastAssistantIndex = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (turns[i].role === "assistant") return i;
    }
    return -1;
  }, [turns]);
  const lastAssistant = lastAssistantIndex >= 0 ? turns[lastAssistantIndex] : null;
  const canRegenerate = Boolean(lastAssistant) && !isPending && !lastAssistant?.streaming;
  const activeToolOps = toolOps.slice(0, 12);

  return (
    <div className="engineer-layout">
      <section className="engineer-main">
        <div className="engineer-hero-bar">
          <div style={{ minWidth: 0 }}>
            <div className="badge badge-info" style={{ marginBottom: 8 }}>OpsPilot AI Engineer</div>
            <h2 className="engineer-title">
              {activeConversation?.title || "Autonomous engineering workspace"}
            </h2>
            <p className="muted" style={{ maxWidth: 720, margin: 0 }}>
              Conversations are stored in PostgreSQL. Plans, diffs, and tool runs below come
              from real persisted records — nothing is simulated.
            </p>
          </div>
          <div className="engineer-context-card">
            <label className="context-label" htmlFor="project-selector">Project context</label>
            <select
              id="project-selector"
              className="engineer-select"
              value={selectedProjectId ?? ""}
              onChange={e => onSelectProject(e.target.value || null)}
            >
              <option value="">No project (general chat)</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {selectedProject ? (
              <div className="engineer-context-meta">
                <span className={`badge ${selectedProject.indexing_status === "indexed" ? "badge-success" : "badge-neutral"}`}>
                  {selectedProject.indexing_status || "not indexed"}
                </span>
                <span className="muted">{selectedProject.indexed_files ?? 0} files indexed</span>
              </div>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>No repository context will be sent.</span>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onNewConversation} style={{ marginTop: 8 }}>
              + New conversation
            </button>
          </div>
        </div>

        <div className="engineer-chat-shell">
          <div className="engineer-chat-scroll" ref={chatScrollRef} aria-live="polite" aria-label="Conversation messages">
            {hasOlder && (
              <div style={{ textAlign: "center", marginBottom: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onLoadOlder} disabled={loadingMessages}>
                  {loadingMessages ? "Loading…" : "Load older messages"}
                </button>
              </div>
            )}
            {loadingMessages && turns.length === 0 && (
              <div className="muted" style={{ padding: 24, textAlign: "center" }}>Loading conversation…</div>
            )}
            {turns.length === 0 && !loadingMessages ? (
              <div className="engineer-empty">
                <div className="hero-avatar" style={{ marginBottom: 16 }}>🧠</div>
                <h1 className="hero-title">What should the AI Engineer do?</h1>
                <p className="hero-subtitle">
                  Describe a coding, refactoring, testing, or deployment-prep task. Select a
                  project above to include indexed repository context.
                </p>
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
                <div key={t.id || idx} className={`turn-row ${t.role === "user" ? "user" : "bot"}`}>
                  <div className={`turn-avatar ${t.role === "user" ? "user" : "bot"}`}>
                    {t.role === "user" ? "U" : "AI"}
                  </div>
                  <div className="turn-bubble">
                    {t.role === "user" ? (
                      <>
                        <div className="bubble-user">{t.content}</div>
                        <div className="turn-toolbar">
                          {formatTime(t.createdAt) && <span className="turn-time">{formatTime(t.createdAt)}</span>}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm turn-action"
                            onClick={() => onEditTurn(idx)}
                            disabled={isPending || t.streaming}
                          >
                            Edit
                          </button>
                          <CopyButton text={t.content} />
                        </div>
                      </>
                    ) : t.error ? (
                      <>
                        <div className="bubble-assistant bubble-error">
                          <span style={{ color: "var(--error)", fontWeight: 600, whiteSpace: "pre-wrap" }}>
                            ⚠️ {t.content || "Generation failed."}
                          </span>
                        </div>
                        <div className="turn-toolbar">
                          {t.meta?.provider && <span className="turn-time">{t.meta.provider}</span>}
                          {formatTime(t.createdAt) && <span className="turn-time">{formatTime(t.createdAt)}</span>}
                          {t.content && <CopyButton text={t.content} />}
                          {idx === lastAssistantIndex && canRegenerate && (
                            <button type="button" className="btn btn-secondary btn-sm turn-action" onClick={onRegenerate}>
                              Retry
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="bubble-assistant">
                          {t.content ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                code({ inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || "");
                                  const code = String(children).replace(/\n$/, "");
                                  if (inline || !match) {
                                    return <code className={className} {...props}>{children}</code>;
                                  }
                                  return (
                                    <div className="code-block">
                                      <div className="code-block-head">
                                        <span>{match[1]}</span>
                                        <CopyButton text={code} label="Copy code" />
                                      </div>
                                      <SyntaxHighlighter
                                        style={oneDark}
                                        language={match[1]}
                                        PreTag="div"
                                        customStyle={{ borderRadius: 10, fontSize: "0.82rem", margin: 0 }}
                                        {...props}
                                      >
                                        {code}
                                      </SyntaxHighlighter>
                                    </div>
                                  );
                                },
                              }}
                            >
                              {t.content}
                            </ReactMarkdown>
                          ) : (
                            <span className="muted">Waiting for the first token…</span>
                          )}
                          {t.streaming && <span className="typing-cursor" />}
                          {t.interrupted && (
                            <div className="turn-notice turn-notice-warning">
                              Generation stopped. Partial output was saved as interrupted.
                            </div>
                          )}
                          <div className="bubble-meta">
                            {t.meta?.agent && <span>🤖 {t.meta.agent}</span>}
                            {t.meta?.model && <span>{t.meta.model}</span>}
                            {t.meta?.latency_ms ? <span>⚡ {t.meta.latency_ms} ms</span> : null}
                            {t.meta?.completion_tokens != null && <span>{t.meta.completion_tokens} tokens</span>}
                            {t.meta?.citations && t.meta.citations.length > 0 && <span>📎 {t.meta.citations.length} citations</span>}
                            {formatTime(t.createdAt) && <span>{formatTime(t.createdAt)}</span>}
                            {statusBadge(t.status || t.meta?.status)}
                          </div>
                        </div>
                        <div className="turn-toolbar">
                          {t.content && <CopyButton text={t.content} />}
                          {idx === lastAssistantIndex && canRegenerate && (
                            <button type="button" className="btn btn-ghost btn-sm turn-action" onClick={onRegenerate}>
                              Regenerate
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="engineer-input-wrap">
            {editingIndex != null && (
              <div className="turn-notice turn-notice-info" style={{ marginBottom: 8 }}>
                Editing a previous message. Saving will remove later messages in this conversation and regenerate the reply.
                <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelEdit} style={{ marginLeft: 8 }}>
                  Cancel edit
                </button>
              </div>
            )}
            {isPending && (
              <div className="row-between" style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                <span>⏳ Generating response…</span>
                {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Stop generation</button>}
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
                placeholder={editingIndex != null ? "Edit your message…" : "Instruct the AI Engineer (e.g. “Fix login issue”, “Add Docker support”)…"}
                rows={1}
                aria-label="Message AI Engineer"
              />
              <button
                className="send-button"
                type="button"
                onClick={() => onSend(input)}
                disabled={isPending || !input.trim()}
                title={editingIndex != null ? "Save and regenerate" : "Send task"}
                aria-label={editingIndex != null ? "Save and regenerate" : "Send"}
              >
                ➤
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Plans and patches are proposals until reviewed. Git pushes, deployments, and destructive
              operations require explicit approval and a connected provider.
            </div>
          </div>
        </div>
      </section>

      <aside className="engineer-side">
        <div className="engineer-panel">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="section-title" style={{ margin: 0 }}>Conversations</span>
            <span className="muted" style={{ fontSize: 12 }}>{conversationsTotal}</span>
          </div>
          <input
            className="engineer-input"
            type="search"
            value={conversationSearch}
            onChange={e => setConversationSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
          />
          <label className="engineer-checkbox">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <div className="conv-list">
            {conversationsLoading && conversations.length === 0 && (
              <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>Loading conversations…</div>
            )}
            {!conversationsLoading && conversations.length === 0 && (
              <div className="muted" style={{ fontSize: 13, padding: "8px 4px" }}>
                {conversationSearch ? "No conversations match this search." : "No conversations yet."}
              </div>
            )}
            {conversations.map(conv => (
              <div key={conv.id} className={`conv-item ${conv.id === activeConversationId ? "active" : ""}`}>
                <button type="button" className="conv-open" onClick={() => onOpenConversation(conv)}>
                  <span className="conv-title">{conv.title}</span>
                  <span className="conv-preview">{conv.last_message_preview || "No messages yet"}</span>
                  <span className="conv-meta">
                    {conv.message_count} msg · {formatTime(conv.last_message_at || conv.updated_at)}
                    {conv.archived_at ? " · archived" : ""}
                  </span>
                </button>
                <div className="conv-actions">
                  <button
                    type="button"
                    className="conv-action"
                    title="Rename"
                    aria-label={`Rename ${conv.title}`}
                    onClick={() => {
                      const title = window.prompt("Rename conversation", conv.title);
                      if (title && title.trim() && title.trim() !== conv.title) onRenameConversation(conv.id, title.trim());
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="conv-action"
                    title={conv.archived_at ? "Unarchive" : "Archive"}
                    aria-label={conv.archived_at ? `Unarchive ${conv.title}` : `Archive ${conv.title}`}
                    onClick={() => onArchiveConversation(conv.id, !conv.archived_at)}
                  >
                    {conv.archived_at ? "↩" : "🗄"}
                  </button>
                  <button
                    type="button"
                    className="conv-action conv-action-danger"
                    title="Delete"
                    aria-label={`Delete ${conv.title}`}
                    onClick={() => onDeleteConversation(conv.id)}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="row-between" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConversationPage(Math.max(1, conversationPage - 1))}
              disabled={conversationPage <= 1 || conversationsLoading}
            >
              ← Prev
            </button>
            <span className="muted" style={{ fontSize: 12 }}>Page {conversationPage}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConversationPage(conversationPage + 1)}
              disabled={!conversationsHasMore || conversationsLoading}
            >
              Next →
            </button>
          </div>
        </div>

        <div className="engineer-panel">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span className="section-title" style={{ margin: 0 }}>Project context</span>
            <span className={`badge ${selectedProject?.repository_inspected ? "badge-success" : "badge-neutral"}`}>
              {selectedProject?.repository_inspected ? "inspected" : "not inspected"}
            </span>
          </div>
          {contextNotice ? (
            <div className="turn-notice turn-notice-info">{contextNotice}</div>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {selectedProject
                ? `Context is retrieved from the authorized index for “${selectedProject.name}”. If no files are indexed, the assistant is told not to claim inspection.`
                : "Select a project to include read-only repository context in prompts."}
            </p>
          )}
          <div className="chip-wrap" style={{ marginTop: 10 }}>
            {selectedProject?.language && <span className="tool-chip">{selectedProject.language}</span>}
            {selectedProject?.default_branch && <span className="tool-chip">branch: {selectedProject.default_branch}</span>}
            {selectedProject?.last_indexed_at && (
              <span className="tool-chip">indexed {formatTime(selectedProject.last_indexed_at)}</span>
            )}
          </div>
        </div>

        <div className="engineer-panel">
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {(["tools", "diff"] as const).map(t => (
              <button
                key={t}
                className={`btn btn-sm ${tab === t ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setTab(t)}
                type="button"
                style={{ textTransform: "capitalize" }}
              >
                {t === "tools" ? `Tool timeline (${toolOps.length})` : "Diff"}
              </button>
            ))}
          </div>
          {tab === "tools" && (
            activeToolOps.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No tool operations recorded for this conversation or project. Tool runs are
                persisted and appear here once executed.
              </div>
            ) : (
              <div className="tool-timeline">
                {activeToolOps.map(op => (
                  <div key={op.id} className="tool-op">
                    <div className="row-between">
                      <strong style={{ fontSize: 13 }}>{op.tool_name}</strong>
                      <ToolStatus status={op.status} />
                    </div>
                    <div className="tool-op-meta">
                      <span>risk: {op.risk_level}</span>
                      {op.requires_approval && <span>approval required</span>}
                      {formatTime(op.created_at) && <span>{formatTime(op.created_at)}</span>}
                    </div>
                    {op.error_message && <div className="tool-op-error">{op.error_message}</div>}
                  </div>
                ))}
              </div>
            )
          )}
          {tab === "diff" && <DiffView ops={toolOps} />}
        </div>

        <div className="engineer-panel">
          <div className="section-title">Execution stages</div>
          <div className="stage-list">
            {[
              { label: "Request received", detail: turns.some(t => t.role === "user") ? "User message persisted" : "Waiting for instruction", done: turns.some(t => t.role === "user") },
              { label: "Context retrieval", detail: selectedProject ? (contextNotice || "Project selected") : "No project selected", done: Boolean(contextNotice) },
              { label: "Response generation", detail: isPending ? "Streaming from provider" : lastAssistant?.status === "completed" ? "Completed and persisted" : lastAssistant ? `Status: ${lastAssistant.status || "unknown"}` : "Not started", done: lastAssistant?.status === "completed" },
              { label: "Review & approval", detail: toolOps.some(o => o.requires_approval) ? "Tool operations awaiting review" : "No pending consequential actions", done: false },
            ].map((s, i) => (
              <div key={i} className="stage-item">
                <span className={`badge ${s.done ? "badge-success" : isPending && i === 2 ? "badge-info" : "badge-neutral"}`} style={{ minWidth: 24, justifyContent: "center" }}>
                  {s.done ? "✓" : isPending && i === 2 ? "…" : "•"}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="stage-label">{s.label}</div>
                  <div className="stage-detail">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
