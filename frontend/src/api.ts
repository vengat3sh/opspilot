import axios, { AxiosError } from "axios";

// Empty string = same origin (production behind nginx proxy); dev uses VITE_API_URL.
const baseURL = import.meta.env.VITE_API_URL ?? "";

export const http = axios.create({ baseURL, timeout: 130_000, withCredentials: true });

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
  conversation_id?: string;
  assistant_message_id?: string;
  user_message_id?: string;
  status?: string;
}

export interface ConversationItem {
  id: string;
  user_id: string;
  project_id?: string | null;
  title: string;
  description?: string | null;
  conversation_type: string;
  provider?: string | null;
  model?: string | null;
  status: string;
  last_message_at?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview?: string | null;
}

export interface ConversationList {
  items: ConversationItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface MessageItem {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  message_type: string;
  status: "pending" | "streaming" | "completed" | "interrupted" | "failed";
  model?: string | null;
  provider?: string | null;
  token_usage?: Record<string, number | null> | null;
  latency_ms?: number | null;
  parent_message_id?: string | null;
  error_message?: string | null;
  sequence: number;
  created_at: string;
  updated_at: string;
}

export interface MessagePage {
  items: MessageItem[];
  has_more: boolean;
  next_before_sequence?: number | null;
}

export interface ProjectFileItem {
  path: string;
  size_bytes: number;
  language?: string | null;
  indexed: boolean;
  is_binary: boolean;
  excerpt?: string | null;
}

export interface ProjectTreeItem {
  path: string;
  type: "file" | "directory";
  size_bytes?: number | null;
}

export interface ProjectContext {
  project_id: string;
  project_name: string;
  indexing_status: string;
  repository_inspected: boolean;
  files: ProjectFileItem[];
  context: string;
}

export interface ToolOperation {
  id: string;
  user_id: string;
  project_id?: string | null;
  conversation_id?: string | null;
  tool_name: string;
  action: string;
  risk_level: string;
  status: string;
  requires_approval: boolean;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  approved_at?: string | null;
  executed_at?: string | null;
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

export interface ProjectItem {
  id: string;
  name: string;
  repo_provider: string;
  repo_url: string;
  default_branch: string;
  status: string;
  language: string;
  framework: string;
  last_synced: string;
  health: string;
  environments: number;
  open_prs: number;
  pending_changes: number;
  description?: string | null;
  workspace_path?: string | null;
  indexing_status?: string;
  indexed_files?: number;
  last_indexed_at?: string | null;
  repository_inspected?: boolean;
  repo_connected?: boolean;
}

export interface EnvironmentItem {
  id: string;
  project_id: string;
  name: string;
  provider: string;
  status: string;
  url?: string | null;
  branch: string;
  last_deploy?: string | null;
}

export interface DeploymentItem {
  id: string;
  project_id: string;
  environment: string;
  status: string;
  commit: string;
  branch: string;
  created_at: string;
  summary: string;
  url?: string | null;
}

export interface IncidentItem {
  id: string;
  project_id: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "mitigated" | "resolved";
  service: string;
  detected_at: string;
  summary: string;
  recommendation: string;
}

export interface WorkflowStage {
  name: string;
  status: "pending" | "active" | "done" | "failed";
}

export interface ProjectWorkflow {
  project_id: string;
  stages: WorkflowStage[];
  current_step: string;
  approvals_required: number;
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

export async function getProjects(): Promise<ProjectItem[]> {
  const { data } = await http.get<ProjectItem[]>("/api/v1/projects");
  return data;
}

export async function createProject(payload: { name: string; repo_provider?: string; repo_url: string; default_branch?: string }): Promise<ProjectItem> {
  const { data } = await http.post<ProjectItem>("/api/v1/projects", payload);
  return data;
}

export async function getProjectWorkflow(projectId: string): Promise<ProjectWorkflow> {
  const { data } = await http.get<ProjectWorkflow>(`/api/v1/projects/${projectId}/workflow`);
  return data;
}

export async function getEnvironments(projectId?: string): Promise<EnvironmentItem[]> {
  const url = projectId ? `/api/v1/projects/${projectId}/environments` : "/api/v1/environments";
  const { data } = await http.get<EnvironmentItem[]>(url);
  return data;
}

export async function getDeployments(projectId?: string): Promise<DeploymentItem[]> {
  const url = projectId ? `/api/v1/projects/${projectId}/deployments` : "/api/v1/deployments";
  const { data } = await http.get<DeploymentItem[]>(url);
  return data;
}

export async function rollbackDeployment(projectId: string, deploymentId: string): Promise<DeploymentItem> {
  const { data } = await http.post<DeploymentItem>(`/api/v1/projects/${projectId}/deployments/${deploymentId}/rollback`);
  return data;
}

export async function getIncidents(projectId?: string): Promise<IncidentItem[]> {
  const url = projectId ? `/api/v1/projects/${projectId}/incidents` : "/api/v1/incidents";
  const { data } = await http.get<IncidentItem[]>(url);
  return data;
}

// ── Persistent conversations ───────────────────────────────────────────────

export async function listConversations(params?: { q?: string; archived?: boolean; page?: number; limit?: number; projectId?: string }): Promise<ConversationList> {
  const { data } = await http.get<ConversationList>("/api/conversations", {
    params: { q: params?.q, archived: params?.archived ?? false, page: params?.page ?? 1, limit: params?.limit ?? 30, project_id: params?.projectId },
  });
  return data;
}

export async function createConversation(payload?: { title?: string; project_id?: string | null; provider?: Provider }): Promise<ConversationItem> {
  const { data } = await http.post<ConversationItem>("/api/conversations", payload ?? {});
  return data;
}

export async function getConversation(id: string): Promise<ConversationItem> {
  const { data } = await http.get<ConversationItem>(`/api/conversations/${id}`);
  return data;
}

export async function updateConversation(id: string, payload: { title?: string; archived?: boolean; project_id?: string | null }): Promise<ConversationItem> {
  const { data } = await http.patch<ConversationItem>(`/api/conversations/${id}`, payload);
  return data;
}

export async function deleteConversation(id: string): Promise<void> {
  await http.delete(`/api/conversations/${id}`);
}

export async function getMessages(conversationId: string, params?: { limit?: number; beforeSequence?: number }): Promise<MessagePage> {
  const { data } = await http.get<MessagePage>(`/api/conversations/${conversationId}/messages`, {
    params: { limit: params?.limit ?? 50, before_sequence: params?.beforeSequence },
  });
  return data;
}

export async function editUserMessage(conversationId: string, messageId: string, content: string): Promise<MessageItem> {
  const { data } = await http.patch<MessageItem>(`/api/conversations/${conversationId}/messages/${messageId}`, { content });
  return data;
}

export async function retryAssistantMessage(assistantMessageId: string, provider?: Provider): Promise<ChatResponse> {
  const { data } = await http.post<ChatResponse>(`/api/chat/retry/${assistantMessageId}`, null, { params: { provider } });
  return data;
}

export async function cancelAssistantGeneration(assistantMessageId: string): Promise<void> {
  await http.post(`/api/chat/cancel/${assistantMessageId}`);
}

// ── Projects / repository context ──────────────────────────────────────────

export async function indexProject(projectId: string): Promise<{ project_id: string; indexing_status: string; indexed_files: number; skipped_files: number; message: string }> {
  const { data } = await http.post(`/api/v1/projects/${projectId}/index`);
  return data;
}

export async function getProjectContext(projectId: string, q = ""): Promise<ProjectContext> {
  const { data } = await http.get<ProjectContext>(`/api/v1/projects/${projectId}/context`, { params: { q } });
  return data;
}

export async function getProjectTree(projectId: string): Promise<ProjectTreeItem[]> {
  const { data } = await http.get<ProjectTreeItem[]>(`/api/v1/projects/${projectId}/tree`);
  return data;
}

export async function getProjectFiles(projectId: string, q?: string): Promise<ProjectFileItem[]> {
  const { data } = await http.get<ProjectFileItem[]>(`/api/v1/projects/${projectId}/files`, { params: { q } });
  return data;
}

// ── Controlled tools ───────────────────────────────────────────────────────

export async function getToolOperations(params?: { conversationId?: string; projectId?: string }): Promise<ToolOperation[]> {
  const { data } = await http.get<ToolOperation[]>("/api/tools/operations", {
    params: { conversation_id: params?.conversationId, project_id: params?.projectId },
  });
  return data;
}

export async function executeTool(payload: { tool: string; project_id: string; conversation_id?: string | null; input?: Record<string, unknown> }): Promise<ToolOperation> {
  const { data } = await http.post<ToolOperation>("/api/tools/execute", payload);
  return data;
}

export async function approveToolOperation(operationId: string, action: "approve" | "reject", notes?: string): Promise<ToolOperation> {
  const { data } = await http.post<ToolOperation>(`/api/tools/operations/${operationId}/approval`, { action, notes });
  return data;
}

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_verified: boolean;
  roles: string[];
  created_at?: string | null;
  last_login_at?: string | null;
}

export interface AuthResponse {
  user: AuthUser;
  access_token?: string | null;
  token_type: string;
}

export async function authMe(): Promise<AuthResponse> {
  const { data } = await http.get<AuthResponse>("/api/v1/auth/me");
  return data;
}

export async function userLogin(payload: { email: string; password: string; remember_me?: boolean }): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>("/api/v1/auth/user/login", payload);
  return data;
}

export async function adminLogin(payload: { email: string; password: string; remember_me?: boolean }): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>("/api/v1/auth/admin/login", payload);
  return data;
}

