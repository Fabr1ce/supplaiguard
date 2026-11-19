#!/usr/bin/env python3
"""Sanitized evolution report (R17.1): what a merged SupplAIGuard fix PR actually resolved.

Usage: evolution_report.py BEFORE.json AFTER.json   (two sg_scan.py JSON outputs) -> report JSON on stdout

Standard library only. The report is built field by field from an allow-list, so nothing else in a
scan (evidence, paths, component names, repository names, descriptions) can reach it.
A finding counts as fixed only if the AFTER scan was complete (no errors): never a false "fixed".
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sg_scan import VERSION, _learn_key  # noqa: E402

_ID_BAD = re.compile(r"[^A-Za-z0-9_.-]")
SEVERITIES = {"critical", "high", "medium", "low"}


def _id(f: dict) -> str:
    raw = str(f.get("rule_id") or f.get("type") or "unknown")
    return _ID_BAD.sub("", raw.split()[0] if raw.split() else "")[:40] or "unknown"


def _sev(f: dict) -> str:
    s = str(f.get("severity") or "").lower()
    return s if s in SEVERITIES else "unknown"


def _tally(findings: list[dict]) -> list[dict]:
    counts: dict[tuple[str, str], int] = {}
    for f in findings:
        k = (_id(f), _sev(f))
        counts[k] = counts.get(k, 0) + 1
    return [{"rule_id": r, "severity": s, "count": n} for (r, s), n in sorted(counts.items())]


def _items(scan: dict) -> dict[str, dict]:
    return {_learn_key(f): f for f in scan.get("findings", []) if isinstance(f, dict)}


def build_report(before: dict, after: dict, today: str | None = None) -> dict:
    complete = not after.get("errors")
    b, a = _items(before), _items(after)
    fixed = [b[k] for k in b if k not in a] if complete else []
    outcome = "unverified" if not complete else "fixed" if fixed else "no_change"
    return {"v": 1, "date": today or date.today().isoformat(), "scanner_version": VERSION,
            "complete": complete, "outcome": outcome,
            "fixed": _tally(fixed), "remaining": _tally(list(a.values()))}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        before, after = (json.loads(Path(p).read_text()) for p in argv[1:])
        print(json.dumps(build_report(before, after), indent=2))
    except (OSError, ValueError) as e:
        print(f"evolution_report: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
