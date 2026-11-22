# Design: Scan a GitHub repository by URL

Status: decided. Build option A (CLI flag) first, then B (Actions dispatch) as a thin wrapper. Option C is not built
(see Decisions in `requirements.md`). Input validation and the prompt-injection guard (G8) are specified below.

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
| Prompt injection in the target's agent files or in user-supplied strings | See the agentic security guard (G8): validation, `detect_injection`, `wrap_untrusted`, no model reads repo text in the CLI path |

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

## Agentic security guard (G8)

New stdlib-only module `scanner/sg_guard.py`. It is pure (no network, no subprocess) and is the only place that decides
whether a string is acceptable or how untrusted text is neutralized.

### API

- `validate_user_string(value, kind, max_len=None) -> str`: `kind` is one of `url`, `ref`, `repo`. ASCII-only
  allow-list with rejection of control, bidi, zero-width, tag characters, percent-encoding, backslash, NUL and
  newlines, plus length caps (`MAX_URL_LEN` 300, `MAX_REF_LEN` 200, repo 100). `ref` and `repo` also reject
  instruction-like text (`INSTRUCTION_PATTERNS`, separators `-_./` read as spaces) and non-hex blobs of 40 or more
  characters. Raises `GuardError` (alias `InvalidUserInput`) with a stable `code`, and the message never echoes the
  raw input. `parse_github_ref` calls it first on the URL, the ref and the repo name and re-raises as
  `InvalidGithubRef` with the same `.code`. Host confusion (`xn--`, homoglyph or fullwidth hosts, userinfo, ports,
  query, fragment, `github.com.evil.com`, upper-case host) is rejected by the guard or the exact-host regex.
- `sanitize_untrusted(text, max_len=200) -> str`: strips control, bidi, zero-width, tag and ANSI characters,
  collapses whitespace, truncates. Never raises. Used for evidence, terminal output and anything shown to an agent.
- `detect_injection(text, source, component) -> list[dict]`: deterministic patterns only (no model). Returns
  `suspicious_agent_skill` finding dicts without `id` or `status` (the caller assigns them) with rule id `SKL-001`,
  `SKL-002`, `SKL-004` (high) or `SKL-005` (medium), the sanitized excerpt capped at 160 characters and a confidence
  (high for literal override phrases and chat-role markers, medium for patterns, low for hidden-character-only
  signals). Hidden characters are reported by codepoint (for example `U+200B x3`), and Unicode tag text is decoded
  so smuggled instructions still match. Also flags encoded blobs next to decode or execute words, instructions in HTML
  comments, and CSS-hidden text. Never raises.
- `wrap_untrusted(text, label) -> str`: sanitizes the text and wraps it in `<<<BEGIN label nonce>>>` and
  `<<<END label nonce>>>` markers with a per-call random nonce, breaks up any `<<<` or `>>>` inside the text, and
  prefixes a one-line reminder that the content is data and not instructions.

### Trust boundary

```
user input ──> guard (validate) ──> fetch (hardened git) ──> scanner ──> reports (md/html/json, escaped)
 URL, ref,      reject early,        https, github.com,      reads files,    sanitize_untrusted on every
 CLI, inputs    no echo of raw       no hooks, caps          never runs      repo-derived string
                                                              them
                         scanner ──> detect_injection ──> suspicious_agent_skill findings
scanner output ──> wrap_untrusted ──> demo-triage Kiro agent (read-only, deny rules, treats text as data)
```

Everything left of the guard is untrusted. Everything the scanner reads from the fetched repo is untrusted. The only
component that could be steered by text is a downstream agent, so the only path to it goes through `wrap_untrusted`.

### OWASP Top 10 for Agentic Applications mapping

The ASI names below are written from memory. genai.owasp.org was not reachable offline when this was written, so the
names, numbering and scope MUST be re-verified before the table is cited.

