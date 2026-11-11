import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getApprovals,
  getDashboardMetrics,
  getDeployments,
  getEnvironments,
  getIncidents,
  getProjects,
  type ProjectItem,
} from "../api";

type Tab = "overview" | "projects" | "connect" | "engineer" | "code" | "git" | "prs" | "cloud" | "infra" | "build" | "history" | "monitoring" | "incidents" | "approvals" | "knowledge" | "analytics" | "settings";

function StatCard({ label, value, sub, tone = "default" }: { label: string; value: string | number; sub: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className={`dcc-stat ${tone}`}>
      <div className="dcc-stat-label">{label}</div>
      <div className="dcc-stat-value">{value}</div>
      <div className="dcc-stat-sub">{sub}</div>
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dcc-panel">
      <div className="dcc-panel-head">
        <h3>{title}</h3>
        {right}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function CommandPalette({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (t: Tab) => void }) {
  const [q, setQ] = useState("");
  const items: { label: string; tab: Tab }[] = [
    ["Overview", "overview"], ["My Projects", "projects"], ["Connect Repository", "connect"], ["AI Engineer", "engineer"],
    ["Code Changes", "code"], ["Git Operations", "git"], ["Pull Requests", "prs"], ["Cloud Environments", "cloud"],
    ["Infrastructure", "infra"], ["Build & Deploy", "build"], ["Deployment History", "history"], ["Monitoring", "monitoring"],
    ["Incidents", "incidents"], ["Approvals", "approvals"], ["AI Knowledge", "knowledge"], ["Analytics", "analytics"], ["Settings", "settings"],
  ].map(([label, tab]) => ({ label: label as string, tab: tab as Tab }));
  const filtered = items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
  if (!open) return null;
  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input autoFocus className="cmdk-input" placeholder="Search pages, projects, actions..." value={q} onChange={e => setQ(e.target.value)} />
        <div className="cmdk-list">
          {filtered.map(i => (
            <button key={i.tab} className="cmdk-item" onClick={() => { onNavigate(i.tab); onClose(); setQ(""); }}>
              <span>{i.label}</span><span className="cmdk-hint">Go</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="cmdk-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}

export function TopNav({
  search, setSearch, onOpenCmdk, notifCount, onNotif, onProfile, profileOpen,
}: {
  search: string; setSearch: (v: string) => void; onOpenCmdk: () => void; notifCount: number; onNotif: () => void; onProfile: () => void; profileOpen: boolean;
}) {
  return (
    <div className="dcc-topnav">
      <div className="dcc-search-wrap">
        <input className="dcc-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, tasks, deployments, docs..." />
        <button className="dcc-kbd" onClick={onOpenCmdk} type="button">Ctrl K</button>
      </div>
      <div className="dcc-top-actions">
        <button className="dcc-icon-btn" onClick={onNotif} type="button" title="Notifications">🔔 {notifCount > 0 && <span className="dcc-notif-dot">{notifCount}</span>}</button>
        <div style={{ position: "relative" }}>
          <button className="dcc-user-btn" onClick={onProfile} type="button"><span className="dcc-avatar">V</span><span>Vengatesh</span></button>
          {profileOpen && (
            <div className="dcc-menu">
              <button type="button">Profile</button>
              <button type="button">Account settings</button>
              <button type="button">Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeveloperCommandCenter({
  tab, onSelectProject, onOpenEngineer, onConnectRepo, searchQuery,
}: {
  tab: Tab; onSelectProject: (p: ProjectItem) => void; onOpenEngineer: () => void; onConnectRepo: () => void; searchQuery: string;
}) {
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: getProjects, staleTime: 30_000 });
  const metricsQ = useQuery({ queryKey: ["dashboard-metrics"], queryFn: getDashboardMetrics, staleTime: 15_000 });
  const deploymentsQ = useQuery({ queryKey: ["deployments"], queryFn: () => getDeployments(), staleTime: 20_000 });
  const envsQ = useQuery({ queryKey: ["environments"], queryFn: () => getEnvironments(), staleTime: 30_000 });
  const incidentsQ = useQuery({ queryKey: ["incidents"], queryFn: () => getIncidents(), staleTime: 20_000 });
  const approvalsQ = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, staleTime: 15_000 });

  const projects = projectsQ.data || [];
  const deployments = deploymentsQ.data || [];
  const envs = envsQ.data || [];
  const incidents = incidentsQ.data || [];
  const approvals = approvalsQ.data || [];
  const metrics = metricsQ.data;
  const q = searchQuery.trim().toLowerCase();
  const filteredProjects = q ? projects.filter(p => [p.name, p.repo_url, p.framework, p.language].join(" ").toLowerCase().includes(q)) : projects;

  const successfulDeployments = deployments.filter(d => d.status.toLowerCase() === "successful").length;
  const activeDeployments = deployments.filter(d => ["queued", "building", "deploying", "verifying"].some(s => d.status.toLowerCase().includes(s))).length;

  if (tab === "projects") {
    return (
      <div className="dcc-page">
        <div className="dcc-page-head"><h2>My Projects</h2><button className="dcc-btn primary" onClick={onConnectRepo}>Connect Repository</button></div>
        <Panel title="Connected projects">
          {projectsQ.isLoading ? <div className="dcc-muted">Loading projects...</div> : projectsQ.isError ? <div className="dcc-empty">Unable to load projects. Check backend API connectivity.</div> : filteredProjects.length === 0 ? <div className="dcc-empty">No projects connected yet. Connect a repository to start analysis, engineering, and deployments.</div> : (
            <div className="dcc-project-grid">
              {filteredProjects.map(p => (
                <button key={p.id} className="dcc-project-card" onClick={() => onSelectProject(p)}>
                  <div className="dcc-project-top"><strong>{p.name}</strong><span className={`dcc-pill ${p.health}`}>{p.health}</span></div>
                  <div className="dcc-project-meta">{p.framework} • {p.language}</div>
                  <div className="dcc-project-meta">{p.repo_url}</div>
                  <div className="dcc-project-stats"><span>{p.environments} envs</span><span>{p.open_prs} PRs</span><span>{p.pending_changes} changes</span></div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "connect") {
    return (
      <div className="dcc-page">
        <div className="dcc-page-head"><h2>Connect Repository</h2></div>
        <Panel title="Repository connection workflow">
          <div className="dcc-steps">
            {["Authenticate with GitHub (OAuth/App)", "Select repository & branch", "Validate permissions and clone metadata", "Analyze architecture and index codebase", "Configure build/test/deploy settings"].map((s, i) => (
              <div key={s} className="dcc-step"><span className="dcc-step-num">{i + 1}</span><span>{s}</span></div>
            ))}
          </div>
          <div className="dcc-form-grid">
            <label>Provider<select defaultValue="github"><option>GitHub</option><option disabled>GitLab (coming soon)</option><option disabled>Bitbucket (coming soon)</option></select></label>
            <label>Repository URL<input placeholder="https://github.com/owner/repo" /></label>
            <label>Default branch<input defaultValue="main" /></label>
            <label>Project name<input placeholder="my-project" /></label>
          </div>
          <div className="dcc-actions"><button className="dcc-btn primary" type="button">Start connection</button><span className="dcc-muted">GitHub App/OAuth integration required for real connection. No credentials are exposed to the frontend.</span></div>
        </Panel>
      </div>
    );
  }

  if (tab === "code") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Code Changes</h2></div>
        <Panel title="Diff viewer" right={<button className="dcc-btn" onClick={onOpenEngineer}>Open in AI Engineer</button>}>
          <pre className="dcc-code">{`--- a/backend/app/main.py\n+++ b/backend/app/main.py\n@@ Proposed (review required) @@\n+ # Connect a project task to generate real diffs from sandbox workspace\n+ # Current state: awaiting active engineering task / sandbox execution\n\nNo real diff loaded. Start or select an engineering task to view actual file changes.`}</pre>
          <div className="dcc-muted" style={{ marginTop: 8 }}>Displays real diffs from git/sandbox task results when available. No placeholder production changes are shown.</div>
        </Panel>
      </div>
    );
  }

  if (tab === "git") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Git Operations</h2></div>
        <Panel title="Repository actions">
          <div className="dcc-grid-2">
            <div className="dcc-card-lite"><strong>Current branch</strong><div className="dcc-muted">main (read-only default)</div></div>
            <div className="dcc-card-lite"><strong>Working tree</strong><div className="dcc-muted">No active sandbox branch. Create a task to generate isolated changes.</div></div>
            <div className="dcc-card-lite"><strong>Recent commits</strong><div className="dcc-muted">Fetched from connected repository after sync.</div></div>
            <div className="dcc-card-lite"><strong>Actions (approval-gated)</strong><div className="dcc-muted">Create branch, commit, push, compare — enabled when project repo and permissions are configured.</div></div>
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "prs") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Pull Requests</h2></div>
        <Panel title="Pull request workflow">
          <div className="dcc-empty">No pull requests loaded. Connect a GitHub repository/project to list PRs, review checks, and create PRs from approved AI-generated branches.</div>
        </Panel>
      </div>
    );
  }

  if (tab === "cloud") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Cloud Environments</h2></div>
        <Panel title="Configured environments">
          {envsQ.isLoading ? <div className="dcc-muted">Loading environments...</div> : envsQ.isError ? <div className="dcc-empty">Unable to load environments. Check backend API connectivity.</div> : envs.length === 0 ? <div className="dcc-empty">No environments configured.</div> : (
            <div className="dcc-list">
              {envs.map(e => (
                <div key={e.id} className="dcc-row">
                  <div><strong>{e.name}</strong> <span className="dcc-muted">• {e.provider} • {e.branch}</span><div className="dcc-muted">{e.url || "No URL assigned"}</div></div>
                  <span className={`dcc-pill ${e.status === "healthy" || e.status === "running" ? "healthy" : e.status === "degraded" ? "degraded" : ""}`}>{e.status}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "infra") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Infrastructure</h2></div>
        <Panel title="Infrastructure as Code & provisioning">
          <div className="dcc-grid-2">
            <div className="dcc-card-lite"><strong>IaC engine</strong><div className="dcc-muted">Terraform/OpenTofu adapter (provider integration required)</div></div>
            <div className="dcc-card-lite"><strong>Plan status</strong><div className="dcc-muted">No active plan. Generate a plan before apply.</div></div>
            <div className="dcc-card-lite"><strong>Cost estimate</strong><div className="dcc-muted">Unavailable until provider/resource plan is generated.</div></div>
            <div className="dcc-card-lite"><strong>Safety</strong><div className="dcc-muted">Provision/apply/destroy actions require explicit approval and audit logging.</div></div>
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "build" || tab === "history") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>{tab === "build" ? "Build & Deploy" : "Deployment History"}</h2></div>
        <Panel title={tab === "build" ? "Deployment pipeline" : "Recent deployments"}>
          {deploymentsQ.isLoading ? <div className="dcc-muted">Loading deployments...</div> : deploymentsQ.isError ? <div className="dcc-empty">Unable to load deployments. Check backend API connectivity.</div> : deployments.length === 0 ? <div className="dcc-empty">No deployments found.</div> : (
            <div className="dcc-list">
              {deployments.map(d => (
                <div key={d.id} className="dcc-row">
                  <div>
                    <strong>{d.project_id}</strong> <span className="dcc-muted">• {d.environment} • {d.branch} • {d.commit}</span>
                    <div className="dcc-muted">{d.summary}</div>
                    <div className="dcc-muted" style={{ fontSize: 11 }}>{d.created_at}{d.url ? ` • ${d.url}` : ""}</div>
                  </div>
                  <span className={`dcc-pill ${d.status.toLowerCase().includes("success") ? "healthy" : d.status.toLowerCase().includes("fail") ? "critical" : d.status.toLowerCase().includes("queue") ? "warn" : ""}`}>{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "monitoring") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Monitoring</h2></div>
        <div className="dcc-grid-2">
          <Panel title="System Monitor">
            <div className="dcc-kv"><span>System health</span><strong>{metrics?.system_health || "unknown"}</strong></div>
            <div className="dcc-kv"><span>Avg response latency</span><strong>{metrics ? `${metrics.avg_latency_ms} ms` : "—"}</strong></div>
            <div className="dcc-kv"><span>Active model</span><strong>{metrics?.active_model || "—"}</strong></div>
            <div className="dcc-kv"><span>Open incidents</span><strong>{incidents.filter(i => i.status !== "resolved").length}</strong></div>
          </Panel>
          <Panel title="Service checks"><div className="dcc-empty">Connect environment health endpoints and provider telemetry APIs to display live uptime, error rates, and resource usage.</div></Panel>
        </div>
      </div>
    );
  }

  if (tab === "incidents") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Incidents</h2></div>
        <Panel title="Incident management">
          {incidentsQ.isLoading ? <div className="dcc-muted">Loading incidents...</div> : incidentsQ.isError ? <div className="dcc-empty">Unable to load incidents. Check backend API connectivity.</div> : incidents.length === 0 ? <div className="dcc-empty">No incidents reported.</div> : (
            <div className="dcc-list">{incidents.map(i => (
              <div key={i.id} className="dcc-row">
                <div><strong>{i.title}</strong> <span className={`dcc-pill ${i.severity}`}>{i.severity}</span><div className="dcc-muted">{i.service} • {i.detected_at} • {i.status}</div><div className="dcc-muted" style={{ marginTop: 4 }}>{i.summary}</div><div className="dcc-reco"><strong>Recommendation:</strong> {i.recommendation}</div></div>
              </div>
            ))}</div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "approvals") {
    return (
      <div className="dcc-page"><div className="dcc-page-head"><h2>Approvals</h2></div>
        <Panel title="Approval queue">
          {approvalsQ.isLoading ? <div className="dcc-muted">Loading approvals...</div> : approvalsQ.isError ? <div className="dcc-empty">Unable to load approvals. Check backend API connectivity.</div> : approvals.length === 0 ? <div className="dcc-empty">No approvals pending.</div> : (
            <div className="dcc-list">{approvals.map(a => (
              <div key={a.id} className="dcc-row"><div><strong>{a.title}</strong><div className="dcc-muted">{a.details}</div><div className="dcc-muted">{a.requested_by} • {a.timestamp}</div></div><span className={`dcc-pill ${a.risk_level}`}>{a.status}</span></div>
            ))}</div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "knowledge") {
    return <div className="dcc-page"><div className="dcc-page-head"><h2>AI Knowledge</h2></div><Panel title="Project & enterprise knowledge"><div className="dcc-empty">Knowledge base and repository intelligence indexing will appear here. Use Document Intelligence Center and connected project analysis for current available data.</div></Panel></div>;
  }
  if (tab === "analytics") {
    return <div className="dcc-page"><div className="dcc-page-head"><h2>Analytics</h2></div><Panel title="Engineering & operations analytics"><div className="dcc-grid-2"><div className="dcc-card-lite"><strong>Queries</strong><div>{metrics?.total_queries ?? "—"}</div></div><div className="dcc-card-lite"><strong>Agent executions</strong><div>{metrics?.agent_executions ?? "—"}</div></div><div className="dcc-card-lite"><strong>Token consumption</strong><div>{metrics?.token_consumption?.toLocaleString() ?? "—"}</div></div><div className="dcc-card-lite"><strong>Estimated cost</strong><div>{metrics?.estimated_api_cost ?? "—"}</div></div></div></Panel></div>;
  }
  if (tab === "settings") {
    return <div className="dcc-page"><div className="dcc-page-head"><h2>Settings</h2></div><Panel title="Workspace settings"><div className="dcc-grid-2"><div className="dcc-card-lite"><strong>Theme</strong><div className="dcc-muted">Dark command center theme enabled. Light theme toggle can be added via preferences.</div></div><div className="dcc-card-lite"><strong>Integrations</strong><div className="dcc-muted">GitHub, cloud providers, and secrets management require secure backend configuration.</div></div><div className="dcc-card-lite"><strong>Security</strong><div className="dcc-muted">RBAC, audit logs, and approval gates enforced for consequential actions.</div></div><div className="dcc-card-lite"><strong>Environment</strong><div className="dcc-muted">Configure via backend .env (never expose secrets in frontend).</div></div></div></Panel></div>;
  }

  // Overview / default command center
  return (
    <div className="dcc-page dcc-overview">
      <div className="dcc-banner">
        <div>
          <div className="dcc-banner-kicker">OpsPilot 3.0 • Developer Command Center</div>
          <h1>Welcome back, Vengatesh</h1>
          <p>Connect repositories, run AI engineering tasks, manage deployments, and monitor incidents from one secure control plane.</p>
          <div className="dcc-banner-actions">
            <button className="dcc-btn primary" onClick={onConnectRepo}>Connect Repository</button>
            <button className="dcc-btn" onClick={onOpenEngineer}>Open AI Engineer</button>
          </div>
        </div>
        <div className="dcc-banner-status">
          <div><span className="dot green" /> Enterprise Security: Enforced</div>
          <div><span className="dot green" /> Approval gates: Active</div>
          <div><span className="dot green" /> Audit logging: Enabled</div>
        </div>
      </div>

      <div className="dcc-stats-grid">
        <StatCard label="Total Projects" value={projects.length} sub="Connected repositories" />
        <StatCard label="Successful Deployments" value={successfulDeployments} sub="Across all environments" tone="good" />
        <StatCard label="Active Deployments" value={activeDeployments} sub="Queued/building/deploying" tone={activeDeployments > 0 ? "warn" : "default"} />
        <StatCard label="System Health" value={metrics?.system_health || "unknown"} sub={metrics ? `${metrics.avg_latency_ms} ms avg latency` : "Telemetry loading..."} tone={metrics?.system_health === "healthy" ? "good" : "warn"} />
      </div>

      <div className="dcc-main-grid">
        <Panel title="Your Projects" right={<button className="dcc-link" onClick={onConnectRepo}>+ Connect</button>}>
          {projectsQ.isLoading ? <div className="dcc-muted">Loading projects...</div> : filteredProjects.length === 0 ? <div className="dcc-empty">No projects yet. Connect a repository to get started.</div> : (
            <div className="dcc-project-grid compact">
              {filteredProjects.slice(0, 4).map(p => (
                <button key={p.id} className="dcc-project-card" onClick={() => onSelectProject(p)}>
                  <div className="dcc-project-top"><strong>{p.name}</strong><span className={`dcc-pill ${p.health}`}>{p.health}</span></div>
                  <div className="dcc-project-meta">{p.framework}</div>
                  <div className="dcc-project-meta dcc-trunc">{p.repo_url}</div>
                  <div className="dcc-project-stats"><span>{p.environments} envs</span><span>{p.open_prs} PRs</span></div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="AI Engineer Activity" right={<button className="dcc-link" onClick={onOpenEngineer}>Open</button>}>
          <div className="dcc-activity">
            {["Task planning ready for connected projects", "Sandbox execution requires project task initialization", "Code review and diff generation available after changes", "PR/deploy actions are approval-gated"].map((t, i) => (
              <div key={i} className="dcc-activity-row"><span className={`dot ${i === 0 ? "green" : "amber"}`} /><span>{t}</span></div>
            ))}
          </div>
        </Panel>

        <Panel title="Deployment Pipeline">
          <div className="dcc-pipeline">
            {["Queued", "Building", "Testing", "Awaiting Approval", "Deploying", "Verifying"].map((s, i) => (
              <div key={s} className={`dcc-pipe-step ${i < 2 ? "done" : i === 2 ? "active" : ""}`}><span>{i + 1}</span><label>{s}</label></div>
            ))}
          </div>
          <div className="dcc-list" style={{ marginTop: 10 }}>
            {deployments.slice(0, 3).map(d => (
              <div key={d.id} className="dcc-row compact"><div><strong>{d.project_id}</strong> <span className="dcc-muted">• {d.environment} • {d.commit}</span></div><span className={`dcc-pill ${d.status.toLowerCase().includes("success") ? "healthy" : d.status.toLowerCase().includes("fail") ? "critical" : "warn"}`}>{d.status}</span></div>
            ))}
            {deployments.length === 0 && <div className="dcc-muted">No deployment activity yet.</div>}
          </div>
        </Panel>

        <Panel title="Cloud Environments">
          <div className="dcc-list">
            {envs.slice(0, 4).map(e => (
              <div key={e.id} className="dcc-row compact"><div><strong>{e.name}</strong> <span className="dcc-muted">• {e.provider} • {e.project_id}</span></div><span className={`dcc-pill ${e.status === "healthy" || e.status === "running" ? "healthy" : "degraded"}`}>{e.status}</span></div>
            ))}
            {envs.length === 0 && <div className="dcc-muted">No environments configured.</div>}
          </div>
        </Panel>

        <Panel title="System Monitor">
          <div className="dcc-kv"><span>Health</span><strong>{metrics?.system_health || "unknown"}</strong></div>
          <div className="dcc-kv"><span>Latency</span><strong>{metrics ? `${metrics.avg_latency_ms} ms` : "—"}</strong></div>
          <div className="dcc-kv"><span>Open incidents</span><strong>{incidents.filter(i => i.status !== "resolved").length}</strong></div>
          <div className="dcc-kv"><span>Pending approvals</span><strong>{approvals.filter(a => a.status === "pending").length}</strong></div>
        </Panel>

        <Panel title="Enterprise Security">
          <div className="dcc-activity">
            <div className="dcc-activity-row"><span className="dot green" /><span>Secrets redaction & least-privilege access policies</span></div>
            <div className="dcc-activity-row"><span className="dot green" /><span>Approval required for deploy/infra/Git push actions</span></div>
            <div className="dcc-activity-row"><span className="dot green" /><span>Sandboxed execution boundaries for project tasks</span></div>
            <div className="dcc-activity-row"><span className="dot green" /><span>Audit-ready activity and incident tracking</span></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
