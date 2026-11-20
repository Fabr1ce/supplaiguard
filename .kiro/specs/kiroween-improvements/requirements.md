# Requirements: Kiroween improvements

Background and verdicts: see `review-synthesis.md`. Deadline: **Fri 2026-12-04, 2:00 PM PT**. Requirement ids `K1` to
`K8`. Existing requirement ids (R*, D*) are unchanged. Nothing here weakens the security policy.

## K1. Judge-first presentation

**User story:** As a judge, I want to understand the project in 15 seconds and find a working link, so that I
look at the demo.

1. THE README SHALL open, before any detail, with: what it is (one sentence), why it matters (the attack-path
   point), what to click (the Pages URL), and one real result (before and after counts from a recorded run).
2. THE repository SHALL have a homepage URL (the Pages site) and topics set. These are repository settings, so they SHALL
   be changed only after the owner approves.
3. THE README SHALL move the long "Why agents" and Kiro-feature tables below that first screen without deleting them.
4. Eligibility evidence (first commit date, license, `.kiro` not ignored) SHALL be recorded in `docs/submission.md`.

## K2. Attack paths (the differentiator, shown)

**User story:** As a judge, I want to see how separate findings combine into one risk, so that I see what a normal
scanner does not show.

1. THE scanner SHALL provide `--attack-paths`, which adds an `attack_paths` list to its JSON output. Without the flag the
   output SHALL be byte-for-byte what it is today (no schema change for existing consumers).
2. A path SHALL come from a **catalog of combination rules** in code. Each rule names the finding rule ids it needs,
   what the combination allows in plain words, and the single smallest change that cuts it. A path SHALL be emitted only
   when **every** member finding is present, and SHALL list those finding ids.
3. A path SHALL be described as a *combination of findings that together remove safeguards*. It SHALL NOT claim the
   path is exploitable, and no model is involved in producing it.
4. Agent-judged chains (from the Threat Analysis agent) SHALL be shown separately and labelled as model output.
5. THE text report, the HTML report and the Pages site SHALL show each path as a small graph: nodes are the findings
   (rule id and component), edges show the order, and the "cut here" change is marked.
6. Property tests SHALL show: no path without all its members; removing any member removes the path; a path never
   contains a finding that is not in the input; output is deterministic.

## K3. A recorded run: find, propose, approve, fix, verify

**User story:** As a judge, I want to watch one complete real run, so that I believe the loop works.

1. THE repository SHALL contain `docs/recorded-run/` with the real artifacts of one full local coordinator run: scan
   before, the proposed diff, the approval, scan after, the Verification result. Each file SHALL carry the run id,
   date, scanner version and model name.
2. THE Pages site SHALL have a "Recorded run" page built **only** from those files. If the files do not exist the page
   SHALL not exist. No number SHALL be typed by hand.
3. THE page SHALL show before and after finding counts and attack paths, the diff, the point where a human approved,
   and the verification outcome (PASS, FAIL, NEEDS_REVIEW or INCOMPLETE). A failed or partial run SHALL be shown as such.
4. THE recorded run requires interactive approvals, so it SHALL be performed by the repository owner. The tooling to
   capture and publish it SHALL be built and tested first with fixture data.

## K4. Honest status

1. THE README, the Pages site and the write-up SHALL separate what runs today from what is experimental or planned.
2. A feature that will not be built before the deadline SHALL be removed from the claims, not left as "planned".
3. THE Pages site SHALL show a status table (feature, state, evidence link) generated from one file, so the README and
   the site cannot disagree.

## K5. In-browser scanner (timeboxed spike)

1. A spike of at most one day SHALL test running the real `sg_scan.py` rule code in the browser with Pyodide. Success
   means a judge can paste an MCP config or agent JSON and see findings, with **no upload** and no network call.
2. THE dependency lookup (OSV) is a separate step and MAY be excluded. Only package coordinates would ever be sent.
3. IF the scanner cannot run in the browser without duplicating its rules in another language THEN the spike SHALL be
   dropped. Duplicated rules drift from the tested ones.
4. THE page SHALL state that it checks configuration only, and SHALL link to the full scanner.

## K6. Public launch button (gated on owner decision)

Built only if the owner approves after reading the risks in `design.md`.

1. A Cloudflare Worker SHALL accept a fixed demo id and start the **read-only** `demo-triage` workflow for that demo.
   It SHALL NOT accept a repository, branch, workflow file or input from the client, and `propose-fix` SHALL be
   impossible to set from it.
2. Credentials SHALL be a GitHub App installation token held as a Worker secret, with Actions write on this repository
   only. Nothing secret SHALL reach the browser or any response.
3. THE Worker SHALL enforce: concurrency of 1, a per-client rate limit, a daily cap, request timeouts, CORS limited to the
   Pages origin, and a kill switch that disables launching without a deploy.
4. THE Worker SHALL correlate a launch to its run with a unique id passed as a workflow input and used in `run-name`,
   because the dispatch response contains no run id.
5. THE page SHALL show real run status only (queued, in progress, completed, failed) and link to the results page. A
   successful run SHALL NOT be shown as a successful remediation.

## K7. Submission assets

1. `docs/demo-script.md`: a script under 3 minutes: hook, setup, discovery, attack path, approved fix, verification, Kiro
   features, close. Every claim in it SHALL point to something that exists.
2. `docs/writeup.md`: the Devpost text, one section per Kiro feature, with repo pointers. The property-based-testing
   section SHALL describe a **real** bug the properties caught, found in the history, or SHALL say plainly that none is recorded.
3. `docs/blog-outline.md` and `docs/social-post.md` for the bonus prizes.
4. `docs/submission.md`: a checklist of the rules (public repo, license, `.kiro`, demo URL, video, category Frankenstein).

## K8. Kiro feature gaps

1. THE owner SHALL decide whether to build a small **Kiro Power** and a **Kiro Crew** app. If built, Crew SHALL be a
   separate public repository with its own README (R18.7).
2. IF a gap is not built THEN K4.2 applies: remove the claim.

## Out of scope

The React/Vite/Tailwind/shadcn/Durable-Objects application, an animated network visualization, and any change to
existing agents, scanner rules, workflows, or security policy.
