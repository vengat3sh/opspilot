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
import DeveloperCommandCenter, { CommandPalette } from "./components/DeveloperCommandCenter";
import DocumentsView from "./components/DocumentsView";
import TicketsView from "./components/TicketsView";

type NavTab =
  | "overview" | "projects" | "connect" | "engineer" | "code" | "git" | "prs"
  | "cloud" | "infra" | "build" | "history" | "monitoring" | "incidents"
  | "approvals" | "knowledge" | "analytics" | "settings" | "agents" | "tickets";

interface Turn { role: "user" | "assistant"; content: string; meta?: StreamMeta; error?: boolean; streaming?: boolean; }
interface ChatSession { id: string; title: string; createdAt: number; turns: Turn[]; }

function loadSavedSessions(): ChatSession[] { try { const raw = localStorage.getItem("opspilot_sessions"); return raw ? JSON.parse(raw) : []; } catch { return []; } }
function saveSessions(sessions: ChatSession[]) { try { localStorage.setItem("opspilot_sessions", JSON.stringify(sessions)); } catch {} }
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
  const [activeTab, setActiveTabState] = useState<NavTab>("overview");
  const [, setTabHistory] = useState<NavTab[]>([]);
  const [, setSelectedProject] = useState<ProjectItem | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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

  const status = useQuery({ queryKey: ["llm-status"], queryFn: getLLMStatus, refetchInterval: 15_000 });
  const approvalsQuery = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, refetchInterval: 15_000 });
  const incidentsQuery = useQuery({ queryKey: ["incidents"], queryFn: () => getIncidents(), refetchInterval: 20_000 });

  useEffect(() => { if (status.data) { if (!status.data.ollama_reachable) setProvider("cloud"); else if (status.data.provider) setProvider(status.data.provider as Provider); } }, [status.data]);
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
  function startNewChat() { abortRef.current?.abort(); setActiveSessionId(null); setTurns([]); setInput(""); setPending(false); setActiveTab("engineer"); }
  function switchSession(session: ChatSession) { abortRef.current?.abort(); setActiveSessionId(session.id); setTurns(session.turns); setInput(""); setPending(false); setActiveTab("engineer"); }
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
            <div className="mobile-nav-group">Recent sessions</div>
            {sessions.length === 0 ? <div className="muted" style={{ fontSize: 13, padding: "4px 8px" }}>No saved sessions</div> : sessions.slice(0, 6).map(s => (
              <button key={s.id} type="button" className={`mobile-nav-item ${activeTab === "engineer" && activeSessionId === s.id ? "active" : ""}`} onClick={() => switchSession(s)}>{s.title}</button>
            ))}
          </aside>
        </>
      )}

      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} onNavigate={(t) => setActiveTab(t as NavTab)} />

      <main className="app-main">
        {dccTabs.has(activeTab) && (
          <DeveloperCommandCenter tab={activeTab as any} searchQuery={search} onConnectRepo={() => setActiveTab("connect")} onOpenEngineer={() => setActiveTab("engineer")} onSelectProject={(p) => { setSelectedProject(p); setActiveTab("projects"); }} userName={user.full_name || "User"} />
        )}
        {activeTab === "engineer" && <AIEngineerView turns={turns} input={input} setInput={setInput} isPending={isPendingUI} onSend={sendMessage} onQuickPrompt={sendMessage} onCancel={() => { abortRef.current?.abort(); setPending(false); setTurns(prev => { const c = [...prev]; const l = c[c.length - 1]; if (l?.streaming) c[c.length - 1] = { ...l, streaming: false, content: l.content || "Generation cancelled." }; return c; }); }} />}
        {activeTab === "approvals" && <ApprovalsView />}
        {activeTab === "knowledge" && <DocumentsView />}
        {activeTab === "analytics" && <DashboardView />}
        {activeTab === "agents" && <AgentsView onSelectAgent={handleSelectAgent} />}
        {activeTab === "tickets" && <TicketsView onInvestigate={handleInvestigateTicket} />}
      </main>
    </div>
  );
}