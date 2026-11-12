---
name: sg-verification
description: Verify that SupplAIGuard remediations actually resolved findings by re-running the checks, and produce a before-and-after security report. Use when verifying fixes, confirming a vulnerability is resolved, detecting regressions, or generating a final verification report.
---

# SupplAIGuard Verification

Proves remediation worked by re-running the same checks against the modified
workspace. Read-only with respect to source files. A file edit NEVER counts as
resolution — only a passing re-check does (security policy, rule 6).

## Procedure

For every finding that was `remediated`:

### Dependency findings

1. Re-run `sg-npm-inventory` on the modified workspace to get the new resolved
   version of the component.
2. Re-run `sg-osv-dependency-scan` for that component@new-version.
3. Result:
   - OSV returns **no** vulnerability for the new version → `PASS`
     (set finding `status: resolved`).
   - OSV still returns the vulnerability → `FAIL` (status stays `remediated` or
     back to `open`).
   - New version unresolved/unknown, or OSV errored → `NEEDS_REVIEW`.

### AI-component findings

1. Re-run `sg-ai-component-rules` against the modified MCP/agent files.
2. Result: the matched `rule_id` no longer fires → `PASS` (`resolved`); still
   fires → `FAIL`; ambiguous → `NEEDS_REVIEW`.

## Regression detection

- Run a full re-scan (deps + AI components). If a finding exists now that did NOT
  exist in the original scan, it is a **regression**. Report it as a new finding
  and set the overall result to `FAIL` or `NEEDS_REVIEW`.

## Per-finding result

Each verified finding gets a result object traceable by `id`:

```json
{ "finding_id": "SG-001", "result": "PASS | FAIL | NEEDS_REVIEW", "evidence": "OSV returns 0 vulns for example-package@1.2.5" }
```

## Before-and-after report

Produce a consolidated report:

```json
{
  "scan_id": "scan-...",
  "overall": "PASS | FAIL | NEEDS_REVIEW",
  "original_findings": [ /* ids + types + severity */ ],
  "changes_made": [ /* from remediation output */ ],
  "resolved": [ "SG-001" ],
  "remaining": [ /* findings still open, with reason */ ],
  "regressions": [ /* new findings introduced */ ],
  "results": [ /* per-finding result objects */ ]
}
```

`overall` = `PASS` only if every original finding is `resolved` and there are no
regressions; `FAIL` if any remains or regressed; `NEEDS_REVIEW` if any result is
`NEEDS_REVIEW` and none are `FAIL`.

## Never

- Never mark `resolved` without a passing re-check.
- Never suppress a regression to make the report look clean.
