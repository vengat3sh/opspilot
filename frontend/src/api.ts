import axios, { AxiosError } from "axios";

// Empty string = same origin (production behind nginx proxy); dev uses VITE_API_URL.
const baseURL = import.meta.env.VITE_API_URL ?? "";

export const http = axios.create({ baseURL, timeout: 130_000 });

export type Role = "system" | "user" | "assistant";
export type Provider = "ollama" | "cloud";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatResponse {
  reply: string;
  provider: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  agent?: string;
  citations?: string[];
}

export interface LLMStatus {
  provider: string;
  ollama_reachable: boolean;
  ollama_models: string[];
  ollama_model_ready: boolean;
  cloud_configured: boolean;
}

export interface StreamMeta {
  provider: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  agent?: string;
  citations?: string[];
}

export interface DashboardMetrics {
  total_documents: number;
  indexed_documents: number;
  total_queries: number;
  agent_executions: number;
  pending_approvals: number;
  open_tickets: number;
  avg_latency_ms: number;
  active_model: string;
  token_consumption: number;
  estimated_api_cost: string;
  system_health: "healthy" | "degraded" | "offline";
  recent_activity: Array<{ time: string; action: string; user: string; agent: string }>;
}

export interface DocumentItem {
  id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  chunks_count: number;
  indexed: boolean;
  category: string;
  uploaded_at: string;
  preview: string;
}

export interface AgentItem {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "waiting_approval" | "error";
  total_runs: number;
  success_rate: number;
  description: string;
  permitted_tools: string[];
}

export interface ApprovalItem {
  id: string;
  action_type: string;
  title: string;
  details: string;
  requested_by: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "executed";
  timestamp: string;
}

export interface TicketItem {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved" | "closed";
  assigned_agent: string;
  created_at: string;
  category: string;
}

// ── API Functions ──────────────────────────────────────────────────────────

export async function sendChat(messages: ChatMessage[], provider?: Provider, agent?: string): Promise<ChatResponse> {
  const { data } = await http.post<ChatResponse>("/api/chat", { messages, provider, agent });
  return data;
}

export async function getLLMStatus(): Promise<LLMStatus> {
  const { data } = await http.get<LLMStatus>("/api/llm/status");
  return data;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const { data } = await http.get<DashboardMetrics>("/api/analytics/dashboard");
  return data;
}

export async function getDocuments(): Promise<DocumentItem[]> {
  const { data } = await http.get<DocumentItem[]>("/api/documents");
  return data;
}

export async function uploadDocument(filename: string, content: string, category: string): Promise<DocumentItem> {
  const { data } = await http.post<DocumentItem>("/api/documents/upload", null, {
    params: { filename, content, category },
  });
  return data;
}

export async function deleteDocument(docId: string): Promise<void> {
  await http.delete(`/api/documents/${docId}`);
}

export async function getAgents(): Promise<AgentItem[]> {
  const { data } = await http.get<AgentItem[]>("/api/agents");
  return data;
}

export async function getApprovals(): Promise<ApprovalItem[]> {
  const { data } = await http.get<ApprovalItem[]>("/api/operations/approvals");
  return data;
}

export async function submitApprovalAction(approvalId: string, action: "approve" | "reject"): Promise<ApprovalItem> {
  const { data } = await http.post<ApprovalItem>(`/api/operations/approvals/${approvalId}/action`, {
    approval_id: approvalId,
    action,
  });
  return data;
}

export async function getTickets(): Promise<TicketItem[]> {
  const { data } = await http.get<TicketItem[]>("/api/operations/tickets");
  return data;
}

export async function createTicket(ticket: { title: string; description: string; priority: string; category: string }): Promise<TicketItem> {
  const { data } = await http.post<TicketItem>("/api/operations/tickets", ticket);
  return data;
}

/**
 * Stream chat via SSE. Calls onToken for each text chunk, onDone with final
 * metadata, and onError on failure. Returns an AbortController so callers
 * can cancel mid-stream.
 */
export function streamChat(
  messages: ChatMessage[],
  provider: Provider | undefined,
  agent: string | undefined,
  onToken: (token: string) => void,
  onDone: (meta: StreamMeta) => void,
  onError: (msg: string) => void,
): AbortController {
  const controller = new AbortController();
  const url = `${baseURL}/api/chat/stream`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, provider, agent }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        onError(`Backend error ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch {
              continue;
            }
            if (typeof parsed === "object" && parsed !== null) {
              const obj = parsed as Record<string, unknown>;
              if (obj.__error__) {
                onError(String(obj.__error__));
                return;
              }
              if (obj.__done__) {
                onDone({
                  provider: String(obj.provider ?? ""),
                  model: String(obj.model ?? ""),
                  latency_ms: Number(obj.latency_ms ?? 0),
                  prompt_tokens: obj.prompt_tokens != null ? Number(obj.prompt_tokens) : null,
                  completion_tokens: obj.completion_tokens != null ? Number(obj.completion_tokens) : null,
                  agent: obj.agent ? String(obj.agent) : undefined,
                  citations: Array.isArray(obj.citations) ? (obj.citations as string[]) : undefined,
                });
                return;
              }
            } else if (typeof parsed === "string") {
              onToken(parsed);
            }
          }
        }
      }
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      onError(err instanceof Error ? err.message : "Stream error");
    });

  return controller;
}

export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (err.code === "ERR_NETWORK") return "Cannot reach the backend API.";
    return err.message;
  }
  return err instanceof Error ? err.message : "Unknown error";
}
