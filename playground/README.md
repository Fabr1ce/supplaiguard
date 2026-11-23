# SupplAIGuard Security Playground

A web page where a judge picks one of four intentionally vulnerable demos, starts the real `demo-triage` GitHub Actions
workflow with one click, watches its steps, and reads the findings.

## What a launch really does

`demo-triage.yml` runs the deterministic scanner on the demo, then (only if the repository has a `KIRO_API_KEY` secret)
a **read-only** Kiro agent that writes triage notes. It changes no files, opens no pull request and does not verify a fix.
The Playground says so on every screen: a finished run is never shown as a remediation. The Remediate and Verify
stages of the full SupplAIGuard loop need a developer's approval and are not started from this page, **unless the optional
remediation flag below is on**.

## Remediation flag (`PROPOSE_FIX_ENABLED`, off by default)

Lets a visitor ask the Remediation agent to propose a fix. The result is a **draft pull request** for a person to review.
Nothing merges automatically, and the Playground never claims a fix is verified.

**Where it is set.** Only in the Worker: `PROPOSE_FIX_ENABLED` in `worker/wrangler.toml` (`[vars]`), or in the Cloudflare
dashboard under Settings > Variables, no deploy needed. Only the exact string `"true"` turns it on. Unset, `"false"`, `"TRUE"`
or anything else is off. Nothing in a browser request can turn it on.

**How it flows.**
1. The Worker's `/api/health` reports `proposeFixEnabled`. The page shows the toggle ("Also let the agent propose a fix") only when
   that is true. The toggle starts off on every page load and is never stored.
2. With the toggle on, the page sends `{ "demoId": "...", "proposeFix": true }` to `POST /api/launch`. The body is parsed strictly
   (`worker/src/validate.ts`): `proposeFix` must be a real boolean, and any unknown field is rejected with 400.
3. The Worker forwards it only if the request asked **and** the setting is on (`worker/src/index.ts`). With the setting off the field is
   ignored and a normal read-only scan starts. When forwarded, the dispatch carries the workflow input `propose-fix: "true"`
   (`worker/src/github.ts`); otherwise the input is not sent and the workflow default (false) applies.
4. `demo-triage.yml` runs its `propose-fix` job. The agent edits a copy, `scanner/fix_gate.py` allow-lists the changes, the scanner re-runs,
   and a draft PR is opened. The job saves `gate.json`, `report.json` and `pr-url.txt` in the `propose-fix-<demo>` artifact.
5. `/api/results/:id` reads that artifact for launches that asked for it and returns the PR link (only if it is a pull request URL of this
   repository), the gate outcome and the scanner re-check. The agent's own text is not passed on. If the artifact has expired, the page says
   so and links to the workflow run.

**Limits, tighter than normal launches.** A remediation launch also counts against the normal limits (one active run, 3 per client per hour,
30 per day) and additionally: `PROPOSE_FIX_PER_CLIENT_PER_DAY` (default 1) and `PROPOSE_FIX_DAILY_CAP` (default 3 per UTC day).

**Cost and risk.**
* Each remediation run uses `KIRO_API_KEY` credits for the agent, on top of the triage run.
* Each run can open a draft PR and push a branch `supplaiguard/fix-<run>-<demo>`: a public page that anyone can trigger can add PR noise. Keep the daily cap low.
* The repository must allow it: Settings > Actions > General > **Allow GitHub Actions to create and approve pull requests**. Without it the job fails at the PR step.
* The `propose-fix` job is the only job with `contents: write` and `pull-requests: write`. The GitHub App the Worker uses still has only `actions: write`.
* The agent only sees wrapped, untrusted scanner output, and the gate refuses source, secrets, workflows and `.git`. Not yet run end to end against GitHub.

**Turn it off.** Set `PROPOSE_FIX_ENABLED` to `"false"` (dashboard or `wrangler.toml` and redeploy). The toggle disappears from the page
and any `proposeFix` request is ignored. To also stop it at the source, leave the `propose-fix` workflow input alone (default false) or remove the
`KIRO_API_KEY` secret (the job then fails before doing anything).

## Scan By URL Flag (`SCAN_URL_ENABLED`, off by default)

Lets a visitor name a **public GitHub repository** and have SupplAIGuard scan it. It is the Playground version of the CLI
`sg_scan.py --github OWNER/REPO` and of the manual workflow `scan-repo.yml`. It uses the deterministic scanner only: no agent, no
model, no secrets. Nothing from the scanned repository is executed, installed or built.

