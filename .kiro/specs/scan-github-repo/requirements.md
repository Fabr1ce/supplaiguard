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
| C. Hosted web form | Static page plus a small API (Lambda) that runs the scan in an isolated sandbox and returns the report | Cost, abuse, sandboxing, a public endpoint |

## Out of scope

- Private repositories and authentication.
- GitLab, Bitbucket, or arbitrary git hosts.
- Running the agent pipeline (remediation, verification) on the fetched repo.
- Scanning more than one repository per request.

## Open questions

1. Is a hosted endpoint (option C) wanted for the demo, or is CLI plus Actions enough?
2. Is a 200 MB size limit and a 120 s timeout acceptable for the demo repos?
3. Should the report be able to link findings to blob URLs on GitHub at the scanned commit?
