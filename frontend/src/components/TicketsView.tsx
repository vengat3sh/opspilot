import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTickets, createTicket, type TicketItem } from "../api";

export default function TicketsView({ onInvestigate }: { onInvestigate?: (ticket: TicketItem) => void }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [category, setCategory] = useState("IT Support");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: getTickets,
  });

  const createMutation = useMutation({
    mutationFn: () => createTicket({ title, description, priority, category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setShowCreate(false);
      setTitle("");
      setDescription("");
    },
  });

  const priorityClasses: Record<string, string> = {
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
          <h2 className="view-title">IT Support & Incident Automation</h2>
          <p className="view-subtitle">Autonomous incident triage, root cause investigation & ticketing workflow</p>
        </div>
        <button className="primary-btn" onClick={() => setShowCreate(prev => !prev)} type="button">
          {showCreate ? "✕ Close" : "+ Create Incident Ticket"}
        </button>
      </div>

      {/* Create Ticket Modal / Form */}
      {showCreate && (
        <div className="upload-box">
          <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Open New Operational Ticket</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 10 }}>
            <div>
              <label className="input-label">Incident / Problem Title</label>
              <input
                className="form-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Laptop VPN connection timeout from Munich"
              />
            </div>
            <div>
              <label className="input-label">Department / Category</label>
              <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="IT Support">IT Support</option>
                <option value="DevOps">DevOps</option>
                <option value="HR">HR</option>
                <option value="Finance">Finance</option>
                <option value="Security">Security</option>
              </select>
            </div>
            <div>
              <label className="input-label">Priority</label>
              <select className="form-input" value={priority} onChange={e => setPriority(e.target.value as any)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical (P1)</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="input-label">Detailed Symptoms / Error Trace</label>
            <textarea
              className="form-input"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe what broke, steps to reproduce, or paste logs..."
            />
          </div>
          <button
            className="primary-btn"
            disabled={!title.trim() || !description.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? "Triaging..." : "Submit to Agent Orchestrator"}
          </button>
        </div>
      )}

      {/* Tickets List */}
      {isLoading ? (
        <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading tickets...</div>
      ) : tickets.length === 0 ? (
        <div className="empty-state">No active operational tickets.</div>
      ) : (
        <div className="ticket-list">
          {tickets.map(ticket => (
            <div key={ticket.id} className="ticket-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="font-mono text-sub font-semibold" style={{ fontSize: 12 }}>{ticket.id}</span>
                    <span className={`risk-badge ${priorityClasses[ticket.priority] || ""}`}>
                      {ticket.priority.toUpperCase()}
                    </span>
                    <span className="ticket-title">{ticket.title}</span>
                  </div>
                  <p className="ticket-desc">{ticket.description}</p>
                </div>
                <span className={`status-pill ${ticket.status === "resolved" ? "active" : "warning"}`}>
                  {ticket.status.toUpperCase()}
                </span>
              </div>

              <div className="ticket-footer">
                <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#64748b" }}>
                  <span>🤖 Assigned: <strong>{ticket.assigned_agent}</strong></span>
                  <span>📁 {ticket.category}</span>
                  <span>📅 {ticket.created_at}</span>
                </div>

                {onInvestigate && (
                  <button
                    className="secondary-btn-sm"
                    onClick={() => onInvestigate(ticket)}
                    type="button"
                  >
                    Investigate with Agent →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
