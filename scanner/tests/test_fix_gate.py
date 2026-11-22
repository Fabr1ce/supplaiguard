"""Deterministic gate between an agent's proposed edits (in a copy) and a draft PR (R5, R4 of the security policy)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fix_gate as fg  # noqa: E402


def tree(root: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return root


def test_manifest_and_agent_config_edits_are_allowed():
    ok = ["package.json", "package-lock.json", "requirements.txt", "requirements-dev.txt",
          ".kiro/agents/a.json", ".kiro/settings/mcp.json", ".kiro/skills/x/SKILL.md"]
    assert fg.violations(ok) == []


def test_source_secrets_workflows_and_git_are_refused():
    bad = ["src/index.ts", ".env", ".env.local", "config/db-secret.yaml", "keys/server.pem", "a/b.key",
           "secrets/x.txt", ".github/workflows/scan.yml", ".git/config", "../escape.json", "/abs/package.json"]
    assert sorted(fg.violations(bad)) == sorted(bad)


def test_major_bump_and_new_dependency_are_flagged():
    old = {"dependencies": {"jsonwebtoken": "8.5.1", "lodash": "^4.17.4"}}
    new = {"dependencies": {"jsonwebtoken": "9.0.0", "lodash": "^4.17.21", "left-pad": "1.3.0"}}
    r = fg.risky_changes(old, new)
    assert r["major"] == ["jsonwebtoken: 8.5.1 -> 9.0.0"]
    assert r["added"] == ["left-pad@1.3.0"]


def test_minor_and_patch_bumps_are_not_flagged():
    r = fg.risky_changes({"dependencies": {"a": "~1.2.3"}}, {"dependencies": {"a": "^1.4.0"}})
    assert r == {"major": [], "added": []}


def test_unparseable_versions_do_not_crash_and_are_not_called_safe():
    r = fg.risky_changes({"dependencies": {"a": "latest"}}, {"dependencies": {"a": "git+https://x/y.git"}})
    assert r["major"] == ["a: latest -> git+https://x/y.git"]


def test_compare_trees_maps_disabled_mcp_config_back_and_ignores_node_modules(tmp_path):
    orig = tree(tmp_path / "o", {"package.json": '{"dependencies":{"a":"1.0.0"}}', ".kiro/settings/mcp.json": "{}", "src/x.ts": "1"})
    new = tree(tmp_path / "n", {"package.json": '{"dependencies":{"a":"1.0.1"}}', ".kiro/settings/mcp.json.disabled": '{"x":1}',
                                "src/x.ts": "1", "node_modules/z/index.js": "evil"})
    r = fg.compare(orig, new)
    assert sorted(r["changed"]) == [".kiro/settings/mcp.json", "package.json"]
    assert r["violations"] == [] and r["major"] == [] and r["added"] == []


def test_compare_reports_a_source_edit_as_violation(tmp_path):
    orig = tree(tmp_path / "o", {"src/x.ts": "1", "package.json": "{}"})
    new = tree(tmp_path / "n", {"src/x.ts": "2", "package.json": "{}"})
    r = fg.compare(orig, new)
    assert r["violations"] == ["src/x.ts"]
    assert fg.main(["fix_gate.py", str(orig), str(new)]) == 2


def test_new_file_and_deleted_file_count_as_changes(tmp_path):
    orig = tree(tmp_path / "o", {"package.json": "{}", "requirements.txt": "a==1"})
    new = tree(tmp_path / "n", {"package.json": "{}", "evil.sh": "x"})
    r = fg.compare(orig, new)
    assert sorted(r["changed"]) == ["evil.sh", "requirements.txt"]
    assert r["violations"] == ["evil.sh"]


def test_invalid_package_json_is_a_violation_not_a_crash(tmp_path):
    orig = tree(tmp_path / "o", {"package.json": "{}"})
    new = tree(tmp_path / "n", {"package.json": "{not json"})
    r = fg.compare(orig, new)
    assert "package.json" in r["violations"]


def test_cli_prints_json_and_exits_zero_when_clean(tmp_path, capsys):
    orig = tree(tmp_path / "o", {"package.json": '{"dependencies":{"a":"1.0.0"}}'})
    new = tree(tmp_path / "n", {"package.json": '{"dependencies":{"a":"1.0.1"}}'})
    assert fg.main(["fix_gate.py", str(orig), str(new)]) == 0
    assert json.loads(capsys.readouterr().out)["changed"] == ["package.json"]
