import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, getApprovals, submitApprovalAction } from "../api";

export default function ApprovalsView() {
  const queryClient = useQueryClient();
  const { data: approvals = [], isLoading, isError } = useQuery({ queryKey: ["approvals"], queryFn: getApprovals });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => submitApprovalAction(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["tool-ops"] });
    },
  });

  const pending = approvals.filter(a => a.status === "pending");
  const history = approvals.filter(a => a.status !== "pending");
  const riskBadge = (level: string) => level === "critical" || level === "high" ? "badge-error" : level === "medium" ? "badge-warning" : "badge-info";

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <p className="page-subtitle">Human-in-the-loop review for consequential and high-risk actions</p>
        </div>
        <span className="badge badge-info">🛡️ Zero unauthorized execution</span>
      </div>

      {actionMutation.isError && (
        <div className="empty-state" style={{ marginBottom: 16, color: "var(--error)" }}>
          {errorMessage(actionMutation.error)}
        </div>
      )}

      {isLoading ? <div className="muted">Loading approvals…</div> : isError ? <div className="empty-state">Unable to load approvals.</div> : (
        <>
          <div style={{ marginBottom: 20 }}>
            <div className="row" style={{ marginBottom: 12 }}><h2 className="section-title" style={{ margin: 0 }}>Pending requests</h2><span className="badge badge-warning">{pending.length}</span></div>
            {pending.length === 0 ? <div className="empty-state">All queued actions have been reviewed. No pending approvals.</div> : (
              <div className="grid">
                {pending.map(item => (
                  <div key={item.id} className="card card-pad">
                    <div className="row-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                          <span className={`badge ${riskBadge(item.risk_level)}`}>{item.risk_level.toUpperCase()} RISK</span>
                          <strong style={{ fontSize: 16 }}>{item.title}</strong>
                        </div>
                        <p className="muted" style={{ fontSize: 14 }}>{item.details}</p>
                      </div>
                      <span className="badge badge-warning">Pending</span>
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12, fontSize: 12 }}>
                      <span className="badge badge-neutral">👤 {item.requested_by}</span>
                      <span className="badge badge-neutral">🕒 {item.timestamp}</span>
                      <span className="badge badge-neutral" style={{ fontFamily: "JetBrains Mono, monospace" }}>{item.action_type}</span>
                    </div>
                    <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <button className="btn btn-danger btn-sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ id: item.id, action: "reject" })} type="button">Reject</button>
                      <button className="btn btn-primary btn-sm" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })} type="button">Approve & execute</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {history.length > 0 && (
            <div>
              <h2 className="section-title">Decision history</h2>
              <div className="grid">
                {history.map(item => (
                  <div key={item.id} className="card card-pad row-between" style={{ flexWrap: "wrap", gap: 12 }}>
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                        <span className={`badge ${item.status === "approved" || item.status === "executed" ? "badge-success" : "badge-error"}`}>{item.status.toUpperCase()}</span>
                        <strong>{item.title}</strong>
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>Requested by {item.requested_by} • {item.timestamp}</div>
                    </div>
                    <span className={`badge ${riskBadge(item.risk_level)}`}>{item.risk_level}</span>
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