import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApprovals, submitApprovalAction } from "../api";

export default function ApprovalsView() {
  const queryClient = useQueryClient();

  const { data: approvals = [], isLoading } = useQuery({
    queryKey: ["approvals"],
    queryFn: getApprovals,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      submitApprovalAction(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
    },
  });

  const pending = approvals.filter(a => a.status === "pending");
  const history = approvals.filter(a => a.status !== "pending");

  const riskClasses: Record<string, string> = {
    critical: "risk-critical",
    high: "risk-high",
    medium: "risk-medium",
    low: "risk-low",
  };

  return (
    <div className="view-container">
      {/* Header */}
      <div className="view-header">
        <div>
          <h2 className="view-title">Human-in-the-Loop Approval Center</h2>
          <p className="view-subtitle">Guarding consequential actions: security boundaries, infrastructure scaling & tool calls</p>
        </div>
        <span className="health-badge healthy">
          🛡️ Zero Unauthorized Execution
        </span>
      </div>

      {isLoading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading pending approvals...</div>
      ) : (
        <>
          {/* Pending Queue */}
          <div style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Pending Action Requests</span>
              <span className="count-badge">{pending.length}</span>
            </h3>

            {pending.length === 0 ? (
              <div className="empty-state">✅ All queued actions have been reviewed. No pending approvals.</div>
            ) : (
              <div className="approval-list">
                {pending.map(item => (
                  <div key={item.id} className="approval-card">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span className={`risk-badge ${riskClasses[item.risk_level] || ""}`}>
                            {item.risk_level.toUpperCase()} RISK
                          </span>
                          <span className="approval-title">{item.title}</span>
                        </div>
                        <p className="approval-details">{item.details}</p>
                      </div>
                    </div>

                    <div className="approval-footer">
                      <div className="approval-meta">
                        <span>👤 Requested by: <strong>{item.requested_by}</strong></span>
                        <span>🕒 {item.timestamp}</span>
                        <span className="font-mono">action: {item.action_type}</span>
                      </div>

                      <div className="approval-btn-group">
                        <button
                          className="reject-btn"
                          disabled={actionMutation.isPending}
                          onClick={() => actionMutation.mutate({ id: item.id, action: "reject" })}
                          type="button"
                        >
                          ✕ Reject
                        </button>
                        <button
                          className="approve-btn"
                          disabled={actionMutation.isPending}
                          onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })}
                          type="button"
                        >
                          ✓ Approve & Execute
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical Review Log */}
          {history.length > 0 && (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>
                Recent Decisions Audit Log
              </h3>
              <div className="approval-list">
                {history.map(item => (
                  <div key={item.id} className="approval-card reviewed">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`status-pill ${item.status === "approved" ? "active" : "danger"}`}>
                            {item.status.toUpperCase()}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{item.title}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          Requested by {item.requested_by} • {item.timestamp}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