export async function userRegister(payload: { full_name: string; email: string; password: string; confirm_password: string; terms_accepted: boolean }): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>("/api/v1/auth/user/register", payload);
  return data;
}

export async function authLogout(): Promise<void> {
  await http.post("/api/v1/auth/user/logout");
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (meta: StreamMeta) => void;
  onError: (msg: string, partial?: string) => void;
  onStarted?: (meta: StreamMeta) => void;
  onInterrupted?: (content: string, meta: StreamMeta) => void;
  onUsage?: (usage: { prompt_tokens: number | null; completion_tokens: number | null }) => void;
  onContext?: (meta: { project_id?: string | null; repository_inspected?: boolean }) => void;
}

export interface StreamRequest {
  messages: ChatMessage[];
  provider?: Provider;
  agent?: string;
  conversationId?: string | null;
  projectId?: string | null;
  idempotencyKey?: string;
  regenerate?: boolean;
}

function streamMetaFrom(obj: Record<string, unknown>): StreamMeta {
  return {
    provider: String(obj.provider ?? ""),
    model: String(obj.model ?? ""),
    latency_ms: Number(obj.latency_ms ?? 0),
    prompt_tokens: obj.prompt_tokens != null ? Number(obj.prompt_tokens) : null,
    completion_tokens: obj.completion_tokens != null ? Number(obj.completion_tokens) : null,
    agent: obj.agent ? String(obj.agent) : undefined,
    citations: Array.isArray(obj.citations) ? (obj.citations as string[]) : undefined,
    conversation_id: obj.conversation_id ? String(obj.conversation_id) : undefined,
    assistant_message_id: obj.assistant_message_id ? String(obj.assistant_message_id) : undefined,
    user_message_id: obj.user_message_id ? String(obj.user_message_id) : undefined,
    status: obj.status ? String(obj.status) : undefined,
  };
}

