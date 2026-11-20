# Review synthesis

Inputs, in `notes/kiroween/improvements/`: `claude-review.md`, `chatgpt-review.md`, `pages1.md` (launcher prompt),
`pages2-ui.md` (playground UI prompt). Each claim below was checked against the repository on 2026-11-20 where it
can be checked. Reviews are opinions of two assistants; they did not read the code or the spec (Claude says so).

## What both reviews agree on

1. Strong on technology and idea; weak on **design, presentation and a visible demo**.
2. The differentiator ("attack path, not three unrelated warnings") is **not shown anywhere**; it is only a README sentence.
3. Half-built or planned features cost more than they earn. Finish or cut.
4. The demo should be a story: problem, tension, human decision, fix, **verified** result.

## Claim check

| Claim | Source | Verified | Result |
|---|---|---|---|
| Project may predate Oct 30 and be ineligible | ChatGPT (called it the biggest risk) | `git log --reverse`: first commit **2026-11-12**, 33 commits, MIT license, `.kiro` not gitignored | **Not a problem.** Keep this evidence in the submission notes |
| No live URL for judges | Claude | `https://fabr1ce.github.io/supplaiguard/` returns **200** with our page; two successful `demo-triage` runs | **Out of date.** The URL exists; it needs to be linked and improved |
| Repo has no description, website or topics | Claude | description and license present; `homepageUrl` empty; **no topics** | **Partly true.** Fix homepage and topics |
| Kiro Powers not used; Crew only planned | Claude | README says both | **True.** Decide: build or remove the claim |
| README is developer-focused, not judge-focused | ChatGPT | README opens with the logo and tagline, then a long "Why AI agents" section; no 15-second demo | **True** |
| Full agent loop not yet demonstrated end to end | ChatGPT | README status: "full live coordinator run ... not exercised yet" | **True.** Needs one real recorded run |
| `workflow_dispatch` returns no run id | pages2 | GitHub community discussion 9752 and a 2026 cross-repo guide both say the response has no run id | **True.** A launcher must correlate with its own id |
| "Three repositories" | pages1 | one repository with three demo folders | **False.** pages2 corrects it |

## Recommendation verdicts

| Recommendation | Verdict | Why |
|---|---|---|
| Attack-path visualization (both reviews) | **Adopt, first** | It is the product's actual claim and it is missing. Compute paths with a deterministic rule catalog so it stays testable, label agent-judged chains separately, never claim a path is exploitable |
| Before/after remediation story with human approval | **Adopt, from a real recorded run** | No simulated results. A replay of real artifacts, labelled with run id and date, is honest; an animation of invented numbers is not |
| Judge-first README and repo metadata | **Adopt** | Cheap, high value |
| Finish or cut "planned" claims | **Adopt** | README and Pages must say what runs today |
| Demo video script, write-up per Kiro feature, blog, social | **Adopt** | Bonus prizes; the write-up needs a real property-test bug, found in history, not invented |
| Browser-based scanner where judges paste config (Claude) | **Adopt as a timeboxed spike** | Best zero-cost interactive demo: run the real stdlib-only scanner in the browser (Pyodide), nothing uploaded, which matches the privacy policy. Unknown: whether the scanner's rule code runs in Pyodide without a refactor |
| Public "Launch" button via Cloudflare Worker (pages1, pages2) | **Adapt, gated on your decision** | Real risks: a public endpoint spends Kiro credits and runs CI. Allowed only for the read-only triage, fixed demo ids, concurrency 1, per-IP and daily caps, kill switch. `propose-fix` must never be reachable from it, or anyone could make branches and PRs |
| React + Vite + Tailwind + shadcn + Framer + Durable Objects app (pages2) | **Defer** | Large, and Claude's strongest warning is half-built work. Take the palette and the timeline/status ideas into the static site first |
| "Cinematic" animated network, Costume Contest play | **Defer** | One static SVG attack-path graph first |
| Kiro Powers and Kiro Crew | **Decision needed** | Crew must be a separate public repo (R18.7). Either build a small one or delete the claim |

## Things the reviews got wrong or cannot know

- Scores like "7.4 to 9.3" are not measurements.
- Claude could not tell last year's top-three winners; ChatGPT says SpookBnB was third overall. Neither is needed here.
- The prompts tell an agent to "present a plan before making changes", which is what this spec is.
