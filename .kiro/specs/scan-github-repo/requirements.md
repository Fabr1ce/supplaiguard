# Requirements: Scan a GitHub repository by URL

## Problem

Today a user must have the repository checked out locally (or run the GitHub Action) before SupplAIGuard can scan it.
A judge or first-time user wants to paste a GitHub URL, have SupplAIGuard fetch the repository, scan it, and read a
report. This spec explores that option and fixes the scope, the safety constraints and the open questions before any
code is written.

## Glossary

- **Target repo**: the public GitHub repository named by the user. Untrusted input.
- **Scan workspace**: a temporary directory that holds the fetched copy of the target repo. Deleted after the scan.
- **Report**: the existing outputs of `scanner/sg_scan.py` (`findings.json`, `summary.md`, `report.html`).

## Requirements

### G1. Accept a repository reference

**User story:** As a judge, I want to give a GitHub repository and get a report, so that I can evaluate SupplAIGuard on
a project I choose.

1. THE entry point SHALL accept `https://github.com/<owner>/<repo>` (optionally with `.git`, `/tree/<ref>`, or a
   `--ref` option) and the short form `<owner>/<repo>`.
2. THE entry point SHALL reject any other host, scheme (`ssh`, `file`, `git`, `http`), credentials in the URL, or
   characters outside the GitHub owner/repo character set, with a clear error and exit code 2. No network call is made
   for a rejected input.
3. THE entry point SHALL be available as a CLI first (`sg_scan.py --github <ref>`). A web form is out of scope for the
   first iteration (see G7).

### G2. Fetch safely

1. THE fetch SHALL be shallow (`--depth 1`) and single-branch, and SHALL NOT fetch submodules, LFS objects or tags.
2. THE fetch SHALL disable git hooks and any repository-supplied configuration (`core.hooksPath=/dev/null`,
   `protocol.allow` limited to https, `GIT_TERMINAL_PROMPT=0`), and SHALL NOT use the user's credentials.
3. THE fetch SHALL enforce a wall-clock timeout (default 120 s) and a size limit (default 200 MB), aborting and
   reporting the reason if either is exceeded.
4. THE scanner SHALL NOT execute any code from the target repo. No `npm install`, `pip install`, build, test or
   script step is run. Scanning reads manifests, lockfiles and config files only.
5. WHEN the scan workspace contains a symlink that resolves outside the workspace, THE scanner SHALL NOT follow it.
6. THE scan workspace SHALL be created with mode 0700 under the system temp directory and removed on success, failure
   and interrupt, unless `--keep-workspace` is given.

### G3. Scan and report

1. THE existing scan (`run_scan`) SHALL run on the scan workspace unchanged, so results match a local scan of the same
   commit.
2. THE report SHALL show the GitHub URL, the resolved ref and the commit SHA instead of a temp path.
3. THE exit code semantics SHALL match the local scan (`--fail-on`).
4. WHEN the fetch fails (not found, private, rate limit, timeout, too large), THE scanner SHALL report the failure as
   an error and SHALL NOT produce a clean result (security policy, evidence discipline).
5. WHEN a repository has no supported manifests or AI configs, THE report SHALL say what was looked for, not only
   "No findings".

### G4. Privacy

1. ONLY package coordinates are sent to OSV.dev, as today. The repository contents are not sent anywhere else.
2. THE clone SHALL come only from github.com. No third-party mirror or proxy is used.
3. Private repositories are out of scope. THE scanner SHALL NOT prompt for or accept tokens in the first iteration.

### G5. Read-only

1. THE feature SHALL NOT write to the target repo, open issues or pull requests on it, or push anything.
2. Remediation is not offered for a fetched repo. THE report MAY show the suggested fixes as text only.

### G6. Abuse limits

1. THE entry point SHALL limit file count and per-file size read during the scan (defaults: 50 000 files, 5 MB per
   file) and report when a limit truncated the scan.
2. WHEN used from a hosted service (G7), THE service SHALL rate-limit per client and cap concurrent scans.

### G7. Delivery options to evaluate

The design SHALL compare these and recommend one for the hackathon:

