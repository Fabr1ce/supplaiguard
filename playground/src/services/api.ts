import type { Execution, Results, ScanUrlResults } from "../types/execution";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface Health {
  ok: boolean;
  launchEnabled: boolean;
  /** Absent on an older Worker: treated as off. */
  proposeFixEnabled?: boolean;
  /** Absent on an older Worker: treated as off. */
  scanUrlEnabled?: boolean;
}

/** The "Scan Your Own Repository" card is shown only when the service says scanning by URL is available. */
export const canScanUrl = (h: Health | null | undefined) => h?.scanUrlEnabled === true && h.launchEnabled;

/** The toggle is shown only when the service says remediation is available. */
export const canProposeFix = (h: Health | null | undefined) => h?.proposeFixEnabled === true && h.launchEnabled;

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

/** The request body. `proposeFix` is only sent when it is true: the Worker ignores it unless the service allows it. */
export const launchBody = (demoId: string, proposeFix = false) => JSON.stringify(proposeFix ? { demoId, proposeFix: true } : { demoId });

export const launchDemo = (demoId: string, proposeFix = false) =>
  request<{ launchId: string; demoId: string; proposeFix?: boolean; status: "queued" }>("/api/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: launchBody(demoId, proposeFix),
  });

/** Body for a scan by URL. `ref` is sent only when given. The Worker validates again and stays the authority. */
export const launchUrlBody = (repoUrl: string, ref?: string | null) => JSON.stringify(ref ? { repoUrl, ref } : { repoUrl });

export const launchRepo = (repoUrl: string, ref?: string | null) =>
  request<{ launchId: string; demoId: "scan-url"; scanUrl: { repo: string; ref: string | null }; status: "queued" }>("/api/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: launchUrlBody(repoUrl, ref),
  });

export const getStatus = (id: string) => request<Execution>(`/api/status/${encodeURIComponent(id)}`);
export const getResults = (id: string) => request<Results | ScanUrlResults>(`/api/results/${encodeURIComponent(id)}`);
export const getHealth = () => request<Health>("/api/health");
