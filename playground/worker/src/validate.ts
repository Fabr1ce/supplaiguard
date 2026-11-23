import { isDemoId, type DemoId } from "./demos";
import { parseRepoRef } from "./repoRef";

const DEMO_KEYS = new Set(["demoId", "proposeFix"]);
const URL_KEYS = new Set(["repoUrl", "ref"]);

export type LaunchFailure = {
  ok: false;
  code: "unknown_demo" | "bad_request" | "scan_url_disabled" | "invalid_repo";
  message: string;
};

export type LaunchRequest =
  | { ok: true; demoId: DemoId; proposeFix: boolean }
  /** The private demo. `proposeFix` is not offered for it: any value is type-checked and then ignored. */
  | { ok: true; privateDemo: string }
  /** Scan by URL. `repo` is the normalized owner/repo and `ref` the validated branch or tag: the only values ever passed on. */
  | { ok: true; scanUrl: { repo: string; ref: string | null } }
  | LaunchFailure;

const unknownDemo: LaunchFailure = { ok: false, code: "unknown_demo", message: "Unknown demo." };

/**
 * Strict parse of the launch body. Exactly one of two forms:
 *  - demo:  { demoId, proposeFix? }
 *    `opts.privateDemoId` (from the Worker's own config, never from the request) adds exactly one more accepted id.
 *  - scan:  { repoUrl, ref? }   (only when `scanUrlEnabled`; otherwise rejected, there is no safe fallback)
 * Unknown fields, wrong types, both forms together, or neither are rejected.
 */
export function parseLaunchRequest(body: unknown, opts: { scanUrlEnabled?: boolean; privateDemoId?: string | null } = {}): LaunchRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return unknownDemo;
  const o = body as Record<string, unknown>;
  const keys = Object.keys(o);
  const isScan = keys.some((k) => URL_KEYS.has(k));

  if (isScan) {
    if (keys.some((k) => DEMO_KEYS.has(k))) return { ok: false, code: "bad_request", message: "Send either a demo or a repository, not both." };
    if (keys.some((k) => !URL_KEYS.has(k))) return { ok: false, code: "bad_request", message: "Unexpected field." };
    if (!opts.scanUrlEnabled) return { ok: false, code: "scan_url_disabled", message: "Scanning by URL is switched off." };
    if (!("repoUrl" in o)) return { ok: false, code: "bad_request", message: "repoUrl is required with ref." };
    if (typeof o.repoUrl !== "string") return { ok: false, code: "bad_request", message: "repoUrl must be a string." };
    if ("ref" in o && o.ref !== null && typeof o.ref !== "string") return { ok: false, code: "bad_request", message: "ref must be a string." };
    const r = parseRepoRef(o.repoUrl, "ref" in o ? o.ref : undefined);
    if (!r.ok) return { ok: false, code: "invalid_repo", message: r.message };
    return { ok: true, scanUrl: { repo: r.slug, ref: r.ref } };
  }

  for (const k of keys) if (!DEMO_KEYS.has(k)) return unknownDemo;
  const isPrivate = !!opts.privateDemoId && o.demoId === opts.privateDemoId;
  if (!isPrivate && !isDemoId(o.demoId)) return unknownDemo;
  if ("proposeFix" in o && typeof o.proposeFix !== "boolean") return { ok: false, code: "bad_request", message: "proposeFix must be true or false." };
  if (isPrivate) return { ok: true, privateDemo: o.demoId as string };
  return { ok: true, demoId: o.demoId as DemoId, proposeFix: o.proposeFix === true };
}
