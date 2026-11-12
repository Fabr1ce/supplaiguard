---
name: sg-findings-schema
description: The canonical SupplAIGuard findings JSON schema contract. Use whenever producing, consuming, validating, or passing SupplAIGuard scan results or findings between agents (discovery inventory, threat findings, remediation, verification reports).
---

# SupplAIGuard Findings Schema

Every SupplAIGuard agent communicates through this one schema. Agents MUST NOT
redefine or rename fields. Malformed output is an error — do not proceed as if a
malformed findings object were valid.

## Scan object

```json
{
  "repository": "string — repo name or path",
  "scan_id": "string — unique id, e.g. scan-<timestamp>",
  "environment": "local | ci",
  "generated_at": "ISO-8601 timestamp",
  "findings": [ /* Finding objects */ ],
  "errors": [ /* optional ScanError objects */ ]
}
```

## Finding object

```json
{
  "id": "SG-001",
  "type": "vulnerable_dependency | malicious_package_indicator | insecure_mcp_configuration | excessive_tool_permissions | suspicious_agent_skill | insecure_integration_configuration",
  "component": "string — package name or component identifier",
  "current_version": "string — dependency findings only",
  "recommended_version": "string — dependency findings only",
  "severity": "critical | high | medium | low",
  "confidence": "high | medium | low",
  "source": "string — file path the finding came from",
  "rule_id": "string — required for AI-component findings (e.g. MCP-001, AGT-003)",
  "evidence": "string | object — OSV advisory id(s) or the matched config/instruction excerpt",
  "description": "string — human-readable explanation",
  "remediation_available": true,
  "status": "open | remediated | resolved | needs_review"
}
```

### Field rules

- `id` — unique within the scan; prefix `SG-` + zero-padded number.
- `type` — exactly one of the six enum values.
- `current_version` / `recommended_version` — REQUIRED for
  `vulnerable_dependency`; omit for non-dependency types.
- `rule_id` — REQUIRED for `insecure_mcp_configuration`,
  `excessive_tool_permissions`, `suspicious_agent_skill`,
  `insecure_integration_configuration` (value from
  `ai-component-security-rules.md`).
- `severity` / `confidence` — assigned per `severity-and-confidence.md`.
- `evidence` — must be present; for malicious/suspicious claims it MUST quote the
  concrete supporting excerpt or advisory id (security policy: Evidence discipline).
- `remediation_available` — boolean; `true` only if a concrete safe fix exists.
- `status` — lifecycle: `open` (new) → `remediated` (fix applied, not yet
  verified) → `resolved` (verification passed) or `needs_review`. Only the
  Verification agent may set `resolved`.

## ScanError object (optional)

```json
{
  "source": "file path or 'osv.dev'",
  "stage": "discovery | threat_analysis | verification",
  "message": "human-readable error"
}
```

Use `errors` for unparseable manifests (discovery continues) and for OSV.dev
failures (never emit a false all-clear — security policy).

## Valid example

```json
{
  "repository": "vulnerable-ai-app",
  "scan_id": "scan-20261111-0001",
  "environment": "local",
  "generated_at": "2026-11-11T05:20:00Z",
  "findings": [
    {
      "id": "SG-001",
      "type": "vulnerable_dependency",
      "component": "example-package",
      "current_version": "1.2.0",
      "recommended_version": "1.2.5",
      "severity": "high",
      "confidence": "high",
      "source": "package-lock.json",
      "evidence": "GHSA-xxxx-xxxx-xxxx",
      "description": "Known prototype-pollution vulnerability; fixed in 1.2.5.",
      "remediation_available": true,
      "status": "open"
    },
    {
      "id": "SG-002",
      "type": "insecure_mcp_configuration",
      "component": "demo-mcp-server",
      "severity": "high",
      "confidence": "high",
      "source": ".kiro/settings/mcp.json",
      "rule_id": "MCP-001",
      "evidence": "\"autoApprove\": [\"*\"]",
      "description": "MCP server auto-approves all tools, removing the human-in-the-loop guard.",
      "remediation_available": true,
      "status": "open"
    }
  ],
  "errors": []
}
```

## Validation checklist

Before emitting a scan object, confirm:

- [ ] `repository`, `scan_id`, `environment` (`local`|`ci`), `generated_at`, `findings` present.
- [ ] Every finding has `id`, `type` (valid enum), `component`, `severity`, `confidence`, `source`, `description`, `remediation_available`, `status`.
- [ ] Dependency findings include `current_version` and `recommended_version`.
- [ ] AI-component findings include a valid `rule_id` and quoted `evidence`.
- [ ] No malicious/suspicious claim lacks evidence.
- [ ] Output is valid JSON (parseable by `jq`).
