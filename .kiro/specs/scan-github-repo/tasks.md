# Tasks: Scan a GitHub repository by URL

Requirement ids refer to `requirements.md`. Do not start until the open questions are answered.

- [x] 1. Reference parser (G1)
  - [x] 1.1 Add `scanner/github_fetch.py` with `parse_github_ref` and `InvalidGithubRef`
  - [x] 1.2 Unit tests for accepted and rejected inputs, plus the hypothesis property test
- [ ] 2. Fetch (G2)
  - [ ] 2.1 Prototype `git clone` and the tarball API; record the choice and rate-limit findings in `design.md`
  - [ ] 2.2 Implement `fetch_repo` with timeout, size limit, isolated environment and error mapping
  - [ ] 2.3 Workspace context manager with cleanup on exit, exception and SIGINT
  - [ ] 2.4 Tests against a local bare repo: success, bad ref, timeout, too large, hook not run, symlink escape
- [ ] 3. CLI integration (G1.3, G3)
  - [ ] 3.1 Add `--github`, `--ref`, `--keep-workspace` to `sg_scan.py`; reject `--github` combined with a positional repo
  - [ ] 3.2 Set `repository` and optional `source` in the output; accept `source` in `validate_scan`
  - [ ] 3.3 Fetch failures become `errors` entries and a non-clean exit; add a test that a failed fetch is never "clean"
  - [ ] 3.4 Update the `sg-findings-schema` skill for the optional `source` field
- [ ] 4. Scan limits (G2.5, G6.1)
  - [ ] 4.1 Inspect how collectors walk the tree; add file count, file size and symlink guards
  - [ ] 4.2 Report truncation as a `scanner/limits` error entry; tests for each limit
  - [ ] 4.3 Report text for "no supported files found" (G3.5)
- [ ] 5. GitHub Actions dispatch (G7 option B)
  - [ ] 5.1 Add `.github/workflows/scan-repo.yml` with `workflow_dispatch` inputs `repo` and `ref`, passed via `env:`
  - [ ] 5.2 Upload `report.html` and `findings.json` as artifacts; write `summary.md` to the job summary
  - [ ] 5.3 Permissions: `contents: read` only
- [ ] 6. Docs
  - [ ] 6.1 README section: "Scan any public GitHub repo" with the CLI command and the Actions form
  - [ ] 6.2 Document limits, defaults and what is not supported (private repos, other hosts)
- [ ] 7. Decision checkpoint
  - [ ] 7.1 Review with the user whether to build option C (hosted form); if yes, write a separate design for the sandbox
- [ ] 8. Verification
  - [ ] 8.1 Run the scanner test suite and the self-scan
  - [ ] 8.2 Manual run against two public repos, one with findings and one without
