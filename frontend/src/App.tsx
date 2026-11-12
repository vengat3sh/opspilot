import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  adminLogin,
  authLogout,
  authMe,
  cancelAssistantGeneration,
  deleteConversation,
  editUserMessage,
  errorMessage,
  getApprovals,
  getIncidents,
  getLLMStatus,
  getMessages,
  getProjects,
  getToolOperations,
  listConversations,
  streamChat,
  updateConversation,
  userLogin,
  userRegister,
  type AuthUser,
  type ChatMessage,
  type ConversationItem,
  type MessageItem,
  type Provider,
  type StreamMeta,
  type TicketItem,
  type ToolOperation,
} from "./api";

import AIEngineerView from "./components/AIEngineerView";
import AgentsView from "./components/AgentsView";
import ApprovalsView from "./components/ApprovalsView";
import DashboardView from "./components/DashboardView";
import DeveloperCommandCenter, { CommandPalette } from "./components/DeveloperCommandCenter";
import DocumentsView from "./components/DocumentsView";
import TicketsView from "./components/TicketsView";

type NavTab =
  | "overview" | "projects" | "connect" | "engineer" | "code" | "git" | "prs"
  | "cloud" | "infra" | "build" | "history" | "monitoring" | "incidents"
  | "approvals" | "knowledge" | "analytics" | "settings" | "agents" | "tickets";

