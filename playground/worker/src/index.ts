import type { Env } from "./env";
import { DEMOS, isDemoId, LAUNCH_ID_RE, type DemoId } from "./demos";
import { dispatch, dispatchPrivate, dispatchScanUrl, findRun, getArtifactZip, getJobs, getRun, GitHubError, scanWorkflowFile } from "./github";
import { parseArtifact, parseFixArtifact, parsePrivateArtifact, parseScanArtifact, PRIVATE_REPORT_ARTIFACT, type PrivateResult } from "./results";
import { privateDemoId, privateTarget } from "./privateDemo";
import { parseLaunchRequest } from "./validate";
import type { LimitConfig } from "./limits";

export { Coordinator } from "./coordinator";

// Room for a 300 character repository reference and a 200 character ref, plus JSON syntax.
const MAX_BODY = 1024;
const SCAN_URL_DEMO = "scan-url";
const NOT_FOUND_AFTER_MS = 6 * 60_000;

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = { vary: "origin" };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET, POST, OPTIONS";
    h["access-control-allow-headers"] = "content-type";
    h["access-control-max-age"] = "600";
  }
  return h;
}

const json = (env: Env, req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors(env, req), ...extra },
  });

const err = (env: Env, req: Request, status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  json(env, req, { error: { code, message } }, status, extra);

async function clientKey(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function limitConfig(env: Env): LimitConfig {
  const n = (v: string, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    enabled: env.LAUNCH_ENABLED !== "false",
    dailyCap: n(env.DAILY_CAP, 30),
    perClientPerHour: n(env.PER_CLIENT_LAUNCHES_PER_HOUR, 3),
    activeTtlMs: 25 * 60_000,
    retainMs: 7 * 24 * 3_600_000,
    proposeFixDailyCap: n(env.PROPOSE_FIX_DAILY_CAP ?? "", 3),
    proposeFixPerClientPerDay: n(env.PROPOSE_FIX_PER_CLIENT_PER_DAY ?? "", 1),
    scanUrlDailyCap: n(env.SCAN_URL_DAILY_CAP ?? "", 5),
    scanUrlPerClientPerDay: n(env.SCAN_URL_PER_CLIENT_PER_DAY ?? "", 1),
    privateDemoDailyCap: n(env.PRIVATE_DEMO_DAILY_CAP ?? "", 6),
    privateDemoPerClientPerDay: n(env.PRIVATE_DEMO_PER_CLIENT_PER_DAY ?? "", 2),
  };
}

/** The one switch for remediation. Anything but the exact string "true" means off. */
export const proposeFixEnabled = (env: Env) => env.PROPOSE_FIX_ENABLED === "true";

/** The one switch for scanning a repository by URL. Anything but the exact string "true" means off. */
export const scanUrlEnabled = (env: Env) => env.SCAN_URL_ENABLED === "true";

function publicStatus(run: { status: string; conclusion: string | null } | null): { status: string; conclusion: string | null } {
  if (!run) return { status: "queued", conclusion: null };
  if (run.status === "completed") return { status: "completed", conclusion: run.conclusion };
  return { status: run.status === "in_progress" ? "in_progress" : "queued", conclusion: null };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env, req) });

    const origin = req.headers.get("origin");
    if (origin && origin !== env.ALLOWED_ORIGIN) return err(env, req, 403, "forbidden_origin", "This origin is not allowed.");

    const coord = env.COORDINATOR.get(env.COORDINATOR.idFromName("global"));
    const client = await clientKey(req);

    try {
      if (url.pathname === "/api/health" && req.method === "GET") {
        return json(env, req, { ok: true, launchEnabled: env.LAUNCH_ENABLED !== "false", proposeFixEnabled: proposeFixEnabled(env), scanUrlEnabled: scanUrlEnabled(env), privateDemoAvailable: privateTarget(env) !== null });
      }

      if (url.pathname === "/api/launch" && req.method === "POST") {
        if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return err(env, req, 415, "bad_request", "Send JSON.");
        const text = await req.text();
        if (text.length > MAX_BODY) return err(env, req, 413, "bad_request", "Request too large.");
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return err(env, req, 400, "bad_request", "Invalid JSON.");
        }
        const parsed = parseLaunchRequest(body, { scanUrlEnabled: scanUrlEnabled(env), privateDemoId: privateDemoId(env) });
        if (!parsed.ok) return err(env, req, parsed.code === "scan_url_disabled" ? 403 : 400, parsed.code, parsed.message);
        const priv = "privateDemo" in parsed ? privateTarget(env) : null;
        if ("privateDemo" in parsed && !priv) return err(env, req, 503, "private_demo_unavailable", "This demo is not connected yet.");
        const scan = "scanUrl" in parsed ? parsed.scanUrl : null;
        const demoId = "demoId" in parsed ? parsed.demoId : null;
        const launchDemo = priv ? priv.id : scan ? SCAN_URL_DEMO : demoId!;
        // The request can only ask. The Worker setting decides: with it off, the field is ignored.
        const proposeFix = "proposeFix" in parsed && parsed.proposeFix && proposeFixEnabled(env);

        const r = await coord.reserve(client, launchDemo, limitConfig(env), proposeFix, scan ?? undefined, !!priv);
        if (!r.ok) {
          const msg: Record<string, string> = {
            disabled: "Launching is switched off right now.",
            busy: "Another demo is running. The Playground runs one at a time. Try again when it finishes.",
            rate_limited: "You have reached the hourly launch limit.",
            daily_cap: "The daily launch limit has been reached. Try again tomorrow.",
            fix_rate_limited: "You have used your remediation launch for today. A scan without remediation is still available.",
            fix_daily_cap: "The daily remediation limit has been reached. A scan without remediation is still available.",
            scan_url_rate_limited: "You have used your repository scan for today. The demos are still available.",
            scan_url_daily_cap: "The daily limit for repository scans has been reached. The demos are still available.",
            private_rate_limited: "You have used your launches of this demo for today. The other demos are still available.",
            private_daily_cap: "The daily limit for this demo has been reached. The other demos are still available.",
          };
          const status = r.reason === "disabled" ? 503 : 429;
          return err(env, req, status, r.reason, msg[r.reason], r.retryAfterSec ? { "retry-after": String(r.retryAfterSec) } : {});
        }
        const launchId = r.launchId!;
        try {
          if (priv) await dispatchPrivate(env, priv, launchId);
          else if (scan) await dispatchScanUrl(env, scan.repo, scan.ref, launchId);
          else await dispatch(env, DEMOS[demoId!].workflowDemo, launchId, proposeFix);
        } catch (e) {
          await coord.finish(launchId, true);
          console.error("dispatch failed", e instanceof Error ? e.message : e);
          return err(env, req, 502, "dispatch_failed", "Could not start the workflow. Try again shortly.");
        }
        if (priv) return json(env, req, { launchId, demoId: priv.id, proposeFix: false, status: "queued", conclusion: null }, 202);
        if (scan) return json(env, req, { launchId, demoId: SCAN_URL_DEMO, scanUrl: scan, status: "queued", conclusion: null }, 202);
        return json(env, req, { launchId, demoId, proposeFix, status: "queued", conclusion: null }, 202);
      }

      const m = url.pathname.match(/^\/api\/(status|results)\/([^/]+)$/);
      if (m && req.method === "GET") {
        const [, kind, id] = m;
        if (!LAUNCH_ID_RE.test(id)) return err(env, req, 400, "bad_request", "Invalid id.");
        if (!(await coord.allowRead(client, 60))) return err(env, req, 429, "rate_limited", "Too many requests.", { "retry-after": "30" });
        const launch = await coord.get(id);
        const isScan = !!launch?.scanUrl && launch.demo === SCAN_URL_DEMO;
        if (!launch || (!isScan && !launch.privateDemo && !isDemoId(launch.demo))) return err(env, req, 404, "not_found", "Unknown execution.");
        // A private launch is looked up in the private repository, with a token scoped to it. If the setting was
        // removed since the launch, there is nothing safe to query.
        const priv = launch.privateDemo ? privateTarget(env) : null;
        if (launch.privateDemo && !priv) return err(env, req, 503, "private_demo_unavailable", "This demo is not connected yet.");
        const wf = priv ? priv.workflowFile : isScan ? scanWorkflowFile(env) : env.WORKFLOW_FILE;

        let run = launch.runId ? await getRun(env, launch.runId, priv ?? undefined) : null;
        if (!run && !launch.runId) {
          run = await findRun(env, id, launch.createdAt, wf, priv ?? undefined);
          if (run) await coord.setRun(id, run.id);
        }
        const st = publicStatus(run);
        const lost = !run && Date.now() - launch.createdAt > NOT_FOUND_AFTER_MS;
        if ((st.status === "completed" || lost) && !launch.done) await coord.finish(id);

        if (kind === "status") {
          const jobs = run && run.status !== "queued" ? await getJobs(env, run.id, priv ?? undefined) : [];
          return json(env, req, {
            launchId: id,
            demoId: launch.demo,
            ...(isScan ? { scanUrl: launch.scanUrl } : {}),
            status: lost ? "completed" : st.status,
            conclusion: lost ? "failed_to_start" : st.conclusion,
            runUrl: run?.html_url ?? null,
            runId: run?.id ?? null,
            branch: run?.head_branch ?? priv?.ref ?? env.WORKFLOW_REF,
            workflow: wf,
            proposeFix: launch.proposeFix === true,
            createdAt: new Date(launch.createdAt).toISOString(),
            startedAt: run?.run_started_at ?? null,
            completedAt: st.status === "completed" ? run?.updated_at ?? null : null,
            jobs,
          });
        }

        // results
        if (!run || st.status !== "completed") return err(env, req, 409, "not_ready", "The run has not finished.");
        if (priv) {
          // Missing, expired or unreadable report: "incomplete", never "clean" and never an error page.
          let zip: Uint8Array | null = null;
          let downloadFailed = false;
          try {
            zip = await getArtifactZip(env, run.id, PRIVATE_REPORT_ARTIFACT, priv);
          } catch (e) {
            downloadFailed = true;
            console.error("private artifact failed", e instanceof GitHubError ? e.message : e);
          }
          const shaped: PrivateResult = parsePrivateArtifact(zip, st.conclusion, downloadFailed);
          return json(env, req, { launchId: id, demoId: launch.demo, runUrl: run.html_url, ...shaped });
        }
        if (isScan) {
          const sz = await getArtifactZip(env, run.id, "supplaiguard-report");
          if (!sz) return err(env, req, 404, "no_artifact", "No results were saved for this run (they may have expired).");
          return json(env, req, { launchId: id, demoId: launch.demo, runUrl: run.html_url, scanUrl: launch.scanUrl, ...parseScanArtifact(sz) });
        }
        const demoKey = launch.demo as DemoId;
        const zip = await getArtifactZip(env, run.id, `demo-triage-${DEMOS[demoKey].workflowDemo}`);
        if (!zip) return err(env, req, 404, "no_artifact", "No results were saved for this run (they may have expired).");
        let fix: unknown;
        if (launch.proposeFix) {
          // Separate artifact from the triage one. A failure here must not hide the triage results.
          try {
            const fz = await getArtifactZip(env, run.id, `propose-fix-${DEMOS[demoKey].workflowDemo}`);
            fix = fz ? { available: true, ...parseFixArtifact(fz, env.GITHUB_OWNER, env.GITHUB_REPO) } : { available: false, prUrl: null };
          } catch {
            fix = { available: false, prUrl: null };
          }
        }
        return json(env, req, { launchId: id, demoId: launch.demo, runUrl: run.html_url, ...parseArtifact(zip), ...(fix ? { fix } : {}) });
      }

      return err(env, req, 404, "not_found", "Not found.");
    } catch (e) {
      // Never forward GitHub's error text to the browser.
      console.error("request failed", e instanceof GitHubError ? e.message : e);
      return err(env, req, 502, "upstream_error", "The service could not reach GitHub. Try again shortly.");
    }
  },
};
