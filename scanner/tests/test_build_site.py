"""Static results site for GitHub Pages: escapes untrusted text, never implies a missing result."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_site as bs  # noqa: E402

RUN = "https://github.com/o/r/actions/runs/1"


def make_demo(root: Path, name: str, triage: str | None = None, report: bool = True, exit_code: str | None = None):
    d = root / f"demo-triage-{name}"
    d.mkdir(parents=True)
    (d / "findings.json").write_text('{"findings": []}')
    if report:
        (d / "report").mkdir()
        (d / "report" / "report.html").write_text("<html>report</html>")
        (d / "report" / "summary.md").write_text("## summary")
    if triage is not None:
        (d / "triage.txt").write_text(triage)
    if exit_code is not None:
        (d / "triage.exit").write_text(exit_code)


def test_index_links_each_demo_report_and_copies_it(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "vulnerable-ai-app")
    bs.build(src, out, run_url="https://github.com/o/r/actions/runs/1", when="2026-11-19")
    index = (out / "index.html").read_text()
    assert 'href="vulnerable-ai-app/report.html"' in index
    assert (out / "vulnerable-ai-app" / "report.html").read_text() == "<html>report</html>"
    assert "https://github.com/o/r/actions/runs/1" in index and "2026-11-19" in index


def test_triage_text_is_escaped(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="<script>alert(1)</script> & more", exit_code="0")
    bs.build(src, out, run_url=RUN, when="d")
    page = (out / "a" / "triage.html").read_text()
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;" in page and "&amp; more" in page


def test_missing_triage_is_said_plainly_not_hidden(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "agent triage did not run" in index.lower()


def test_failed_triage_is_labelled_failed(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="partial", exit_code="1")
    bs.build(src, out, run_url=RUN, when="d")
    assert "failed (exit 1)" in (out / "index.html").read_text().lower()


def test_unsafe_demo_names_are_skipped(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "ok")
    make_demo(src, "../evil")
    make_demo(src, 'x"><script>')
    bs.build(src, out, run_url=RUN, when="d")
    assert (out / "ok").is_dir()
    assert "evil" not in (out / "index.html").read_text()
    assert "<script>" not in (out / "index.html").read_text()


def test_run_url_must_be_https_github(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    with pytest.raises(ValueError):
        bs.build(src, out, run_url='javascript:alert(1)', when="d")