interface Turn {
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
function getInitialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("opspilot_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const NAV: Array<{ id: NavTab; label: string; icon: string; section: string }> = [
  { id: "overview", label: "Overview", icon: "🏠", section: "Main" },
  { id: "projects", label: "Projects", icon: "📦", section: "Main" },
  { id: "connect", label: "Connect", icon: "🔗", section: "Main" },
  { id: "engineer", label: "AI Engineer", icon: "🧠", section: "Engineering" },
  { id: "code", label: "Code Changes", icon: "📝", section: "Engineering" },
  { id: "git", label: "Git Ops", icon: "🌿", section: "Engineering" },
  { id: "prs", label: "Pull Requests", icon: "🔀", section: "Engineering" },
  { id: "cloud", label: "Cloud", icon: "☁️", section: "Delivery" },
  { id: "infra", label: "Infrastructure", icon: "🏗️", section: "Delivery" },
  { id: "build", label: "Build & Deploy", icon: "🚀", section: "Delivery" },
  { id: "history", label: "Deploy History", icon: "🕘", section: "Delivery" },
  { id: "monitoring", label: "Monitoring", icon: "📈", section: "Operations" },
  { id: "incidents", label: "Incidents", icon: "🚨", section: "Operations" },
  { id: "approvals", label: "Approvals", icon: "🛡️", section: "Operations" },
  { id: "tickets", label: "Tickets", icon: "🎫", section: "Operations" },
  { id: "knowledge", label: "Knowledge", icon: "📚", section: "Intelligence" },
  { id: "agents", label: "Agents", icon: "🤖", section: "Intelligence" },
  { id: "analytics", label: "Analytics", icon: "📊", section: "Intelligence" },
  { id: "settings", label: "Settings", icon: "⚙️", section: "System" },
];

const TOP_NAV_IDS: NavTab[] = ["overview", "projects", "engineer", "build", "monitoring", "incidents", "approvals"];

function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [view, setView] = useState<"choice" | "user-login" | "user-signup" | "admin-login">("choice");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm_password: "", remember_me: false, terms: false });

  const passwordStrength = (() => {
    const p = form.password;
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
    const colors = ["#e11d48", "#f97316", "#d97706", "#2563eb", "#059669"];
    return { score, label: labels[score], color: colors[score], pct: (score / 4) * 100 };
  })();

  async function submitUserLogin(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setLoading(true);
    try { const res = await userLogin({ email: form.email, password: form.password, remember_me: form.remember_me }); onAuthenticated(res.user); }
    catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  }
  async function submitAdminLogin(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setLoading(true);
    try { const res = await adminLogin({ email: form.email, password: form.password, remember_me: form.remember_me }); onAuthenticated(res.user); }
    catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  }
  async function submitUserSignup(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!form.full_name.trim()) { setErr("Full name is required"); return; }
    if (form.password.length < 8) { setErr("Password must be at least 8 characters"); return; }
    if (form.password !== form.confirm_password) { setErr("Passwords do not match"); return; }
    if (!form.terms) { setErr("You must accept the terms to create an account"); return; }
    setLoading(true);
    try {
      const res = await userRegister({ full_name: form.full_name.trim(), email: form.email, password: form.password, confirm_password: form.confirm_password, terms_accepted: true });
      onAuthenticated(res.user);
    } catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="card-pad">
          <div className="auth-brand">
            <div className="brand-mark">⚡</div>
            <div><div className="brand-text">OpsPilot</div><div className="brand-sub">Secure engineering platform</div></div>
          </div>

          {view === "choice" && (
            <>
              <h1 className="auth-title">Sign in to OpsPilot</h1>
              <p className="auth-desc">Choose your account type to access the appropriate workspace and permissions.</p>
              <div className="stack">
                <button className="btn btn-primary" style={{ justifyContent: "flex-start", padding: 16, textAlign: "left" }} onClick={() => { setView("user-login"); setErr(null); }}>
                  <span style={{ fontSize: 18 }}>👤</span>
                  <span><span style={{ display: "block", fontWeight: 700 }}>User Login</span><span style={{ display: "block", fontSize: 12, opacity: 0.9, fontWeight: 500 }}>Developer workspace, projects, AI engineer, deployments</span></span>
                </button>
                <button className="btn btn-secondary" style={{ justifyContent: "flex-start", padding: 16, textAlign: "left" }} onClick={() => { setView("admin-login"); setErr(null); }}>
                  <span style={{ fontSize: 18 }}>🛡️</span>
                  <span><span style={{ display: "block", fontWeight: 700 }}>Admin Login</span><span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Platform controls, user management, audit and operations</span></span>
                </button>
              </div>
              <div style={{ marginTop: 16, fontSize: 13, color: "var(--text-muted)" }}>
                New to OpsPilot? <button className="btn btn-ghost btn-sm" style={{ padding: "2px 6px" }} onClick={() => { setView("user-signup"); setErr(null); }}>Create an account</button>
              </div>
            </>
          )}

          {(view === "user-login" || view === "admin-login") && (
            <form onSubmit={view === "user-login" ? submitUserLogin : submitAdminLogin} className="stack">
              <div>
                <h2 className="auth-title" style={{ fontSize: 22 }}>{view === "admin-login" ? "Admin login" : "Welcome back"}</h2>
                <p className="auth-desc" style={{ marginBottom: 0 }}>{view === "admin-login" ? "Authorized administrators only." : "Sign in to your OpsPilot workspace."}</p>
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" required type="email" autoComplete="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@company.com" />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <div style={{ position: "relative" }}>
                  <input id="password" className="input" required type={showPassword ? "text" : "password"} autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Enter your password" style={{ paddingRight: 44 }} />
                  <button type="button" className="icon-btn" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(s => !s)} style={{ position: "absolute", right: 4, top: 4, width: 32, height: 32, border: "none", background: "transparent" }}>{showPassword ? "🙈" : "👁️"}</button>
                </div>
              </div>
              <div className="row-between">
                <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.remember_me} onChange={e => setForm(f => ({ ...f, remember_me: e.target.checked }))} /> Remember me
                </label>
              </div>
              {err && <div className="error-text" role="alert">{err}</div>}
              <button disabled={loading} type="submit" className="btn btn-primary" style={{ width: "100%" }}>{loading ? "Signing in..." : "Sign in"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setView("choice")}>← Back</button>
              <p style={{ fontSize: 12, color: "var(--text-subtle)" }}>Forgot password and OAuth options appear when configured by the backend.</p>
            </form>
          )}

          {view === "user-signup" && (
            <form onSubmit={submitUserSignup} className="stack">
              <div>
                <h2 className="auth-title" style={{ fontSize: 22 }}>Create your account</h2>
                <p className="auth-desc" style={{ marginBottom: 0 }}>Public signup creates a standard user account.</p>
              </div>
              <div className="field">
                <label htmlFor="full_name">Full name</label>
                <input id="full_name" className="input" required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Doe" autoComplete="name" />
              </div>
              <div className="field">
                <label htmlFor="signup-email">Email</label>
                <input id="signup-email" className="input" required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@company.com" autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="signup-password">Password</label>
                <div style={{ position: "relative" }}>
                  <input id="signup-password" className="input" required type={showPassword ? "text" : "password"} minLength={8} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" autoComplete="new-password" style={{ paddingRight: 44 }} />
                  <button type="button" className="icon-btn" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(s => !s)} style={{ position: "absolute", right: 4, top: 4, width: 32, height: 32, border: "none", background: "transparent" }}>{showPassword ? "🙈" : "👁️"}</button>
                </div>
                {form.password && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border)" }}>
                      <div style={{ height: "100%", width: `${passwordStrength.pct}%`, background: passwordStrength.color, transition: "width .2s ease" }} />
                    </div>
                    <div style={{ fontSize: 12, color: passwordStrength.color, marginTop: 4, fontWeight: 600 }}>Password strength: {passwordStrength.label}</div>
                  </div>
                )}
              </div>
              <div className="field">
                <label htmlFor="confirm_password">Confirm password</label>
                <input id="confirm_password" className="input" required type={showPassword ? "text" : "password"} minLength={8} value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} placeholder="Re-enter password" autoComplete="new-password" />
              </div>
              <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.checked }))} style={{ marginTop: 3 }} />
                <span>I accept the terms and agree to use OpsPilot responsibly.</span>
              </label>
              {err && <div className="error-text" role="alert">{err}</div>}
              <button disabled={loading} type="submit" className="btn btn-primary" style={{ width: "100%" }}>{loading ? "Creating account..." : "Create account"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setView("choice")}>← Back</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("opspilot_theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    authMe().then(res => { if (mounted) setCurrentUser(res.user); }).catch(() => {}).finally(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-muted)" }}>
        <div style={{ textAlign: "center" }}>
          <div className="brand-mark" style={{ margin: "0 auto 12px" }}>⚡</div>
          <div style={{ fontWeight: 600 }}>Loading secure session…</div>
        </div>
      </div>
    );
  }
  if (!currentUser) {
    return <AuthGate onAuthenticated={setCurrentUser} />;
  }
  return <AuthenticatedApp user={currentUser} theme={theme} setTheme={setTheme} onSignOut={async () => { try { await authLogout(); } catch {} setCurrentUser(null); }} />;
}

