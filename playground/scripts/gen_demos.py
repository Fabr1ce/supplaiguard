#!/usr/bin/env python3
"""Generate playground/src/data/demos.json from real scanner output on demo/*.

Nothing here is typed by hand except the names and one-line descriptions, which are copied from each demo's own
package.json or source docstring. Findings, severities and rule ids come from `scanner/sg_scan.py`.
Rule explanations are copied from .kiro/steering/ai-component-security-rules.md.
Usage: python3 playground/scripts/gen_demos.py   (needs network for the OSV lookup, like the scanner)
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "playground" / "src" / "data" / "demos.json"

DEMOS = [
    ("vulnerable-ai-app", "Vulnerable AI App", "demo/vulnerable-ai-app/package.json"),
    ("haunted-storyteller", "Haunted Storyteller", None),
    ("crypt-keeper-mcp", "Crypt Keeper MCP", "demo/crypt-keeper-mcp/package.json"),
    ("seance-gateway", "Séance Gateway", "demo/seance-gateway/package.json"),
]
# Private demos live in their own private repository and are NOT scanned here. Their entries carry only a name and a
# neutral description (never findings, counts or rule ids), so a visitor or an agent cannot read answers from this repo.
PRIVATE_DEMOS = [
    {"id": "ledgerlight", "name": "Ledgerlight",
     "description": "A small AI bookkeeping assistant that lives in its own private repository and runs SupplAIGuard through its own GitHub Actions. You cannot read its code; you only see the results.",
     "private": True},
]

# Source: demo/haunted-storyteller/storyteller/agent.py docstring.
HAUNTED = "Agent factory: a Strands agent wired to local tools + the Crypt Keeper MCP server."

# Source: .kiro/steering/ai-component-security-rules.md
RULES = {
    "MCP-001": "Wildcard auto-approval removes the human-in-the-loop guard; any tool the server exposes runs without prompting.",
    "MCP-003": "Unpinned remote code can change under you; a compromised upstream executes locally.",
    "MCP-004": "Credentials and traffic are exposed in transit.",
    "MCP-005": "Secret committed to config; rotate and move to an env var.",
    "AGT-001": "Grants every tool, including write and shell, with no gating.",
    "AGT-004": "Combined shell and unrestricted write enables self-modifying and lateral actions.",
    "SKL-002": "Attempts to defeat the human-in-the-loop controls.",
    "SKL-004": "Secret disclosure.",
    "SKL-005": "Possible prompt-injection payload; flag for review.",
}

CATEGORY = {
    "vulnerable_dependency": "Vulnerable dependency",
    "insecure_mcp_configuration": "Insecure MCP configuration",
    "excessive_tool_permissions": "Excessive agent permissions",
    "suspicious_agent_skill": "Suspicious agent instructions",
}


def scan(demo: str) -> dict:
    p = subprocess.run([sys.executable, "scanner/sg_scan.py", f"demo/{demo}", "--environment", "ci", "--format", "json"],
                       cwd=ROOT, capture_output=True, text=True)  # exit code 1 means findings, which is expected
    return json.loads(p.stdout)


def main() -> None:
    demos = []
    for demo_id, name, pkg in DEMOS:
        desc = HAUNTED if pkg is None else json.loads((ROOT / pkg).read_text())["description"]
        raw = scan(demo_id)
        findings = []
        for f in raw["findings"]:
            findings.append({
                "id": f["id"], "type": f["type"], "ruleId": f.get("rule_id", ""), "severity": f["severity"],
                "component": f["component"], "source": f.get("source", ""),
                "why": RULES.get(f.get("rule_id", ""), ""),
                "advisories": len(f.get("evidence", [])) if f["type"] == "vulnerable_dependency" else 0,
                "currentVersion": f.get("current_version", ""), "recommendedVersion": f.get("recommended_version", ""),
            })
        types = sorted({f["type"] for f in findings}, key=lambda t: list(CATEGORY).index(t))
        sev: dict = {}
        for f in findings:
            sev[f["severity"]] = sev.get(f["severity"], 0) + 1
        demos.append({"id": demo_id, "name": name, "description": desc,
                      "categories": [CATEGORY[t] for t in types], "bySeverity": sev,
                      "scannerVersion": raw.get("scanner_version", ""), "findings": findings})
    demos.extend(PRIVATE_DEMOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(demos, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: " + ", ".join(f"{d['id']}={len(d['findings'])}" for d in demos if "findings" in d))


if __name__ == "__main__":
    main()
