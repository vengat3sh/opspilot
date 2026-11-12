import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProject,
  errorMessage,
  getApprovals,
  getDashboardMetrics,
  getDeployments,
  getEnvironments,
  getIncidents,
  getProjects,
  type ProjectItem,
} from "../api";

type Tab = "overview" | "projects" | "connect" | "engineer" | "code" | "git" | "prs" | "cloud" | "infra" | "build" | "history" | "monitoring" | "incidents" | "approvals" | "knowledge" | "analytics" | "settings";

function StatCard({ label, value, sub, tone = "neutral" }: { label: string; value: string | number; sub: string; tone?: "neutral" | "success" | "warning" | "error" }) {
  const toneClass = tone === "success" ? "badge-success" : tone === "warning" ? "badge-warning" : tone === "error" ? "badge-error" : "badge-info";
  return (
    <div className="card card-pad">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div className="metric-label">{label}</div>
        <span className={`badge ${toneClass}`}>{tone === "success" ? "Healthy" : tone === "warning" ? "Attention" : tone === "error" ? "Critical" : "Live"}</span>
      </div>
      <div className="metric-value" style={{ marginTop: 8 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <div className="row-between" style={{ marginBottom: 14, alignItems: "center" }}>
        <h3 className="section-title" style={{ margin: 0 }}>{title}</h3>
        {right}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function CommandPalette({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (t: Tab) => void }) {
  const [q, setQ] = useState("");
  const items: { label: string; tab: Tab; desc: string }[] = [
    { label: "Overview", tab: "overview", desc: "Command center home" },
    { label: "My Projects", tab: "projects", desc: "Connected repositories" },
    { label: "Connect Repository", tab: "connect", desc: "Add a new project" },
    { label: "AI Engineer", tab: "engineer", desc: "Autonomous engineering workspace" },
    { label: "Code Changes", tab: "code", desc: "Diffs and proposed edits" },
    { label: "Git Operations", tab: "git", desc: "Branches and commits" },
    { label: "Pull Requests", tab: "prs", desc: "Review and PR workflow" },
    { label: "Cloud Environments", tab: "cloud", desc: "Environment status" },
    { label: "Infrastructure", tab: "infra", desc: "IaC and provisioning" },
    { label: "Build & Deploy", tab: "build", desc: "Pipelines and releases" },
    { label: "Deployment History", tab: "history", desc: "Past deployments" },
    { label: "Monitoring", tab: "monitoring", desc: "Health and telemetry" },
    { label: "Incidents", tab: "incidents", desc: "Incident response" },
    { label: "Approvals", tab: "approvals", desc: "Human-in-the-loop queue" },
    { label: "AI Knowledge", tab: "knowledge", desc: "Documents and RAG" },
    { label: "Analytics", tab: "analytics", desc: "Usage and metrics" },
    { label: "Settings", tab: "settings", desc: "Workspace preferences" },
  ];
  const filtered = items.filter(i => `${i.label} ${i.desc}`.toLowerCase().includes(q.toLowerCase()));
  if (!open) return null;
  return (
    <div className="cmdk-backdrop" onClick={onClose} role="presentation">
      <div className="cmdk" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <input autoFocus className="input" placeholder="Search pages and actions… (Esc to close)" value={q} onChange={e => setQ(e.target.value)} aria-label="Search navigation" />
        </div>
        <div className="cmdk-list">
          {filtered.map(i => (
            <button key={i.tab} className="cmdk-item" onClick={() => { onNavigate(i.tab); onClose(); setQ(""); }}>
              <span><strong>{i.label}</strong><div className="muted" style={{ fontSize: 12 }}>{i.desc}</div></span>
              <span className="badge badge-neutral">Go</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="muted" style={{ padding: 16 }}>No results found.</div>}
        </div>
      </div>
    </div>
  );
}

export function TopNav() { return null; } // Navigation is handled by App shell header

export default function DeveloperCommandCenter({
  tab, onSelectProject, onOpenEngineer, onConnectRepo, searchQuery, userName = "User",
}: {
  tab: Tab; onSelectProject: (p: ProjectItem) => void; onOpenEngineer: () => void; onConnectRepo: () => void; searchQuery: string; userName?: string;
}) {
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: getProjects, staleTime: 30_000 });
  const metricsQ = useQuery({ queryKey: ["dashboard-metrics"], queryFn: getDashboardMetrics, staleTime: 15_000 });
  const deploymentsQ = useQuery({ queryKey: ["deployments"], queryFn: () => getDeployments(), staleTime: 20_000 });
  const envsQ = useQuery({ queryKey: ["environments"], queryFn: () => getEnvironments(), staleTime: 30_000 });
  const incidentsQ = useQuery({ queryKey: ["incidents"], queryFn: () => getIncidents(), staleTime: 20_000 });
  const approvalsQ = useQuery({ queryKey: ["approvals"], queryFn: getApprovals, staleTime: 15_000 });
  const queryClient = useQueryClient();
  const [connectName, setConnectName] = useState("");
  const [connectUrl, setConnectUrl] = useState("");
  const [connectBranch, setConnectBranch] = useState("main");
  const [connectProvider, setConnectProvider] = useState("local");
  const connectMutation = useMutation({
    mutationFn: () => createProject({
      name: connectName.trim(),
      repo_provider: connectProvider,
      repo_url: connectUrl.trim(),
      default_branch: connectBranch.trim() || "main",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setConnectName("");
      setConnectUrl("");
    },
  });

  const projects = projectsQ.data || [];
  const deployments = deploymentsQ.data || [];
  const envs = envsQ.data || [];
  const incidents = incidentsQ.data || [];
  const approvals = approvalsQ.data || [];
  const metrics = metricsQ.data;
  const q = searchQuery.trim().toLowerCase();
  const filteredProjects = q ? projects.filter(p => [p.name, p.repo_url, p.framework, p.language].join(" ").toLowerCase().includes(q)) : projects;
  const successfulDeployments = deployments.filter(d => d.status.toLowerCase().includes("success")).length;
  const activeDeployments = deployments.filter(d => ["queue", "build", "deploy", "verif"].some(s => d.status.toLowerCase().includes(s))).length;

  const page = (title: string, subtitle: string, actions?: React.ReactNode) => (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>
      {actions && <div className="row" style={{ flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );

  if (tab === "projects") {
    return (
      <div className="view-container">
        {page("My Projects", "Connected repositories, environments, and delivery status.", <button className="btn btn-primary" onClick={onConnectRepo}>Connect repository</button>)}
        <Panel title="Connected projects">
          {projectsQ.isLoading ? <div className="muted">Loading projects…</div> : projectsQ.isError ? <div className="empty-state">Unable to load projects. Check backend API connectivity.</div> : filteredProjects.length === 0 ? <div className="empty-state">No projects connected yet. Connect a repository to start analysis, engineering, and deployments.</div> : (
            <div className="grid grid-3">
              {filteredProjects.map(p => (
                <button key={p.id} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", width: "100%" }} onClick={() => onSelectProject(p)}>
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 16 }}>{p.name}</strong>
                    <span className={`badge ${p.health === "healthy" ? "badge-success" : p.health === "degraded" ? "badge-warning" : "badge-neutral"}`}>{p.health}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>{p.framework} • {p.language}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4, wordBreak: "break-all" }}>{p.repo_url}</div>
                  <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                    <span className="badge badge-neutral">{p.environments} envs</span>
                    <span className="badge badge-info">{p.open_prs} PRs</span>
                    <span className="badge badge-warning">{p.pending_changes} changes</span>
                  </div>
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
      <div className="view-container">
        {page("Connect Repository", "Link a source repository so OpsPilot can analyze, plan, and deploy safely.")}
        <Panel title="Connection workflow">
          <div className="grid grid-2">
            <div className="stack">
              {["Authenticate with your Git provider (OAuth/App)", "Select repository and default branch", "Validate permissions and repository metadata", "Analyze architecture and index codebase", "Configure build, test, and deployment settings"].map((s, i) => (
                <div key={s} className="row" style={{ alignItems: "flex-start" }}>
                  <span className="badge badge-info" style={{ minWidth: 28, justifyContent: "center" }}>{i + 1}</span>
                  <span>{s}</span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>GitHub App/OAuth integration is required for real connections. Credentials are never exposed to the frontend.</p>
            </div>
            <div className="stack">
              <div className="field"><label>Provider</label><select className="select" value={connectProvider} onChange={e => setConnectProvider(e.target.value)}><option value="local">Local workspace</option><option value="github">GitHub</option><option disabled>GitLab (coming soon)</option><option disabled>Bitbucket (coming soon)</option></select></div>
              <div className="field"><label>Repository URL</label><input className="input" placeholder="https://github.com/owner/repo" value={connectUrl} onChange={e => setConnectUrl(e.target.value)} /></div>
              <div className="field"><label>Default branch</label><input className="input" value={connectBranch} onChange={e => setConnectBranch(e.target.value)} /></div>
              <div className="field"><label>Project name</label><input className="input" placeholder="my-project" value={connectName} onChange={e => setConnectName(e.target.value)} /></div>
              {connectMutation.isError && <div className="turn-notice turn-notice-warning">{errorMessage(connectMutation.error)}</div>}
              {connectMutation.isSuccess && <div className="turn-notice turn-notice-info">Project registered. Set <code>PROJECT_WORKSPACE_ROOT</code> and index it to add repository context.</div>}
              <button className="btn btn-primary" type="button" disabled={!connectName.trim() || connectMutation.isPending} onClick={() => connectMutation.mutate()}>
                {connectMutation.isPending ? "Registering…" : "Register project"}
              </button>
              <p className="muted" style={{ fontSize: 12 }}>GitHub App/OAuth, clone, and provider metadata sync are not connected. Registration persists the project record only.</p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (tab === "code") {
    return (
      <div className="view-container">
        {page("Code Changes", "Review proposed diffs from engineering tasks before approval or merge.", <button className="btn btn-secondary" onClick={onOpenEngineer}>Open AI Engineer</button>)}
        <Panel title="Diff viewer">
          <pre className="diff-box" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{`--- a/backend/app/main.py\n+++ b/backend/app/main.py\n@@ Proposed (review required) @@\n+ Connect a project task to generate real diffs from the sandbox workspace.\n\nNo real diff loaded. Start or select an engineering task to view actual file changes.`}</pre>
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Only real diffs from git/sandbox task results are shown when available.</p>
        </Panel>
      </div>
    );
  }

  if (tab === "git") {
    return (
      <div className="view-container">
        {page("Git Operations", "Branch, commit, and push actions are approval-gated and audited.")}
        <div className="grid grid-2">
          <div className="card card-pad"><div className="metric-label">Current branch</div><div style={{ fontWeight: 700, marginTop: 6 }}>main</div><div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Read-only default context</div></div>
          <div className="card card-pad"><div className="metric-label">Working tree</div><div style={{ fontWeight: 700, marginTop: 6 }}>No active sandbox branch</div><div className="muted" style={{ fontSize: 13, marginTop: 4 }}>Create a task to generate isolated changes.</div></div>
          <div className="card card-pad"><div className="metric-label">Recent commits</div><div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Fetched from connected repository after sync.</div></div>
          <div className="card card-pad"><div className="metric-label">Approval-gated actions</div><div className="muted" style={{ fontSize: 13, marginTop: 6 }}>Create branch, commit, push, compare — enabled when project permissions are configured.</div></div>
        </div>
      </div>
    );
  }

  if (tab === "prs") {
    return (
      <div className="view-container">
        {page("Pull Requests", "Review checks and create PRs from approved AI-generated branches.")}
        <Panel title="Pull request workflow"><div className="empty-state">No pull requests loaded. Connect a repository to list PRs, checks, and reviews.</div></Panel>
      </div>
    );
  }

  if (tab === "cloud") {
    return (
      <div className="view-container">
        {page("Cloud Environments", "Track configured environments, health, and deployment targets.")}
        <Panel title="Environments">
          {envsQ.isLoading ? <div className="muted">Loading environments…</div> : envsQ.isError ? <div className="empty-state">Unable to load environments. Check backend API connectivity.</div> : envs.length === 0 ? <div className="empty-state">No environments configured.</div> : (
            <div className="grid">
              {envs.map(e => (
                <div key={e.id} className="card card-pad row-between" style={{ flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{e.name} <span className="muted" style={{ fontWeight: 500 }}>• {e.provider} • {e.branch}</span></div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{e.url || "No URL assigned"}</div>
                  </div>
                  <span className={`badge ${e.status === "healthy" || e.status === "running" ? "badge-success" : e.status === "degraded" ? "badge-warning" : "badge-neutral"}`}>{e.status}</span>
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
      <div className="view-container">
        {page("Infrastructure", "Plan and manage infrastructure changes with explicit approvals.")}
        <div className="grid grid-2">
          <div className="card card-pad"><div className="metric-label">IaC engine</div><div className="muted" style={{ marginTop: 6 }}>Terraform/OpenTofu adapter (provider integration required)</div></div>
          <div className="card card-pad"><div className="metric-label">Plan status</div><div className="muted" style={{ marginTop: 6 }}>No active plan. Generate a plan before apply.</div></div>
          <div className="card card-pad"><div className="metric-label">Cost estimate</div><div className="muted" style={{ marginTop: 6 }}>Unavailable until a resource plan is generated.</div></div>
          <div className="card card-pad"><div className="metric-label">Safety</div><div className="muted" style={{ marginTop: 6 }}>Provision/apply/destroy actions require approval and audit logging.</div></div>
        </div>
      </div>
    );
  }

  if (tab === "build" || tab === "history") {
    const isBuild = tab === "build";
    return (
      <div className="view-container">
        {page(isBuild ? "Build & Deploy" : "Deployment History", isBuild ? "Pipeline activity, approvals, and release status." : "Recent deployments across environments.")}
        <Panel title={isBuild ? "Deployment pipeline" : "Recent deployments"}>
          {deploymentsQ.isLoading ? <div className="muted">Loading deployments…</div> : deploymentsQ.isError ? <div className="empty-state">Unable to load deployments. Check backend API connectivity.</div> : deployments.length === 0 ? <div className="empty-state">No deployments found.</div> : (
            <div className="grid">
              {deployments.map(d => (
                <div key={d.id} className="card card-pad row-between" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{d.project_id} <span className="muted" style={{ fontWeight: 500 }}>• {d.environment} • {d.branch} • {d.commit}</span></div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{d.summary}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{d.created_at}{d.url ? ` • ${d.url}` : ""}</div>
                  </div>
                  <span className={`badge ${d.status.toLowerCase().includes("success") ? "badge-success" : d.status.toLowerCase().includes("fail") ? "badge-error" : d.status.toLowerCase().includes("queue") || d.status.toLowerCase().includes("build") || d.status.toLowerCase().includes("deploy") ? "badge-warning" : "badge-info"}`}>{d.status}</span>
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
      <div className="view-container">
        {page("Monitoring", "System health, model telemetry, and service signals.")}
        <div className="grid grid-2">
          <Panel title="System monitor">
            <div className="stack">
              <div className="row-between"><span className="muted">System health</span><span className={`badge ${metrics?.system_health === "healthy" ? "badge-success" : metrics?.system_health === "degraded" ? "badge-warning" : "badge-neutral"}`}>{metrics?.system_health || "unknown"}</span></div>
              <div className="row-between"><span className="muted">Avg response latency</span><strong>{metrics ? `${metrics.avg_latency_ms} ms` : "—"}</strong></div>
              <div className="row-between"><span className="muted">Active model</span><strong style={{ fontSize: 13, textAlign: "right" }}>{metrics?.active_model || "—"}</strong></div>
              <div className="row-between"><span className="muted">Open incidents</span><strong>{incidents.filter(i => i.status !== "resolved").length}</strong></div>
            </div>
          </Panel>
          <Panel title="Service checks"><div className="empty-state">Connect environment health endpoints and provider telemetry APIs to display live uptime, error rates, and resource usage.</div></Panel>
        </div>
      </div>
    );
  }

  if (tab === "incidents") {
    return (
      <div className="view-container">
        {page("Incidents", "Track active issues, severity, and recommended remediation.")}
        <Panel title="Incident management">
          {incidentsQ.isLoading ? <div className="muted">Loading incidents…</div> : incidentsQ.isError ? <div className="empty-state">Unable to load incidents. Check backend API connectivity.</div> : incidents.length === 0 ? <div className="empty-state">No incidents reported.</div> : (
            <div className="grid">
              {incidents.map(i => (
                <div key={i.id} className="card card-pad">
                  <div className="row-between" style={{ flexWrap: "wrap", gap: 8 }}>
                    <strong>{i.title}</strong>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <span className={`badge ${i.severity === "critical" || i.severity === "high" ? "badge-error" : i.severity === "medium" ? "badge-warning" : "badge-neutral"}`}>{i.severity}</span>
                      <span className={`badge ${i.status === "resolved" ? "badge-success" : i.status === "mitigated" ? "badge-info" : "badge-warning"}`}>{i.status}</span>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{i.service} • {i.detected_at}</div>
                  <p style={{ marginTop: 8 }}>{i.summary}</p>
                  <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 13 }}><strong>Recommendation:</strong> {i.recommendation}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === "knowledge") {
    return (
      <div className="view-container">
        {page("AI Knowledge", "Project and enterprise knowledge used for grounded assistance.")}
        <Panel title="Knowledge base"><div className="empty-state">Repository intelligence and document indexing appear here. Use the Knowledge/Documents tools and connected project analysis for available data.</div></Panel>
      </div>
    );
  }

  if (tab === "analytics") {
    return (
      <div className="view-container">
        {page("Analytics", "Usage, agent activity, and cost telemetry from live system data.")}
        <div className="grid grid-4">
          <div className="card card-pad"><div className="metric-label">Total queries</div><div className="metric-value">{metrics?.total_queries ?? "—"}</div></div>
          <div className="card card-pad"><div className="metric-label">Agent executions</div><div className="metric-value">{metrics?.agent_executions ?? "—"}</div></div>
          <div className="card card-pad"><div className="metric-label">Token consumption</div><div className="metric-value" style={{ fontSize: 22 }}>{metrics?.token_consumption?.toLocaleString() ?? "—"}</div></div>
          <div className="card card-pad"><div className="metric-label">Estimated cost</div><div className="metric-value" style={{ fontSize: 20 }}>{metrics?.estimated_api_cost ?? "—"}</div></div>
        </div>
        <Panel title="Recent activity">
          {metrics?.recent_activity?.length ? (
            <div className="grid">{metrics.recent_activity.slice(0, 8).map((a, i) => <div key={i} className="row-between card card-pad" style={{ padding: 12 }}><span><strong>{a.action}</strong> <span className="muted">• {a.user} • {a.agent}</span></span><span className="muted" style={{ fontSize: 12 }}>{a.time}</span></div>)}</div>
          ) : <div className="empty-state">No recent activity available.</div>}
        </Panel>
      </div>
    );
  }

  if (tab === "settings") {
    return (
      <div className="view-container">
        {page("Settings", "Workspace preferences, security posture, and integrations.")}
        <div className="grid grid-2">
          <div className="card card-pad"><div className="section-title">Appearance</div><p className="muted">Use the theme toggle in the top navigation to switch light/dark mode. Your preference is saved on this device.</p></div>
          <div className="card card-pad"><div className="section-title">Integrations</div><p className="muted">GitHub, cloud providers, and secrets management require secure backend configuration. Secrets are never stored in the frontend.</p></div>
          <div className="card card-pad"><div className="section-title">Security</div><p className="muted">RBAC, audit logging, and approval gates protect consequential actions across deployments, Git operations, and infrastructure.</p></div>
          <div className="card card-pad"><div className="section-title">Environment</div><p className="muted">Backend configuration is managed via environment variables (database, JWT, CORS, cookies, OAuth, diagnostics) and should not be exposed to clients.</p></div>
        </div>
      </div>
    );
  }

  // Overview
  return (
    <div className="view-container">
      <div className="card card-pad" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08)), var(--surface)", marginBottom: 16 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <div className="badge badge-info" style={{ marginBottom: 10 }}>OpsPilot 3.0 • Developer Command Center</div>
            <h1 className="page-title">Welcome back{userName && userName !== "User" ? `, ${userName.split(" ")[0]}` : ""}</h1>
            <p className="page-subtitle">Connect repositories, run AI engineering tasks, manage deployments, and monitor incidents from one secure workspace.</p>
            <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={onConnectRepo}>Connect repository</button>
              <button className="btn btn-secondary" onClick={onOpenEngineer}>Open AI Engineer</button>
            </div>
          </div>
          <div className="stack" style={{ minWidth: 220 }}>
            <div className="row" style={{ gap: 8 }}><span className="badge badge-success">Security enforced</span></div>
            <div className="row" style={{ gap: 8 }}><span className="badge badge-success">Approval gates active</span></div>
            <div className="row" style={{ gap: 8 }}><span className="badge badge-success">Audit logging enabled</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Total projects" value={projects.length} sub="Connected repositories" />
        <StatCard label="Successful deployments" value={successfulDeployments} sub="Across all environments" tone="success" />
        <StatCard label="Active deployments" value={activeDeployments} sub="Queued / building / deploying" tone={activeDeployments > 0 ? "warning" : "neutral"} />
        <StatCard label="System health" value={metrics?.system_health || "unknown"} sub={metrics ? `${metrics.avg_latency_ms} ms avg latency` : "Telemetry loading…"} tone={metrics?.system_health === "healthy" ? "success" : "warning"} />
      </div>

      <div className="grid grid-2" style={{ marginTop: 0 }}>
        <Panel title="Your projects" right={<button className="btn btn-ghost btn-sm" onClick={onConnectRepo}>+ Connect</button>}>
          {projectsQ.isLoading ? <div className="muted">Loading projects…</div> : filteredProjects.length === 0 ? <div className="empty-state">No projects yet. Connect a repository to get started.</div> : (
            <div className="grid grid-2">
              {filteredProjects.slice(0, 4).map(p => (
                <button key={p.id} className="card card-pad" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => onSelectProject(p)}>
                  <div className="row-between"><strong>{p.name}</strong><span className={`badge ${p.health === "healthy" ? "badge-success" : "badge-warning"}`}>{p.health}</span></div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{p.framework} • {p.language}</div>
                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}><span className="badge badge-neutral">{p.environments} envs</span><span className="badge badge-info">{p.open_prs} PRs</span></div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="AI Engineer activity" right={<button className="btn btn-ghost btn-sm" onClick={onOpenEngineer}>Open</button>}>
          <div className="stack">
            {["Task planning ready for connected projects", "Sandbox execution requires project task initialization", "Code review and diff generation available after changes", "PR/deploy actions are approval-gated"].map((t, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start" }}><span className={`badge ${i === 0 ? "badge-success" : "badge-info"}`}>•</span><span style={{ fontSize: 14 }}>{t}</span></div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent deployments">
          <div className="stack">
            {deployments.slice(0, 4).map(d => (
              <div key={d.id} className="row-between" style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div><div style={{ fontWeight: 600, fontSize: 14 }}>{d.project_id} <span className="muted">• {d.environment}</span></div><div className="muted" style={{ fontSize: 12 }}>{d.commit} • {d.branch}</div></div>
                <span className={`badge ${d.status.toLowerCase().includes("success") ? "badge-success" : d.status.toLowerCase().includes("fail") ? "badge-error" : "badge-warning"}`}>{d.status}</span>
              </div>
            ))}
            {deployments.length === 0 && <div className="empty-state">No deployment activity yet.</div>}
          </div>
        </Panel>

        <Panel title="System & approvals">
          <div className="stack">
            <div className="row-between"><span className="muted">Health</span><span className={`badge ${metrics?.system_health === "healthy" ? "badge-success" : "badge-warning"}`}>{metrics?.system_health || "unknown"}</span></div>
            <div className="row-between"><span className="muted">Latency</span><strong>{metrics ? `${metrics.avg_latency_ms} ms` : "—"}</strong></div>
            <div className="row-between"><span className="muted">Open incidents</span><strong>{incidents.filter(i => i.status !== "resolved").length}</strong></div>
            <div className="row-between"><span className="muted">Pending approvals</span><strong>{approvals.filter(a => a.status === "pending").length}</strong></div>
            <div className="row-between"><span className="muted">Environments</span><strong>{envs.length}</strong></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}