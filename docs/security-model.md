# Security Model

SupplAIGuard scans repositories that may be hostile, and it hands text from them to language models. The design assumes that any content it reads can try to attack it. The governing rules are in [`.kiro/steering/security-policy.md`](../.kiro/steering/security-policy.md).

## Trust Boundaries

| Treated as untrusted data | Why |
|---|---|
| Everything in a scanned repository: files, names, README text, skills, agent configs, MCP configs, the HEAD commit message | An attacker controls it. |
| Output of an agent | A model that read untrusted text may repeat it. |
| Input from a Playground visitor and from workflow inputs | Anyone can send it. |
| The pull request that is being scanned | It must not hide its own findings. |

| Trusted, deterministic parts | Role |
|---|---|
| `scanner/sg_scan.py` | Never executes, installs or builds the target. Reads files only. |
| `scanner/sg_guard.py` | Validates strings, strips hidden characters, wraps untrusted text. |
| `scanner/fix_gate.py` | Decides which edits may become a pull request, with no model involved. |
| Workflow permissions | Least privilege per job. |
| A human reviewer | The only party that merges. |

## Controls

- **Scanner never executes target code.** No install, build or script runs. For fetched repositories, git hooks are off, submodules are not followed and symlinks that leave the clone are skipped.
- **Agents see untrusted text only wrapped.** `wrap_untrusted` sanitizes text and delimits it with a random nonce. In CI the agent reads `findings.untrusted.txt` and the prompt declares the whole repository to be data.
- **Headless Kiro is boxed in.** It runs in a copy or an empty directory, with every `mcp.json` renamed to `mcp.json.disabled` (headless Kiro starts workspace MCP servers without a prompt), workspace hooks removed, and permission rules that deny reads of `/proc`, `/sys`, `/etc`, `~/.ssh`, `~/.aws`, `~/.config` and Kiro settings, plus shell and writes (the propose-fix job allows writes except to secret, `.github`, `.git` and `src` paths).
- **Fixes are proposals.** The remediation agent edits a copy. `fix_gate.py` allows only `package.json`, `package-lock.json`, `requirements*.txt`, `.kiro/agents/*.json`, `.kiro/settings/mcp.json` and `.kiro/skills/*/SKILL.md`. It reports major version changes and new dependencies for explicit approval.
- **Verification is separate.** A finding is resolved only after a re-scan no longer reports it. A failed scan is never a clean scan (exit code 2).
- **Pinned supply chain.** Reusable workflows reject `sg-ref` unless it is a full 40 character SHA. Third party actions are pinned by SHA. The scanner has no dependencies and only package names and versions go to OSV.dev.
- **Inputs reach shells only through `env:`**, never through `${{ }}` inside `run:`, and are validated.
- **Reports escape repository text** for HTML, Markdown and terminals. The results site escapes everything it shows.

## OWASP Top 10 For Agentic Applications

This summarizes the mapping in the [scan-github-repo design](../.kiro/specs/scan-github-repo/design.md), which also names the test for each control. The ASI names there were not re-verified against genai.owasp.org (task 2.6 is open).

| Risk | Summary of the control |
|---|---|
| ASI01 Agent Goal Hijack | Input validation, an injection detector (`suspicious_agent_skill`), and wrapped untrusted text. |
| ASI02 Tool Misuse and Exploitation | `git` runs from an argument list with no shell. |
| ASI03 Identity and Privilege Abuse | No tokens in the scanner, isolated `HOME`, `contents: read` workflows. |
| ASI04 Agentic Supply Chain Vulnerabilities | github.com over https only, no submodules, stdlib only scanner, SHA pins. |
| ASI05 Unexpected Code Execution | Nothing from the target is installed, built or run. |
| ASI06 Memory and Context Poisoning | No state is written from repository text. Evidence is sanitized and truncated. |
| ASI07 Insecure Inter-Agent Communication | Not applicable to the CLI. The hand-off to triage is structured and wrapped. |
| ASI08 Cascading Failures | Timeouts, size limits and per collector isolation. Failures are errors, never clean. |
| ASI09 Human-Agent Trust Exploitation | Reports escape repository text. An injection finding is never shown as clean. |
| ASI10 Rogue Agents | Not applicable to the scanner. Triage agents are read-only with deny rules. |

