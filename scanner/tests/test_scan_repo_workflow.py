"""Policy checks for .github/workflows/scan-repo.yml (spec tasks 6.1-6.3; OWASP Agentic ASI02, ASI03, ASI05)."""
import re
from pathlib import Path

RAW = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "scan-repo.yml").read_text()
WF = "\n".join(l for l in RAW.splitlines() if not l.lstrip().startswith("#"))


def test_dispatch_inputs_repo_and_ref():
    assert re.search(r"workflow_dispatch:\s+inputs:\s+repo:", WF)
    assert re.search(r"\n      ref:\n", WF)


def test_inputs_never_interpolated_into_run_scripts():
    in_run = False
    for line in WF.splitlines():
        s = line.strip()
        if re.match(r"run:\s*\|", s):
            in_run = True
            continue
        if in_run and s and not line.startswith(" " * 10):
            in_run = False
        if in_run:
            assert "${{" not in line, line
    assert "REPO: ${{ inputs.repo }}" in WF and "REF: ${{ inputs.ref }}" in WF


def test_least_privilege_and_no_secrets():
    assert re.search(r"^permissions: \{\}", WF, re.M)
    assert len(re.findall(r"^\s+contents: read\b", WF, re.M)) == 1
    assert "secrets." not in WF and "kiro" not in WF.lower()
    assert not re.search(r"^\s+[\w-]+: (write|admin)\b", WF, re.M)


def test_actions_pinned_by_sha():
    uses = re.findall(r"uses:\s*(\S+)", WF)
    assert uses and all(re.search(r"@[0-9a-f]{40}$", u) for u in uses)


def test_uploads_reports_and_never_reports_incomplete_as_clean():
    assert "upload-artifact" in WF and "GITHUB_STEP_SUMMARY" in WF and "--out-dir" in WF
    assert "NOT a clean result" in WF
