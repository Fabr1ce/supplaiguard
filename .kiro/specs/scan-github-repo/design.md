# Design: Scan a GitHub repository by URL

Status: exploration. Recommendation: build option A (CLI flag) first, then B (Actions dispatch) as a thin wrapper.
Option C only if the open questions in `requirements.md` say a hosted demo is required.

## Components

```
user input ──> parse_github_ref() ──> fetch_repo() ──> run_scan() ──> render (md/html/json)
 (URL/short)    validate, no network    git shallow clone   existing       existing
                                        into temp dir
```

All new code lives in a new module `scanner/github_fetch.py`, imported by `sg_scan.py`. `run_scan` is not modified.

### `parse_github_ref(text, ref=None) -> GithubRef`

- Pure function, no I/O. Returns `owner`, `repo`, `ref` (or None for default branch).
- Allowed owner pattern: `[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})`. Repo: `[A-Za-z0-9._-]{1,100}`, not `.` or `..`.
- Accepts `https://github.com/o/r`, `.git`, `/tree/<ref>`, and `o/r`. Everything else raises `InvalidGithubRef`.
- The clone URL is rebuilt from the parsed parts (`https://github.com/{owner}/{repo}.git`). The user string is never
  passed to git.

### `fetch_repo(ref, workdir, timeout, max_bytes) -> FetchResult`

- Runs `git` via `subprocess.run` with an argument list (no shell):
  `git -c core.hooksPath=/dev/null -c protocol.allow=never -c protocol.https.allow=always clone --depth 1
  --single-branch --no-tags --no-recurse-submodules [--branch <ref>] -- <url> <dir>`.
- Environment: `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `HOME` set to a
  temp dir so no user credential helper applies.
- `--branch` value comes from the validated ref pattern (`[A-Za-z0-9._/-]+`, no leading `-`).
- Timeout via `subprocess` `timeout`. Size is checked by walking the directory after clone and by polling during the
  clone; exceeding the limit kills the process and raises `FetchTooLarge`.
- Returns commit SHA from `git rev-parse HEAD` and the resolved branch name.
- Errors map to stable messages: `not_found`, `timeout`, `too_large`, `rate_limited`, `git_missing`, `network`.

### Workspace lifecycle

`tempfile.mkdtemp(prefix="sg-")` (mode 0700), wrapped in a context manager that removes it on exit, exception and
SIGINT. `--keep-workspace` skips removal and prints the path.

### Scan limits

A small guard around file discovery in `run_scan`'s collectors: skip symlinks that resolve outside the root, skip files
over `max_file_bytes`, stop at `max_files`. Skipped counts are added to `errors` as a `scanner/limits` entry so a
truncated scan is never shown as clean. Check how the collectors walk the tree before choosing between a wrapper and
a change in the collectors (task 4).

### Report changes

`out["repository"]` is set to `github.com/<owner>/<repo>@<sha7>` rather than the temp path. Add optional fields
`source: {"type": "github", "url": ..., "ref": ..., "commit": ...}`. Because `sg-findings-schema` is the shared contract,
the field is optional and `validate_scan` must accept it; update the schema skill in the same change.

## Options compared

| | A. CLI flag | B. Actions dispatch | C. Hosted form |
|---|---|---|---|
| Effort | Small | Small on top of A | Large |
| Judge needs | Python, git, repo checkout | GitHub account | A browser |
| Isolation of untrusted input | Judge's own machine | GitHub-hosted runner | We must build it (Lambda or container, no network except OSV, read-only FS, timeout) |
| Abuse and cost | None | GitHub's limits | Rate limits, quotas, public endpoint |
| Fits "judge enters a repo" | Yes, in a terminal | Yes, in a form | Best UX |

Recommendation: A, then B. B reuses the existing `scan.yml` setup. Add `on: workflow_dispatch: inputs: repo, ref`, run
the CLI, upload `report.html` and `findings.json` as artifacts, and write `summary.md` to the job summary. The
workflow must treat `inputs.repo` as untrusted: pass it through `env:` and never interpolate it into a `run:` script.

If C is chosen later: the API accepts only the validated ref, runs the CLI in a sandbox with outbound access limited to
github.com and api.osv.dev, returns the report, and keeps nothing after the response.

## Security analysis

| Threat | Mitigation |
|---|---|
| Command or argument injection through the URL or ref | Strict parser, rebuilt URL, argument list, `--` before the URL, no leading `-` in ref |
| Malicious repo hooks or config run on clone | `core.hooksPath=/dev/null`, global and system config disabled, no checkout hooks run on a fresh clone |
| Submodule or LFS fetching from other hosts | `--no-recurse-submodules`, LFS smudge disabled (`filter.lfs.smudge=`, `filter.lfs.required=false`) |
| Code execution from the repo | Scanner only reads files; no install or build step |
| Symlink escape (`package.json -> /etc/passwd`) | Skip symlinks that resolve outside the root |
| Zip-bomb style repos, huge trees | Size, file count and per-file limits, timeout |
| SSRF through redirects to internal hosts | `protocol.allow=never` plus https only, host fixed to github.com |
| Credential leakage | No tokens, isolated `HOME`, no credential helper |
| Temp data left behind | Context-managed cleanup, 0700 |
| Prompt injection in the target's agent files | Findings quote the text as data. Not applicable to the CLI path because no LLM reads it. If the agent pipeline is later run on it, treat contents as untrusted |

## Testing

- Unit tests for `parse_github_ref`: accepted forms, and a table of rejected inputs (other hosts, `file://`, `ssh://`,
  userinfo, `--upload-pack=...`, newlines, `..`, unicode lookalikes).
- A hypothesis property test: any string accepted by the parser rebuilds to a URL that starts with
  `https://github.com/` and contains no characters outside the allowed set.
- Fetch tests use a local bare repository served via a patched URL builder (no network), covering: success, missing
  ref, timeout (fake slow git), too large, hook in the repo not executed (a `post-checkout` hook that writes a marker
  file), symlink escape.
- Integration test, marked `network`, that scans a known small public repo and checks the report header.
- Existing property tests and the self-scan must still pass.

## Open design questions

- Whether to use `git clone` or GitHub's tarball API (`/repos/{o}/{r}/tarball/{ref}`). Tarball avoids git config and
  hooks entirely and is simpler to size-limit by streaming, but counts against the unauthenticated API rate limit
  (60/hour per IP). Prototype both in task 2 and pick one.
