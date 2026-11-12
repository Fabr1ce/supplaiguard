---
name: sg-osv-dependency-scan
description: Query the OSV.dev API to find known vulnerabilities in npm dependencies and produce vulnerable_dependency findings. Use when analyzing dependencies for CVEs/advisories, checking package versions against OSV, or determining safe upgrade versions.
---

# OSV.dev Dependency Vulnerability Scan

Turns the npm dependency inventory into `vulnerable_dependency` findings using the
public OSV.dev API. Only package names + versions leave the machine (privacy).

Tools: `shell` restricted to `curl https://api.osv.dev/*`, plus `jq` for parsing.

## Step 1 — Batch query for vuln IDs

`POST https://api.osv.dev/v1/querybatch`. Body is a list of queries; one per
`(name, version)`:

```json
{ "queries": [ { "package": { "ecosystem": "npm", "name": "lodash" }, "version": "4.17.4" } ] }
```

Example:

```bash
echo '{"queries":[{"package":{"ecosystem":"npm","name":"lodash"},"version":"4.17.4"}]}' \
  | curl -s -X POST -d @- https://api.osv.dev/v1/querybatch
```

Response `results[]` aligns positionally with `queries[]`. Each has a `vulns[]`
array of `{ id, modified }` (IDs only). An empty/absent `vulns` for a query means
no known vulnerability for that package@version.

Batch in reasonable chunks (e.g. ≤100 queries per request) for large lockfiles.

## Step 2 — Fetch details per vuln ID

For each vuln id: `GET https://api.osv.dev/v1/vulns/{id}`.

```bash
curl -s https://api.osv.dev/v1/vulns/GHSA-29mw-wpgm-hmr9
```

From the detail record extract:

- **Severity source (priority order, per `severity-and-confidence.md`):**
  1. `severity[]` entry with `type` `CVSS_V3`/`CVSS_V4` → parse the base score
     from the vector (or use the numeric score if present) → map to band.
  2. else `database_specific.severity` (e.g. `CRITICAL/HIGH/MODERATE/LOW`;
     `MODERATE` → `medium`).
  3. else default `medium`.
- **Fixed version:** in `affected[]`, find the entry whose `package.name` matches
  AND `package.ecosystem == "npm"`. Within its `ranges[].events[]`, read
  `introduced` / `fixed`. The `fixed` value is the first non-vulnerable version.
  If multiple ranges apply to the installed version, pick the **lowest `fixed`
  that is greater than the current version** as `recommended_version`.
  - If an affected entry only has `last_affected` (no `fixed`), there may be no
    published fix → `remediation_available: false`.

## Step 3 — Build findings

For each vulnerable package@version, emit a `vulnerable_dependency` finding per
`sg-findings-schema`:

- `component` = package name, `current_version` = installed version.
- `recommended_version` = computed lowest fixed version (or omit if none).
- `remediation_available` = true iff a `fixed` version > current exists.
- `severity` from Step 2; `confidence` = `high` when OSV gave explicit severity
  AND a fix; `medium` otherwise (per scoring steering).
- `evidence` = the OSV id(s) (e.g. `GHSA-…` / `CVE-…`).
- `source` = the lockfile/manifest path the package came from.
- `description` = concise summary (what + fixed-in).

De-duplicate: one finding per `(component, current_version)`; list multiple
advisory ids in `evidence` and use the **highest** severity among them.

## Error handling (critical)

If OSV.dev is unreachable, times out, or returns a non-2xx status:

- Record a `ScanError` (`stage: "threat_analysis"`, `source: "osv.dev"`).
- DO NOT emit an "all clear" / zero-findings success. Report the failure so the
  caller (Coordinator) halts remediation. This is required by the security
  policy (never a false all-clear).

## Verification reuse

The Verification agent reuses this exact procedure against the post-remediation
inventory: a dependency finding only becomes `resolved` if the re-query returns
no vulnerability for the new installed version.
