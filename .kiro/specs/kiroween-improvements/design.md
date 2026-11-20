# Design: Kiroween improvements

## Principle

Show the real thing. Every number, path and diff on the site is computed from scanner output or recorded run artifacts,
and a missing input removes the feature instead of being replaced by a mock. This follows the security policy
("structured, auditable output", "never a false all-clear") and answers the reviews' main complaint: the best idea
(attack paths) is invisible.

## K2. Attack paths

New module `scanner/attack_paths.py`, standard library only, called by `sg_scan.py` only when `--attack-paths` is given.

```
PATHS = [ PathRule(id, title, needs=[AnyOf(rule ids)...], scope, effect, cut) ... ]
compute(findings) -> [ {id, title, members:[finding id...], effect, cut} ]   # pure, deterministic, sorted
```

A member is satisfied by any finding whose `rule_id` (or `type` for dependency findings) is in its `AnyOf` set.
`scope` is `repo` (findings co-present in the scanned config set) or `component` (all members on the same component).
We say "co-present", not "connected": the scanner cannot prove that an agent uses a given MCP server, so the wording
never says an attacker can reach anything.

Initial catalog (each cites the existing rule ids; the text of each rule lives in code and is reviewed once):

| id | Needs | Scope | What the combination removes | Smallest cut |
|---|---|---|---|---|
| P-001 | (AGT-001 or AGT-004) + (MCP-001 or MCP-002) + SKL-002 | repo | The agent can run anything, no tool call is confirmed, and an instruction tells it to ignore safety | Remove the wildcard auto-approval on the MCP server |
| P-002 | MCP-003 + MCP-005 | component | An unpinned remote package runs with a hardcoded secret in its environment | Pin the package version and move the secret to an environment variable |
| P-003 | vulnerable_dependency + (AGT-001 or AGT-004) | repo | A known-vulnerable dependency sits next to an agent with unrestricted tools | Fix the dependency or restrict the agent's tools |
| P-004 | SKL-004 + (AGT-001 or AGT-002) | repo | A skill reads credential files into output and the agent can also run shell commands | Remove the read instruction or add a shell allow-list |

Output goes under a new `attack_paths` key. No flag means no key and no change. Existing property tests keep passing; new
properties cover K2.6. `--format text|html|md` render each path as a small graph (an inline SVG in HTML: nodes are
`rule id` + component, arrows show the order in `needs`, the cut is highlighted). Colours: the logo's green, purple and
orange on its dark ground, plus a cyan accent for "cut here" (taken from `pages2-ui.md`).

The Pages site (`build_site.py`) shows paths on each demo card and gets a "What an attack path is" explainer. The
agent-judged chains from the Threat Analysis `ANALYSIS_RESULT` block (already in the `reasoning-demo` spec, task 6.1)
are shown in a separate, labelled box.

## K3. Recorded run

```
docs/recorded-run/
  run.json        run id, date, scanner version, model, repo commit, outcome of verification
  before.json     scanner output with --attack-paths
  proposed.diff   the diff the Remediation agent proposed
  approval.txt    what the human approved (who, when, which files)
  after.json      scanner output after the fix
  verification.md the Verification agent's report
```

`scanner/record_run.py` assembles this folder from the files of a real run and refuses to write if a required input is
missing or if `after.json` is incomplete (exit code 2). `build_site.py` renders `recorded-run/index.html` from it:
before and after counts, paths cleared, the diff, the approval, and the verification outcome. The page reuses
`evolution_report.py` for the allow-listed counts. Tests use fixture bundles only. The real bundle comes from the owner's
interactive run (task 6).

## K4. Single status file

`docs/status.json` lists features with `state` (`works`, `experimental`, `planned`, `removed`) and an evidence link.
`scanner/render_status.py` writes the README status table between two markers and the Pages status page. A test fails if
the README block differs from the file, and fails if a `works` feature has no evidence link.

## K1, K7. Documents

`docs/submission.md`, `docs/demo-script.md`, `docs/writeup.md`, `docs/blog-outline.md`, `docs/social-post.md`. The README
gets a four-line opening block; everything else moves below it.

## K5. Pyodide spike (timeboxed)

Question: does the real rule code in `sg_scan.py` run unchanged in the browser? The scanner is one file with the
file-walking and OSV code mixed with the rule functions, so the likely work is exposing a pure
`scan_config_text(name, text) -> findings` entry point and testing it in Python first. If that is a small, tested refactor
the page loads Pyodide from a pinned URL, imports the same `sg_scan.py`, and runs on pasted text (no upload, no network).
If the refactor is large or the rules need duplicating, stop and record why.

## K6. Launcher: risks and design (build only after approval)

| Risk | Control |
|---|---|
| Anyone can spend Kiro credits and CI minutes | Read-only `demo-triage` only, concurrency 1, per-client rate limit, a daily cap, kill switch |
| Anyone can make the agent write or open PRs | `propose-fix` is not a parameter the Worker can send; the Worker has no input except a demo id |
| Stolen token | GitHub App installation token, Actions write on this repository only, stored as a Worker secret, short-lived |
| Dispatch returns no run id | Pass `launch_id` as a workflow input, set `run-name: ... ${{ inputs.launch_id }}`, list recent runs and match the name |
| CORS is not authentication | CORS limits browsers only; the caps above are what protect the service |
| Misleading success | The page shows run status; "completed" never implies "fixed" |

The workflow change needed is small: an optional `launch_id` input and a `run-name`. It does not change any step.

## Decisions needed from the owner

1. K6: build the launcher, or keep the Pages site read-only. (Recommendation: skip unless time remains after K1 to K4 and K7;
   the existing Pages site and recorded run already give judges a login-free demo.)
2. K5: approve the one-day spike.
3. K8: build a small Kiro Power and a Kiro Crew repo, or remove those claims.
4. K1.2: approve changing the repository homepage and topics.
5. K3: schedule the interactive recorded run.
