# Operations

How to set up, run and troubleshoot SupplAIGuard. The flow behind each item is in [Flow](flow.md).

## Setup Checklist

| Item | Where | Needed for |
|---|---|---|
| Python 3.10 or newer (3.15 is pinned in `.python-version`) | local | The scanner. No packages are needed. |
| [Kiro CLI](https://kiro.dev/docs/cli/setup/) v3, signed in | local | The agents. |
| `./install.sh` | local | Installs agents to `~/.kiro/agents` and policies and skills to `~/.kiro/supplaiguard`. Run again after editing `.kiro/`. `--dry-run` previews and `--uninstall` removes. |
| Secret `KIRO_API_KEY` | Settings > Secrets and variables > Actions | Headless triage, `propose-fix`, and manual `agent-triage`. Without it the scan still runs and triage is skipped. |
| Setting "Allow GitHub Actions to create and approve pull requests" | Settings > Actions > General | The `propose-fix` job. Without it the job fails at the pull request step. |
| Pages source set to GitHub Actions | Settings > Pages | Deploying the results site and the Playground. |
| Variable `PLAYGROUND_API_URL` | Settings > Secrets and variables > Actions > Variables | The Worker URL, without a trailing slash, baked into the Playground build. |
| Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | `npx wrangler secret put` in `playground/worker` | The Worker's GitHub App login. The key must be PKCS#8. |
| GitHub App for the Worker | GitHub Developer settings | Repository permissions `Actions: Read and write` and `Metadata: Read-only`, installed only on this repository. |
| Worker variable `PROPOSE_FIX_ENABLED` | `playground/worker/wrangler.toml` or the Cloudflare dashboard | Off unless exactly `"true"`. Default `"false"`. |
| Worker variables `SCAN_URL_ENABLED`, `SCAN_URL_DAILY_CAP`, `SCAN_URL_PER_CLIENT_PER_DAY`, `SCAN_URL_WORKFLOW_FILE` | same | Scan by URL from the Playground. Off unless `SCAN_URL_ENABLED` is exactly `"true"`. Defaults `"false"`, `5`, `1`, `scan-repo.yml`. The Playground-triggered path has not run live. |
| Worker variable `LAUNCH_ENABLED` | same | Kill switch. `"false"` stops launches without a deploy. |
| Variable `SG_EVOLUTION_OPT_IN` = `true` | Consumer repository variables | Turns on `report-fix.yml` there. |
| Secrets `SG_APP_ID`, `SG_APP_PRIVATE_KEY` | Consumer repository | The GitHub App installed only on the SupplAIGuard repository (`Contents` and `Pull requests` write), used by `report-fix.yml`. |

Never commit `*.pem` or `*.key` files. Both are in `.gitignore`.

## Run Things

### The CLI

```bash
python3 scanner/sg_scan.py PATH                       # text in a terminal, JSON when piped
python3 scanner/sg_scan.py PATH --out-dir out         # findings.json, summary.md, report.html
python3 scanner/sg_scan.py PATH --format md|html|json|text
python3 scanner/sg_scan.py PATH --fail-on high        # exit 1 only at or above high
python3 scanner/sg_scan.py PATH --offline             # skip OSV, reported as an error
python3 scanner/sg_scan.py PATH --suppressions FILE   # reviewed false positives
python3 scanner/sg_scan.py PATH --history             # record the scan for Learn
python3 scanner/sg_scan.py PATH --learn-report        # summarize the history
python3 scanner/sg_scan.py --github owner/name --ref v1.2.0
```

Exit codes: `0` clean, `1` findings at or above `--fail-on`, `2` scan errors or invalid input.

The Python tests:

```bash
uv venv --python 3.15 scanner/.venv
uv pip install --python scanner/.venv/bin/python -r scanner/requirements-dev.txt
scanner/.venv/bin/python -m pytest scanner/tests -q
```

The Playground:

```bash
cd playground/worker && npm install && npm test && npm run typecheck
cd playground && npm install && npm test && npm run build
```

### The Agents

```bash
./install.sh
cd /path/to/repo
kiro-cli chat --agent supplaiguard-coordinator "Run a full SupplAIGuard scan."
```

### The Workflows

| Workflow | How to run | Notes |
|---|---|---|
| `self-scan.yml` | Runs on push to `main` and on pull requests. Manual run adds `agent-triage`. | Scans `.kiro`. |
| `scan.yml` in your repository | Copy `examples/consumer-workflow.yml` and pin `uses:` and `sg-ref` to the same full commit SHA. | Branches and tags are rejected unless `allow-unpinned` is set. |
| `scan-repo.yml` | Actions > Scan a public GitHub repo > Run workflow (`repo`, `ref`). | Public repositories on github.com only. |
| `demo-triage.yml` | Actions > Demo triage > Run workflow. Choose a demo and optionally `propose-fix`. | Needs `KIRO_API_KEY` for triage. Publishes Pages. |
| `remediate.yml` in your repository | Copy `examples/consumer-remediate.yml`, pin both SHAs to a commit that contains `remediate.yml`, add `KIRO_API_KEY`, tick "Allow GitHub Actions to create and approve pull requests". Run it manually, or add it as a `fixes` job after the scan so a push with findings starts it (see Run The Whole Loop). | Opens a draft PR on `supplaiguard/fix-<run id>`. Skips while a fix PR is open and for the push that merges one. Never run live. |
| `report-fix.yml` | Copy `examples/consumer-report-fix.yml`, pin both SHAs, set `SG_EVOLUTION_OPT_IN`. | Never run live. |

The Pages root is the homepage: it leads to the Playground (`/playground/`) and shows the latest `demo-triage.yml` run lower down. The latest run results appear after the first run. Before then the site returns 404.

### Run The Whole Loop On Your Own Repository

This is the full sequence, from a push to a merged learn report. People act in steps 4 and 8. Everything else is automatic.

1. **Push** to `main` of the consumer repository.
2. **Scan.** The consumer workflow calls `scan.yml`. With findings at or above `fail-on`, the scan job fails on purpose (exit code `1`) and the report is uploaded.
3. **Remediate and verify.** A second job in the same workflow runs only when that push scan returned `1`. It calls `remediate.yml`: the Remediation agent edits a copy, `fix_gate.py` allows only manifests, agent, skill and MCP config, the copy is re-scanned, and a **draft** PR opens on `supplaiguard/fix-<run id>`. The PR body lists the re-check and every change that needs explicit approval. With `allow-major: true`, major version bumps are among them.
4. **Review, approve, merge.** A person reads the draft, marks it ready, **approves** it and merges it. The approval matters: `report-fix.yml` reports nothing without an approving review.
5. **Scan again.** The merge is a push to `main`, so the scan runs again. This is the check that should pass. The remediation guard sees that this push merged a fix PR and does not start a new round. It also never opens a second fix PR while one is open.
6. **Learn.** The PR closing as merged runs the consumer's report-fix workflow (`report-fix.yml`). It scans before and after the merge and, if the outcome is `fixed`, opens a learn PR on this repository that adds one sanitized file under `evolution/reports/`.
7. **Validate.** The SupplAIGuard Steward, a Kiro Crew app in its own repository, checks open learn PRs every 6 hours by code. It needs one added file, the exact report schema, catalogue rule ids and no injection text. It then comments and labels the PR `learn:valid` or `learn:rejected`. It never approves or merges.
8. **Merge the learn PR.** The maintainer merges valid learn PRs. The Steward's weekly digest shows which rules get fixed and which keep remaining.

**One-time setup in the consumer repository**

| What | Where | For step |
|---|---|---|
| Workflow with a `check` job (`scan.yml`) and a `fixes` job (`remediate.yml`, `needs: check`, runs on push when `needs.check.outputs.exit-code == '1'`) | `.github/workflows/` | 2, 3 |
| Report-fix workflow, a copy of `examples/consumer-report-fix.yml` | `.github/workflows/` | 6 |
| Every `uses:` and `sg-ref` pinned to ONE full commit SHA of this repository that contains `remediate.yml` and the remediation guard | both files | all |
| Secret `KIRO_API_KEY` | Actions secrets | 3 |
| "Allow GitHub Actions to create and approve pull requests" ticked | Settings > Actions > General | 3 |
| Variable `SG_EVOLUTION_OPT_IN` = `true` | Actions variables | 6 |
| Secrets `SG_APP_ID`, `SG_APP_PRIVATE_KEY`: a GitHub App installed only on this repository with Contents and Pull requests: write | Actions secrets | 6 |

**One-time setup for step 7:** install the Steward in Kiro Crew, give the Crew gateway a `GITHUB_TOKEN` limited to this repository (Pull requests and Issues: read and write, Contents: read), and resume its `learn-review` schedule. See the Steward's README.

**What can stop the loop**

- The re-scan in step 5 passes only if the agent fixed every finding at or above `fail-on`. Anything that needs a source code change stays open and is listed in the PR as `NEEDS HUMAN:`. The loop still reports what was fixed in step 6.
- If OSV.dev is unreachable, the scan is incomplete (exit code `2`). No fix job runs, and nothing is called clean.
- The fix PR is opened with the workflow's own token. GitHub does not start `pull_request` workflows for PRs opened that way, so the PR itself is not scanned. The scan in step 5 covers it after the merge.
- Tests of the consumer repository are not run by any step.

**Status.** Every piece is covered by tests here. The whole sequence has not run live: no push-triggered fix PR, approved merge, learn PR or Steward verdict has happened on GitHub yet.

### Turn Off Remediation From The Playground

Set `PROPOSE_FIX_ENABLED` to `"false"` in the dashboard or `wrangler.toml` (then redeploy). To stop it at the source, leave the `propose-fix` input at its default or remove `KIRO_API_KEY`. See [`playground/README.md`](../playground/README.md).

### Turn Off Scan By URL From The Playground

Set `SCAN_URL_ENABLED` to `"false"` in the dashboard or `wrangler.toml` (then redeploy). The card disappears and a repository request gets a 403. To stop it at the source, disable `scan-repo.yml` in Settings > Actions. The workflow itself ran live once by manual dispatch (run 45071479996), but the Playground-triggered path (Worker dispatch, run lookup, artifact download) has not, so the first enabled launch is its first real test: watch the run. See [`playground/README.md`](../playground/README.md).

### Connect Or Disconnect The Private Demo

The fourth Playground card runs in a separate private repository and its own Actions. Set `PRIVATE_DEMO_REPO` (`owner/name`) in the dashboard or `wrangler.toml` and redeploy to connect it; set it to `""` to disconnect. Before that, the private repository needs the secret `KIRO_API_KEY`, real commit SHAs in place of the `<FULL_COMMIT_SHA>` placeholders, Actions enabled, and the Worker's GitHub App installed on it (Actions: Read and write, Metadata: Read-only). Not run live: the first launch is its first real test. See "Private Demo" in [`playground/README.md`](../playground/README.md).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| A workflow run shows as failed with **zero jobs** | GitHub rejected the workflow file before it could start, usually an invalid expression. Open the run and read the annotation, then run `scanner/.venv/bin/python -m pytest scanner/tests/test_workflow_expressions.py -q`. The test lists any function in `${{ }}` that GitHub does not support (for example `split()` in `report-fix.yml`, fixed in commit `32c4160`). |
| The expression lint test fails | It names the file and the unsupported function. Replace it with a supported one (`contains`, `startsWith`, `endsWith`, `format`, `join`, `toJSON`, `fromJSON`, `hashFiles`, status functions) or move the logic into a `run:` step. |
| `scan.yml` fails with "sg-ref must be a full 40-character commit SHA" | Pin to a SHA, or set `allow-unpinned: true` (not recommended). |
| Exit code 2 from the scanner | A scan error. Read `errors` in the report. OSV.dev unreachable, `--offline`, an unreadable file, or a hit limit all count. It is never a clean result. |
| Gate fails, summary missing | The scanner crashed before it wrote `summary.md`. Treated as exit 2. |
| Suppression not applied on a pull request | Suppressions are read from the PR base commit. A PR that adds the file is scanned without it. |
| Triage step skipped | No `KIRO_API_KEY`, a fork pull request, or Dependabot without a Dependabot secret. |
| `propose-fix` fails at the pull request step | The setting "Allow GitHub Actions to create and approve pull requests" is off. |
| `propose-fix` fails with "The agent changed files that are not allowed" | `fix_gate.py` refused the edit. Read `gate.json` in the artifact. This is the gate working. |
| The draft pull request shows no checks | A pull request opened with `GITHUB_TOKEN` does not start other workflows. Close and reopen it. |
| Playground says "The backend is not configured" | `PLAYGROUND_API_URL` was not set when the site was built. Set it and run Demo triage again. |
| `dispatch_failed` in the Worker | The App is not installed on the repository, the key is not PKCS#8, or `demo-triage.yml` on `main` lacks the `launch_id` input. Check `wrangler tail`. |
| "Another demo is running" | One launch at a time. A lost run frees the slot after 25 minutes. |
| Browser CORS error | `ALLOWED_ORIGIN` is not exactly the page origin. |
| Results say not available | Artifacts expire after 14 days. |
| `kiro-cli` agent validation fails in CI | `install.sh` runs `kiro-cli agent validate`, which needs `KIRO_API_KEY`. |

Next: [Status](status.md).
