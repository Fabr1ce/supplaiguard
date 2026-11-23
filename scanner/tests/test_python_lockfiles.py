"""uv.lock and poetry.lock are read like package-lock.json: every registry package is checked, nothing else."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sg_scan  # noqa: E402

UV_LOCK = '''version = 1
requires-python = ">=3.12"

[[package]]
name = "demo-app"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "Flask_Cors"
version = "4.0.0"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "from-git"
version = "1.0.0"
source = { git = "https://example.invalid/x.git" }
'''

POETRY_LOCK = '''[[package]]
name = "requests"
version = "2.19.0"
description = "x"

[metadata]
lock-version = "2.0"
'''


def scan_for(tmp_path, name, text, monkeypatch, vulnerable=None):
    (tmp_path / name).write_text(text)
    seen = []

    def fake_json(url, body=None):
        if body is not None:
            seen.extend((q["package"]["name"], q["package"]["ecosystem"], q["version"]) for q in body["queries"])
            return {"results": [{"vulns": [{"id": "GHSA-test"}]} if (q["package"]["name"] == vulnerable) else {}
                                for q in body["queries"]]}
        return {"database_specific": {"severity": "HIGH"},
                "affected": [{"package": {"name": vulnerable}, "ranges": [{"events": [{"fixed": "9.9.9"}]}]}]}
    monkeypatch.setattr(sg_scan, "http_json", fake_json)
    return sg_scan.run_scan(tmp_path, environment="local"), seen


def test_uv_lock_checks_only_registry_packages(tmp_path, monkeypatch):
    out, seen = scan_for(tmp_path, "uv.lock", UV_LOCK, monkeypatch)
    assert seen == [("flask-cors", "PyPI", "4.0.0")]
    assert out["coverage"]["files_scanned"]["lockfiles"] == 1
    assert not out["errors"]


def test_poetry_lock_finding_names_the_lockfile(tmp_path, monkeypatch):
    out, _ = scan_for(tmp_path, "poetry.lock", POETRY_LOCK, monkeypatch, vulnerable="requests")
    f = [x for x in out["findings"] if x["type"] == "vulnerable_dependency"]
    assert len(f) == 1 and f[0]["source"] == "poetry.lock" and f[0]["current_version"] == "2.19.0"
    assert f[0]["recommended_version"] == "9.9.9"


def test_broken_toml_is_an_error_not_a_clean_scan(tmp_path, monkeypatch):
    out, seen = scan_for(tmp_path, "uv.lock", "[[package\nname =", monkeypatch)
    assert not seen
    assert any(e["source"] == "uv.lock" for e in out["errors"])
    assert sg_scan.exit_code(out) == 2


def test_offline_mode_says_cves_were_not_checked(tmp_path):
    (tmp_path / "uv.lock").write_text(UV_LOCK)
    out = sg_scan.run_scan(tmp_path, offline=True, environment="local")
    assert any("NOT checked" in e["message"] for e in out["errors"])
