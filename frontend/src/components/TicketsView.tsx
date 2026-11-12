import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTicket, getTickets, type TicketItem } from "../api";

export default function TicketsView({ onInvestigate }: { onInvestigate?: (ticket: TicketItem) => void }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [category, setCategory] = useState("IT Support");

  const { data: tickets = [], isLoading, isError } = useQuery({ queryKey: ["tickets"], queryFn: getTickets });
  const createMutation = useMutation({
    mutationFn: () => createTicket({ title, description, priority, category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setShowCreate(false); setTitle(""); setDescription("");
    },
  });

  const priorityBadge = (p: string) => p === "critical" || p === "high" ? "badge-error" : p === "medium" ? "badge-warning" : "badge-info";
  const statusBadge = (s: string) => s === "resolved" || s === "closed" ? "badge-success" : s === "investigating" ? "badge-info" : "badge-warning";

  return (
    <div className="view-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tickets & Incidents</h1>
          <p className="page-subtitle">Operational triage, investigation, and incident workflow tracking</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(v => !v)} type="button">{showCreate ? "Close" : "+ Create ticket"}</button>
      </div>

      {showCreate && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h3 className="section-title">Open new ticket</h3>
          <div className="grid grid-3" style={{ marginBottom: 12 }}>
            <div className="field"><label>Title</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. VPN connection timeout" /></div>
            <div className="field"><label>Category</label>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="IT Support">IT Support</option><option value="DevOps">DevOps</option><option value="HR">HR</option><option value="Finance">Finance</option><option value="Security">Security</option>
              </select>
            </div>
            <div className="field"><label>Priority</label>
              <select className="select" value={priority} onChange={e => setPriority(e.target.value as any)}>
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical (P1)</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}><label>Symptoms / details</label><textarea className="textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what broke, steps to reproduce, or logs…" /></div>
          <button className="btn btn-primary" disabled={!title.trim() || !description.trim() || createMutation.isPending} onClick={() => createMutation.mutate()} type="button">
            {createMutation.isPending ? "Submitting…" : "Submit ticket"}
          </button>
        </div>
      )}

      {isLoading ? <div className="muted">Loading tickets…</div> : isError ? <div className="empty-state">Unable to load tickets.</div> : tickets.length === 0 ? (
        <div className="empty-state">No operational tickets found.</div>
      ) : (
        <div className="grid">
          {tickets.map(ticket => (
            <div key={ticket.id} className="card card-pad">
              <div className="row-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className="badge badge-neutral" style={{ fontFamily: "JetBrains Mono, monospace" }}>{ticket.id}</span>
                    <span className={`badge ${priorityBadge(ticket.priority)}`}>{ticket.priority.toUpperCase()}</span>
                    <strong style={{ fontSize: 16 }}>{ticket.title}</strong>
                  </div>
                  <p className="muted" style={{ fontSize: 14 }}>{ticket.description}</p>
                </div>
                <span className={`badge ${statusBadge(ticket.status)}`}>{ticket.status.toUpperCase()}</span>
              </div>
              <div className="row-between" style={{ marginTop: 14, flexWrap: "wrap", gap: 10 }}>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <span className="badge badge-neutral">🤖 {ticket.assigned_agent}</span>
                  <span className="badge badge-neutral">📁 {ticket.category}</span>
                  <span className="badge badge-neutral">📅 {ticket.created_at}</span>
                </div>
                {onInvestigate && <button className="btn btn-secondary btn-sm" onClick={() => onInvestigate(ticket)} type="button">Investigate with AI →</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}