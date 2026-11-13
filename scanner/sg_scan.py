#!/usr/bin/env python3
"""SupplAIGuard deterministic scanner (Phase 2).

Implements the rule catalog in .kiro/steering/ai-component-security-rules.md and
emits the findings schema from the sg-findings-schema skill. Exact checks
(MCP-*, AGT-*, INT-*, dependency CVEs, SKL-* phrase matches) are done in code so
results are reproducible; the LLM agents are reserved for triage, semantic SKL
review, and remediation.

Usage: sg_scan.py [REPO] [--offline] [--pretty] [--format json|md|html]
                  [--fail-on low|medium|high|critical] [--environment local|ci]
                  [--out-dir DIR]
Exit:  0 clean | 1 findings at/above --fail-on | 2 scan errors (never a false all-clear)
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

VERSION = "0.2.0"
SEV_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}
FINDING_TYPES = {"vulnerable_dependency", "malicious_package_indicator", "insecure_mcp_configuration",
                 "excessive_tool_permissions", "suspicious_agent_skill", "insecure_integration_configuration"}
CONFIDENCE = {"high", "medium", "low"}
STATUSES = {"open", "remediated", "resolved", "needs_review"}
NO_RULE_ID = {"vulnerable_dependency", "malicious_package_indicator"}
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


def lock_packages(scan: Scan, p: Path) -> set[tuple[str, str]]:
    """Every (name, version) installed according to package-lock.json.

    A lockfile can hold several versions of one package (nested node_modules); each one is
    a separate install that can be vulnerable, so none may be collapsed by name.
    """
    data = load_json(scan, p, "discovery") or {}
    out: set[tuple[str, str]] = set()
    for path, meta in (data.get("packages") or {}).items():
        if path and meta.get("version") and "node_modules/" in path:
            out.add((path.rsplit("node_modules/", 1)[1], meta["version"]))

    def v1(deps):
        for n, m in (deps or {}).items():
            if m.get("version"):
                out.add((n, m["version"]))
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
    pkgs = set(requirements_packages(lock).items()) if eco == "PyPI" else lock_packages(scan, lock)
    if not pkgs or offline:
        if offline and pkgs:
            scan.error("osv.dev", "threat_analysis", "offline mode: dependency CVEs NOT checked")
        return
    src = rel(scan, lock)
    items = sorted(pkgs)
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


# ---------------------------------------------------------------- scan / validate / exit code
def run_scan(repo: Path, offline: bool = False, environment: str | None = None) -> dict:
    """Run every check and return a scan object per the sg-findings-schema skill."""
    repo = Path(repo).resolve()
    scan = Scan(repo)
    for p in walk(repo, {"mcp.json"}):
        scan_mcp(scan, p)
    for p in walk(repo, suffix=".json"):
        if p.parent.name == "agents" and p.parent.parent.name == ".kiro":
            scan_agent(scan, p)
    for p in walk(repo, {"SKILL.md"}):
        scan_skl(scan, p.parent.name, rel(scan, p), p.read_text(errors="ignore"))
    for p in walk(repo, {"package-lock.json"}):
        scan_deps(scan, p, offline)
    for p in walk(repo):
        if re.fullmatch(r"requirements[\w.\-]*\.txt", p.name):
            scan_deps(scan, p, offline)
    now = datetime.now(timezone.utc)
    env = environment or ("ci" if os.environ.get("GITHUB_ACTIONS") == "true" else "local")
    return {"repository": repo.name, "scan_id": now.strftime("scan-%Y%m%d-%H%M%S"), "environment": env,
            "generated_at": now.isoformat(timespec="seconds"), "scanner_version": VERSION,
            "findings": scan.findings, "errors": scan.errors}


def exit_code(out: dict, fail_on: str = "low") -> int:
    """2 if anything went wrong (never a false all-clear), 1 if a finding reaches the threshold, else 0."""
    if out.get("errors"):
        return 2
    limit = SEV_RANK[fail_on]
    return 1 if any(SEV_RANK.get(f.get("severity"), 0) >= limit for f in out.get("findings", [])) else 0


def validate_scan(out: dict) -> list[str]:
    """Check a scan object against the sg-findings-schema contract. Returns a list of problems."""
    bad: list[str] = []
    for k in ("repository", "scan_id", "environment", "generated_at", "findings"):
        if k not in out:
            bad.append(f"missing top-level field: {k}")
    if out.get("environment") not in ("local", "ci"):
        bad.append(f"environment must be local|ci, got {out.get('environment')!r}")
    ids = set()
    for f in out.get("findings", []):
        fid = f.get("id", "?")
        if fid in ids:
            bad.append(f"duplicate id {fid}")
        ids.add(fid)
        for k in ("id", "type", "component", "severity", "confidence", "source", "description",
                  "remediation_available", "status"):
            if k not in f:
                bad.append(f"{fid}: missing {k}")
        if f.get("type") not in FINDING_TYPES:
            bad.append(f"{fid}: bad type {f.get('type')!r}")
        if f.get("severity") not in SEV_RANK:
            bad.append(f"{fid}: bad severity {f.get('severity')!r}")
        if f.get("confidence") not in CONFIDENCE:
            bad.append(f"{fid}: bad confidence {f.get('confidence')!r}")
        if f.get("status") not in STATUSES:
            bad.append(f"{fid}: bad status {f.get('status')!r}")
        if not isinstance(f.get("remediation_available"), bool):
            bad.append(f"{fid}: remediation_available must be bool")
        if "evidence" not in f or f.get("evidence") in (None, "", []):
            bad.append(f"{fid}: evidence is required")
        if f.get("type") == "vulnerable_dependency":
            for k in ("current_version", "recommended_version"):
                if k not in f:
                    bad.append(f"{fid}: dependency finding missing {k}")
        if f.get("type") not in NO_RULE_ID and not f.get("rule_id"):
            bad.append(f"{fid}: AI-component finding missing rule_id")
    return bad


# ---------------------------------------------------------------- reports (all text is escaped: evidence is untrusted)
def _text(v, limit: int = 200) -> str:
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    v = re.sub(r"[\x00-\x1f\x7f]+", " ", str(v if v is not None else ""))
    return v[:limit] + ("…" if len(v) > limit else "")


def _md(v, limit: int = 200) -> str:
    return html.escape(_text(v, limit), quote=True).replace("|", "&#124;").replace("`", "&#96;")


def _counts(out: dict) -> dict:
    c = {s: 0 for s in ("critical", "high", "medium", "low")}
    for f in out.get("findings", []):
        if f.get("severity") in c:
            c[f["severity"]] += 1
    return c


def _status(out: dict) -> tuple[str, str]:
    if out.get("errors"):
        return "INCOMPLETE", "The scan did not finish cleanly, so this is NOT a clean result."
    if out.get("findings"):
        return "FINDINGS", f"{len(out['findings'])} finding(s) need attention."
    return "CLEAN", "No findings."


def _sorted(out: dict) -> list[dict]:
    return sorted(out.get("findings", []), key=lambda f: (-SEV_RANK.get(f.get("severity"), 0), f.get("id", "")))


def _detail(f: dict) -> str:
    if f.get("type") == "vulnerable_dependency":
        return f"{f.get('current_version', '?')} → {f.get('recommended_version', '?')}"
    return f.get("rule_id", "")


def render_md(out: dict) -> str:
    label, msg = _status(out)
    c = _counts(out)
    L = [f"## SupplAIGuard scan: {label}", "",
         f"{_md(msg)}", "",
         f"`{_md(out.get('repository'))}` · {_md(out.get('environment'))} · {_md(out.get('scan_id'))}", "",
         "| Critical | High | Medium | Low |", "|---|---|---|---|",
         f"| {c['critical']} | {c['high']} | {c['medium']} | {c['low']} |", ""]
    if out.get("errors"):
        L += ["### Scan errors", ""] + [f"- {_md(e.get('source'))} ({_md(e.get('stage'))}): {_md(e.get('message'))}"
                                       for e in out["errors"]] + [""]
    if out.get("findings"):
        L += ["### Findings", "", "| ID | Severity | Type | Component | Detail | Source |", "|---|---|---|---|---|---|"]
        for f in _sorted(out):
            L.append(f"| {_md(f.get('id'))} | {_md(f.get('severity'))} | {_md(f.get('type'))} | "
                     f"{_md(f.get('component'), 60)} | {_md(_detail(f), 60)} | {_md(f.get('source'), 80)} |")
        L.append("")
    return "\n".join(L)


_CSS = """body{margin:0;background:#120f1a;color:#e8e4f0;font:16px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 20px}h1{margin:0 0 4px;color:#ff9f43}
.sub{color:#9a93ad;margin-bottom:24px}.banner{padding:14px 18px;border-radius:10px;font-weight:600;margin-bottom:24px}
.CLEAN{background:#12351f;color:#7ee2a0}.FINDINGS{background:#3a1f12;color:#ffb27a}.INCOMPLETE{background:#3a1224;color:#ff7aa8}
.cards{display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap}.card{flex:1;min-width:110px;background:#1c1729;border-radius:10px;padding:12px 16px}
.card b{display:block;font-size:28px}.critical{color:#ff5c7a}.high{color:#ff9f43}.medium{color:#ffd166}.low{color:#8ecae6}
table{width:100%;border-collapse:collapse;background:#1c1729;border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #2a2440;vertical-align:top}th{color:#9a93ad;font-weight:600}
.pill{padding:2px 8px;border-radius:999px;background:#2a2440;font-size:13px}.err li{color:#ff7aa8}footer{margin-top:28px;color:#6f6888;font-size:13px}"""


def render_html(out: dict) -> str:
    e = lambda v, n=200: html.escape(_text(v, n), quote=True)  # noqa: E731
    label, msg = _status(out)
    c = _counts(out)
    rows = "".join(
        f"<tr><td>{e(f.get('id'))}</td><td class=\"{e(f.get('severity'))}\">{e(f.get('severity'))}</td>"
        f"<td>{e(f.get('type'))}</td><td>{e(f.get('component'), 80)}</td><td>{e(_detail(f), 80)}</td>"
        f"<td>{e(f.get('source'), 100)}</td><td>{e(f.get('evidence'), 160)}</td></tr>" for f in _sorted(out))
    errs = "".join(f"<li>{e(x.get('source'))} ({e(x.get('stage'))}): {e(x.get('message'))}</li>" for x in out.get("errors", []))
    err_html = f'<h2>Scan errors</h2><ul class="err">{errs}</ul>' if errs else ""
    cards = "".join(f"<div class=\"card\"><span class=\"{s}\">{s.title()}</span><b>{c[s]}</b></div>" for s in c)
    table = ("<table><thead><tr><th>ID</th><th>Severity</th><th>Type</th><th>Component</th><th>Detail</th>"
             f"<th>Source</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>") if rows else ""
    return (f"<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            f"<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>SupplAIGuard report</title>"
            f"<style>{_CSS}</style></head><body><main><h1>SupplAIGuard</h1>"
            f"<div class=\"sub\">{e(out.get('repository'))} · <span class=\"pill\">{e(out.get('environment'))}</span> · "
            f"{e(out.get('scan_id'))} · scanner {e(out.get('scanner_version', ''))}</div>"
            f"<div class=\"banner {label}\">{label}: {e(msg)}</div><div class=\"cards\">{cards}</div>"
            f"{err_html}{table}"
            f"<footer>Secure locally. Verify continuously. Ship confidently.</footer></main></body></html>")


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--offline", action="store_true", help="skip OSV lookups (reported as an error)")
    ap.add_argument("--pretty", action="store_true", help="indent JSON output")
    ap.add_argument("--format", choices=("json", "md", "html"), default="json", help="what to print to stdout")
    ap.add_argument("--fail-on", choices=tuple(SEV_RANK), default="low",
                    help="lowest severity that makes the exit code 1 (default: low = any finding)")
    ap.add_argument("--environment", choices=("local", "ci"), help="default: ci when GITHUB_ACTIONS=true")
    ap.add_argument("--out-dir", help="also write findings.json, summary.md and report.html here")
    a = ap.parse_args()

    out = run_scan(Path(a.repo), a.offline, a.environment)
    problems = validate_scan(out)
    if problems:  # a malformed scan object is a scanner bug: surface it, never pass it on as valid
        out["errors"].append({"source": "scanner", "stage": "validation", "message": "; ".join(problems[:5])})
    if a.out_dir:
        d = Path(a.out_dir)
        d.mkdir(parents=True, exist_ok=True)
        (d / "findings.json").write_text(json.dumps(out, indent=2))
        (d / "summary.md").write_text(render_md(out))
        (d / "report.html").write_text(render_html(out))
    if a.format == "md":
        print(render_md(out))
    elif a.format == "html":
        print(render_html(out))
    else:
        print(json.dumps(out, indent=2 if a.pretty else None))
    return exit_code(out, a.fail_on)


if __name__ == "__main__":
    sys.exit(main())
