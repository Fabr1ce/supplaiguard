---
inclusion: always
---

# Severity and Confidence Scoring

The Threat Analysis and Verification agents MUST assign `severity` and
`confidence` to every finding using these rules. This is the single source of
truth for scoring (referenced by `sg-osv-dependency-scan` and
`sg-ai-component-rules`).

## Severity (enum: critical | high | medium | low)

### Dependency findings (OSV.dev)

Derive severity from the OSV record, in priority order:

1. If the OSV record has a **CVSS v3/v4 base score**, map:
   - `>= 9.0` → `critical`
   - `7.0–8.9` → `high`
   - `4.0–6.9` → `medium`
   - `< 4.0` → `low`
2. Else if the OSV record has a **qualitative database severity**
   (e.g. GHSA `CRITICAL/HIGH/MODERATE/LOW`), map directly
   (`MODERATE` → `medium`).
3. Else default to `medium`.

### AI-component findings

Use the severity assigned to the matched rule in
`ai-component-security-rules.md`. If the rule does not specify one, default to
`medium`.

## Confidence (enum: high | medium | low)

- **high** — Deterministic match with authoritative evidence:
  - Dependency: OSV returns a vulnerability for the exact resolved
    package@version AND provides an explicit severity and/or a fixed version.
  - AI-component: an exact deterministic rule match (e.g. literal `"*"`
    auto-approve, literal `tools: ["*"]`).
- **medium** — Match is real but some data is missing or heuristic:
  - Dependency: OSV match without explicit severity (severity defaulted to
    `medium`), or version range match rather than exact pin.
  - AI-component: pattern/heuristic match (e.g. a broad glob permission).
- **low** — Weak/heuristic signal that warrants human review:
  - Suspicious-but-ambiguous agent-skill instruction indicators.
  - Approximate (unlocked) dependency inventory where the exact resolved version
    could not be confirmed.

## Interaction with status

Severity and confidence never change a finding's `status`. Only the Verification
agent moves a finding to `resolved`, and only after a passing re-check (see the
security policy, rule 6).
