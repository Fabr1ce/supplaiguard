# Tasks: Kiroween improvements

Deadline Fri 2026-12-04 2:00 PM PT. Test first where code exists. Order is by value to a judge. `(Kn.m)` cites requirements.

- [x] 0. Reviews read; claims checked; synthesis written (`review-synthesis.md`). Eligibility verified: first commit 2026-11-12 _(K1.4)_

- [ ] 1. Attack paths (the differentiator)
  - [ ] 1.1 Tests: catalog behaviour and the four properties (all members needed, removing a member removes the path, no foreign findings, deterministic) _(K2.2, K2.3, K2.6)_
  - [ ] 1.2 `scanner/attack_paths.py` with catalog P-001 to P-004 _(K2.2)_
  - [ ] 1.3 `--attack-paths` flag; with no flag the output is unchanged (test compares bytes with the current output on the three demos) _(K2.1)_
  - [ ] 1.4 Render in text, markdown and HTML reports (inline SVG graph, cut marked) _(K2.5)_
  - [ ] 1.5 Show paths on the Pages site; label agent-judged chains separately _(K2.4, K2.5)_
  - [ ] 1.6 Run on the three demos; record which paths appear in the README (real output only)

- [ ] 2. Honest status
  - [ ] 2.1 `docs/status.json`; `scanner/render_status.py` with tests (README block in sync, `works` needs evidence) _(K4.3)_
  - [ ] 2.2 Audit README claims: label or remove anything planned or untested _(K4.1, K4.2)_

- [ ] 3. Judge-first README
  - [ ] 3.1 Four-line opening block and the Pages link; move the long sections down, delete nothing _(K1.1, K1.3)_
  - [ ] 3.2 `docs/submission.md` with the eligibility evidence and the rules checklist _(K1.4, K7.4)_
  - [ ] 3.3 Owner approves, then set repository homepage and topics (`gh repo edit`) _(K1.2)_

- [ ] 4. Recorded-run tooling (fixture data only)
  - [ ] 4.1 Tests for `scanner/record_run.py`: refuses missing input, refuses an incomplete `after.json`, never writes numbers it was not given _(K3.1, K3.4)_
  - [ ] 4.2 Implement it; render `recorded-run/index.html` in `build_site.py`, absent if no bundle _(K3.2, K3.3)_

- [ ] 5. Submission assets
  - [ ] 5.1 `docs/demo-script.md` under 3 minutes, every claim pointing at something real _(K7.1)_
  - [ ] 5.2 Find a real property-test bug in the history for the write-up; if none, say so _(K7.2)_
  - [ ] 5.3 `docs/writeup.md`, `docs/blog-outline.md`, `docs/social-post.md` _(K7.2, K7.3)_

- [ ] 6. **Owner:** the interactive recorded run (needs approvals)
  - [ ] 6.1 Run the coordinator on a demo with `--attack-paths` in the scan; approve the fix; keep the files _(K3.1, K3.4)_
  - [ ] 6.2 Build `docs/recorded-run/` with `record_run.py`; check the page; commit _(K3.2)_
  - [ ] 6.3 Fill in the README's one real result from it _(K1.1)_
  - [ ] 6.4 Record the video from the same run _(K7.1)_

- [ ] 7. In-browser scanner spike (timebox: one day; needs approval)
  - [ ] 7.1 Pure `scan_config_text` entry point in the scanner with tests, no behaviour change _(K5.3)_
  - [ ] 7.2 Pyodide page on pasted MCP/agent JSON; confirm no network call and no upload _(K5.1)_
  - [ ] 7.3 Keep or drop, and record why _(K5.3)_

- [ ] 8. Kiro gaps (needs a decision)
  - [ ] 8.1 Decide Power and Crew; build a small Power; Crew in a separate public repo _(K8.1)_
  - [ ] 8.2 Anything not built: remove from the claims _(K8.2, K4.2)_

- [ ] 9. Launcher (needs approval; only after 1 to 5 are done)
  - [ ] 9.1 Add an optional `launch_id` input and `run-name` to `demo-triage.yml` _(K6.4)_
  - [ ] 9.2 Worker with fixed demo ids, concurrency 1, rate and daily caps, kill switch, CORS _(K6.1-K6.3)_
  - [ ] 9.3 Tests for the Worker's validation and limits; GitHub App setup notes _(K6.2, K6.3)_
  - [ ] 9.4 Page shows real status only, links to results _(K6.5)_

## Not planned

React/Vite/Tailwind/shadcn/Durable-Objects app; animated network visualization (see Out of scope).
