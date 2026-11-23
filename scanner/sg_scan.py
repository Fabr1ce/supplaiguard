#!/usr/bin/env python3
"""SupplAIGuard deterministic scanner (Phase 2).

Implements the rule catalog in .kiro/steering/ai-component-security-rules.md and
emits the findings schema from the sg-findings-schema skill. Exact checks
(MCP-*, AGT-*, INT-*, dependency CVEs, SKL-* phrase matches) are done in code so
results are reproducible; the LLM agents are reserved for triage, semantic SKL
review, and remediation.

Usage: sg_scan.py [REPO | --github OWNER/REPO|URL [--ref REF] [--keep-workspace]] [--offline] [--pretty] [--format auto|text|json|md|html]
                  [--fail-on low|medium|high|critical] [--environment local|ci]
                  [--out-dir DIR] [--suppressions FILE] [--history [FILE]] [--phase analysis|verification]
       sg_scan.py [REPO] --learn-report [FILE] [--format text|json]
Exit:  0 clean | 1 findings at/above --fail-on | 2 scan errors (never a false all-clear)
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

import sg_guard  # sibling module, stdlib only

try:  # Python 3.11+. On 3.10 the scan still runs; uv.lock and poetry.lock are reported as not analysed.
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - depends on the interpreter
    tomllib = None

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
MAX_FILES = 50000
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_DOC_BYTES = 100 * 1024  # prose files are read for injection text up to this many bytes
MAX_JSON_STRINGS = 5000
MAX_NAME_FINDINGS = 100
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
        self.limits = {"symlinks": 0, "oversized": 0, "truncated": False}
        self.coverage = {"mcp_json": 0, "agent_configs": 0, "skills": 0, "lockfiles": 0, "requirements": 0}

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


def read_capped(p: Path, root: Path | None = None, errors: str = "strict") -> str:
    """Read a text file, refusing anything outside `root` (when given) or larger than MAX_FILE_BYTES."""
    if root is not None:
        real = p.resolve()
        if real != root.resolve() and root.resolve() not in real.parents:
            raise OSError("path resolves outside the repository")
    if p.stat().st_size > MAX_FILE_BYTES:
        raise OSError(f"file larger than {MAX_FILE_BYTES} bytes")
    return p.read_text(errors=errors)


def load_json(scan: Scan, p: Path, stage: str):
    try:
        return json.loads(read_capped(p, scan.repo))
    except (OSError, ValueError) as e:
        scan.error(rel(scan, p), stage, f"unparseable: {e}")
        return None


def walk(repo: Path, names: set[str] | None = None, suffix: str | None = None, stats: dict | None = None):
    """Yield regular files under `repo`. Never follows symlinks out of the repo, skips oversized files
    and stops after MAX_FILES. Counts of what was skipped are added to `stats` when given."""
    stats = stats if stats is not None else {"symlinks": 0, "oversized": 0, "truncated": False}
    root = Path(os.path.realpath(repo))
    seen = 0

    def inside(real: str) -> bool:
        return real == str(root) or real.startswith(str(root) + os.sep)

    for dirpath, dirnames, filenames in os.walk(repo, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for d in dirnames:  # a symlinked dir is never descended into; count the ones that leave the repo
            full = os.path.join(dirpath, d)
            if os.path.islink(full) and not inside(os.path.realpath(full)):
                stats["symlinks"] += 1
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            if os.path.islink(full):
                real = os.path.realpath(full)
                if not inside(real):
                    stats["symlinks"] += 1
                    continue
                if not os.path.isfile(real):
                    continue
            elif not os.path.isfile(full):
                continue
            try:
                if os.stat(full).st_size > MAX_FILE_BYTES:
                    stats["oversized"] += 1
                    continue
            except OSError:
                continue
            if seen >= MAX_FILES:
                stats["truncated"] = True
                return
            seen += 1
            p = Path(full)
            if (names is None and suffix is None) or (names and fn in names) or (suffix and fn.endswith(suffix)):
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
    if data is None:
        return  # already recorded as unparseable
    src = rel(scan, p)
    if not isinstance(data, dict):
        scan.error(src, "threat_analysis", "MCP config must be a JSON object; the file was not analysed")
        return
    servers = data.get("mcpServers") or {}
    if not isinstance(servers, dict):
        scan.error(src, "threat_analysis", "'mcpServers' must be an object; the file was not analysed")
        return
    for name, srv in servers.items():
        if not isinstance(srv, dict):
            scan.error(src, "threat_analysis", f"MCP server {str(name)[:40]!r} is not an object; it was not analysed")
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
    scan_injection(scan, component, source, text)


def scan_injection(scan: Scan, component: str, source: str, text, existing: set | None = None) -> int:
    """Run the prompt-injection detector over untrusted text and add its findings. A finding is skipped when
    the same rule already fired for the same source on the same evidence (scan_skl overlaps the detector).
    Returns the number of findings added."""
    added = 0
    for f in sg_guard.detect_injection(text, source=source, component=component):
        ev = f["evidence"]
        dup = any(g.get("type") == "suspicious_agent_skill" and g.get("rule_id") == f["rule_id"]
                  and g.get("source") == f["source"]
                  and (g.get("evidence") == ev or ev in g.get("evidence", "") or g.get("evidence", "") in ev)
                  for g in scan.findings)
        if dup:
            continue
        scan.add(**f)
        added += 1
    return added


def _json_strings(node, out: list, depth: int = 0):
    if len(out) >= MAX_JSON_STRINGS or depth > 40:
        return
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for k, v in node.items():
            _json_strings(k, out, depth + 1)
            _json_strings(v, out, depth + 1)
    elif isinstance(node, list):
        for v in node:
            _json_strings(v, out, depth + 1)


def scan_json_strings(scan: Scan, p: Path, component: str):
    """Injection check over every string in an MCP or agent JSON file. Unparseable files are already
    reported by their own collector, so failures here are silent."""
    try:
        data = json.loads(read_capped(p, scan.repo))
    except (OSError, ValueError):
        return
    strings: list[str] = []
    _json_strings(data, strings)
    src = rel(scan, p)
    for s in strings:
        scan_injection(scan, component, src, s[:MAX_DOC_BYTES])


def read_prose(scan: Scan, p: Path) -> str:
    return read_capped(p, scan.repo, errors="ignore")[:MAX_DOC_BYTES]


def scan_names(scan: Scan, files: list[Path]):
    """Directory and file names are attacker-chosen text too (tag characters, instruction-like names)."""
    seen: set[str] = set()
    flagged = 0
    for p in files:
        parts = Path(rel(scan, p)).parts
        for i in range(len(parts)):
            path = "/".join(parts[: i + 1])
            if path in seen:
                continue
            seen.add(path)
            if flagged >= MAX_NAME_FINDINGS:
                scan.error("scanner/limits", "threat_analysis",
                           f"stopped reporting suspicious file names after {MAX_NAME_FINDINGS} findings")
                return
            flagged += scan_injection(scan, "file name", path, parts[i])


def scan_agent(scan: Scan, p: Path):
    agent = load_json(scan, p, "threat_analysis")
    if agent is None:
        return  # already recorded as unparseable
    src = rel(scan, p)
    if not isinstance(agent, dict):
        scan.error(src, "threat_analysis", "agent config must be a JSON object; the file was not analysed")
        return
    name = str(agent.get("name") or p.stem)  # `name` is optional: Kiro derives it from the filename
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
        root = scan.repo.resolve()
        if pf != root and root not in pf.parents:
            scan.error(src, "threat_analysis", "prompt file:// path points outside the repository; it was not read")
            prompt = ""
        elif pf.is_file():
            try:
                prompt = read_capped(pf, root)
            except OSError as e:
                scan.error(src, "threat_analysis", f"prompt file could not be read safely: {e}")
                prompt = ""
        else:
            prompt = ""
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
    for line in read_capped(p, errors="ignore").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*==\s*([A-Za-z0-9_.\-+!]+)", line)
        if m:
            out[m.group(1).lower().replace("_", "-")] = m.group(2)
    return out


PY_LOCKFILES = ("uv.lock", "poetry.lock")


def python_lock_packages(scan: Scan, p: Path) -> set[tuple[str, str]]:
    """Every registry (name, version) in a uv.lock or poetry.lock. Both files are TOML with `[[package]]` tables.

    uv marks the project itself and local or git packages with a non-registry `source`; those are not on PyPI,
    so they are skipped rather than sent to OSV as if they were.
    """
    if tomllib is None:
        scan.error(rel(scan, p), "discovery", "reading this lockfile needs Python 3.11 or newer; dependencies NOT checked")
        return set()
    try:
        data = tomllib.loads(read_capped(p, errors="ignore"))
    except tomllib.TOMLDecodeError as e:
        scan.error(rel(scan, p), "discovery", f"lockfile is not valid TOML ({e}); not analysed")
        return set()
    out: set[tuple[str, str]] = set()
    for pkg in data.get("package") or []:
        if not isinstance(pkg, dict):
            continue
        name, ver, source = pkg.get("name"), pkg.get("version"), pkg.get("source")
        if not (isinstance(name, str) and isinstance(ver, str)):
            continue
        if isinstance(source, dict) and "registry" not in source:
            continue  # uv: virtual, editable, directory, git or path source
        out.add((name.lower().replace("_", "-"), ver))
    return out


def scan_deps(scan: Scan, lock: Path, offline: bool):
    eco = "PyPI" if lock.suffix == ".txt" or lock.name in PY_LOCKFILES else "npm"
    if lock.name in PY_LOCKFILES:
        pkgs = python_lock_packages(scan, lock)
    else:
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
def run_scan(repo: Path, offline: bool = False, environment: str | None = None,
             extra_texts: list[tuple[str, str, str]] | None = None) -> dict:
    """Run every check and return a scan object per the sg-findings-schema skill.
    `extra_texts` are (component, source, text) triples of untrusted text the caller already holds
    (e.g. the HEAD commit subject of a fetched repo); they get the injection check. Stays pure: no I/O here."""
    repo = Path(repo).resolve()
    scan = Scan(repo)

    def guarded(stage: str, p: Path, fn, *args):
        """One hostile or odd file must not stop the scan, and must never read as clean."""
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001
            scan.error(rel(scan, p), stage, f"could not be processed safely ({type(e).__name__}); not analysed")

    files = list(walk(repo, stats=scan.limits))
    cov = scan.coverage
    for p in files:
        if p.name == "mcp.json":
            cov["mcp_json"] += 1
            guarded("threat_analysis", p, scan_mcp, scan, p)
            guarded("threat_analysis", p, scan_json_strings, scan, p, "mcp.json")
    for p in files:
        if p.name.endswith(".json") and p.parent.name == "agents" and p.parent.parent.name == ".kiro":
            cov["agent_configs"] += 1
            guarded("threat_analysis", p, scan_agent, scan, p)
            guarded("threat_analysis", p, scan_json_strings, scan, p, p.stem)
    for p in files:
        if p.name == "SKILL.md":
            cov["skills"] += 1
            guarded("threat_analysis", p, lambda p=p: scan_skl(scan, p.parent.name, rel(scan, p),
                                                                read_capped(p, repo, errors="ignore")))
    for p in files:
        parts = Path(rel(scan, p)).parts
        if re.match(r"(readme|contributing)", p.name, re.I) or (
                len(parts) == 2 and parts[0] == "docs" and p.suffix.lower() == ".md"):
            guarded("threat_analysis", p, lambda p=p: scan_injection(scan, p.name, rel(scan, p), read_prose(scan, p)))
    guarded("threat_analysis", repo, scan_names, scan, files)
    for component, source, text in extra_texts or []:
        guarded("threat_analysis", repo, scan_injection, scan, str(component), str(source), text)
    for p in files:
        if p.name == "package-lock.json":
            cov["lockfiles"] += 1
            guarded("threat_analysis", p, scan_deps, scan, p, offline)
    for p in files:
        if p.name in PY_LOCKFILES:
            cov["lockfiles"] += 1
            guarded("threat_analysis", p, scan_deps, scan, p, offline)
    for p in files:
        if re.fullmatch(r"requirements[\w.\-]*\.txt", p.name):
            cov["requirements"] += 1
            guarded("threat_analysis", p, scan_deps, scan, p, offline)
    lim = scan.limits
    if lim["symlinks"] or lim["oversized"] or lim["truncated"]:
        msg = f"skipped {lim['symlinks']} symlink(s) outside the repo, {lim['oversized']} oversized file(s)"
        if lim["truncated"]:
            msg += f"; stopped after {MAX_FILES} files"
        scan.error("scanner/limits", "discovery", msg)
    now = datetime.now(timezone.utc)
    env = environment or ("ci" if os.environ.get("GITHUB_ACTIONS") == "true" else "local")
    return {"repository": repo.name, "scan_id": now.strftime("scan-%Y%m%d-%H%M%S"), "environment": env,
            "generated_at": now.isoformat(timespec="seconds"), "scanner_version": VERSION,
            "findings": scan.findings, "errors": scan.errors,
            "coverage": {"files_scanned": dict(scan.coverage)}}


def run_scan_failed(repository: str, environment: str | None, source: str, message: str) -> dict:
    """A scan that could not start (e.g. the fetch failed): no findings, one error, so never clean."""
    now = datetime.now(timezone.utc)
    env = environment or ("ci" if os.environ.get("GITHUB_ACTIONS") == "true" else "local")
    return {"repository": repository, "scan_id": now.strftime("scan-%Y%m%d-%H%M%S"), "environment": env,
            "generated_at": now.isoformat(timespec="seconds"), "scanner_version": VERSION, "findings": [],
            "errors": [{"source": source, "stage": "discovery", "message": message}]}


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
    if "source" in out:
        src = out["source"]
        if not isinstance(src, dict):
            bad.append("source must be an object")
        else:
            for k in sorted(set(src) - {"type", "url", "ref", "commit"}, key=str):
                bad.append(f"source: unknown key {k!r}")
            if src.get("type") != "github":
                bad.append(f"source.type must be 'github', got {src.get('type')!r}")
            if not (isinstance(src.get("url"), str) and src["url"].startswith("https://github.com/")):
                bad.append("source.url must start with https://github.com/")
            if not (isinstance(src.get("commit"), str) and re.fullmatch(r"[0-9a-f]{40}", src["commit"])):
                bad.append("source.commit must be a 40-char lowercase hex sha")
            if src.get("ref") is not None and not isinstance(src.get("ref"), str):
                bad.append("source.ref must be a string or null")
    if "coverage" in out:
        fs = out["coverage"].get("files_scanned") if isinstance(out["coverage"], dict) else None
        if not (isinstance(fs, dict) and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0
                                             for v in fs.values())):
            bad.append("coverage.files_scanned must be an object of non-negative integers")
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


# ---------------------------------------------------------------- suppressions (visible, reasoned, expiring)
SUPPRESSION_MATCH_KEYS = ("rule_id", "type", "component", "source")
SUPPRESSION_KEYS = set(SUPPRESSION_MATCH_KEYS) | {"reason", "expires"}


def load_suppressions(path: Path) -> tuple[list[dict], list[dict]]:
    """Read a suppressions file. Returns (valid entries, errors).

    Suppressions only ever move a finding into the report's `suppressed` list; they never delete
    it. Anything malformed is an error (so the scan exits 2) and that entry is NOT applied.
    """
    errors: list[dict] = []

    def err(msg: str):
        errors.append({"source": str(path), "stage": "suppressions", "message": msg})

    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError) as e:
        err(f"cannot read suppressions file: {e}")
        return [], errors
    entries = data.get("suppressions") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        err('file must be {"suppressions": [ ... ]}')
        return [], errors
    good: list[dict] = []
    for i, s in enumerate(entries):
        tag = f"entry {i}"
        if not isinstance(s, dict):
            err(f"{tag}: must be an object")
        elif set(s) - SUPPRESSION_KEYS:
            err(f"{tag}: unknown key(s) {sorted(set(s) - SUPPRESSION_KEYS)}")
        elif not isinstance(s.get("reason"), str) or not s["reason"].strip():
            err(f"{tag}: a non-empty 'reason' is required")
        elif not (s.get("rule_id") or s.get("type")) or not (s.get("component") or s.get("source")):
            err(f"{tag}: too broad; give rule_id or type, AND component or source")
        elif "expires" in s and not _valid_date(s["expires"]):
            err(f"{tag}: 'expires' must be YYYY-MM-DD")
        else:
            good.append(s)
    return good, errors


def _valid_date(v) -> bool:
    try:
        date.fromisoformat(v)
        return True
    except (TypeError, ValueError):
        return False


def _suppression_matches(s: dict, f: dict, today: date) -> bool:
    if "expires" in s and date.fromisoformat(s["expires"]) < today:
        return False  # expired: the finding comes back
    return all(f.get(k) == s[k] for k in SUPPRESSION_MATCH_KEYS if k in s)


def apply_suppressions(out: dict, suppressions: list[dict], today: date | None = None) -> dict:
    """Move matching findings from `findings` to `suppressed` (with the reason). Nothing is dropped."""
    today = today or date.today()
    kept, hidden = [], []
    for f in out.get("findings", []):
        hit = next((s for s in suppressions if _suppression_matches(s, f, today)), None)
        if hit:
            hidden.append({**f, "suppressed_reason": hit["reason"]})
        else:
            kept.append(f)
    out["findings"] = kept
    if hidden:
        out["suppressed"] = hidden
    return out


# ---------------------------------------------------------------- reports (all text is escaped: evidence is untrusted)
def _text(v, limit: int = 200) -> str:
    """Untrusted value to one safe line: no control, bidi, zero-width, tag or ANSI characters, no newlines."""
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    v = sg_guard.sanitize_untrusted(v, 1 << 30)
    return v[:limit] + ("…" if len(v) > limit else "")


_MD_ESCAPE = {ord(c): f"&#{ord(c)};" for c in "[]()!*_~#\\@"}


def _md(v, limit: int = 200) -> str:
    """Escape for Markdown: HTML entities for everything that can start a link, image, heading, emphasis or
    tag, and a broken '://' / 'www.' so nothing becomes an autolink."""
    t = "".join(_MD_ESCAPE.get(ord(ch)) or html.escape(ch, quote=True) for ch in _text(v, limit))
    t = t.replace("|", "&#124;").replace("`", "&#96;").replace("://", "&#58;&#47;&#47;")
    return re.sub(r"(?i)www\.", lambda m: m.group(0)[:-1] + "&#46;", t)


def _counts(out: dict) -> dict:
    c = {s: 0 for s in ("critical", "high", "medium", "low")}
    for f in out.get("findings", []):
        if f.get("severity") in c:
            c[f["severity"]] += 1
    return c


NOTHING_RECOGNISED = ("No findings, but nothing recognised was found to scan (looked for mcp.json, "
                      ".kiro/agents/*.json, SKILL.md, package-lock.json, uv.lock, poetry.lock, requirements*.txt). "
                      "This is not a statement that the repository is safe.")


def _nothing_recognised(out: dict) -> bool:
    fs = (out.get("coverage") or {}).get("files_scanned")
    return isinstance(fs, dict) and all(v == 0 for v in fs.values())


def _status(out: dict) -> tuple[str, str]:
    if out.get("errors"):
        return "INCOMPLETE", "The scan did not finish cleanly, so this is NOT a clean result."
    if out.get("findings"):
        return "FINDINGS", f"{len(out['findings'])} finding(s) need attention."
    if out.get("suppressed") and not _nothing_recognised(out):
        return "CLEAN", f"No open findings; {len(out['suppressed'])} suppressed with recorded reasons (listed below)."
    if _nothing_recognised(out):
        return "CLEAN", NOTHING_RECOGNISED
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
    if out.get("suppressed"):
        L += [f"### Suppressed ({len(out['suppressed'])}) — still reported, with the recorded reason", "",
              "| ID | Rule | Source | Reason |", "|---|---|---|---|"]
        for f in out["suppressed"]:
            L.append(f"| {_md(f.get('id'))} | {_md(f.get('rule_id') or f.get('type'))} | "
                     f"{_md(f.get('source'), 80)} | {_md(f.get('suppressed_reason'), 200)} |")
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
    sup_rows = "".join(
        f"<tr><td>{e(f.get('id'))}</td><td>{e(f.get('rule_id') or f.get('type'))}</td><td>{e(f.get('source'), 100)}</td>"
        f"<td>{e(f.get('suppressed_reason'), 200)}</td></tr>" for f in out.get("suppressed", []))
    sup_html = (f"<h2>Suppressed ({len(out['suppressed'])}) — still reported, with the recorded reason</h2>"
                f"<table><thead><tr><th>ID</th><th>Rule</th><th>Source</th><th>Reason</th></tr></thead>"
                f"<tbody>{sup_rows}</tbody></table>") if sup_rows else ""
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
            f"{err_html}{table}{sup_html}"
            f"<footer>Secure locally. Verify continuously. Ship confidently.</footer></main></body></html>")


# ---------------------------------------------------------------- plain-text report for a person at a terminal
# Everything from the scanned repository is untrusted: strip control codes (ANSI escapes can rewrite a
# terminal), bidi overrides (can reorder text to deceive) and newlines (could forge a fake RESULT line).
_TERM_BAD = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+")
_SEV_COLOR = {"critical": "1;31", "high": "31", "medium": "33", "low": "36"}
_VERDICT_COLOR = {"PASS": "1;32", "FAIL": "1;31", "INCOMPLETE": "1;35"}


def _term(v, limit: int = 200) -> str:
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    v = " ".join(_TERM_BAD.sub(" ", sg_guard.sanitize_untrusted(v, 1 << 30)).split())
    return v[:limit] + ("\u2026" if len(v) > limit else "")


def render_text(out: dict, fail_on: str = "low", color: bool = False, width: int = 100) -> str:
    """Human-friendly report: verdict, counts, then every finding (most severe first)."""
    def paint(text: str, code: str) -> str:
        return f"\x1b[{code}m{text}\x1b[0m" if color else text

    width = max(60, min(width, 140))
    code = exit_code(out, fail_on)
    verdict = {0: "PASS", 1: "FAIL", 2: "INCOMPLETE"}[code]
    findings, errors, suppressed = _sorted(out), out.get("errors", []), out.get("suppressed", [])
    counts = _counts(out)
    deps = [f for f in findings if f.get("type") == "vulnerable_dependency"]
    n_ai = len(findings) - len(deps)
    threshold = "any severity" if fail_on == "low" else f"{fail_on} or higher"

    def pl(n: int, word: str) -> str:
        return f"{n} {word}" + ("" if n == 1 else "s")
    at_or_above = sum(1 for f in findings if SEV_RANK.get(f.get("severity"), 0) >= SEV_RANK[fail_on])

    def row(label: str, text: str, indent: int = 0) -> str:
        prefix = " " * indent + f"{label:<10}"
        return textwrap.fill(text, width=width, initial_indent=prefix, subsequent_indent=" " * len(prefix),
                             break_long_words=True, break_on_hyphens=False)

    if verdict == "PASS":
        why = f"no findings meet the fail threshold: {threshold}"
        if findings:
            why += f"; {pl(len(findings), 'lower-severity finding')} listed below"
    elif verdict == "FAIL":
        why = f"{pl(at_or_above, 'finding')} meet the fail threshold: {threshold}"
    else:
        why = "the scan did not finish cleanly, so this is NOT a clean result"

    L = [f"SupplAIGuard scan: {_term(out.get('repository'), 80)}  "
         f"({_term(out.get('environment'), 10)}, {_term(out.get('scan_id'), 40)}, scanner {_term(out.get('scanner_version', '?'), 12)})",
         "-" * min(width, 72),
         f"RESULT    {paint(verdict, _VERDICT_COLOR[verdict])}  ({why})"]
    if findings:
        parts = ", ".join(paint(f"{counts[s]} {s}", _SEV_COLOR[s]) if counts[s] else f"{counts[s]} {s}"
                          for s in ("critical", "high", "medium", "low"))
        L.append(f"FINDINGS  {len(findings)} total: {parts}")
        L.append(f"          {len(deps)} vulnerable {'dependency' if len(deps) == 1 else 'dependencies'}, "
                 f"{pl(n_ai, 'AI-config issue')} (MCP servers, agent permissions, skills)")
        fixable = sum(1 for f in findings if f.get("remediation_available") is True)
        L.append(f"          {fixable} of {len(findings)} have a fix available")
    else:
        L.append("FINDINGS  No findings." if not suppressed else
                 f"FINDINGS  No open findings ({len(suppressed)} suppressed, listed below).")
    if suppressed and findings:
        L.append(f"SUPPRESSED {pl(len(suppressed), 'reviewed false positive')}, listed below")
    L.append(f"ERRORS    {pl(len(errors), 'scan error')}" if errors else "ERRORS    none")
    if _nothing_recognised(out):
        L.append(row("COVERAGE", NOTHING_RECOGNISED))

    if errors:
        L += ["", "SCAN ERRORS (the result above cannot be trusted as clean)"]
        for e in errors:
            L.append(row("  !", f"{_term(e.get('source'), 60)} ({_term(e.get('stage'), 20)}): {_term(e.get('message'), 200)}"))
    if findings:
        L += ["", f"FINDINGS, most severe first ({len(findings)})"]
        for i, f in enumerate(findings, 1):
            sev = str(f.get("severity", "?"))
            tag = paint(f"[{_term(sev, 8).upper()}]", _SEV_COLOR.get(sev, "0")) + " " * max(1, 11 - len(_term(sev, 8)) - 2)
            if f.get("type") == "vulnerable_dependency":
                fix = f.get("recommended_version")
                title = (f"{_term(f.get('component'), 60)} {_term(f.get('current_version'), 20)}"
                         + (f"  ->  {_term(fix, 20)}" if f.get("remediation_available") and fix else "  (no fixed version published)"))
                fixtxt = f"upgrade to {_term(fix, 20)}" if f.get("remediation_available") and fix else "none available yet"
            else:
                title = f"{_term(f.get('rule_id'), 12)}  {_term(f.get('component'), 60)}"
                fixtxt = ("change the configuration (the Remediation agent can propose the edit)"
                          if f.get("remediation_available") else "no automatic fix")
            L.append(f"{i:>3}. {tag} {_term(f.get('id'), 12)}  {title}")
            L.append(row("where:", _term(f.get("source"), 120), 6))
            L.append(row("why:", _term(f.get("description"), 240), 6))
            L.append(row("evidence:", _term(f.get("evidence"), 160), 6))
            L.append(row("fix:", fixtxt, 6))
    if suppressed:
        L += ["", f"SUPPRESSED ({len(suppressed)}): reviewed, still reported, with the recorded reason"]
        for f in suppressed:
            L.append(f"  ~ {_term(f.get('id'), 12)}  {_term(f.get('rule_id') or f.get('type'), 30)}  {_term(f.get('source'), 80)}")
            L.append(row("reason:", _term(f.get("suppressed_reason"), 240), 6))
    L += ["", paint("Other formats: --format json|md|html   Save all reports: --out-dir DIR   Threshold: --fail-on high", "2")]
    return "\n".join(L)


# ---------------------------------------------------------------- Learn: local history (R21)
HISTORY_DEFAULT = ".supplaiguard/history.jsonl"
STILL_OPEN_RUNS = 3


def _learn_key(f: dict) -> str:
    raw = "|".join(str(f.get(k) or "") for k in ("type", "rule_id", "component"))
    return hashlib.sha256(raw.encode("utf-8", "replace")).hexdigest()[:16]


def _valid_record(r) -> bool:
    return (isinstance(r, dict) and r.get("v") == 1 and isinstance(r.get("complete"), bool)
            and isinstance(r.get("findings"), list) and isinstance(r.get("resolved"), list)
            and all(isinstance(f, dict) and isinstance(f.get("key"), str) for f in r["findings"])
            and all(isinstance(k, str) for k in r["resolved"]))


def history_record(out: dict, prior: list[dict], phase: str, branch, commit, today: str | None = None) -> dict:
    """One allow-listed history line. Built field by field: nothing else from a finding can leak in."""
    complete = not out.get("errors")
    baseline = next((r for r in reversed(prior) if r.get("complete")), None)
    base_keys = {f["key"] for f in baseline["findings"]} if baseline else set()
    ever_resolved = {k for r in prior for k in r.get("resolved", [])}
    findings, seen = [], set()
    for f in out.get("findings", []):
        if not isinstance(f, dict):
            continue
        key = _learn_key(f)
        if key in seen:
            continue
        seen.add(key)
        learn = "remaining" if key in base_keys else "recurred" if key in ever_resolved else "new"
        findings.append({"key": key, "type": _term(f.get("type"), 40), "rule_id": _term(f.get("rule_id"), 20) or None,
                         "component": _term(f.get("component"), 120), "severity": _term(f.get("severity"), 10),
                         "learn": learn})
    resolved = sorted(base_keys - seen) if complete and baseline else []
    return {"v": 1, "date": today or date.today().isoformat(), "scanner_version": VERSION,
            "scan_id": _term(out.get("scan_id"), 40), "phase": phase,
            "branch": _term(branch, 120) if branch else None, "commit": _term(commit, 40) if commit else None,
            "complete": complete, "findings": findings, "resolved": resolved}


def read_history(path: Path) -> tuple[list[dict], int]:
    """Valid records in order, plus how many non-blank lines were skipped. Never raises on bad content."""
    if not path.is_file():
        return [], 0
    records, skipped = [], 0
    for line in path.read_text(errors="replace").split("\n"):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except ValueError:
            r = None
        if _valid_record(r):
            records.append(r)
        else:
            skipped += 1
    return records, skipped


def git_info(repo: Path) -> tuple[str | None, str | None]:
    def git(*args):
        try:
            r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=10)
            return r.stdout.strip() or None if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None
    return git("branch", "--show-current"), git("rev-parse", "--short", "HEAD")


def learn_summary(records: list[dict], skipped: int, n: int = STILL_OPEN_RUNS) -> dict:
    complete = [r for r in records if r.get("complete")]
    rules: dict[str, int] = {}
    info: dict[str, dict] = {}
    for r in complete:
        for f in r["findings"]:
            rule = f.get("rule_id") or f.get("type") or "?"
            rules[rule] = rules.get(rule, 0) + 1
            info[f["key"]] = {k: f.get(k) for k in ("rule_id", "type", "component", "severity")}
    recurred = sorted({f["key"] for r in records for f in r["findings"] if f.get("learn") == "recurred"})
    last = complete[-n:]
    still = sorted(set.intersection(*({f["key"] for f in r["findings"]} for r in last))) if len(last) >= n else []
    dates = [r.get("date") for r in records if r.get("date")]
    return {"runs": len(records), "complete_runs": len(complete), "first": min(dates, default=None),
            "last": max(dates, default=None), "skipped_lines": skipped,
            "top_rules": [[k, v] for k, v in sorted(rules.items(), key=lambda kv: (-kv[1], kv[0]))[:5]],
            "recurred": [{"key": k, **info.get(k, {})} for k in recurred],
            "still_open": [{"key": k, **info.get(k, {})} for k in still], "still_open_runs": n}


def render_learn(s: dict) -> str:
    def item(f):
        return f"  - {_term(f.get('rule_id') or f.get('type'), 30)}  {_term(f.get('component'), 80)}  ({_term(f.get('severity'), 10)})"
    L = [f"SupplAIGuard learn report: {s['runs']} runs ({s['complete_runs']} complete), "
         f"{_term(s['first'], 10)} to {_term(s['last'], 10)}"]
    if s["skipped_lines"]:
        L.append(f"Skipped {s['skipped_lines']} malformed history line(s).")
    L.append("Most frequent rules: " + (", ".join(f"{_term(k, 30)} x{v}" for k, v in s["top_rules"]) or "none"))
    L.append(f"Came back after being resolved ({len(s['recurred'])}):")
    L += [item(f) for f in s["recurred"]] or ["  none"]
    L.append(f"Open in each of the last {s['still_open_runs']} complete runs ({len(s['still_open'])}):")
    L += [item(f) for f in s["still_open"]] or ["  none" if s["complete_runs"] >= s["still_open_runs"]
                                                else f"  not enough runs yet (need {s['still_open_runs']})"]
    L.append("Learn is advisory: it never changes findings or exit codes. Recurring false positives can be "
             "proposed as suppressions; nothing is suppressed automatically.")
    return "\n".join(L)


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("repo", nargs="?", default=None, help="local directory to scan (default: .)")
    ap.add_argument("--github", metavar="REF", help="scan a public GitHub repo: OWNER/REPO or https://github.com/OWNER/REPO "
                    "(shallow clone into a private temp dir; nothing from it is executed)")
    ap.add_argument("--ref", help="branch or tag to scan with --github (default: the repo's default branch)")
    ap.add_argument("--keep-workspace", action="store_true", help="with --github, keep the temp clone and print its path")
    ap.add_argument("--offline", action="store_true", help="skip OSV lookups (reported as an error)")
    ap.add_argument("--pretty", action="store_true", help="indent JSON output")
    ap.add_argument("--format", choices=("auto", "text", "json", "md", "html"), default="auto",
                    help="what to print to stdout. auto (default): a readable report in a terminal, JSON when piped")
    ap.add_argument("--fail-on", choices=tuple(SEV_RANK), default="low",
                    help="lowest severity that makes the exit code 1 (default: low = any finding)")
    ap.add_argument("--environment", choices=("local", "ci"), help="default: ci when GITHUB_ACTIONS=true")
    ap.add_argument("--out-dir", help="also write findings.json, summary.md and report.html here")
    ap.add_argument("--suppressions", help="JSON file of reasoned, expiring suppressions (never auto-discovered: "
                    "in CI read it from a trusted ref, not from the PR being scanned)")
    ap.add_argument("--history", nargs="?", const="", metavar="FILE",
                    help=f"append an allow-listed record of this scan (default: REPO/{HISTORY_DEFAULT}); never changes the exit code")
    ap.add_argument("--phase", choices=("analysis", "verification"), default="analysis",
                    help="which lifecycle step this scan is, stored in the history record")
    ap.add_argument("--learn-report", nargs="?", const="", metavar="FILE",
                    help=f"summarise the history (default: REPO/{HISTORY_DEFAULT}) instead of scanning; exits 0")
    a = ap.parse_args()

    def usage_error(msg: str) -> int:
        print(f"sg_scan: error: {msg}", file=sys.stderr)
        return 2

    if a.github is not None and a.repo is not None:
        return usage_error("--github cannot be combined with a local REPO path")
    if (a.ref or a.keep_workspace) and a.github is None:
        return usage_error("--ref and --keep-workspace need --github")
    if a.github is not None and a.learn_report is not None:
        return usage_error("--learn-report works on a local history, not with --github")
    if a.github is not None and a.history == "":
        return usage_error("--history needs an explicit FILE with --github (never written into the clone)")
    local = Path(a.repo if a.repo is not None else ".")

    if a.learn_report is not None:
        path = Path(a.learn_report) if a.learn_report else local / HISTORY_DEFAULT
        if not path.is_file():
            print(f"No history yet at {path}. Scans add to it with --history.")
            return 0
        summary = learn_summary(*read_history(path))
        print(json.dumps(summary, indent=2) if a.format == "json" else render_learn(summary))
        return 0

    branch = commit = None
    if a.github is not None:
        import github_fetch  # sibling module, stdlib only; imported late so local scans do not need it
        import sg_guard
        try:
            gref = github_fetch.parse_github_ref(a.github, a.ref)
        except (github_fetch.InvalidGithubRef, sg_guard.GuardError) as e:
            return usage_error(sg_guard.sanitize_untrusted(str(e), max_len=200) or "invalid GitHub reference")
        with github_fetch.scan_workspace(a.keep_workspace) as ws:
            try:
                fr = github_fetch.fetch_repo(gref, ws)
                out = run_scan(fr.path, a.offline, a.environment,
                               [("HEAD commit message", "git:HEAD", fr.commit_subject)])
                out["repository"] = f"{gref.display}@{fr.commit[:7]}"
                out["source"] = {"type": "github", "url": f"https://github.com/{gref.owner}/{gref.repo}",
                                 "ref": fr.branch, "commit": fr.commit}
                branch, commit = fr.branch, fr.commit[:7]
            except github_fetch.FetchError as e:
                out = run_scan_failed(gref.display, a.environment,
                                      "github.fetch", sg_guard.sanitize_untrusted(str(e), max_len=300))
            if a.keep_workspace:
                print(f"sg_scan: workspace kept at {ws}", file=sys.stderr)
    else:
        out = run_scan(local, a.offline, a.environment)
    if a.suppressions:
        supps, serrs = load_suppressions(Path(a.suppressions))
        out["errors"].extend(serrs)
        apply_suppressions(out, supps)
    problems = validate_scan(out)
    if problems:  # a malformed scan object is a scanner bug: surface it, never pass it on as valid
        out["errors"].append({"source": "scanner", "stage": "validation", "message": "; ".join(problems[:5])})
    if a.history is not None:
        path = Path(a.history) if a.history else local / HISTORY_DEFAULT
        try:
            prior, _ = read_history(path)
            rec = history_record(out, prior, a.phase, *((branch, commit) if a.github is not None else git_info(local)))
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a") as fh:
                fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
        except OSError as e:  # advisory: the scan result and exit code stand (R21.5)
            print(f"sg_scan: could not write history to {path}: {e}", file=sys.stderr)
    if a.out_dir:
        d = Path(a.out_dir)
        d.mkdir(parents=True, exist_ok=True)
        (d / "findings.json").write_text(json.dumps(out, indent=2))
        (d / "summary.md").write_text(render_md(out))
        (d / "report.html").write_text(render_html(out))
    fmt = a.format if a.format != "auto" else ("text" if sys.stdout.isatty() else "json")
    if fmt == "text":
        color = sys.stdout.isatty() and "NO_COLOR" not in os.environ
        print(render_text(out, a.fail_on, color, shutil.get_terminal_size((100, 24)).columns))
    elif fmt == "md":
        print(render_md(out))
    elif fmt == "html":
        print(render_html(out))
    else:
        print(json.dumps(out, indent=2 if a.pretty else None))
    return exit_code(out, a.fail_on)


def cli() -> int:
    """Entry point. Anything unexpected exits 2: it must never look like "findings" (1) or "clean" (0)."""
    try:
        return main()
    except Exception as e:  # noqa: BLE001
        print(f"sg_scan: internal error: {type(e).__name__}: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(cli())
