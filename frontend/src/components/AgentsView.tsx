import { useQuery } from "@tanstack/react-query";
import { getAgents } from "../api";

export default function AgentsView({ onSelectAgent }: { onSelectAgent?: (agentId: string) => void }) {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: getAgents,
  });

  const agentIcons: Record<string, string> = {
    "agent-knowledge": "🧠",
    "agent-research": "🔬",
    "agent-operations": "⚡",
    "agent-analytics": "📈",
  };

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Multi-Agent AI Orchestrator</h2>
          <p className="view-subtitle">Stateful LangGraph agent pipelines with role-based authority & safety bounds</p>
        </div>
        <span className="health-badge healthy">
          <span className="dot green" /> 4 Agents Operational
        </span>
      </div>

      {isLoading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading agent swarm...</div>
      ) : (
        <div className="agent-grid">
          {agents.map(ag => {
            const icon = agentIcons[ag.id] || "🤖";
            const isWaiting = ag.status === "waiting_approval";

            return (
              <div key={ag.id} className="agent-card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="agent-avatar">{icon}</div>
                    <div>
                      <h3 className="agent-name">{ag.name}</h3>
                      <div className="agent-role">{ag.role}</div>
                    </div>
                  </div>
                  <span className={`status-pill ${isWaiting ? "warning" : "active"}`}>
                    <span className={`dot ${isWaiting ? "amber" : "green"}`} />
                    {isWaiting ? "Awaiting Approval" : "Ready / Idle"}
                  </span>
                </div>

                <p className="agent-desc">{ag.description}</p>

                {/* Permitted Tools */}
                <div style={{ marginBottom: 14 }}>
                  <div className="tool-header">Permitted MCP Tools:</div>
                  <div className="tool-chips">
                    {ag.permitted_tools.map(tool => (
                      <span key={tool} className="tool-chip">
                        ⚙️ {tool}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Performance stats */}
                <div className="agent-stats">
                  <div>
                    <span className="stat-label">Executions</span>
                    <span className="stat-val">{ag.total_runs}</span>
                  </div>
                  <div>
                    <span className="stat-label">Success Rate</span>
                    <span className="stat-val text-emerald">{ag.success_rate}%</span>
                  </div>
                </div>

                {onSelectAgent && (
                  <button
                    className="agent-invoke-btn"
                    onClick={() => onSelectAgent(ag.id)}
                    type="button"
                  >
                    Chat with {ag.name} →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