## Permissions Per Workflow

| Workflow or job | Permissions | Secrets |
|---|---|---|
| `scan.yml` `scan` | `contents: read` | none |
| `scan.yml` `agent-triage` (off by default) | `contents: read` | `KIRO_API_KEY` |
| `self-scan.yml` | `contents: read` | `KIRO_API_KEY` only on a manual run with `agent-triage` |
| `scan-repo.yml` | `contents: read` | none |
| `demo-triage.yml` `triage` | `contents: read` | `KIRO_API_KEY` |
| `demo-triage.yml` `propose-fix` | `contents: write`, `pull-requests: write` | `KIRO_API_KEY`, `GITHUB_TOKEN` (given to push and `gh pr create` only) |
| `demo-triage.yml` `publish` | `contents: read`, `actions: read` | none |
| `demo-triage.yml` `deploy` | `pages: write`, `id-token: write` | none |
| `report-fix.yml` `report` | `contents: read`, `pull-requests: read` | `SG_APP_ID`, `SG_APP_PRIVATE_KEY` (token limited to the upstream repository) |
| Playground Worker GitHub App | `actions: write`, metadata read, installed on this repository only | `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` in the Worker, never in the repository |

All workflows start with `permissions: {}`, and each job asks for only what it needs.

## Scan By URL From The Playground

Off unless the Worker variable `SCAN_URL_ENABLED` is exactly `"true"`. The visitor's text is untrusted. It is validated in the browser (convenience), in the Worker before any reservation or network call, in `scan-repo.yml` by a regex, and by `scanner/sg_guard.py`. Only the normalized `owner/repo` and ref reach the workflow, through `env:` and never through `${{ }}` in a script. The run name carries only the launch id. The clone is shallow with hooks and submodules off, and nothing in it is executed. The Worker passes on counts, enums, fixed reason codes and one validated repository string, never text from the repository. Failure modes fail closed: any error, limit or missing report is "incomplete", not clean. Limits: 1 per client per day, 5 per day, one run at a time. Residual risks: abuse of runner minutes, public content fetched on a visitor's choice, and package names sent to OSV.dev. URL scans are deterministic only: no agent or model runs on a scanned repository, because it is untrusted and the triage agent needs a secret. Agent triage is available on the four demos. The workflow `scan-repo.yml` ran live once by manual dispatch (run 45071479996). The Playground-triggered path has not run live; fixtures and unit tests only.

## What Is Never Done

- Nothing merges automatically. No workflow or agent merges, and agents deny `git merge`, `gh pr merge` and force pushes.
- Secret files are never written (`.env`, `*secret*`, `secrets/`, `*.pem`, `*.key`), and `*.pem` and `*.key` are in `.gitignore`.
- Dependencies are never downgraded to a vulnerable version, and no unverified dependency is added silently.
- Repository source is never uploaded. Only package names and versions go to OSV.dev.
- A failure to check is never reported as clean.
- A package or component is never called malicious without recorded evidence (an advisory id, a rule id or an excerpt).
- Reports sent upstream never contain source, config excerpts, secrets, paths, component names or repository names.
- Private repositories are not scanned by URL, and no tokens are used for fetching.

## Limits Of This Model

- The remediation agent in an interactive session relies on Kiro permission prompts. Their behavior was not confirmed live (task 33.5).
- The Kiro installer in CI is downloaded from `cli.kiro.dev` and is not pinned to a checksum (a TODO in the workflows).
- A Playground launch can be triggered by anyone, so cost and pull request noise are bounded only by the Worker limits and the kill switch. CORS is not authentication.

Next: [Operations](operations.md).
