import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  adminLogin,
  authLogout,
  authMe,
  errorMessage,
  getApprovals,
  getIncidents,
  getLLMStatus,
  streamChat,
  userLogin,
  userRegister,
  type AuthUser,
  type ChatMessage,
  type ProjectItem,
  type Provider,
  type StreamMeta,
  type TicketItem,
} from "./api";

import AIEngineerView from "./components/AIEngineerView";
import AgentsView from "./components/AgentsView";
import ApprovalsView from "./components/ApprovalsView";
import DashboardView from "./components/DashboardView";
import DocumentsView from "./components/DocumentsView";
import TicketsView from "./components/TicketsView";
import DeveloperCommandCenter, { CommandPalette, TopNav } from "./components/DeveloperCommandCenter";

type NavTab =
  | "overview" | "projects" | "connect" | "engineer" | "code" | "git" | "prs"
  | "cloud" | "infra" | "build" | "history" | "monitoring" | "incidents"
  | "approvals" | "knowledge" | "analytics" | "settings" | "workspace" | "documents" | "agents" | "tickets";

interface Turn { role: "user" | "assistant"; content: string; meta?: StreamMeta; error?: boolean; streaming?: boolean; }
interface ChatSession { id: string; title: string; createdAt: number; turns: Turn[]; }

