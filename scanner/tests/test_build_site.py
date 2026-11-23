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


# ---- branding, flow, results, run button -------------------------------------------------------------------

def test_banner_and_mark_are_copied_and_used(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="t", exit_code="0")
    bs.build(src, out, run_url=RUN, when="d")
    assert (out / "banner.gif").read_bytes().startswith(b"GIF")
    assert (out / "mark.svg").read_text().startswith("<svg")
    index = (out / "index.html").read_text()
    triage = (out / "a" / "triage.html").read_text()
    assert '<img src="banner.gif"' in index
    assert '<a href="index.html"><img src="mark.svg"' in index
    assert '<a href="../index.html"><img src="../mark.svg"' in triage
    assert "banner.gif" not in triage


def test_missing_brand_assets_degrade_gracefully(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="t", exit_code="0")
    bs.build(src, out, run_url=RUN, when="d", banner=tmp_path / "no.gif", mark=tmp_path / "no.svg")
    index = (out / "index.html").read_text()
    assert index.count("<h1>") == 1 and "<h1>SupplAIGuard</h1>" in index
    assert "banner.gif" not in index and "mark.svg" not in index


def test_titles_use_capital_first_letters(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "vulnerable-ai-app", triage="t", exit_code="0")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "<title>SupplAIGuard: Autonomous Security For AI-Native Applications</title>" in index
    assert "Vulnerable AI App" in index
    for h in ("The Problem", "How It Works", "What It Checks", "Try It", "Latest Demo Run", "What Each Run Does"):
        assert f">{h}</h" in index