| Option | Summary | Main risk |
|---|---|---|
| A. CLI flag | `sg_scan.py --github owner/repo` clones locally and scans | None beyond G2; runs on the judge's machine |
| B. GitHub Actions `workflow_dispatch` | Judge enters a repo in a form, the workflow clones, scans, uploads the report as an artifact | Needs a GitHub account; runs untrusted input in our CI |
| C. Hosted web form (**not built**, see Decisions) | Static page plus a small API (Lambda) that runs the scan in an isolated sandbox and returns the report | Cost, abuse, sandboxing, a public endpoint |

## Out of scope

- Private repositories and authentication.
- GitLab, Bitbucket, or arbitrary git hosts.
- Running the agent pipeline (remediation, verification) on the fetched repo.
- Scanning more than one repository per request.

### G8. Input validation and prompt-injection guard (OWASP Top 10 for Agentic Applications)

**User story:** As a maintainer, I want every string a user or a scanned repository can influence to be validated or
treated as untrusted data, so that a crafted URL, ref or repository text cannot hijack the scanner, the CI workflow or a
downstream agent.

The risk categories ASI01 to ASI10 are mapped in `design.md`. The names are recorded from memory and must be
re-verified against genai.owasp.org (it was not reachable when this spec was written).

1. **(a) User-controlled strings.** WHEN the entry point receives a user-controlled string (repository URL, `--ref`,
   CLI arguments, `workflow_dispatch` inputs), THE guard SHALL validate it against an allow-list before any use. THE
   guard SHALL:
   - normalize with NFKC and require ASCII-only after normalization, and reject the input if normalization changed it;
   - reject control characters, newlines, bidirectional controls, zero-width characters and Unicode tag characters;
   - reject IDN and homoglyph hosts (any non-ASCII host, any `xn--` label) and percent-encoding;
   - enforce length caps (defaults: 300 characters for a URL, 200 for a ref, 100 for a repo name);
   - reject a ref, owner or repo whose text reads as an instruction to an agent (for example "ignore previous
     instructions", "you are now", "system prompt").
   A rejection SHALL name the rule and SHALL NOT echo the raw offending string unescaped.
2. **(b) Untrusted repository text.** THE scanner SHALL run a deterministic prompt-injection detector over untrusted
   repository text: README files, `SKILL.md`, agent and MCP config bodies, file names, and the HEAD commit message. WHEN
   it matches, THE scanner SHALL emit a `suspicious_agent_skill` finding with an `SKL-001`, `SKL-002` or `SKL-005`
   style rule id, quoted evidence, and severity and confidence as in `severity-and-confidence.md` (exact literal match
   high confidence, heuristic match medium, ambiguous low). Evidence SHALL be sanitized and truncated.
3. **(c) No model sees raw repo text.** THE scanner SHALL NOT send repository text to any model or external service.
   WHERE a downstream agent (for example the demo-triage Kiro agent) reads scan output, it SHALL receive repository
   text only as sanitized, delimited untrusted data with an explicit instruction not to follow it.
4. **(d) Least privilege and containment.** THE feature SHALL execute no code from the target repo, use a pinned
   fetch (https, github.com only, hardened git), enforce the size, time, file-count and per-file caps of G2 and G6,
   escape all repository text in reports (Markdown, HTML, terminal), and SHALL NOT write persistent memory, state,
   suppressions or configuration derived from untrusted content.
5. **(e) Never a false all-clear.** A failed fetch, a rejected input, a truncated scan, or a scan that produced
   injection findings SHALL NOT be reported as clean (security policy, evidence discipline).

## Out of scope (additions)

- A hosted endpoint (option C) and any per-client rate limiting for it (G6.2 applies only if it is ever built).

## Decisions

Recorded from the open questions of the first draft:

1. **No hosted endpoint.** CLI plus GitHub Actions `workflow_dispatch` is enough for the demo. Option C is not built.
2. **Limits accepted.** 200 MB size limit and 120 s timeout are acceptable for the demo repos.
3. **Blob-URL links.** Findings may link to GitHub blob URLs at the scanned commit. This is optional and is done last,
   after the guard and the fetch are complete.
