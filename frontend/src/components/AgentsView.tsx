import { useQuery } from "@tanstack/react-query";
import { getAgents } from "../api";

export default function AgentsView({ onSelectAgent }: { onSelectAgent?: (agentId: string) => void }) {
  const { data: agents = [], isLoading, isError } = useQuery({ queryKey: ["agents"], queryFn: getAgents });
  const agentIcons: Record<string, string> = { "agent-knowledge": "🧠", "agent-research": "🔬", "agent-operations": "⚡", "agent-analytics": "📈" };

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Agents</h1>
          <p className="page-subtitle">Registered agent roles, permitted tools, and persisted execution counts for your account</p>
        </div>
        <span className="badge badge-success">● {agents.length || 4} agents available</span>
      </div>

      {isLoading ? <div className="muted">Loading agents…</div> : isError ? <div className="empty-state">Unable to load agents.</div> : (
        <div className="grid grid-2">
          {agents.map(ag => {
            const icon = agentIcons[ag.id] || "🤖";
            const isWaiting = ag.status === "waiting_approval";
            return (
              <div key={ag.id} className="card card-pad">
                <div className="row-between" style={{ marginBottom: 12, alignItems: "flex-start" }}>
                  <div className="row" style={{ gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "linear-gradient(135deg,var(--indigo),var(--violet))", color: "#fff", fontSize: 20 }}>{icon}</div>
                    <div>
                      <h3 style={{ fontSize: 17, fontWeight: 700 }}>{ag.name}</h3>
                      <div className="muted" style={{ fontSize: 13 }}>{ag.role}</div>
                    </div>
                  </div>
                  <span className={`badge ${isWaiting ? "badge-warning" : ag.status === "error" ? "badge-error" : "badge-success"}`}>{isWaiting ? "Awaiting approval" : ag.status === "error" ? "Error" : ag.status}</span>
                </div>

                <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>{ag.description}</p>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".04em" }}>Permitted tools</div>
                  <div className="chip-wrap">{ag.permitted_tools.map(tool => <span key={tool} className="tool-chip">⚙️ {tool}</span>)}</div>
                </div>

                <div className="grid grid-2" style={{ gap: 10, marginBottom: 14 }}>
                  <div className="card" style={{ padding: 12, boxShadow: "none", background: "var(--surface-2)" }}><div className="metric-label">Executions</div><div style={{ fontWeight: 800, fontSize: 20 }}>{ag.total_runs}</div></div>
                  <div className="card" style={{ padding: 12, boxShadow: "none", background: "var(--surface-2)" }}><div className="metric-label">Success rate</div><div style={{ fontWeight: 800, fontSize: 20, color: "var(--success)" }}>{ag.success_rate}%</div></div>
                </div>

                {onSelectAgent && <button className="btn btn-secondary" onClick={() => onSelectAgent(ag.id)} type="button">Open in AI Engineer →</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}