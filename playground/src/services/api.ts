import type { Execution, Results } from "../types/execution";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export const apiConfigured = BASE !== "";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) throw new ApiError("not_configured", "The Playground backend is not configured.", 0);
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ApiError("network", "Could not reach the Playground service. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(e?.code ?? "error", e?.message ?? "Something went wrong.", res.status, Number(res.headers.get("retry-after")) || undefined);
  }
  return body as T;
}

export const launchDemo = (demoId: string) =>
  request<{ launchId: string; demoId: string; status: "queued" }>("/api/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ demoId }),
  });

export const getStatus = (id: string) => request<Execution>(`/api/status/${encodeURIComponent(id)}`);
export const getResults = (id: string) => request<Results>(`/api/results/${encodeURIComponent(id)}`);
export const getHealth = () => request<{ ok: boolean; launchEnabled: boolean }>("/api/health");