**Status.** `scan-repo.yml` ran live once by manual dispatch (run 45071479996: deterministic scan, summary and artifact steps succeeded; see
`docs/status.md`). The Playground-triggered path has **not run live**. It is covered by fixtures and unit tests only (the validator against the
Python reference, the Worker with a mocked GitHub, the results shaping, the UI services). The Worker dispatch by `launch_id`, the run lookup by
`run-name`, the artifact download and the results shaping are unverified against real GitHub.

**Deterministic only.** URL scans are deterministic only. No agent or model runs on a scanned repository, because it is untrusted and the triage
agent needs a secret. Agent triage is available on the four demos.

**Where it is set.** Only in the Worker: `SCAN_URL_ENABLED` in `worker/wrangler.toml` (both `[vars]` and `[env.dev.vars]`, default `"false"`), or in
the Cloudflare dashboard under Settings > Variables, no deploy needed. Only the exact string `"true"` turns it on. Unset, `"false"`, `"TRUE"`, `"1"`
or anything else is off. Nothing in a browser request can turn it on.

**How it flows.**
1. `/api/health` reports `scanUrlEnabled`. The page shows the "Scan Your Own Repository" card only when that is true (and launching is on).
   With the flag off no input is rendered at all.
2. The card checks the two fields in the browser with a copy of the Worker's validator (`src/services/repoRef.ts`, kept byte-identical by a test)
   and shows inline errors. This is a convenience only. The Worker is the authority.
3. The page sends `POST /api/launch` with `{ "repoUrl": "...", "ref": "..." }` (`ref` optional). A request is **either** that form **or** the demo
   form `{ "demoId": ... }`. Both together, neither, unknown fields and wrong types get a 400. With the flag off, a repository request is rejected with
   a **403** `scan_url_disabled`. It is not silently turned into a demo, because there is no safe fallback.
4. The Worker validates the reference (`worker/src/repoRef.ts`) before any reservation or network call and keeps only the normalized `owner/repo` and
   the validated ref. It reserves a slot in the Durable Object (same limits as every launch, plus the URL limits below).
5. The Worker dispatches `scan-repo.yml` on `WORKFLOW_REF` with the inputs `repo`, `ref` (empty string when none) and `launch_id`. Only the
   normalized values are sent. The workflow validates again with its own regex, then the scanner's guard (`scanner/sg_guard.py`) validates a third time.
6. `scan-repo.yml` has the run name `Scan repo <launch_id>`. The Worker finds the run by that id, as it does for the demos, and the Execution page shows the
   real job and step names (the single job `scan`, with the `Scan` step that clones and scans).
7. `/api/results/:id` downloads the `supplaiguard-report` artifact and returns only: the normalized repository (`github.com/owner/repo@sha7`),
   counts by severity, a count of findings that read like instructions to an agent, the exit code and status, fixed reason codes, and the run link.
   No finding text, error message or file name from the repository is passed on or shown.

**What the result can say.** The exit code keeps the scanner's meaning: 0 clean, 1 findings, 2 scan errors or incomplete. A failed fetch, a limit
(truncated file list, oversized files, skipped links), any scanner error, a missing or unreadable report, or a recorded exit code of 2 all give status
`incomplete`, shown as "NOT a clean result". The worker fails closed: anything missing is incomplete, never clean. A clean scan that recognised nothing
(no MCP config, agent file, skill, lockfile or requirements file) says so.

**Limits, tighter than normal launches.** A URL scan also counts against the normal limits (one active run at a time, 3 per client per hour, 30 per day)
and additionally: `SCAN_URL_PER_CLIENT_PER_DAY` (default 1) and `SCAN_URL_DAILY_CAP` (default 5 per UTC day). A launch whose dispatch fails is refunded.
Input limits: reference up to 300 characters, branch or tag up to 200, request body up to 1 KB.

**Validation rules.** A TypeScript port of `scanner/github_fetch.py` `parse_github_ref` and the user-string checks in `scanner/sg_guard.py`.
Only `https://github.com/<owner>/<repo>[.git][/tree/<ref>]` or `owner/repo` is accepted. The owner is 1 to 39 characters of letters, digits and hyphens, and does not
start with a hyphen. The repo is 1 to 100 characters of letters, digits, `.`, `_` and `-`. The ref is 1 to 200 characters of letters, digits, `.`, `_`, `/` and `-`, with no leading
`-` or `/`, no trailing `/` or `.lock`, no `..` and no `//`. Rejected: other hosts and schemes, credentials, ports, queries, non-ASCII or IDN text, control,
bidi, zero-width and tag characters, percent-encoding, backslashes, newlines and other whitespace inside the value, and repo or ref text that reads like an
instruction to an agent or contains a long non-hex encoded blob. Both validators run against the same inputs: `scanner/tests/fixtures/injection_corpus.json`
and `scanner/tests/fixtures/github_ref_cases.json` (expectations generated from the Python code and checked by `scanner/tests/test_github_ref_cases.py`
and `worker/test/repoRef.test.ts`). Known differences: error messages differ (the Worker uses fixed text that never echoes the input), and the Worker counts length in
code points, like Python, but a `ref` of `""` is rejected like the CLI does. The Python guard is the reference. Change both together.

