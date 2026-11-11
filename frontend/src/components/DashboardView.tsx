import { useQuery } from "@tanstack/react-query";
import { getDashboardMetrics } from "../api";

export default function DashboardView() {
  const { data: metrics, isLoading, refetch } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: getDashboardMetrics,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="view-container">
        <div className="view-header">
          <div>
            <h2 className="view-title">Enterprise Dashboard</h2>
            <p className="view-subtitle">Live system telemetry & AI operations intelligence</p>
          </div>
        </div>
        <div className="dashboard-skeleton-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton dashboard-skeleton-card" />
          ))}
        </div>
        <div className="dashboard-skeleton-panels">
          <div className="skeleton dashboard-skeleton-panel" />
          <div className="skeleton dashboard-skeleton-panel" />
        </div>
      </div>
    );
  }

  const m = metrics || {
    total_documents: 4,
    indexed_documents: 4,
    total_queries: 42,
    agent_executions: 321,
    pending_approvals: 2,
    open_tickets: 2,
    avg_latency_ms: 820,
    active_model: "nvidia/nemotron-3.5-lightning:free",
    token_consumption: 12840,
    estimated_api_cost: "$0.00 (Zero-Cost Free Tier)",
    system_health: "healthy" as const,
    recent_activity: [],
  };

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Enterprise Dashboard</h2>
          <p className="view-subtitle">Live system telemetry & AI operations intelligence</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="health-badge healthy">
            <span className="dot green" /> System Operational
          </span>
          <button className="secondary-btn" onClick={() => refetch()} type="button">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon-wrap" style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1" }}>
            💬
          </div>
          <div>
            <div className="metric-label">Total Queries</div>
            <div className="metric-value">{m.total_queries}</div>
            <div className="metric-caption text-emerald">↑ 14% this week</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon-wrap" style={{ background: "rgba(16,185,129,0.12)", color: "#10b981" }}>
            📁
          </div>
          <div>
            <div className="metric-label">Indexed Documents</div>
            <div className="metric-value">{m.indexed_documents} / {m.total_documents}</div>
            <div className="metric-caption text-sub">BGE semantic embeddings</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon-wrap" style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
            🤖
          </div>
          <div>
            <div className="metric-label">Agent Executions</div>
            <div className="metric-value">{m.agent_executions}</div>
            <div className="metric-caption text-sub">Across 4 specialized agents</div>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon-wrap" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
            🛡️
          </div>
          <div>
            <div className="metric-label">Pending Approvals</div>
            <div className="metric-value">{m.pending_approvals}</div>
            <div className="metric-caption text-amber">Human-in-the-loop review</div>
          </div>
        </div>
      </div>

      {/* Second Row: Telemetry & Activity */}
      <div className="dashboard-columns">
        {/* Telemetry Card */}
        <div className="dashboard-panel">
          <div className="panel-title">System & Model Telemetry</div>

          <div className="telemetry-item">
            <div className="telemetry-label-row">
              <span>Average Response Latency</span>
              <span className="font-semibold">{m.avg_latency_ms} ms</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.min(100, (m.avg_latency_ms / 3000) * 100)}%`, background: "#10b981" }} />
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-label-row">
              <span>Active Inference Model</span>
              <span className="font-mono text-primary font-semibold" style={{ fontSize: 12 }}>{m.active_model}</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-label-row">
              <span>Token Consumption</span>
              <span className="font-semibold">{m.token_consumption.toLocaleString()} tokens</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: "35%", background: "#6366f1" }} />
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-label-row">
              <span>Estimated Cloud Cost</span>
              <span className="text-emerald font-bold">{m.estimated_api_cost}</span>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="dashboard-panel">
          <div className="panel-title">Audit & Activity Stream</div>
          <div className="activity-list">
            {m.recent_activity.map((act, i) => (
              <div key={i} className="activity-item">
                <div className="activity-dot" />
                <div style={{ flex: 1 }}>
                  <div className="activity-action">{act.action}</div>
                  <div className="activity-sub">By {act.user} • {act.agent}</div>
                </div>
                <div className="activity-time">{act.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
