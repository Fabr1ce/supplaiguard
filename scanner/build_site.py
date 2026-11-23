#!/usr/bin/env python3
"""Build the static results site that GitHub Pages serves, from downloaded demo-triage artifacts.

Usage: build_site.py INPUT_DIR OUTPUT_DIR RUN_URL DATE   (optional environment variable DEMO_NAME)

INPUT_DIR holds one directory per demo named `demo-triage-<demo>` (the artifact layout of demo-triage.yml):
  findings.json, report/report.html, report/summary.md, triage.txt, triage.exit, mcp-disabled.txt, demo-name.txt
actions/download-artifact extracts a pattern match of exactly ONE artifact straight into `path` (v8.0.2:
`artifacts.length === 1` skips the per-artifact subdirectory). That flat layout is handled too: the files are
read from INPUT_DIR itself and the demo name comes from demo-name.txt, else from DEMO_NAME. Both are checked with
NAME_OK; without either the demo is called `demo`.
Standard library only. Everything that came from a scanned repository or from the agent is untrusted: it is
HTML-escaped or reduced to allow-listed values, demo names are allow-listed, and the run URL must be an https
github.com URL. A missing or failed step is stated on the page, never hidden.
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import sys
from pathlib import Path

TITLE = "SupplAIGuard Demo Results"
NAME_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$")
URL_OK = re.compile(r"^(https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/actions/runs/\d+(/[A-Za-z0-9/_-]*)?$")
RULE_OK = re.compile(r"^[A-Z]{3}-\d{3}$")
SEVERITIES = ("critical", "high", "medium", "low")
ACRONYMS = {"ai": "AI", "mcp": "MCP", "ci": "CI"}
ASSETS = Path(__file__).resolve().parent.parent / "assets"
DEFAULT_BANNER = ASSETS / "banner-rounded.gif"
DEFAULT_MARK = ASSETS / "site-mark.svg"

# Brand colours come from the logo: dark violet ground, green, purple and orange accents.
CSS = """
:root{--bg:#120f1a;--panel:#1a1326;--line:#2a2440;--text:#ece8f5;--mute:#a9a2bd;--green:#8fd36b;--purple:#a265ff;--orange:#ff9f43}
*{box-sizing:border-box}
.topbar{display:flex;align-items:center;gap:.6rem;max-width:56rem;margin:0 auto;padding:.75rem 1rem 0}
.topbar a{display:inline-flex;align-items:center;gap:.6rem;color:var(--text);text-decoration:none;font-weight:600}
.topbar a:hover{color:var(--green)}
.topbar img{width:36px;height:36px;display:block}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:56rem;margin:0 auto;padding:1.5rem 1rem 3rem}
header{text-align:center;margin-bottom:1.5rem}
header img{max-width:100%;height:auto;border-radius:18px}
h1{font-size:1.9rem;margin:1rem 0 .25rem}
h2{font-size:1.25rem;margin:2rem 0 .75rem;color:var(--green)}
a{color:var(--purple)}a:hover{color:var(--orange)}
.tag{color:var(--mute);margin:0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1rem 1.25rem}
.btn{display:inline-block;background:var(--purple);color:#fff;text-decoration:none;font-weight:600;padding:.7rem 1.2rem;border-radius:10px}
.btn:hover{background:var(--orange);color:#120f1a}
.note{color:var(--mute);font-size:.9rem;margin:.6rem 0 0}
ol.flow{counter-reset:s;list-style:none;padding:0;margin:0}
ol.flow li{counter-increment:s;position:relative;padding:.4rem 0 .4rem 2.6rem}
ol.flow li:before{content:counter(s);position:absolute;left:0;top:.35rem;width:1.8rem;height:1.8rem;border-radius:50%;
 background:var(--line);color:var(--green);font-weight:700;display:flex;align-items:center;justify-content:center}
table{width:100%;border-collapse:collapse;margin-top:.5rem}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mute);font-weight:600;font-size:.85rem}
.ok{color:var(--green)}.bad{color:var(--orange)}.dim{color:var(--mute)}
.demo{margin:1rem 0}.demo h3{margin:0 0 .4rem}
pre{background:#0c0a12;border:1px solid var(--line);padding:1rem;overflow:auto;white-space:pre-wrap;border-radius:10px}
footer{margin-top:2.5rem;color:var(--mute);font-size:.9rem;text-align:center}
"""

FLOW = (
    ("Copy The Demo", "The demo folder is copied to a temporary directory. Every MCP config in the copy is renamed so "
                      "Kiro cannot start it (headless Kiro starts workspace MCP servers without a prompt)."),
    ("Deterministic Scan", "The SupplAIGuard scanner checks dependencies against OSV.dev and matches the MCP and "
                           "agent rules. No model is involved, so the result is reproducible."),
    ("Agent Triage", "A headless Kiro threat-analysis agent, with read-only tools, reads the findings and the code. It "
                     "links findings into attack paths and checks whether vulnerable code is actually used."),
    ("Publish", "These pages are built from the results of this run. A step that did not run is shown as skipped."),
    ("Remediate", "Optional, off by default (the propose-fix input). A separate job lets the Remediation agent edit a "
                  "copy of the demo. A deterministic fix gate allows only manifests and agent or MCP config, never "
                  "source, secrets or workflows. The result is a DRAFT pull request. A person reviews it, and "
                  "nothing merges automatically."),
    ("Verify", "The scanner runs again on the changed copy, and the draft pull request lists the before and after "
               "result. A finding counts as resolved only when a re-scan no longer reports it. The tests are not run."),
    ("Learn", "Opt-in. After a person merges a fix, a sanitized report (rule ids, severities, counts and outcome, no "
              "source or paths) can be sent upstream so the rules improve."),
)
OPTIONAL_NOTE = ("Remediate, Verify and Learn are not tracked on this page. They happen in a separate Propose Fix job "
                 "and in your own repository, so open the workflow run to see whether Remediate ran.")


def title_case(slug: str) -> str:
    """vulnerable-ai-app -> Vulnerable AI App"""
    words = re.split(r"[-_. ]+", slug)
    return " ".join(ACRONYMS.get(w.lower(), w[:1].upper() + w[1:]) for w in words if w)


def _topbar(prefix: str) -> str:
    """Small brand mark (head and ring) at the top left, linking to the index page."""
    return (f'<nav class="topbar"><a href="{prefix}index.html"><img src="{prefix}mark.svg" width="36" height="36" alt="">'
            "<span>SupplAIGuard</span></a></nav>")


def _page(title: str, body: str, topbar: str = "") -> str:
    return (f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{html.escape(title)}</title><style>{CSS}</style><body>{topbar}<main>{body}</main></body></html>")


def _header(banner_src: str, h1: str) -> str:
    return (f'<header><img src="{banner_src}" width="760" alt="SupplAIGuard: a stitched green and purple '
            f'ghost-shield inside a five-step loop">'
            f"<h1>{html.escape(h1)}</h1>"
            '<p class="tag">Autonomous Security For AI-Native Applications</p></header>')


def _triage_state(d: Path) -> tuple[str, str]:
    """(label, css class) for the agent triage of one demo."""
    t, e = d / "triage.txt", d / "triage.exit"
    if not t.is_file() or not e.is_file():
        return "agent triage did not run (no KIRO_API_KEY, or the step was skipped)", "bad"
    code = e.read_text().strip()
    if code == "0":
        return "agent triage completed", "ok"
    return f"agent triage failed (exit {html.escape(code[:6])})", "bad"


def _copy_state(d: Path) -> tuple[str, str]:
    f = d / "mcp-disabled.txt"
    if not f.is_file():
        return "skipped", "bad"
    raw = f.read_text().strip()
    n = int(raw) if raw.isdigit() and len(raw) < 4 else 0
    return f"done, {n} MCP config{'' if n == 1 else 's'} disabled", "ok"


def _counts(d: Path) -> str:
    """One line of allow-listed counts from findings.json; never raw text from the file."""
    try:
        findings = json.loads((d / "findings.json").read_text())["findings"]
        sev, rules = {}, {}
        for f in findings:
            s = f.get("severity") if isinstance(f, dict) else None
            if s in SEVERITIES:
                sev[s] = sev.get(s, 0) + 1
            r = f.get("rule_id") if isinstance(f, dict) else None
            if isinstance(r, str) and RULE_OK.match(r):
                rules[r] = rules.get(r, 0) + 1
        total = len(findings)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return "results unavailable (findings.json missing or unreadable)"
    parts = [f"{sev[s]} {s}" for s in SEVERITIES if s in sev]
    line = f"{total} finding{'' if total == 1 else 's'}" + (f": {', '.join(parts)}" if parts else "")
    if rules:
        line += f". Rules hit: {', '.join(sorted(rules))}"
    return line


def _demo_dirs(src: Path, demo_name: str | None) -> list[tuple[str, Path]]:
    """(name, directory) for every demo found, in either download-artifact layout. Names are not yet validated."""
    found = [(d.name.removeprefix("demo-triage-"), d) for d in sorted(src.glob("demo-triage-*")) if d.is_dir()]
    if found or not src.is_dir():
        return found
    flat_markers = ("findings.json", "triage.txt", "triage.exit", "mcp-disabled.txt")
    if not any((src / m).is_file() for m in flat_markers) and not (src / "report" / "report.html").is_file():
        return []
    name = None
    f = src / "demo-name.txt"
    if f.is_file():
        name = f.read_text(errors="replace").strip()[:80]
    if not name or not NAME_OK.match(name):
        name = demo_name if demo_name and NAME_OK.match(demo_name) else "demo"
    return [(name, src)]


def build(src: Path, out: Path, run_url: str, when: str, banner: Path | None = None, mark: Path | None = None,
          demo_name: str | None = None) -> None:
    m = URL_OK.match(run_url)
    if not m:
        raise ValueError("run_url must be an https://github.com/<owner>/<repo>/actions/runs/<id> URL")
    repo_url = m.group(1)
    out.mkdir(parents=True, exist_ok=True)
    banner, mark = banner or DEFAULT_BANNER, mark or DEFAULT_MARK
    has_banner, has_mark = banner.is_file(), mark.is_file()
    if has_banner:
        shutil.copyfile(banner, out / "banner.gif")
    if has_mark:
        shutil.copyfile(mark, out / "mark.svg")

    rows, cards = [], []
    for name, d in _demo_dirs(src, demo_name):
        if not NAME_OK.match(name) or name in {".", ".."}:
            continue
        shown = html.escape(title_case(name))
        dest = out / name
        dest.mkdir(parents=True, exist_ok=True)

        copy_l, copy_c = _copy_state(d)
        report = d / "report" / "report.html"
        if report.is_file():
            shutil.copyfile(report, dest / "report.html")
            scan_l, scan_c = "done", "ok"
        else:
            scan_l, scan_c = "report missing", "bad"
        tri_l, tri_c = _triage_state(d)

        links = [f'<a href="{name}/report.html">Scanner Report</a>'] if report.is_file() else []
        triage = d / "triage.txt"
        if triage.is_file():
            text = triage.read_text(errors="replace")[:60000]
            (dest / "triage.html").write_text(_page(
                f"{title_case(name)}: Agent Triage",
                f"<h1>{shown}: Agent Triage</h1><p class=\"{tri_c}\">{tri_l}</p>"
                "<p class=\"note\">Untrusted model output about an untrusted repository. Shown as plain text.</p>"
                f"<pre>{html.escape(text)}</pre><p><a href=\"../index.html\">Back To All Demos</a></p>",
                _topbar("../") if has_mark else ""))
            links.append(f'<a href="{name}/triage.html">Agent Triage Output</a>')

        rows.append(f"<tr><td><strong>{shown}</strong></td><td class=\"{copy_c}\">{copy_l}</td>"
                    f"<td class=\"{scan_c}\">{scan_l}</td><td class=\"{tri_c}\">{tri_l}</td></tr>")
        cards.append(f'<div class="panel demo"><h3>{shown}</h3><p>{html.escape(_counts(d))}</p>'
                     f"<p>{' | '.join(links) or 'No reports were produced.'}</p></div>")

    links_row = (' | '.join((
        '<a href="playground/">Open The Playground</a>',
        '<a href="https://github.com/Fabr1ce/supplaiguard/tree/main/docs">Documentation</a>',
        f'<a href="{html.escape(repo_url, quote=True)}">Repository</a>')))
    empty = ("No demo results were found in this run. The run may have skipped the scan, or its results artifact was "
             f'missing. <a href="{html.escape(run_url, quote=True)}">Open the workflow run</a> to see which step failed.')
    flow_items = "".join(f"<li><strong>{n}</strong><br><span class=\"dim\">{html.escape(t)}</span></li>" for n, t in FLOW)
    body = (
        (_header("banner.gif", TITLE) if has_banner else f"<header><h1>{html.escape(TITLE)}</h1></header>")
        + '<div class="panel"><a class="btn" href="' + html.escape(repo_url, quote=True) + '/actions/workflows/demo-triage.yml">Run The Demo Workflow</a>'
        '<p class="note">Starting a run needs write access to the repository, so the button opens the workflow page '
        "on GitHub. Everyone else can read the latest results below, or fork the repository and run it there.</p></div>"
        '<p class="note">This page shows the latest run only. Each run replaces the whole page with its own results.</p>'
        f'<p>{links_row}</p>'
        "<h2>How The Flow Works</h2>"
        f'<div class="panel"><ol class="flow">{flow_items}</ol><p class="note">{html.escape(OPTIONAL_NOTE)}</p></div>'
        "<h2>What Happened In This Run</h2>"
        '<div class="panel"><table><tr><th>Demo</th><th>Copy The Demo</th><th>Deterministic Scan</th><th>Agent Triage</th></tr>'
        f"{''.join(rows) or '<tr><td colspan=4 class=bad>' + empty + '</td></tr>'}</table></div>"
        "<h2>Results</h2>" + ("".join(cards) or '<div class="panel bad">' + empty + "</div>")
        + f'<footer>Generated {html.escape(when)} by <a href="{html.escape(run_url, quote=True)}">this workflow run</a>. '
        "No login is needed to read this page.</footer>"
    )
    (out / "index.html").write_text(_page(TITLE, body, _topbar("") if has_mark else ""))
    (out / ".nojekyll").write_text("")


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        build(Path(argv[1]), Path(argv[2]), argv[3], argv[4], demo_name=os.environ.get("DEMO_NAME"))
    except (OSError, ValueError) as e:
        print(f"build_site: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
