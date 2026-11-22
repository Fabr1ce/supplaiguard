"""The docs folder must stay navigable: relative links resolve and mermaid blocks are closed."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
DOCS = sorted((ROOT / "docs").glob("*.md"))
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)")


def _links(text: str):
    # Ignore links inside fenced code blocks.
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    for target in LINK.findall(text):
        if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
            continue
        yield target.split("#", 1)[0]


def _check(path: Path, text: str):
    return [t for t in _links(text) if t and not (path.parent / t).exists()]


def test_docs_are_found():
    names = {p.name for p in DOCS}
    assert {"README.md", "architecture.md", "flow.md", "security-model.md", "operations.md", "status.md"} <= names


@pytest.mark.parametrize("path", DOCS, ids=lambda p: p.name)
def test_relative_links_resolve(path: Path):
    assert not _check(path, path.read_text(encoding="utf-8"))


def test_readme_documentation_section_links_resolve():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    m = re.search(r"^## Documentation\n(.*?)(?=^## )", text, re.S | re.M)
    assert m, "README.md has no Documentation section"
    links = list(_links(m.group(1)))
    assert links and all(t.startswith("docs/") for t in links)
    assert not [t for t in links if not (ROOT / t).exists()]


@pytest.mark.parametrize("path", DOCS, ids=lambda p: p.name)
def test_mermaid_blocks_open_and_close(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    in_fence = False
    in_mermaid = False
    for line in lines:
        if line.startswith("```"):
            if in_fence:
                in_fence = in_mermaid = False
            else:
                in_fence = True
                in_mermaid = line.strip() == "```mermaid"
    assert not in_fence, f"{path.name}: unclosed code fence"
    text = path.read_text(encoding="utf-8")
    for block in re.findall(r"```mermaid\n(.*?)```", text, re.S):
        assert block.strip().split()[0] in {"flowchart", "graph", "sequenceDiagram"}


def test_no_em_dashes():
    for p in DOCS:
        assert "\u2014" not in p.read_text(encoding="utf-8"), p.name