**Cost and abuse risks.**
* Each scan uses about one GitHub Actions run (a few minutes on a hosted runner). Anyone who can reach the page can trigger one, so keep the caps low.
* Visitors choose the repository, so the run can fetch arbitrary public content from github.com. The clone is shallow and size-limited, hooks are off, submodules are off,
  and nothing in it is run. Dependency lookups send package names and versions to OSV.dev (see `docs/security-model.md`).
* The run log and artifacts of this project's repository name the scanned repository. The scanned repository's text can appear in the job summary and the HTML report,
  where the scanner escapes it. The Playground shows none of it.
* Artifacts expire after 14 days, and downloading one needs a GitHub login, so the page links to the run instead of embedding the report.
* The 429 and 403 replies come from the Worker, never from GitHub's text.

**GitHub App permissions.** No new permission. The Worker's App keeps `Actions: Read and write` and `Metadata: Read-only` on this repository only. That covers
dispatching `scan-repo.yml` (a second workflow file in the same repository), listing its runs and reading its artifacts. `scan-repo.yml` itself has
`permissions: {}` at the top and `contents: read` on its one job, and uses no secrets. The workflow file name is the Worker variable
`SCAN_URL_WORKFLOW_FILE` (default `scan-repo.yml`). The workflow must exist on `WORKFLOW_REF` (default `main`) with the `launch_id` input.

**Turn it off.** Set `SCAN_URL_ENABLED` to `"false"` (dashboard, or `wrangler.toml` and redeploy). The card disappears and any repository request gets a 403.
To stop it at the source, disable the `scan-repo.yml` workflow in the repository's Actions settings.

## Laboratory Atmosphere

While a run is queued or in progress, the Execution page gets a laboratory mood: a purple and green glow, occasional forked bolts behind the page, a slow arc between two electrodes, and a pulse on the running step. The storm grows as the run moves through its real steps. A successful run ends with a green "alive" glow. A failed or cancelled run fades to a dim, cold state with no celebration.

A rotating line of Frankenstein flavour text (public-domain novel and general gothic tropes only) sits above the real status, for example "Deterministic scan: running". The flavour never replaces the status. The "It lives. Results are ready." line appears only when the real run conclusion is success, and a one-time "Step complete" line appears only for a step that really finished with success.

Accessibility and safety:

- The effects are decorative: `aria-hidden`, `pointer-events: none`, low opacity, and behind all content.
- With `prefers-reduced-motion` all animation stops and only a static glow remains.
- Each bolt flashes once every 8 to 20 seconds and no flash is a hard on/off cut, so the page stays far below 3 flashes per second.
- Only the real status line is a polite live region. The rotating flavour text is hidden from screen readers.

To edit the messages, change the catalogue in `src/services/flavor.ts` (`RUNNING`, `STEP_DONE`, `RUN_SUCCESS`, `RUN_FAILURE`, `RUN_CANCELLED`). Keep 4 to 6 running lines per step, 80 characters or fewer, no em dashes, and no words like "success", "passed" or "complete" outside the branches that earn them. `npm test` enforces these rules.

To preview without a backend, run `npm run dev` and open `#/run/test?demo=sim`. Add `&end=failure` or `&end=cancelled` to see the cold ending, and `&fix=1` to include the propose-fix job. The simulator exists only in dev builds.

## Architecture

```
Browser (GitHub Pages, /supplaiguard/playground/)
   │  POST /api/launch {demoId}      GET /api/status/:id      GET /api/results/:id
   ▼
Cloudflare Worker ── Durable Object "Coordinator" (limits, launch records)
   │  GitHub App installation token (Actions only, this repository only)
   ▼
GitHub REST API ── workflow_dispatch demo-triage.yml {demo, launch_id}
```

* The browser only sends a demo id. Repository, workflow file, branch and inputs are fixed in the Worker
  (`worker/src/demos.ts`, `wrangler.toml`).
