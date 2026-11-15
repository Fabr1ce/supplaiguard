---
name: sg-remediation
description: Generate and apply safe, approval-gated fixes for SupplAIGuard findings (dependency version bumps and insecure config tightening). Use when remediating findings, proposing upgrades, or fixing insecure MCP/agent configurations.
---

# SupplAIGuard Remediation

Proposes and applies safe fixes with developer approval. This is the ONLY
SupplAIGuard capability allowed to write, and all writes are gated and scoped.
Follow the security policy at all times.

## Hard rules (from security policy)

- Never auto-merge anything.
- Never downgrade to a known-vulnerable version; only move forward.
- Never introduce an unverified dependency version.
- Never modify secret/prod files (`.env`, `**/*secret*`, `**/secrets/**`,
  `**/*.pem`, `**/*.key`).
- High-impact changes (major bumps, MCP command/transport changes, permission
  changes) require explicit developer approval before writing.
- Apply changes only after the developer approves the write.

## Procedure (per finding, only where `remediation_available: true`)

### Dependency findings (`vulnerable_dependency`)

1. Target version = `recommended_version` (lowest fixed > current, from
   `sg-osv-dependency-scan`). Confirm it is NOT itself vulnerable (re-check via
   OSV if unsure).
2. Classify impact: patch/minor = standard; major semver bump = high-impact
   (explicit approval).
3. Propose the edit:
   - Update the version in `package.json` (dependency range) and the resolved
     entry/entries in `package-lock.json`. Prefer regenerating the lockfile with
     `npm install <name>@<target>` when npm is available; otherwise edit the
     pinned `version` (and integrity, if the agent cannot recompute, flag that
     the lockfile needs `npm install` to finalize).
4. Explain the change: what, why (advisory id), from→to version, impact class.
5. Capture **before/after** of each changed file for verification.

### AI-component findings

- `MCP-001/002` (wildcard auto-approve): replace blanket approval with an
  explicit minimal allow-list, or remove auto-approval so tools prompt.
- `MCP-003`/`INT-001` (unpinned remote): pin to a specific published version.
- `MCP-004` (plaintext http): switch to `https` where supported.
- `MCP-005`/`INT-002` (hardcoded secret): replace literal with `${ENV_VAR}` and
  instruct the developer to set the env var; never write the secret value.
- `AGT-001..004` (excessive permissions): narrow `allowedTools` to the specific
  tools needed; add `toolsSettings` command allow-lists and path restrictions.
  These are permission changes → high-impact → explicit approval.

## Approval & write mechanics

- The Remediation agent's `toolsSettings.fs_write` restricts writes to manifests
  and config paths and denies secret/prod paths. Writes still prompt the
  developer for approval. If the developer declines, leave files unchanged and
  mark the finding `open` (not `remediated`).
- After a successful write, set the finding `status` to `remediated` (NOT
  `resolved` — only Verification can resolve it).

## Git workflow: every fix lands on its own branch (R20)

Run each command on its own. Chaining (`;`, `&&`, `||`), backticks and `$(` are denied, so they must
not appear in commit messages or PR titles and bodies either.

1. **Check first, before any write.**
   `git rev-parse --is-inside-work-tree`, then `git status --porcelain`. If this isn't a git repo, or any
   path other than `.supplaiguard/history.jsonl` shows as changed, STOP and ask the developer
   (commit or stash their work first). Never mix your edits with theirs.
2. **Branch.** Record the start branch with `git branch --show-current`, then
   `git switch -c supplaiguard/fix-<scan_id>`. Never write on the start branch.
3. **Edit** as in the procedure above. Each write prompts.
4. **If every edit was declined:** `git switch <start>`, then `git branch -D supplaiguard/fix-<scan_id>`.
   Report that nothing changed and stop.
5. **Commit.** `git add <path>` once per changed file (never `-A` or `.`), then
   `git commit -m "SupplAIGuard: fix SG-001 SG-003" -m "lodash 4.17.4 to 4.18.0 (GHSA-...)"`.
6. **Push and PR, each with a prompt; the developer may decline either.**
   `git push -u origin supplaiguard/fix-<scan_id>`, then
   `gh pr create --base <start> --head supplaiguard/fix-<scan_id> --title "SupplAIGuard: fix <ids>" --body "<plain text>"`.
   The body lists each finding, from and to, the advisory or rule id, and the line "Verification follows. Do not merge before it passes."
   NEVER merge, force-push, amend, reset, rebase, or push any other branch. If there is no `origin` remote
   or `gh` isn't logged in, skip this step and say so.
7. **Report header**, always first in your output:

```
Branch:      supplaiguard/fix-<scan_id>   (made from <start>)
Commit:      <git rev-parse --short HEAD>
PR:          <URL>  |  no PR opened yet: gh pr create --base <start> --head supplaiguard/fix-<scan_id>
Review diff: git diff <start>...supplaiguard/fix-<scan_id>
Go back:     git switch <start>
```

## Output

Start with the report header above. Then, for each remediated finding, produce:

```json
{
  "finding_id": "SG-001",
  "action": "bump example-package 1.2.0 -> 1.2.5",
  "impact": "standard | high",
  "approved": true,
  "files": [
    { "path": "package.json", "before": "...", "after": "..." },
    { "path": "package-lock.json", "before": "...", "after": "..." }
  ],
  "explanation": "Resolves GHSA-xxxx; patch bump, no API change."
}
```

Hand the set of remediations plus updated finding statuses to the Verification
agent.