function AuthenticatedApp({ user, theme, setTheme, onSignOut }: { user: AuthUser; theme: "light" | "dark"; setTheme: (t: "light" | "dark") => void; onSignOut: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTabState] = useState<NavTab>("overview");
  const [, setTabHistory] = useState<NavTab[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("cloud");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [search] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const isPendingRef = useRef(false);
  const [isPendingUI, setIsPendingUI] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [lastAssistantId, setLastAssistantId] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationPage, setConversationPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [toolOps, setToolOps] = useState<ToolOperation[]>([]);
  const [contextNotice, setContextNotice] = useState<string | null>(null);

  const status = useQuery({ queryKey: ["llm-status"], queryFn: getLLMStatus, refetchInterval: 15_000 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, refetchInterval: 15_000 });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: () => getIncidents(), refetchInterval: 20_000 });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: getProjects, refetchInterval: 30_000 });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", conversationSearch, conversationPage, showArchived],
    queryFn: () => listConversations({ q: conversationSearch || undefined, archived: showArchived, page: conversationPage, limit: 30 }),
    refetchInterval: 20_000,
  });
  const toolOpsQuery = useQuery({
    queryKey: ["tool-ops", activeConversationId, selectedProjectId],
    queryFn: () => getToolOperations({ conversationId: activeConversationId || undefined, projectId: selectedProjectId || undefined }),
    enabled: Boolean(activeConversationId || selectedProjectId),
    refetchInterval: 10_000,
  });

  useEffect(() => { if (status.data) { if (!status.data.ollama_reachable) setProvider("cloud"); else if (status.data.provider) setProvider(status.data.provider as Provider); } }, [status.data]);
  useEffect(() => { if (toolOpsQuery.data) setToolOps(toolOpsQuery.data); }, [toolOpsQuery.data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(v => !v); }
      if (e.key === "Escape") { setCmdkOpen(false); setNotifOpen(false); setProfileOpen(false); setMobileNavOpen(false); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { document.body.style.overflow = mobileNavOpen ? "hidden" : ""; return () => { document.body.style.overflow = ""; }; }, [mobileNavOpen]);

  function setActiveTab(next: NavTab) { setActiveTabState(prev => { if (prev !== next) setTabHistory(h => [...h, prev].slice(-12)); return next; }); setMobileNavOpen(false); setNotifOpen(false); setProfileOpen(false); }
  function setPending(v: boolean) { isPendingRef.current = v; setIsPendingUI(v); }
  function refreshConversations() { void queryClient.invalidateQueries({ queryKey: ["conversations"] }); }
  function refreshTools() { void queryClient.invalidateQueries({ queryKey: ["tool-ops"] }); }
  function startNewChat() { abortRef.current?.abort(); setActiveConversationId(null); setTurns([]); setInput(""); setEditingIndex(null); setLastAssistantId(null); setOlderCursor(null); setHasOlder(false); setContextNotice(null); setPending(false); setActiveTab("engineer"); }

  function messageToTurn(m: MessageItem): Turn | null {
    if (m.role !== "user" && m.role !== "assistant") return null;
    const meta: StreamMeta | undefined = m.role === "assistant" ? {
      provider: m.provider || "",
      model: m.model || "",
      latency_ms: m.latency_ms || 0,
      prompt_tokens: m.token_usage?.prompt_tokens ?? null,
      completion_tokens: m.token_usage?.completion_tokens ?? null,
      conversation_id: m.conversation_id,
      assistant_message_id: m.id,
      status: m.status,
    } : undefined;
    return {
      id: m.id,
      role: m.role,
      content: m.content || (m.status === "failed" ? (m.error_message || "Generation failed") : ""),
      meta,
      error: m.status === "failed",
      interrupted: m.status === "interrupted",
      streaming: m.status === "streaming",
      createdAt: m.created_at,
      status: m.status,
    };
  }

  async function openConversation(conv: ConversationItem) {
    abortRef.current?.abort();
    setActiveConversationId(conv.id);
    setSelectedProjectId(conv.project_id || null);
    setInput("");
    setEditingIndex(null);
    setLastAssistantId(null);
    setContextNotice(null);
    setPending(false);
    setActiveTab("engineer");
    setLoadingMessages(true);
    try {
      const page = await getMessages(conv.id, { limit: 50 });
      setTurns(page.items.map(messageToTurn).filter((t): t is Turn => Boolean(t)));
      setOlderCursor(page.next_before_sequence ?? null);
      setHasOlder(page.has_more);
      const lastAssistant = [...page.items].reverse().find(m => m.role === "assistant");
      setLastAssistantId(lastAssistant?.id ?? null);
    } catch (e) {
      setTurns([{ role: "assistant", content: errorMessage(e), error: true }]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function loadOlderMessages() {
    if (!activeConversationId || !olderCursor || loadingMessages) return;
    setLoadingMessages(true);
    try {
      const page = await getMessages(activeConversationId, { limit: 50, beforeSequence: olderCursor });
      const older = page.items.map(messageToTurn).filter((t): t is Turn => Boolean(t));
      setTurns(prev => [...older, ...prev]);
      setOlderCursor(page.next_before_sequence ?? null);
      setHasOlder(page.has_more);
    } catch (e) {
      setTurns(prev => [{ role: "assistant", content: errorMessage(e), error: true }, ...prev]);
    } finally {
      setLoadingMessages(false);
    }
  }

  async function handleSelectProject(id: string | null) {
    setSelectedProjectId(id);
    if (!activeConversationId) return;
    try {
      await updateConversation(activeConversationId, { project_id: id });
      refreshConversations();
      setContextNotice(id ? "Project linked to this conversation." : "Project context cleared for this conversation.");
    } catch (e) {
      setContextNotice(errorMessage(e));
    }
  }

  async function renameConversation(id: string, title: string) {    try { await updateConversation(id, { title }); refreshConversations(); } catch (e) { setContextNotice(errorMessage(e)); }
  }
  async function archiveConversation(id: string, archived: boolean) {
    try { await updateConversation(id, { archived }); if (archived && id === activeConversationId) startNewChat(); refreshConversations(); } catch (e) { setContextNotice(errorMessage(e)); }
  }
  async function removeConversation(id: string) {
    if (!window.confirm("Delete this conversation? This removes it from your history.")) return;
    try { await deleteConversation(id); if (id === activeConversationId) startNewChat(); refreshConversations(); } catch (e) { setContextNotice(errorMessage(e)); }
  }

  async function sendMessage(text: string, options?: { regenerate?: boolean; editIndex?: number | null }) {
    if (isPendingRef.current) return;
    if (!options?.regenerate && !text.trim()) return;
    abortRef.current?.abort();
    const editIndex = options?.editIndex ?? editingIndex;
    let baseTurns = turns;
    let shouldRegenerate = Boolean(options?.regenerate);
    if (editIndex != null) {
      baseTurns = turns.slice(0, editIndex);
      const edited = turns[editIndex];
      if (activeConversationId && edited?.id) {
        try {
          await editUserMessage(activeConversationId, edited.id, text.trim());
          shouldRegenerate = true;
          refreshConversations();
        } catch (e) {
          setContextNotice(errorMessage(e));
          return;
        }
      }
    }
    if (options?.regenerate) {
      const lastAssistant = [...baseTurns].reverse().findIndex(t => t.role === "assistant");
      if (lastAssistant >= 0) baseTurns = baseTurns.slice(0, baseTurns.length - 1 - lastAssistant);
    }
    const content = text.trim();
    const userTurn: Turn = { role: "user", content: content || (baseTurns.filter(t => t.role === "user").slice(-1)[0]?.content ?? ""), createdAt: new Date().toISOString() };
    const historyTurns = shouldRegenerate && editIndex == null ? baseTurns : [...baseTurns, userTurn];
    const messages: ChatMessage[] = historyTurns
      .filter(t => (t.role === "user" || t.role === "assistant") && t.content && !t.error)
      .map(t => ({ role: t.role, content: t.content }));
    if (!messages.length) return;
    const newTurns: Turn[] = [...historyTurns, { role: "assistant", content: "", streaming: true, createdAt: new Date().toISOString() }];
    setTurns(newTurns);
    setInput("");
    setEditingIndex(null);
    setPending(true);
    setActiveTab("engineer");
    const idempotencyKey = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    let conversationId = activeConversationId;
    const updateLast = (patch: Partial<Turn>) => setTurns(prev => {
      const c = [...prev];
      const idx = c.length - 1;
      if (idx >= 0 && c[idx]?.role === "assistant") c[idx] = { ...c[idx], ...patch };
      return c;
    });
    abortRef.current = streamChat({
      messages,
      provider,
      agent: selectedAgent,
      conversationId,
      projectId: selectedProjectId,
      idempotencyKey,
      regenerate: Boolean(options?.regenerate),
    }, {
      onStarted: meta => {
        if (meta.conversation_id) { conversationId = meta.conversation_id; setActiveConversationId(meta.conversation_id); refreshConversations(); }
        if (meta.assistant_message_id) setLastAssistantId(meta.assistant_message_id);
        setContextNotice(meta.provider ? `Streaming via ${meta.provider}` : null);
      },
      onContext: meta => {
        if (meta.project_id) setContextNotice(meta.repository_inspected ? "Project context retrieved from the repository index." : "Project selected, but no indexed files were inspected.");
      },
      onToken: token => setTurns(prev => {
        const c = [...prev];
        const idx = c.length - 1;
        if (idx >= 0 && c[idx]?.role === "assistant" && c[idx]?.streaming) c[idx] = { ...c[idx], content: (c[idx].content || "") + token };
        return c;
      }),
      onDone: meta => {
        updateLast({ streaming: false, meta, status: meta.status || "completed" });
        setPending(false);
        if (meta.assistant_message_id) setLastAssistantId(meta.assistant_message_id);
        refreshConversations();
        refreshTools();
      },
      onInterrupted: (partial, meta) => {
        updateLast({ streaming: false, interrupted: true, content: partial, meta, status: "interrupted" });
        setPending(false);
        refreshConversations();
      },
      onError: (msg, partial) => {
        updateLast({ streaming: false, error: true, content: partial ? `${partial}\n\n⚠️ ${msg}` : msg, status: "failed" });
        setPending(false);
        refreshConversations();
      },
    });
  }

  function handleRegenerate() {
    if (isPendingRef.current || !turns.some(t => t.role === "assistant")) return;
    if (!activeConversationId) {
      const userIndex = [...turns].map(t => t.role).lastIndexOf("user");
      const lastUser = userIndex >= 0 ? turns[userIndex] : null;
      if (lastUser) sendMessage(lastUser.content, { editIndex: userIndex });
      return;
    }
    sendMessage("", { regenerate: true });
  }
  function handleEditTurn(index: number) {
    const turn = turns[index];
    if (!turn || turn.role !== "user") return;
    setEditingIndex(index);
    setInput(turn.content);
  }
  function handleCancel() {
    abortRef.current?.abort();
    if (lastAssistantId) void cancelAssistantGeneration(lastAssistantId).catch(() => {});
    setTurns(prev => {
      const c = [...prev];
      const l = c[c.length - 1];
      if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, interrupted: true, status: "interrupted", content: l.content || "Generation cancelled." };
      return c;
    });
    setPending(false);
    refreshConversations();
  }
  function handleSelectAgent(agentId: string) { const raw = agentId.replace("agent-", ""); setSelectedAgent(raw); setActiveTab("engineer"); sendMessage(`Operate as the ${raw.toUpperCase()} Agent and assist with the current project engineering workflow.`); }
  function handleInvestigateTicket(ticket: TicketItem) { setActiveTab("engineer"); sendMessage(`Investigate ticket ${ticket.id}: "${ticket.title}". Category: ${ticket.category}. Priority: ${ticket.priority}. Symptoms: ${ticket.description}. Provide root-cause analysis and remediation plan.`); }

  const pendingApprovals = approvalsQuery.data?.filter(a => a.status === "pending").length || 0;
  const openIncidents = incidentsQuery.data?.filter(i => i.status !== "resolved").length || 0;
  const notifCount = pendingApprovals + openIncidents;
  const notifications = useMemo(() => {
    const items: Array<{ text: string; tone: "warning" | "error" | "info" }> = [];
    (approvalsQuery.data || []).filter(a => a.status === "pending").slice(0, 4).forEach(a => items.push({ text: `Approval pending: ${a.title}`, tone: "warning" }));
    (incidentsQuery.data || []).filter(i => i.status !== "resolved").slice(0, 4).forEach(i => items.push({ text: `Incident: ${i.title}`, tone: "error" }));
    if (!items.length) items.push({ text: "You're all caught up.", tone: "info" });
    return items;
  }, [approvalsQuery.data, incidentsQuery.data]);

  const dccTabs = new Set<NavTab>(["overview", "projects", "connect", "code", "git", "prs", "cloud", "infra", "build", "history", "monitoring", "incidents", "settings", "knowledge", "analytics"]);
  const initials = (user.full_name || "U").trim().split(/\s+/).map(s => s[0]).slice(0, 2).join("").toUpperCase();
  const sections = Array.from(new Set(NAV.map(n => n.section)));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="hamburger" type="button" aria-label="Open navigation menu" onClick={() => setMobileNavOpen(true)}>☰</button>
          <div className="brand" role="button" tabIndex={0} onClick={() => setActiveTab("overview")} onKeyDown={(e) => e.key === "Enter" && setActiveTab("overview")}>
            <div className="brand-mark">⚡</div>
            <div>
              <div className="brand-text">OpsPilot</div>
              <div className="brand-sub">Engineering command center</div>
            </div>
          </div>
          <nav className="nav-links desktop-only" aria-label="Primary">
            {NAV.filter(n => TOP_NAV_IDS.includes(n.id)).map(item => {
              const badge = item.id === "approvals" ? pendingApprovals : item.id === "incidents" ? openIncidents : 0;
              return (
                <button key={item.id} type="button" className={`nav-link ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)}>
                  <span>{item.label}</span>
                  {badge > 0 && <span className="badge badge-warning" style={{ marginLeft: 6, padding: "2px 7px", fontSize: 11 }}>{badge}</span>}
                </button>
              );
            })}
            <button type="button" className="nav-link" onClick={() => setCmdkOpen(true)} title="Search / navigate (Ctrl+K)">More…</button>
          </nav>
          <div className="topbar-actions">
            <button className="icon-btn" type="button" title="Search (Ctrl+K)" aria-label="Search" onClick={() => setCmdkOpen(true)}>⌕</button>
            <button className="icon-btn" type="button" title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} aria-label="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀️" : "🌙"}</button>
            <button className="icon-btn" type="button" title="Notifications" aria-label="Notifications" onClick={() => { setNotifOpen(v => !v); setProfileOpen(false); }} style={{ position: "relative" }}>
              🔔{notifCount > 0 && <span style={{ position: "absolute", top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 999, background: "var(--error)", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 4px" }}>{notifCount}</span>}
            </button>
            <button className="icon-btn" type="button" title="Account" aria-label="Account menu" onClick={() => { setProfileOpen(v => !v); setNotifOpen(false); }} style={{ width: 36, height: 36, borderRadius: 999, background: "linear-gradient(135deg,var(--indigo),var(--violet))", color: "#fff", border: "none", fontWeight: 700, fontSize: 12 }}>{initials}</button>
          </div>
        </div>
      </header>

      {notifOpen && (
        <div className="dcc-notif-panel" role="dialog" aria-label="Notifications">
          <div className="dcc-notif-head">Notifications</div>
          {notifications.map((n, i) => <div key={i} className="dcc-notif-item"><span className={`badge ${n.tone === "error" ? "badge-error" : n.tone === "warning" ? "badge-warning" : "badge-info"}`} style={{ marginRight: 8 }}>•</span>{n.text}</div>)}
        </div>
      )}
      {profileOpen && (
        <div className="dcc-notif-panel" style={{ width: 280 }} role="dialog" aria-label="Account menu">
          <div className="dcc-notif-head" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: "linear-gradient(135deg,var(--indigo),var(--violet))", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12 }}>{initials}</div>
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.full_name}</div><div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div></div>
          </div>
          <div className="dcc-notif-item">Roles: {user.roles.join(", ") || "None"}</div>
          <div style={{ padding: 10, display: "grid", gap: 8 }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setActiveTab("settings"); setProfileOpen(false); }}>Settings</button>
            <button className="btn btn-danger btn-sm" type="button" onClick={() => { void onSignOut(); }}>Sign out</button>
          </div>
        </div>
      )}

      {mobileNavOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />
          <aside className="mobile-nav" role="dialog" aria-label="Navigation menu">
            <div className="mobile-nav-head">
              <div className="brand"><div className="brand-mark">⚡</div><div className="brand-text">OpsPilot</div></div>
              <button className="icon-btn" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>✕</button>
            </div>
            <button className="mobile-nav-item" type="button" onClick={startNewChat}>+ New task session</button>
            {sections.map(section => (
              <div key={section}>
                <div className="mobile-nav-group">{section}</div>
                {NAV.filter(n => n.section === section).map(item => {
                  const badge = item.id === "approvals" ? pendingApprovals : item.id === "incidents" ? openIncidents : 0;
                  return (
                    <button key={item.id} type="button" className={`mobile-nav-item ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)}>
                      <span style={{ marginRight: 8 }}>{item.icon}</span>{item.label}
                      {badge > 0 && <span className="badge badge-warning" style={{ marginLeft: 8, padding: "2px 7px" }}>{badge}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="mobile-nav-group">Recent conversations</div>
            {(conversationsQuery.data?.items ?? []).length === 0 ? <div className="muted" style={{ fontSize: 13, padding: "4px 8px" }}>No conversations yet</div> : (conversationsQuery.data?.items ?? []).slice(0, 6).map(s => (
              <button key={s.id} type="button" className={`mobile-nav-item ${activeTab === "engineer" && activeConversationId === s.id ? "active" : ""}`} onClick={() => void openConversation(s)}>{s.title}</button>
            ))}
          </aside>
        </>
      )}

      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNavigate={(t) => setActiveTab(t as NavTab)} />

      <main className="app-main">
        {dccTabs.has(activeTab) && (
          <DeveloperCommandCenter tab={activeTab as any} searchQuery={search} onConnectRepo={() => setActiveTab("connect")} onOpenEngineer={() => setActiveTab("engineer")} onSelectProject={(p) => { setSelectedProjectId(p.id); setActiveTab("projects"); }} userName={user.full_name || "User"} />
        )}
        {activeTab === "engineer" && (
          <AIEngineerView
            turns={turns}
            input={input}
            setInput={setInput}
            isPending={isPendingUI}
            onSend={sendMessage}
            onQuickPrompt={text => void sendMessage(text)}
            onCancel={handleCancel}
            conversations={conversationsQuery.data?.items ?? []}
            conversationsLoading={conversationsQuery.isLoading}
            conversationsTotal={conversationsQuery.data?.total ?? 0}
            activeConversationId={activeConversationId}
            onNewConversation={startNewChat}
            onOpenConversation={conv => void openConversation(conv)}
            onRenameConversation={renameConversation}
            onDeleteConversation={removeConversation}
            onArchiveConversation={archiveConversation}
            conversationSearch={conversationSearch}
            setConversationSearch={(v) => { setConversationSearch(v); setConversationPage(1); }}
            conversationPage={conversationPage}
            setConversationPage={setConversationPage}
            conversationsHasMore={conversationsQuery.data?.has_more ?? false}
            showArchived={showArchived}
            setShowArchived={(v) => { setShowArchived(v); setConversationPage(1); }}
            projects={projectsQuery.data ?? []}
            selectedProjectId={selectedProjectId}
            onSelectProject={id => void handleSelectProject(id)}
            toolOps={toolOps}
            onRegenerate={handleRegenerate}
            onEditTurn={handleEditTurn}
            onLoadOlder={() => void loadOlderMessages()}
            hasOlder={hasOlder}
            loadingMessages={loadingMessages}
            contextNotice={contextNotice}
            editingIndex={editingIndex}
            onCancelEdit={() => { setEditingIndex(null); setInput(""); }}
          />
        )}
        {activeTab === "approvals" && <ApprovalsView />}
        {activeTab === "knowledge" && <DocumentsView />}
        {activeTab === "analytics" && <DashboardView />}
        {activeTab === "agents" && <AgentsView onSelectAgent={handleSelectAgent} />}
        {activeTab === "tickets" && <TicketsView onInvestigate={handleInvestigateTicket} />}
      </main>
    </div>
  );
}