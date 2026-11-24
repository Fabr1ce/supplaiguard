# Status

This page separates what is tested, what is implemented but never run live, and what is only planned. The evidence is the specs' task lists (`.kiro/specs/*/tasks.md`), the test suite (544 tests passed when this page was written) and `git log`. Some task checkboxes in `.kiro/specs/supplaiguard/tasks.md` lag behind the code (for example task 22.1 is unchecked, but the `propose-fix` job exists in `demo-triage.yml`). Where they disagree, this page follows the code and says so.

## Implemented And Tested

| Capability | Evidence |
|---|---|
| Deterministic scanner: MCP, agent and skill rules, OSV dependency checks, suppressions, reports, exit codes | `scanner/tests/test_properties.py` (property-based tests with Hypothesis) and the other files in `scanner/tests/`. Tasks 20.1, 20.7, 20.8, 21.1. |
| Input guard, injection detector, `wrap_untrusted` | `test_sg_guard.py`, `test_scan_injection.py`. Scan-github-repo tasks 2.x. |
| Hardened shallow clone and `--github` | `test_github_fetch.py`, `test_github_fetch_clone.py`, `test_github_cli.py`. A hostile repository is tested end to end through a local fixture (`test_hostile_repo_end_to_end`). |
| Agent permission policy (read-only roles, scoped writes, denied merges and pushes) | `scanner/tests/test_agent_policy.py`. Tasks 33.1, 33.2. |
| Fix gate | `test_fix_gate.py`. |
| Sanitized evolution report | `test_evolution_report.py`. |
| Results site builder | `test_build_site.py`. |
| Workflow policy checks (permissions, pins, wrapped findings, draft only) | `test_scan_repo_workflow.py`, `test_agent_policy.py`. |
| Workflow expression lint | `test_workflow_expressions.py` rejects functions GitHub does not support in `${{ }}`. |
| Learn, local part (`--history`, `--learn-report`) | Tasks 34.1 to 34.3, property tests. |
| Text report | Task 32. |
| Global install script | README status line and `install.sh --dry-run`. |
| Playground Worker validation, limits, results shaping | `playground/worker/test/*.test.ts`. Kiroween tasks 9.2, 9.3. |

## Ran Live On GitHub

| Capability | Evidence |
|---|---|
| Reusable scan through `self-scan.yml` | Task 20.5: first real run on PR #3 verified inputs, SHA fetch, summary, artifact and the failing gate. It exposed a `bash -e` bug that tests had missed, since fixed. The post-merge check that a push to `main` passes is still listed as open. |
| Headless agent triage in `scan.yml` | Task 20.6a: two live runs on 2026-11-15. The first failed (install step lacked the key), the second passed. The triage text has had little review. |
| `scan-repo.yml` by manual dispatch | [Run 45071479996](https://github.com/Fabr1ce/supplaiguard/actions/runs/45071479996), `workflow_dispatch` on `main` at commit `45a6b33`, 2026-11-22. The single job `scan` succeeded in about 10 seconds. Steps: Validate inputs, Check out SupplAIGuard, Set up Python, Scan, Publish job summary, Upload report, Gate. Verified through the public GitHub API. The report contents were not inspected, so this page makes no claim about the repository scanned or its findings. Task 9.2 of scan-github-repo (two public repositories, one with findings and one without) stays open. |
| `demo-triage.yml` and the Pages results site | README: "Used by the demo site since the Pages commits in PR #6 and #7". Commits `172d3b7` and `39b91e5`. |

## Implemented But Never Run Live

| Capability | Why it is unproven |
|---|---|
| `propose-fix` job opening a draft pull request | The README and the workflow header say it was never run on GitHub. Needs `KIRO_API_KEY` and the Actions setting for pull requests. |
| Playground `proposeFix` toggle and result view | Depends on the job above. The README says "Not yet run end to end against GitHub". |
| Playground Worker deployed and launching real runs | The repository has the code, tests and deploy notes. It records no live launch. |
| Playground scan by URL (`SCAN_URL_ENABLED`) | Off by default. The Playground-triggered path is unverified: the Worker dispatch by `launch_id`, the run lookup, the artifact download and the results shaping are covered by fixtures and unit tests only. The manual dispatch of `scan-repo.yml` ran live (see above). |
| `report-fix.yml` and `examples/consumer-report-fix.yml` | Task 25.2: written, not run against a real merged fix pull request. Its last commit removed an invalid `split()` expression. |
| Full interactive coordinator run | Tasks 13.3, 13.4, 13.7, 19.2 and 33.5 are open: write prompts, verification honesty, the `Stop` hook review and the branch and pull request flow were never observed live. |
| Dependabot behavior assumptions | Task 20.2 spike is open. |

## Planned Or Not Started

| Item | Evidence |
|---|---|
| Turning evolution reports into rule or skill changes (R17.2, R17.5) and an acceptance gate | Tasks 25.3 and the README. No `evolution/` directory exists. |
| Kiro Crew steward | Tasks 26.x. No code. |
| Kiro GitHub app for review comments on fix PRs | Task 22.3. |
| `--baseline FILE` for new versus fixed findings | Task 20.9. |
| Attack paths (`scanner/attack_paths.py`), a recorded run, an in-browser scanner spike, a status JSON | `.kiro/specs/kiroween-improvements/tasks.md` tasks 1 to 8 are unchecked. None of those files exist. |
| Reasoning demo scenarios (`demo/seance-gateway` ground truth, scorer) | `.kiro/specs/reasoning-demo/tasks.md`: only the feasibility tasks are done. `seance-gateway` exists as a skeleton and a choice in `demo-triage.yml`. |
| Submission material (video, write-up, blog post) | Tasks 28 to 31. |
| Re-verification of the OWASP ASI names against genai.owasp.org | Scan-github-repo task 2.6. |
| Pinning the Kiro installer to a checksum | A TODO in the workflows. |

## What This Page Could Not Confirm From The Repository

- Whether the Cloudflare Worker is deployed and which Pages and Worker settings are in place.
- Whether repository secrets and variables (`KIRO_API_KEY`, `PLAYGROUND_API_URL`, the GitHub App secrets) are set.
- The current content of the live Pages site.

Back to the [index](README.md).

## Example Targets For Scan By URL

The Playground offers two public, deliberately vulnerable multi-agent projects as one-click examples: `opena2a-org/damn-vulnerable-ai-agent` and `GenAI-Security-Project/finbot-ctf`. They are third-party projects, and clicking one only fills the form. The scanner reads `uv.lock` and `poetry.lock` (added so FinBot's dependencies are checked), covered by offline tests with a mocked OSV. Neither repository has been scanned live from the build environment, because it had no network access, so no results are claimed here.

## Kiro Crew App

`SupplAIGuard Steward` is a Kiro Crew app in its own repository (`Fabr1ce/supplaiguard-steward`). It runs a copy of this scanner on local checkouts the user picks, on demand or on a paused weekly schedule, keeps a history per repository, and reports new, resolved and returning findings. Its agent is read-only and may run only the steward script. Verified: the script, 13 unit tests and `kiro-cli agent validate`. Not verified: installing and running it inside Kiro Crew, which was not available in the build environment.
