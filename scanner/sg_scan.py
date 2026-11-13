#!/usr/bin/env python3
"""SupplAIGuard deterministic scanner (Phase 2).

Implements the rule catalog in .kiro/steering/ai-component-security-rules.md and
emits the findings schema from the sg-findings-schema skill. Exact checks
(MCP-*, AGT-*, INT-*, dependency CVEs, SKL-* phrase matches) are done in code so
results are reproducible; the LLM agents are reserved for triage, semantic SKL
review, and remediation.

Usage: sg_scan.py [REPO] [--offline] [--pretty]
Exit:  0 clean | 1 findings | 2 scan errors (never a false all-clear)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OSV_BATCH = "https://api.osv.dev/v1/querybatch"
OSV_VULN = "https://api.osv.dev/v1/vulns/"
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__"}
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "0.0.0.0")
SECRET_KEY = re.compile(r"(key|token|secret|password|passwd|credential|authorization)", re.I)
ENV_REF = re.compile(r"^\$\{?\w+\}?$")
SHELL_NAMES = {"shell", "execute_bash", "bash"}
WRITE_NAMES = {"write", "fs_write"}

SKL_RULES = [
    ("SKL-001", "high", re.compile(r"(post|send|upload|exfiltrat\w*)\b.{0,60}\b(secret|credential|env|repo|token)\w*.{0,60}https?://", re.I | re.S),
     "Instruction to exfiltrate data to an external URL."),
    ("SKL-002", "high", re.compile(r"(disable|ignore|bypass|skip|turn off)\b.{0,40}\b(security|safety|approval|guardrail|permission)", re.I),
     "Instruction to disable or bypass security controls."),
    ("SKL-003", "high", re.compile(r"(curl|wget)\b[^\n|]*\|\s*(ba)?sh|\beval\b.{0,30}(download|fetch|curl)", re.I),
     "Instruction to fetch and execute remote code."),
    ("SKL-004", "high", re.compile(r"(read|cat|print|include)\b.{0,40}(\.env|id_rsa|\.aws/credentials|\.pem)", re.I),
     "Instruction to read credential files and disclose them."),
    ("SKL-005", "medium", re.compile(r"ignore (all )?(previous|prior|above) instructions|you are now\b", re.I),
     "Prompt-injection style override."),
]


class Scan:
    def __init__(self, repo: Path):
        self.repo = repo
        self.findings: list[dict] = []
        self.errors: list[dict] = []

    def add(self, **f):
        f["id"] = f"SG-{len(self.findings) + 1:03d}"
        f.setdefault("confidence", "high")
        f.setdefault("remediation_available", True)
        f["status"] = "open"
        self.findings.append(f)

    def error(self, source: str, stage: str, message: str):
        self.errors.append({"source": source, "stage": stage, "message": message})


def rel(scan: Scan, p: Path) -> str:
    try:
        return str(p.relative_to(scan.repo))
    except ValueError:
        return str(p)


def load_json(scan: Scan, p: Path, stage: str):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError) as e:
        scan.error(rel(scan, p), stage, f"unparseable: {e}")
        return None


def walk(repo: Path, names: set[str] | None = None, suffix: str | None = None):
    for p in repo.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts) or not p.is_file():
            continue
        if (names is None and suffix is None) or (names and p.name in names) or (suffix and p.name.endswith(suffix)):
            yield p


# ---------------------------------------------------------------- MCP rules
def pinned(args: list[str], command: str) -> bool:
    pkgs = [a for a in args if not a.startswith("-")]
    if command not in ("npx", "uvx", "pnpm", "bunx") or not pkgs:
        return True
    pkg = pkgs[0]
    version = pkg.rsplit("@", 1)[1] if "@" in pkg[1:] else ""
    return bool(version) and version != "latest"


def scan_mcp(scan: Scan, p: Path):
    data = load_json(scan, p, "threat_analysis")
    if not isinstance(data, dict):
        return
    src = rel(scan, p)
    for name, srv in (data.get("mcpServers") or {}).items():
        if not isinstance(srv, dict):
            continue
        auto = srv.get("autoApprove")
        if auto == True or (isinstance(auto, list) and "*" in auto):  # noqa: E712
            scan.add(type="insecure_mcp_configuration", component=name, severity="high", source=src,
                     rule_id="MCP-001", evidence=f'"autoApprove": {json.dumps(auto)}',
                     description="MCP server auto-approves all tools, removing the human-in-the-loop guard.")
        for flag in ("trustAllTools", "trust_all_tools", "trustAll"):
            if srv.get(flag) is True:
                scan.add(type="insecure_mcp_configuration", component=name, severity="high", source=src,
                         rule_id="MCP-002", evidence=f'"{flag}": true',
                         description="MCP server disables tool prompting globally.")
        cmd, args = srv.get("command", ""), srv.get("args") or []
        if cmd and not pinned(args, cmd):
            scan.add(type="insecure_mcp_configuration", component=name, severity="medium", source=src,
                     rule_id="MCP-003", evidence=f'"command": "{cmd}", "args": {json.dumps(args)}',
                     description="Unpinned remote package; upstream changes execute locally.")
        url = srv.get("url", "")
        if url.startswith("http://") and not any(h in url for h in LOCAL_HOSTS):
            scan.add(type="insecure_mcp_configuration", component=name, severity="medium", source=src,
                     rule_id="MCP-004", evidence=f'"url": "{url}"',
                     description="Plaintext http:// endpoint on a non-local host.")
        for section in ("env", "headers"):
            for k, v in (srv.get(section) or {}).items():
                if isinstance(v, str) and SECRET_KEY.search(k) and not ENV_REF.match(v) and v:
                    scan.add(type="insecure_mcp_configuration", component=name, severity="high", source=src,
                             rule_id="MCP-005", evidence=f'"{k}": "{v[:4]}***"',
                             description="Hardcoded secret in MCP config; rotate it and use an env var.")


# ---------------------------------------------------------------- agent rules
def agent_caps(agent: dict) -> dict:
    """Return which of shell/write are allowed, and whether each is restricted."""
    tools = set(agent.get("allowedTools") or []) | set(agent.get("tools") or [])
    rules = (agent.get("permissions") or {}).get("rules") or []
    settings = agent.get("toolsSettings") or {}
    wildcard = "*" in tools or any(
        r.get("capability") == "all" and r.get("effect") == "allow" for r in rules)

    def cap(names: set[str], settings_keys: set[str], restrict_keys: tuple[str, ...]):
        rule_hits = [r for r in rules if r.get("capability") in names and r.get("effect") == "allow"]
        allowed = wildcard or bool(tools & names) or bool(rule_hits)
        restricted = any(r.get("match") for r in rule_hits) or any(
            settings.get(k, {}).get(rk) for k in settings_keys for rk in restrict_keys)
        return allowed, restricted

    sh, shr = cap(SHELL_NAMES, {"execute_bash", "shell"}, ("allowedCommands",))
    wr, wrr = cap(WRITE_NAMES, {"fs_write", "write"}, ("allowedPaths", "deniedPaths"))
    return {"wildcard": wildcard, "shell": sh and not shr, "write": wr and not wrr}


def scan_skl(scan: Scan, component: str, source: str, text: str):
    for rid, sev, rx, why in SKL_RULES:
        m = rx.search(text)
        if m:
            scan.add(type="suspicious_agent_skill", component=component, severity=sev, source=source,
                     rule_id=rid, evidence=m.group(0)[:160], description=why,
                     confidence="medium" if rid == "SKL-005" else "high")


def scan_agent(scan: Scan, p: Path):
    agent = load_json(scan, p, "threat_analysis")
    if not isinstance(agent, dict) or "name" not in agent:
        return
    src, name = rel(scan, p), agent["name"]
    caps = agent_caps(agent)
    if caps["wildcard"]:
        scan.add(type="excessive_tool_permissions", component=name, severity="high", source=src,
                 rule_id="AGT-001", evidence='tools/allowedTools contains "*" or permission rule capability=all',
                 description="Grants every tool, including write and shell, with no gating.")
    else:
        if caps["shell"]:
            scan.add(type="excessive_tool_permissions", component=name, severity="high", source=src,
                     rule_id="AGT-002", evidence="shell allowed with no command allow-list",
                     description="Arbitrary command execution with no restriction.")
        if caps["write"]:
            scan.add(type="excessive_tool_permissions", component=name, severity="high", source=src,
                     rule_id="AGT-003", evidence="write allowed with no path restriction",
                     description="Can modify any file, including secrets and ~/.kiro configs.")
    if caps["shell"] and caps["write"] or caps["wildcard"]:
        scan.add(type="excessive_tool_permissions", component=name, severity="high", source=src,
                 rule_id="AGT-004", evidence="shell + unrestricted write together",
                 description="Combined capability enables self-modifying and lateral actions.")
    prompt = agent.get("prompt") or ""
    if prompt.startswith("file://"):
        pf = (p.parent / prompt[7:]).resolve()
        prompt = pf.read_text() if pf.is_file() else ""
    scan_skl(scan, name, src, prompt)


# ---------------------------------------------------------------- dependencies
def semver(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", v.split("-")[0])[:3])


def lock_packages(scan: Scan, p: Path) -> dict[str, str]:
    data = load_json(scan, p, "discovery") or {}
    out: dict[str, str] = {}
    for path, meta in (data.get("packages") or {}).items():
        if path and meta.get("version") and "node_modules/" in path:
            out[path.rsplit("node_modules/", 1)[1]] = meta["version"]

    def v1(deps):
        for n, m in (deps or {}).items():
            if m.get("version"):
                out[n] = m["version"]
            v1(m.get("dependencies"))
    v1(data.get("dependencies"))
    return out


def http_json(url: str, body: dict | None = None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 (fixed https host)
        return json.load(r)


def requirements_packages(p: Path) -> dict[str, str]:
    """Pinned `name==version` lines of a requirements*.txt (unpinned lines are skipped)."""
    out: dict[str, str] = {}
    for line in p.read_text(errors="ignore").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*==\s*([A-Za-z0-9_.\-+!]+)", line)
        if m:
            out[m.group(1).lower().replace("_", "-")] = m.group(2)
    return out


def scan_deps(scan: Scan, lock: Path, offline: bool):
    eco = "PyPI" if lock.suffix == ".txt" else "npm"
    pkgs = requirements_packages(lock) if eco == "PyPI" else lock_packages(scan, lock)
    if not pkgs or offline:
        if offline and pkgs:
            scan.error("osv.dev", "threat_analysis", "offline mode: dependency CVEs NOT checked")
        return
    src = rel(scan, lock)
    items = sorted(pkgs.items())
    try:
        vulns: dict[tuple[str, str], list[str]] = {}
        for i in range(0, len(items), 500):
            chunk = items[i:i + 500]
            res = http_json(OSV_BATCH, {"queries": [
                {"package": {"name": n, "ecosystem": eco}, "version": v} for n, v in chunk]})
            for (n, v), r in zip(chunk, res.get("results", [])):
                ids = [x["id"] for x in r.get("vulns", [])]
                if ids:
                    vulns[(n, v)] = ids
        for (name, ver), ids in vulns.items():
            sev_rank = {"LOW": 1, "MODERATE": 2, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}
            worst, fixes = 1, []
            for vid in ids:
                d = http_json(OSV_VULN + vid)
                worst = max(worst, sev_rank.get(str(d.get("database_specific", {}).get("severity", "")).upper(), 2))
                for aff in d.get("affected", []):
                    if aff.get("package", {}).get("name", "").lower().replace("_", "-") != name:
                        continue
                    cand = [e["fixed"] for r in aff.get("ranges", []) for e in r.get("events", [])
                            if "fixed" in e and semver(e["fixed"]) > semver(ver)]
                    if cand:
                        fixes.append(min(cand, key=semver))
            fix = max(fixes, key=semver) if fixes else None
            scan.add(type="vulnerable_dependency", component=name, current_version=ver,
                     recommended_version=fix or "none available",
                     severity={1: "low", 2: "medium", 3: "high", 4: "critical"}[worst], source=src,
                     evidence=ids, remediation_available=bool(fix),
                     description=f"{len(ids)} known advisories affect {name}@{ver}."
                     + (" Fix is a MAJOR version bump: review breaking changes." if fix and semver(fix)[0] > semver(ver)[0] else ""))
    except Exception as e:  # network/parse failure must never read as "clean"
        scan.error("osv.dev", "threat_analysis", f"OSV lookup failed: {e}")


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--offline", action="store_true", help="skip OSV lookups (reported as an error)")
    ap.add_argument("--pretty", action="store_true")
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    scan = Scan(repo)

    for p in walk(repo, {"mcp.json"}):
        scan_mcp(scan, p)
    for p in walk(repo, suffix=".json"):
        if p.parent.name == "agents" and p.parent.parent.name == ".kiro":
            scan_agent(scan, p)
    for p in walk(repo, {"SKILL.md"}):
        scan_skl(scan, p.parent.name, rel(scan, p), p.read_text(errors="ignore"))
    for p in walk(repo, {"package-lock.json"}):
        scan_deps(scan, p, a.offline)
    for p in walk(repo):
        if re.fullmatch(r"requirements[\w.\-]*\.txt", p.name):
            scan_deps(scan, p, a.offline)

    out = {"repository": repo.name, "scan_id": datetime.now(timezone.utc).strftime("scan-%Y%m%d-%H%M%S"),
           "environment": "local", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "findings": scan.findings, "errors": scan.errors}
    print(json.dumps(out, indent=2 if a.pretty else None))
    return 2 if scan.errors else (1 if scan.findings else 0)


if __name__ == "__main__":
    sys.exit(main())
