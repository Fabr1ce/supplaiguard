import { isDemoId, type DemoId } from "./demos";

/** Fields a launch request may carry. Anything else is rejected. */
const ALLOWED_KEYS = new Set(["demoId", "proposeFix"]);

export type LaunchRequest =
  | { ok: true; demoId: DemoId; proposeFix: boolean }
  | { ok: false; code: "unknown_demo" | "bad_request"; message: string };

/** Strict parse of the launch body: a plain object, a known demo, and `proposeFix` only as a real boolean. */
export function parseLaunchRequest(body: unknown): LaunchRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "unknown_demo", message: "Unknown demo." };
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) return { ok: false, code: "unknown_demo", message: "Unknown demo." };
  if (!isDemoId(o.demoId)) return { ok: false, code: "unknown_demo", message: "Unknown demo." };
  if ("proposeFix" in o && typeof o.proposeFix !== "boolean") return { ok: false, code: "bad_request", message: "proposeFix must be true or false." };
  return { ok: true, demoId: o.demoId, proposeFix: o.proposeFix === true };
}
