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

## Output

For each remediated finding, produce:

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