def test_homepage_leads_to_the_playground(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert 'href="playground/">Open The Playground</a>' in index
    assert index.count('href="playground/"') == 2  # hero and Try It
    assert index.index('href="playground/"') < index.index("Latest Demo Run")
    assert "Autonomous security for AI-native applications." in index
    assert "Prevent locally. Detect continuously. Remediate intelligently. Verify automatically." in index
    assert index.count("<h1>") == 1
    assert "<main>" in index and "<header" in index and "<nav" in index and "<footer>" in index
    assert "<script" not in index
    assert '<a href="https://github.com/o/r">View On GitHub</a>' in index
    assert 'href="https://github.com/Fabr1ce/supplaiguard/tree/main/docs">Read The Docs</a>' in index
    assert "MIT license" in index
    assert "Run The Demo Workflow" not in index


def test_loop_steps_appear_in_order(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    pos = [index.index(f"<h3>{s}</h3>") for s in ("Discover", "Analyze", "Remediate", "Verify", "Learn")]
    assert pos == sorted(pos)
    assert "DRAFT pull request" in index.split("Latest Demo Run")[0]


def test_workflow_link_stays_as_the_manual_path(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert ('Prefer GitHub? <a href="https://github.com/o/r/actions/workflows/demo-triage.yml">Run the Demo Triage '
            "workflow</a> there (needs write access to the repository).") in index
    assert index.index("Latest Demo Run") < index.index("actions/workflows/demo-triage.yml")


def test_no_em_dashes_anywhere(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="t", exit_code="0")
    bs.build(src, out, run_url=RUN, when="d")
    assert "\u2014" not in (out / "index.html").read_text()
    assert "\u2014" not in (out / "a" / "triage.html").read_text()


def test_flow_lists_the_steps_in_order_with_honest_status(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a", triage="t", exit_code="0")
    (src / "demo-triage-a" / "mcp-disabled.txt").write_text("1")
    make_demo(src, "b")  # no triage, no mcp note: those steps did not run
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    order = [index.index(s) for s in ("Copy The Demo", "Deterministic Scan", "Agent Triage", "Publish")]
    assert order == sorted(order)
    assert "1 MCP config disabled" in index
    assert "skipped" in index.lower()


def test_results_show_counts_from_findings(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    (src / "demo-triage-a" / "findings.json").write_text(
        '{"findings":[{"severity":"high","rule_id":"MCP-001"},{"severity":"high","rule_id":"AGT-001"},'
        '{"severity":"medium","rule_id":"<b>x</b>"}]}')
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "3 findings" in index and "2 high" in index and "1 medium" in index
    assert "<b>x</b>" not in index


def test_broken_findings_json_does_not_break_the_build(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    (src / "demo-triage-a" / "findings.json").write_text("not json")
    bs.build(src, out, run_url=RUN, when="d")
    assert "results unavailable" in (out / "index.html").read_text().lower()


# ---- flat layout (download-artifact extracts a single matched artifact straight into the input folder) --------

def make_flat(root: Path, name_file: str | None = None, triage: str | None = None):
    root.mkdir(parents=True)
    (root / "findings.json").write_text('{"findings":[{"severity":"high","rule_id":"MCP-001"}]}')
    (root / "report").mkdir()
    (root / "report" / "report.html").write_text("<html>flat</html>")
    (root / "mcp-disabled.txt").write_text("1")
    if name_file is not None:
        (root / "demo-name.txt").write_text(name_file)
    if triage is not None:
        (root / "triage.txt").write_text(triage)
        (root / "triage.exit").write_text("0")


def test_flat_layout_is_built_using_the_name_file(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_flat(src, name_file="vulnerable-ai-app\n", triage="ok")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "No demo results" not in index
    assert 'href="vulnerable-ai-app/report.html"' in index and "1 high" in index
    assert (out / "vulnerable-ai-app" / "report.html").read_text() == "<html>flat</html>"
    assert (out / "vulnerable-ai-app" / "triage.html").is_file()


def test_flat_layout_falls_back_to_demo_name_setting_then_generic(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_flat(src)
    bs.build(src, out, run_url=RUN, when="d", demo_name="haunted-storyteller")
    assert (out / "haunted-storyteller" / "report.html").is_file()
    src2, out2 = tmp_path / "in2", tmp_path / "site2"
    make_flat(src2)
    bs.build(src2, out2, run_url=RUN, when="d")
    assert (out2 / "demo" / "report.html").is_file()


@pytest.mark.parametrize("bad", ["../evil", 'x"><script>', "a/b", ""])
def test_flat_layout_rejects_unsafe_names(tmp_path, bad):
    src, out = tmp_path / "in", tmp_path / "site"
    make_flat(src, name_file=bad)
    bs.build(src, out, run_url=RUN, when="d", demo_name='<b>"')
    index = (out / "index.html").read_text()
    assert "evil" not in index and "<script>" not in index and "<b>" not in index
    assert (out / "demo" / "report.html").is_file()


def test_nested_layout_wins_over_stray_flat_files(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    (src / "findings.json").write_text('{"findings":[]}')
    bs.build(src, out, run_url=RUN, when="d")
    assert (out / "a" / "report.html").is_file() and not (out / "demo").exists()


def test_main_reads_demo_name_from_environment(tmp_path, monkeypatch):
    src, out = tmp_path / "in", tmp_path / "site"
    make_flat(src)
    monkeypatch.setenv("DEMO_NAME", "crypt-keeper-mcp")
    assert bs.main(["build_site.py", str(src), str(out), RUN, "d"]) == 0
    assert (out / "crypt-keeper-mcp" / "report.html").is_file()


@pytest.mark.parametrize("make_src", ["missing", "empty"])
def test_empty_page_explains_and_never_looks_clean(tmp_path, make_src):
    src, out = tmp_path / "in", tmp_path / "site"
    if make_src == "empty":
        src.mkdir()
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "No demo results were found in this run." in index
    assert "may have skipped the scan, or its results artifact was missing" in index
    assert f'href="{RUN}"' in index
    assert "0 findings" not in index and 'class="ok"' not in index and "clean" not in index.lower()


# ---- refreshed copy ----------------------------------------------------------------------------------------

def test_flow_includes_the_remediation_loop_in_order(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    steps = ("Copy The Demo", "Deterministic Scan", "Agent Triage", "Publish", "Remediate", "Verify", "Learn")
    pos = [index.index(f"<strong>{s}</strong>") for s in steps]
    assert pos == sorted(pos)
    assert "DRAFT pull request" in index and "nothing merges automatically" in index.lower()
    assert "not tracked on this page" in index
    assert "\u2014" not in index


def test_latest_run_only_and_links(tmp_path):
    src, out = tmp_path / "in", tmp_path / "site"
    make_demo(src, "a")
    bs.build(src, out, run_url=RUN, when="d")
    index = (out / "index.html").read_text()
    assert "This page shows the latest run only" in index
    assert 'href="playground/">Open The Playground</a>' in index
    assert 'href="https://github.com/Fabr1ce/supplaiguard/tree/main/docs">Read The Docs</a>' in index
    assert '<a href="https://github.com/o/r">View On GitHub</a>' in index