/**
 * Stream chat via the documented SSE protocol. Returns an AbortController so
 * callers can stop generation. The backend persists partial output as
 * interrupted when the client aborts.
 */
export function streamChat(req: StreamRequest, cb: StreamCallbacks): AbortController {
  const controller = new AbortController();
  const url = `${baseURL}/api/chat/stream`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: req.messages,
      provider: req.provider,
      agent: req.agent,
      conversation_id: req.conversationId ?? null,
      project_id: req.projectId ?? null,
      idempotency_key: req.idempotencyKey,
      regenerate: req.regenerate ?? false,
    }),
    signal: controller.signal,
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        let detail = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
        } catch {}
        cb.onError(`Backend error ${res.status}: ${detail}`);
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
          let eventName = "";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          const payload = dataLines.join("\n");
          if (!payload) continue;
          let parsed: unknown;
          try { parsed = JSON.parse(payload); } catch { parsed = payload; }
          if (typeof parsed === "string") {
            cb.onToken(parsed);
            continue;
          }
          if (typeof parsed !== "object" || parsed === null) continue;
          const obj = parsed as Record<string, unknown>;
          const type = String(obj.type ?? eventName ?? "");
          if (obj.__error__) { cb.onError(String(obj.__error__), String(obj.content ?? "")); return; }
          if (obj.__done__) { cb.onDone(streamMetaFrom(obj)); return; }
          if (type === "message_started") { cb.onStarted?.(streamMetaFrom(obj)); continue; }
          if (type === "token") { cb.onToken(String(obj.content ?? "")); continue; }
          if (type === "usage") {
            cb.onUsage?.({
              prompt_tokens: obj.prompt_tokens != null ? Number(obj.prompt_tokens) : null,
              completion_tokens: obj.completion_tokens != null ? Number(obj.completion_tokens) : null,
            });
            continue;
          }
          if (type === "context") {
            cb.onContext?.({ project_id: obj.project_id ? String(obj.project_id) : null, repository_inspected: Boolean(obj.repository_inspected) });
            continue;
          }
          if (type === "message_completed") { cb.onDone(streamMetaFrom(obj)); return; }
          if (type === "message_interrupted") {
            cb.onInterrupted?.(String(obj.content ?? ""), streamMetaFrom(obj));
            return;
          }
          if (type === "message_failed") {
            cb.onError(String(obj.error ?? "Generation failed"), String(obj.content ?? ""));
            return;
          }
        }
      }
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") return;
      cb.onError(err instanceof Error ? err.message : "Stream error");
    });

  return controller;
}

export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const status = err.response?.status;
    const detail = err.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0];
      if (first && typeof first.msg === "string") return first.msg;
    }
    if (status === 409) return "An account with this email already exists.";
    if (status === 401) return "Invalid email or password.";
    if (status === 403) return "You do not have permission to perform this action.";
    if (status === 422) return "Please check your input and try again.";
    if (status === 500) return "Something went wrong on the server. Please try again.";
    if (err.code === "ERR_NETWORK") return "Cannot reach the backend API. Please check your connection and try again.";
    return "Request failed. Please try again.";
  }
  return err instanceof Error ? err.message : "Unknown error";
}
