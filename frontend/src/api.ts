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
}

export async function sendChat(messages: ChatMessage[], provider?: Provider): Promise<ChatResponse> {
  const { data } = await http.post<ChatResponse>("/api/chat", { messages, provider });
  return data;
}

export async function getLLMStatus(): Promise<LLMStatus> {
  const { data } = await http.get<LLMStatus>("/api/llm/status");
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
  onToken: (token: string) => void,
  onDone: (meta: StreamMeta) => void,
  onError: (msg: string) => void,
): AbortController {
  const controller = new AbortController();
  const url = `${baseURL}/api/chat/stream`;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, provider }),
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
        // SSE frames are separated by "\n\n"
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

