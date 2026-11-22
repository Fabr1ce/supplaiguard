#!/usr/bin/env python3
"""Deterministic gate between an agent's proposed edits (made in a COPY of a repo) and a draft pull request.

Usage: fix_gate.py ORIGINAL_DIR NEW_DIR   -> JSON on stdout; exit 0 if every change is allowed, 2 otherwise

The agent is trusted to propose, not to decide what may change. This gate decides, with no model involved:
  - only manifests and agent/MCP config may differ (allow-list); source, secrets, workflows and .git never may
  - symlinks, absolute paths and `..` in the copy are refused
  - major version changes and brand-new dependencies are reported so the PR can say they need explicit approval
A `.disabled` suffix (used to keep Kiro from starting MCP servers in the copy) is mapped back to the real name.
Standard library only. Policy: never modify secret files; high-impact changes need explicit human approval.
"""
from __future__ import annotations

import fnmatch
import json
import re
import sys
from pathlib import Path

ALLOWED = ("package.json", "package-lock.json", "requirements*.txt", ".kiro/agents/*.json",
           ".kiro/settings/mcp.json", ".kiro/skills/*/SKILL.md")
SKIP_DIRS = {"node_modules", ".git", "dist", ".venv", "__pycache__", ".pytest_cache"}
SECTIONS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
MAJOR = re.compile(r"(\d+)")


def _denied(path: str) -> bool:
    p = path.replace("\\", "/")
    parts = p.split("/")
    base = parts[-1].lower()
    return (p.startswith("/") or ".." in parts or parts[0] in {".git", ".github"} or base.startswith(".env")
            or "secret" in p.lower() or base.endswith((".pem", ".key")))


def violations(changed: list[str]) -> list[str]:
    return [c for c in changed if _denied(c) or not any(fnmatch.fnmatchcase(c, pat) for pat in ALLOWED)]


def _major(spec: str) -> int | None:
    m = MAJOR.search(spec.lstrip("^~<>=v ").split(" ")[0]) if re.match(r"^[\^~<>=v ]*\d", spec) else None
    return int(m.group(1)) if m else None


def _deps(pkg: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for s in SECTIONS:
        d = pkg.get(s)
        if isinstance(d, dict):
            out.update({str(k): str(v) for k, v in d.items()})
    return out


def risky_changes(old: dict, new: dict) -> dict[str, list[str]]:
    o, n = _deps(old), _deps(new)
    major, added = [], []
    for name, spec in n.items():
        if name not in o:
            added.append(f"{name}@{spec}")
        elif spec != o[name]:
            a, b = _major(o[name]), _major(spec)
            if a is None or b is None or a != b:
                major.append(f"{name}: {o[name]} -> {spec}")
    return {"major": major, "added": added}


def _files(root: Path) -> tuple[dict[str, Path], list[str]]:
    found: dict[str, Path] = {}
    links: list[str] = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        key = rel.as_posix().removesuffix(".disabled")
        if p.is_symlink():
            links.append(key)
        elif p.is_file():
            found[key] = p
    return found, links


def compare(orig: Path, new: Path) -> dict:
    a, _ = _files(orig)
    b, links = _files(new)
    changed = sorted(k for k in set(a) | set(b) if k not in a or k not in b or a[k].read_bytes() != b[k].read_bytes())
    bad = violations(changed) + [k for k in links if k not in violations(changed)]
    major: list[str] = []
    added: list[str] = []
    if "package.json" in changed and "package.json" in a and "package.json" in b:
        try:
            r = risky_changes(json.loads(a["package.json"].read_text()), json.loads(b["package.json"].read_text()))
            major, added = r["major"], r["added"]
        except (ValueError, OSError):
            bad.append("package.json")
    return {"changed": changed, "violations": sorted(set(bad)), "major": major, "added": added}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    r = compare(Path(argv[1]), Path(argv[2]))
    print(json.dumps(r, indent=2))
    return 2 if r["violations"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