| Id | Risk | Control in this feature | Test (file, name; to be added in the feature that implements it) |
|---|---|---|---|
| ASI01 | Agent Goal Hijack | Instruction-like text rejected in ref and repo (G8a). Repo text only reaches an agent as `wrap_untrusted` data (G8c). `detect_injection` flags goal-override text in README, SKILL.md, agent and MCP bodies, names and commit message (G8b) | `test_sg_guard.py::test_rejects_instruction_like_ref`, `test_sg_guard.py::test_detect_injection_rules`, `test_sg_guard.py::test_wrap_untrusted_escapes_delimiters` |
| ASI02 | Tool Misuse and Exploitation | Git runs by argument list with `--` and a rebuilt URL, validated ref, hardened env. No shell. Scanner has no tool that executes repo content | `test_sg_guard.py::test_rejected_before_any_subprocess`, `test_github_fetch.py::test_rejected_inputs`, `test_github_fetch.py::test_fetch_hook_not_run` |
| ASI03 | Identity and Privilege Abuse | No tokens, isolated `HOME`, empty git config, no credential helper. Workflows use `contents: read` only and pass inputs via `env:` | `test_github_fetch.py::test_fetch_env_isolated`, `test_agent_policy.py` workflow permission checks |
| ASI04 | Agentic Supply Chain Vulnerabilities | Host fixed to github.com over https, no submodules, LFS or tags, no mirrors. Only package coordinates go to OSV.dev. The scanner itself stays stdlib-only | `test_github_fetch.py::test_clone_url_rebuilt`, `test_github_fetch.py::test_fetch_argv_hardened` |
| ASI05 | Unexpected Code Execution | Repo code is never executed: no install, build or script. Hooks disabled. Symlinks outside the workspace are not followed | `test_github_fetch.py::test_fetch_hook_not_run`, `test_github_fetch.py::test_symlink_escape_skipped` |
| ASI06 | Memory and Context Poisoning | Nothing derived from untrusted content is written to suppressions, config or memory (G8d). Evidence is sanitized and truncated. History and report files hold escaped text only | `test_sg_guard.py::test_scan_writes_no_state_from_repo_text`, `test_sg_guard.py::test_sanitize_untrusted_strips_hidden_chars` |
| ASI07 | Insecure Inter-Agent Communication | Not applicable in the CLI path: the scanner has no agent-to-agent channel. Closest control: the scanner-to-triage-agent hand-off is structured JSON (`sg-findings-schema`) plus `wrap_untrusted` delimiters | `test_sg_guard.py::test_wrap_untrusted_escapes_delimiters`, `test_properties.py` schema validation |
| ASI08 | Cascading Failures | Per-collector `guarded()` isolation, timeout, size, file-count and per-file caps, truncation reported as `scanner/limits` error, fetch failure is an error, never clean (G8e) | `test_github_fetch.py::test_fetch_failure_not_clean`, `test_sg_scan_limits.py::test_truncation_reported` |
| ASI09 | Human-Agent Trust Exploitation | Reports escape repo text (Markdown, HTML, terminal) so a repo cannot forge a verdict or a fix suggestion. Findings show quoted evidence and rule id. Injection findings are never labeled clean | `test_sg_guard.py::test_report_escapes_repo_text`, `test_sg_guard.py::test_injection_finding_not_clean` |
| ASI10 | Rogue Agents | Not applicable: the scanner starts no autonomous agent and the feature is read-only (G5). Closest control: the demo-triage agent is read-only with deny rules, and remediation is not offered for a fetched repo | `test_agent_policy.py` (deny rules and read-only agents) |

Test names are the planned names. FEAT-002 to FEAT-005 create them and may adjust a name, in which case this table is
updated in the same commit.

### Clone versus tarball decision

Chosen: hardened `git clone` (shallow, single branch, hooks disabled, isolated env, https only). Reason: it matches how
a developer would fetch the code, gives the commit SHA directly, and does not depend on the API rate limit. The
tarball API (`/repos/{o}/{r}/tarball/{ref}`) avoids git config and hooks and is easy to size-limit while streaming, but
unauthenticated calls are limited to 60 per hour per IP. It was not prototyped because there is no network in the
build environment. It stays a documented alternative.