* **Correlation.** `workflow_dispatch` returns no run id. The Worker creates a launch id (`pg-` + 12 hex), passes it as the
  `launch_id` input, and the workflow's `run-name` contains it. Status calls list recent runs and match that name. The id the
  browser holds is the launch id, never a GitHub run id, so the browser cannot ask about arbitrary runs.
* **Limits** (Durable Object, `worker/src/limits.ts`): one active launch globally, 3 launches per client per hour, 30 per UTC day,
  60 read calls per client per minute, tighter limits for remediation launches (see the remediation flag), a 25 minute cap on how long a lost run can hold the slot, and a kill switch
  (`LAUNCH_ENABLED="false"`, changeable in the Cloudflare dashboard without a deploy). CORS is limited to the Pages
  origin, and requests from other origins are rejected. CORS is not authentication; the limits are the protection.
* **Results.** After a run completes, `/api/results/:id` downloads the `demo-triage-<demo>` artifact, and returns an allow-listed, size-limited
  version of `findings.json`, the agent notes and two counters. Agent text is untrusted and is shown as plain text.
* Card findings (`src/data/demos.json`) are generated from real scanner output by `scripts/gen_demos.py`. Do not edit by hand.

## Demo mapping

| Demo id (sent by the browser) | Workflow input `demo` |
|---|---|
| `vulnerable-ai-app` | `vulnerable-ai-app` |
| `haunted-storyteller` | `haunted-storyteller` |
| `crypt-keeper-mcp` | `crypt-keeper-mcp` |
| `seance-gateway` | `seance-gateway` (choice added to `demo-triage.yml`) |

The only change to `demo-triage.yml` besides the new choice: an optional `launch_id` input, a `run-name`, and a publish-job
step that builds this app into the Pages artifact.

## Local development

```bash
# Worker (needs a GitHub App to launch; without one, /api/health and input validation still work)
cd worker && npm install
printf 'GITHUB_APP_ID=...\nGITHUB_APP_PRIVATE_KEY="$(cat app-pkcs8.pem)"\n' > .dev.vars   # gitignored
npm run dev            # http://localhost:8787, CORS allows http://localhost:5173
npm test && npm run typecheck

# Frontend
cd .. && npm install && cp .env.example .env.local
npm run dev            # http://localhost:5173/supplaiguard/playground/
npm test && npm run build
```

Development and production are separate: `wrangler.toml` has `[vars]` for production and `[env.dev]` for local use.

## GitHub App (recommended)

1. GitHub > Settings > Developer settings > GitHub Apps > New. No webhook. Repository permissions: **Actions: Read and write**, Metadata: Read-only. Nothing else.
2. Install it on **only** `Fabr1ce/supplaiguard`.
3. Generate a private key (`.pem`). Convert it to PKCS#8, which WebCrypto needs:
   `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem`
4. Store the secrets in the Worker (never in the repository):
   ```bash
   cd worker
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem
   ```
The Worker asks GitHub for a short-lived installation token limited to this repository and `actions: write`.
A fine-grained PAT (Actions read/write on this repository) would also work as a temporary stand-in but is not implemented.

## Deploy

**Worker:** `cd worker && npm ci && npx wrangler deploy`. Copy the `workers.dev` URL.

**Pages:** the existing `demo-triage.yml` publish job builds `playground/` and copies it to `/playground/` of the results site, so
the Playground and the results share one Pages deployment and neither replaces the other.
1. Repository Settings > Secrets and variables > Actions > **Variables**: add `PLAYGROUND_API_URL` = the Worker URL (no trailing slash).
2. Run the **Demo triage** workflow once (any demo). The Playground is then at `https://fabr1ce.github.io/supplaiguard/playground/`.
3. If the Worker's `ALLOWED_ORIGIN` differs from the Pages origin, change it in `wrangler.toml` and redeploy.

The workflow must exist on the `main` branch (`WORKFLOW_REF`), because that is the ref the Worker dispatches.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "The backend is not configured" | `PLAYGROUND_API_URL` was not set when the site was built. Set it and re-run Demo triage. |
| `dispatch_failed` | App not installed on the repository, wrong key format (must be PKCS#8), or `demo-triage.yml` on `main` lacks the `launch_id` input. See `wrangler tail`. |
| Run stays "Waiting for GitHub" then "did not start" | The dispatch succeeded but no run named with the launch id appeared in 6 minutes. |
| "Another demo is running" | One launch at a time. A lost run frees the slot after 25 minutes. |
| Agent step shows Skipped | The repository has no `KIRO_API_KEY` secret. The scan still runs and results are shown. |
| Browser CORS error | `ALLOWED_ORIGIN` does not equal the page's origin exactly. |
| Results say not available | Artifacts expire after 14 days. |
