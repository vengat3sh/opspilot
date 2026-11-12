import { useQuery } from "@tanstack/react-query";
import { getDashboardMetrics } from "../api";

function formatNum(n: number) { return n.toLocaleString(); }

export default function DashboardView() {
  const { data: metrics, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: getDashboardMetrics,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="view-container">
        <div className="page-header"><div><h1 className="page-title">Analytics</h1><p className="page-subtitle">Live system telemetry and AI operations intelligence</p></div></div>
        <div className="grid grid-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card card-pad"><div className="skeleton" style={{ height: 18, width: "60%", marginBottom: 12 }} /><div className="skeleton" style={{ height: 32, width: "40%", marginBottom: 8 }} /><div className="skeleton" style={{ height: 14, width: "70%" }} /></div>)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="view-container">
        <div className="empty-state">Unable to load analytics. <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => refetch()}>Retry</button></div>
      </div>
    );
  }

  const m = metrics!;

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Live system telemetry and AI operations intelligence</p>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className={`badge ${m.system_health === "healthy" ? "badge-success" : m.system_health === "degraded" ? "badge-warning" : "badge-error"}`}>● System {m.system_health}</span>
          <button className="btn btn-secondary" onClick={() => refetch()} type="button">↻ Refresh</button>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card card-pad metric-card" style={{ padding: 18 }}>
          <div className="metric-icon-wrap" style={{ background: "rgba(99,102,241,0.12)", color: "var(--indigo)" }}>💬</div>
          <div><div className="metric-label">Total queries</div><div className="metric-value">{formatNum(m.total_queries)}</div><div className="metric-caption muted">User and agent interactions</div></div>
        </div>
        <div className="card card-pad metric-card" style={{ padding: 18 }}>
          <div className="metric-icon-wrap" style={{ background: "var(--success-bg)", color: "var(--success)" }}>📁</div>
          <div><div className="metric-label">Indexed documents</div><div className="metric-value">{m.indexed_documents} / {m.total_documents}</div><div className="metric-caption muted">Knowledge base coverage</div></div>
        </div>
        <div className="card card-pad metric-card" style={{ padding: 18 }}>
          <div className="metric-icon-wrap" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>🤖</div>
          <div><div className="metric-label">Agent executions</div><div className="metric-value">{formatNum(m.agent_executions)}</div><div className="metric-caption muted">Across registered agents</div></div>
        </div>
        <div className="card card-pad metric-card" style={{ padding: 18 }}>
          <div className="metric-icon-wrap" style={{ background: "var(--error-bg)", color: "var(--error)" }}>🛡️</div>
          <div><div className="metric-label">Pending approvals</div><div className="metric-value">{m.pending_approvals}</div><div className="metric-caption muted">Human-in-the-loop queue</div></div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card card-pad">
          <div className="section-title">System & model telemetry</div>
          <div className="stack">
            <div>
              <div className="row-between"><span className="muted">Average response latency</span><strong>{m.avg_latency_ms} ms</strong></div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", border: "1px solid var(--border)" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (m.avg_latency_ms / 3000) * 100)}%`, background: "linear-gradient(90deg, var(--success), #10b981)" }} />
              </div>
            </div>
            <div className="row-between"><span className="muted">Active inference model</span><strong style={{ fontSize: 13, textAlign: "right", wordBreak: "break-all" }}>{m.active_model}</strong></div>
            <div>
              <div className="row-between"><span className="muted">Token consumption</span><strong>{formatNum(m.token_consumption)} tokens</strong></div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", border: "1px solid var(--border)" }}>
                <div style={{ height: "100%", width: "35%", background: "linear-gradient(90deg, var(--indigo), var(--violet))" }} />
              </div>
            </div>
            <div className="row-between"><span className="muted">Estimated cloud cost</span><span className="badge badge-success">{m.estimated_api_cost}</span></div>
            <div className="row-between"><span className="muted">Open tickets</span><strong>{m.open_tickets}</strong></div>
          </div>
        </div>

        <div className="card card-pad">
          <div className="section-title">Recent activity</div>
          {m.recent_activity?.length ? (
            <div className="stack">
              {m.recent_activity.map((act, i) => (
                <div key={i} className="row" style={{ alignItems: "flex-start", paddingBottom: 10, borderBottom: i < m.recent_activity.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span className="badge badge-info" style={{ marginTop: 2 }}>•</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{act.action}</div>
                    <div className="muted" style={{ fontSize: 12 }}>By {act.user} • {act.agent}</div>
                  </div>
                  <div className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{act.time}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No recent activity recorded.</div>
          )}
        </div>
      </div>
    </div>
  );
}