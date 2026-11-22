"""Catch unsupported GitHub Actions expression functions before GitHub rejects the workflow file."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FILES = sorted([*(ROOT / ".github" / "workflows").glob("*.yml"), *(ROOT / "examples").glob("*.yml")])
ALLOWED = {
    "contains", "startswith", "endswith", "format", "join", "tojson", "fromjson", "hashfiles",
    "success", "always", "cancelled", "failure",
}
EXPR = re.compile(r"\$\{\{(.*?)\}\}", re.S)
STRING = re.compile(r"'(?:[^']|'')*'")
CALL = re.compile(r"([A-Za-z_][A-Za-z0-9_-]*)\s*\(")


def test_workflow_files_are_found():
    assert FILES


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_expressions_only_call_supported_functions(path: Path):
    bad = []
    for m in EXPR.finditer(path.read_text()):
        expr = STRING.sub("''", m.group(1))
        bad += [f for f in CALL.findall(expr) if f.lower() not in ALLOWED]
    assert not bad, f"{path.name}: unsupported expression functions {sorted(set(bad))}"


def test_report_fix_does_not_use_split():
    assert "split(" not in (ROOT / ".github" / "workflows" / "report-fix.yml").read_text()