function loadSavedSessions(): ChatSession[] { try { const raw = localStorage.getItem("opspilot_sessions"); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function saveSessions(sessions: ChatSession[]) { try { localStorage.setItem("opspilot_sessions", JSON.stringify(sessions)); } catch {} }

const NAV: Array<{ id: NavTab; label: string; icon: string; section?: string }> = [
  { id: "overview", label: "Overview", icon: "🏠", section: "Main" },
  { id: "projects", label: "My Projects", icon: "📦", section: "Main" },
  { id: "connect", label: "Connect Repository", icon: "🔗", section: "Main" },
  { id: "engineer", label: "AI Engineer", icon: "🧠", section: "Engineering" },
  { id: "code", label: "Code Changes", icon: "📝", section: "Engineering" },
  { id: "git", label: "Git Operations", icon: "🌿", section: "Engineering" },
  { id: "prs", label: "Pull Requests", icon: "🔀", section: "Engineering" },
  { id: "cloud", label: "Cloud Environments", icon: "☁️", section: "Delivery" },
  { id: "infra", label: "Infrastructure", icon: "🏗️", section: "Delivery" },
  { id: "build", label: "Build & Deploy", icon: "🚀", section: "Delivery" },
  { id: "history", label: "Deployment History", icon: "🕘", section: "Delivery" },
  { id: "monitoring", label: "Monitoring", icon: "📈", section: "Operations" },
  { id: "incidents", label: "Incidents", icon: "🚨", section: "Operations" },
  { id: "approvals", label: "Approvals", icon: "🛡️", section: "Operations" },
  { id: "knowledge", label: "AI Knowledge", icon: "📚", section: "Intelligence" },
  { id: "analytics", label: "Analytics", icon: "📊", section: "Intelligence" },
  { id: "settings", label: "Settings", icon: "⚙️", section: "System" },
];

function AuthGate({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [view, setView] = useState<"choice" | "user-login" | "user-signup" | "admin-login">("choice");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", confirm_password: "", remember_me: false, terms: false });

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
    if (form.password !== form.confirm_password) { setErr("Passwords do not match"); return; }
    if (!form.terms) { setErr("You must accept the terms"); return; }
    setLoading(true);
    try { const res = await userRegister({ full_name: form.full_name, email: form.email, password: form.password, confirm_password: form.confirm_password, terms_accepted: true }); onAuthenticated(res.user); }
    catch (e) { setErr(errorMessage(e)); } finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "radial-gradient(900px 500px at 85% -10%, rgba(99,102,241,.22), transparent 60%), #0b1020", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 520, background: "rgba(15,23,42,.92)", border: "1px solid rgba(148,163,184,.18)", borderRadius: 18, padding: 24, color: "#e2e8f0", boxShadow: "0 20px 50px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>⚡</div>
          <div><div style={{ fontWeight: 800, fontSize: 18 }}>OpsPilot</div><div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: ".06em" }}>SECURE ACCESS</div></div>
        </div>
        {view === "choice" && (
          <>
            <h1 style={{ fontSize: 24, margin: "8px 0 6px" }}>Sign in to continue</h1>
            <p style={{ color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>Choose your account type to access the appropriate dashboard and permissions.</p>
            <div style={{ display: "grid", gap: 10 }}>
              <button onClick={() => { setView("user-login"); setErr(null); }} style={{ padding: 14, borderRadius: 12, border: "1px solid rgba(99,102,241,.35)", background: "rgba(99,102,241,.18)", color: "#fff", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontWeight: 700 }}>User Login</div><div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>Access developer workspace, projects, AI engineer, deployments</div>
              </button>
              <button onClick={() => { setView("admin-login"); setErr(null); }} style={{ padding: 14, borderRadius: 12, border: "1px solid rgba(148,163,184,.25)", background: "rgba(30,41,59,.55)", color: "#fff", textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontWeight: 700 }}>Admin Login</div><div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>Access admin dashboard, user management, audit logs, platform controls</div>
              </button>
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: "#94a3b8" }}>New user? <button onClick={() => { setView("user-signup"); setErr(null); }} style={{ background: "none", border: "none", color: "#a5b4fc", cursor: "pointer", padding: 0 }}>Create an account</button></div>
          </>
        )}
        {(view === "user-login" || view === "admin-login") && (
          <form onSubmit={view === "user-login" ? submitUserLogin : submitAdminLogin}>
            <h2 style={{ fontSize: 22, margin: "8px 0 4px" }}>{view === "admin-login" ? "Admin Login" : "User Login"}</h2>
            <p style={{ color: "#94a3b8", marginBottom: 14, fontSize: 13 }}>{view === "admin-login" ? "Authorized administrators only." : "Sign in to your OpsPilot workspace."}</p>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Email<input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Password<input required type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={form.remember_me} onChange={e => setForm(f => ({ ...f, remember_me: e.target.checked }))} /> Remember me</label>
            </div>
            {err && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 13 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setView("choice")} style={secondaryBtnStyle}>Back</button>
              <button disabled={loading} type="submit" style={primaryBtnStyle}>{loading ? "Signing in..." : "Sign in"}</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Forgot password and OAuth flows are available after backend email/OAuth configuration.</div>
          </form>
        )}
        {view === "user-signup" && (
          <form onSubmit={submitUserSignup}>
            <h2 style={{ fontSize: 22, margin: "8px 0 4px" }}>Create user account</h2>
            <p style={{ color: "#94a3b8", marginBottom: 14, fontSize: 13 }}>Public signup creates a standard user account (no admin privileges).</p>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Full name<input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Email<input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Password<input required type="password" minLength={8} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#94a3b8" }}>Confirm password<input required type="password" minLength={8} value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} style={inputStyle} /></label>
              <label style={{ fontSize: 12, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={form.terms} onChange={e => setForm(f => ({ ...f, terms: e.target.checked }))} /> I accept the terms</label>
            </div>
            {err && <div style={{ marginTop: 10, color: "#fca5a5", fontSize: 13 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setView("choice")} style={secondaryBtnStyle}>Back</button>
              <button disabled={loading} type="submit" style={primaryBtnStyle}>{loading ? "Creating..." : "Create account"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", marginTop: 4, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.22)", background: "rgba(15,23,42,.7)", color: "#e2e8f0" };
const primaryBtnStyle: React.CSSProperties = { flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(129,140,248,.45)", background: "linear-gradient(135deg,#6366f1,#4f46e5)", color: "#fff", fontWeight: 700, cursor: "pointer" };
const secondaryBtnStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.22)", background: "rgba(255,255,255,.04)", color: "#e2e8f0", fontWeight: 600, cursor: "pointer" };

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    authMe().then(res => { if (mounted) setCurrentUser(res.user); }).catch(() => {}).finally(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (authLoading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1020", color: "#cbd5e1" }}>Loading secure session...</div>;
  }
  if (!currentUser) {
    return <AuthGate onAuthenticated={setCurrentUser} />;
  }
  return <AuthenticatedApp user={currentUser} onSignOut={async () => { try { await authLogout(); } catch {} setCurrentUser(null); }} />;
}

function AuthenticatedApp({ user, onSignOut }: { user: AuthUser; onSignOut: () => Promise<void> }) {
  const [activeTab, setActiveTabState] = useState<NavTab>("overview");
  const [tabHistory, setTabHistory] = useState<NavTab[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("cloud");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const isPendingRef = useRef(false);
  const [isPendingUI, setIsPendingUI] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const status = useQuery({ queryKey: ["llm-status"], queryFn: getLLMStatus, refetchInterval: 15_000 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, refetchInterval: 15_000 });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: () => getIncidents(), refetchInterval: 20_000 });

  useEffect(() => { if (status.data) { if (!status.data.ollama_reachable) setProvider("cloud"); else if (status.data.provider) setProvider(status.data.provider as Provider); } }, [status.data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdkOpen(v => !v); }
      if (e.key === "Escape") { setCmdkOpen(false); setNotifOpen(false); setProfileOpen(false); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  function setActiveTab(next: NavTab) { setActiveTabState(prev => { if (prev !== next) setTabHistory(h => [...h, prev].slice(-12)); return next; }); setSidebarOpen(false); }
  function goBack() { setTabHistory(h => { if (!h.length) { setActiveTabState("overview"); return h; } const prev = h[h.length - 1]; setActiveTabState(prev); return h.slice(0, -1); }); }
  function setPending(v: boolean) { isPendingRef.current = v; setIsPendingUI(v); }
  function startNewChat() { abortRef.current?.abort(); setActiveSessionId(null); setTurns([]); setInput(""); setPending(false); setActiveTab("engineer"); }
  function switchSession(session: ChatSession) { abortRef.current?.abort(); setActiveSessionId(session.id); setTurns(session.turns); setInput(""); setPending(false); setActiveTab("engineer"); }
  function deleteSession(e: React.MouseEvent, id: string) { e.stopPropagation(); setSessions(prev => { const next = prev.filter(s => s.id !== id); saveSessions(next); return next; }); if (activeSessionId === id) startNewChat(); }
  function updateSavedHistory(updatedTurns: Turn[], promptText?: string) {
    setSessions(prev => {
      let currentId = activeSessionId; let list = [...prev];
      if (!currentId) { currentId = Date.now().toString(); setActiveSessionId(currentId); const title = promptText ? (promptText.slice(0, 34) + (promptText.length > 34 ? "..." : "")) : "Task session"; list.unshift({ id: currentId, title, createdAt: Date.now(), turns: updatedTurns }); }
      else { const idx = list.findIndex(s => s.id === currentId); if (idx !== -1) list[idx] = { ...list[idx], turns: updatedTurns }; }
      saveSessions(list); return list;
    });
  }
  function sendMessage(text: string) {
    if (!text.trim() || isPendingRef.current) return;
    abortRef.current?.abort();
    const messages: ChatMessage[] = [...turns.filter(t => !t.error).map(({ role, content }) => ({ role, content })), { role: "user" as const, content: text.trim() }];
    const newTurns: Turn[] = [...turns, { role: "user", content: text.trim() }, { role: "assistant", content: "", streaming: true }];
    setTurns(newTurns); updateSavedHistory(newTurns, text.trim()); setInput(""); setPending(true); setActiveTab("engineer");
    abortRef.current = streamChat(messages, provider, selectedAgent,
      token => setTurns(prev => { const c = [...prev], l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { ...l, content: l.content + token }; return c; }),
      meta => { setTurns(prev => { const c = [...prev], l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, meta }; updateSavedHistory(c); return c; }); setPending(false); },
      msg => { setTurns(prev => { const c = [...prev], l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { role: "assistant", content: msg, error: true }; updateSavedHistory(c); return c; }); setPending(false); },
    );
  }
  function handleSelectAgent(agentId: string) { const raw = agentId.replace("agent-", ""); setSelectedAgent(raw); setActiveTab("engineer"); sendMessage(`Operate as the ${raw.toUpperCase()} Agent and assist with the current project engineering workflow.`); }
  function handleInvestigateTicket(ticket: TicketItem) { setActiveTab("engineer"); sendMessage(`Investigate ticket ${ticket.id}: "${ticket.title}". Category: ${ticket.category}. Priority: ${ticket.priority}. Symptoms: ${ticket.description}. Provide root-cause analysis and remediation plan.`); }

  const pendingApprovals = approvalsQuery.data?.filter(a => a.status === "pending").length || 0;
  const openIncidents = incidentsQuery.data?.filter(i => i.status !== "resolved").length || 0;
  const notifCount = pendingApprovals + openIncidents;
  const notifications = useMemo(() => {
    const items: string[] = [];
    (approvalsQuery.data || []).filter(a => a.status === "pending").slice(0, 4).forEach(a => items.push(`Approval pending: ${a.title}`));
    (incidentsQuery.data || []).filter(i => i.status !== "resolved").slice(0, 4).forEach(i => items.push(`Incident: ${i.title}`));
    if (!items.length) items.push("No new notifications");
    return items;
  }, [approvalsQuery.data, incidentsQuery.data]);

  const dccTabs = new Set(["overview", "projects", "connect", "code", "git", "prs", "cloud", "infra", "build", "history", "monitoring", "incidents", "settings"]);
  let section = "";
  const titleMap: Record<string, string> = { overview: "Developer Command Center", projects: "My Projects", connect: "Connect Repository", engineer: "AI Engineer", code: "Code Changes", git: "Git Operations", prs: "Pull Requests", cloud: "Cloud Environments", infra: "Infrastructure", build: "Build & Deploy", history: "Deployment History", monitoring: "Monitoring", incidents: "Incidents", approvals: "Approvals", knowledge: "AI Knowledge", analytics: "Analytics", settings: "Settings" };

  return (
    <div className="app-container dcc-theme">
      <div className={`mobile-overlay ${sidebarOpen ? "open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-header-left"><div className="brand-icon">⚡</div><div><div className="brand-name">OpsPilot</div><span className="brand-tag">3.0 DEV COMMAND CENTER</span></div></div>
          <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} type="button">✕</button>
        </div>
        <div className="sidebar-content">
          {NAV.map(item => {
            const showSection = item.section && item.section !== section;
            if (item.section) section = item.section;
            const badge = item.id === "approvals" ? pendingApprovals : item.id === "incidents" ? openIncidents : 0;
            return (
              <div key={item.id}>
                {showSection && <div className="section-label" style={{ marginTop: 10 }}>{item.section}</div>}
                <button className={`nav-tab ${activeTab === item.id ? "active" : ""}`} onClick={() => setActiveTab(item.id)} type="button">
                  <div className="nav-tab-left"><span className="nav-tab-icon">{item.icon}</span><span>{item.label}</span></div>
                  {badge > 0 && <span className={`tab-badge ${item.id === "incidents" ? "highlight" : ""}`}>{badge}</span>}
                </button>
              </div>
            );
          })}
          <div className="section-label" style={{ marginTop: 14 }}>Task Sessions</div>
          <button className="new-chat-btn" onClick={startNewChat} type="button">+ New Task Session</button>
          <div className="history-list">
            {sessions.length === 0 ? <div style={{ padding: "6px 8px", fontSize: 11.5, color: "#64748b" }}>No saved sessions</div> : sessions.map(s => (
              <button key={s.id} className={`history-item ${activeTab === "engineer" && activeSessionId === s.id ? "active" : ""}`} onClick={() => switchSession(s)} type="button">
                <span className="history-title">{s.title}</span>
                <span className="history-del-btn" onClick={e => deleteSession(e, s.id)}>🗑</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-footer">OpsPilot v3.0 • {selectedProject ? `Project: ${selectedProject.name}` : user.full_name}</div>
      </aside>

      <main className="app-main">
        <header className="chat-navbar dcc-navbar">
          <div className="navbar-left">
            <button className="nav-icon-btn" onClick={goBack} type="button" title="Go back" disabled={tabHistory.length === 0} style={tabHistory.length === 0 ? { opacity: 0.45 } : undefined}>←</button>
            <button className="nav-icon-btn" onClick={() => setSidebarOpen(true)} type="button" title="Open navigation">☰</button>
            <button className="nav-icon-btn" onClick={() => setSidebarOpen(false)} type="button" title="Close navigation">✕</button>
            <span className="nav-active-pill">{titleMap[activeTab] || "OpsPilot"}</span>
          </div>
          <TopNav search={search} setSearch={setSearch} onOpenCmdk={() => setCmdkOpen(true)} notifCount={notifCount} onNotif={() => { setNotifOpen(v => !v); setProfileOpen(false); }} onProfile={() => { setProfileOpen(v => !v); setNotifOpen(false); }} profileOpen={profileOpen} userName={user.full_name || "User"} />
        </header>

        {notifOpen && (
          <div className="dcc-notif-panel"><div className="dcc-notif-head">Notifications</div>{notifications.map((n, i) => <div key={i} className="dcc-notif-item">{n}</div>)}</div>
        )}
        {profileOpen && (
          <div className="dcc-notif-panel" style={{ right: 16, width: 260 }}>
            <div className="dcc-notif-head">{user.full_name}</div>
            <div className="dcc-notif-item">{user.email}</div>
            <div className="dcc-notif-item">Roles: {user.roles.join(", ") || "None"}</div>
            <button className="dcc-btn" style={{ margin: 10, width: "calc(100% - 20px)" }} onClick={() => { void onSignOut(); }}>Sign out</button>
          </div>
        )}

        <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNavigate={(t) => setActiveTab(t as NavTab)} />

        {dccTabs.has(activeTab) && (
          <DeveloperCommandCenter tab={activeTab as any} searchQuery={search} onConnectRepo={() => setActiveTab("connect")} onOpenEngineer={() => setActiveTab("engineer")} onSelectProject={(p) => { setSelectedProject(p); setActiveTab("projects"); }} userName={user.full_name || "User"} />
        )}
        {activeTab === "engineer" && <AIEngineerView turns={turns} input={input} setInput={setInput} isPending={isPendingUI} onSend={sendMessage} onQuickPrompt={sendMessage} onCancel={() => { abortRef.current?.abort(); setPending(false); setTurns(prev => { const c = [...prev]; const l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, content: l.content || "Generation cancelled." }; return c; }); }} />}
        {activeTab === "knowledge" && <DocumentsView />}
        {activeTab === "approvals" && <ApprovalsView />}
        {activeTab === "analytics" && <DashboardView />}
        {activeTab === "agents" && <AgentsView onSelectAgent={handleSelectAgent} />}
        {activeTab === "tickets" && <TicketsView onInvestigate={handleInvestigateTicket} />}
      </main>
    </div>
  );
}
