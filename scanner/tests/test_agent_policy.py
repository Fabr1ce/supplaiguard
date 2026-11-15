"""Policy invariants for SupplAIGuard's own agent configs (.kiro/agents/supplaiguard-*.json).

These turn the written security policy into tests, so a config change (or an automatic
`kiro-cli agent upgrade`) cannot quietly weaken it:
  - read-only roles can never write
  - the one agent that writes asks the human first, and can never touch secrets
  - nothing may run package-install commands silently (install scripts execute code)
  - nothing may merge or push (policy: never auto-merge)
"""
from __future__ import annotations

import fnmatch
import json
from pathlib import Path

import pytest

AGENTS_DIR = Path(__file__).resolve().parents[2] / ".kiro" / "agents"
AGENTS = {p.stem.removeprefix("supplaiguard-"): json.loads(p.read_text())
          for p in sorted(AGENTS_DIR.glob("supplaiguard-*.json"))}
READ_ONLY = ("coordinator", "discovery", "threat-analysis", "verification", "reviewer")


def rules(agent: str, capability: str, effect: str | None = None) -> list[dict]:
    return [r for r in AGENTS[agent]["permissions"]["rules"]
            if r.get("capability") == capability and (effect is None or r.get("effect") == effect)]


def patterns(agent: str, capability: str, effect: str) -> list[str]:
    return [m for r in rules(agent, capability, effect) for m in r.get("match", ["*"])]


def test_all_six_agents_are_present():
    assert set(AGENTS) == {*READ_ONLY, "remediation"}


DENY_WRITES = tuple(a for a in READ_ONLY if a != "coordinator")


@pytest.mark.parametrize("agent", DENY_WRITES)
def test_read_only_roles_deny_every_write_and_allow_none(agent):
    assert "**" in patterns(agent, "fs_write", "deny"), f"{agent} must deny fs_write on **"
    assert not rules(agent, "fs_write", "allow"), f"{agent} must never allow writes"
    assert not rules(agent, "fs_write", "ask"), f"{agent} must not even be able to ask to write"


def test_remediation_asks_before_writing_and_never_allows_silently():
    assert not rules("remediation", "fs_write", "allow"), (
        "the remediation agent must not write without asking the human (requirement R5.3)")
    assert patterns("remediation", "fs_write", "ask"), "writes must be gated by an explicit ask rule"


def test_remediation_write_scope_is_manifests_and_config_only():
    scope = patterns("remediation", "fs_write", "ask")
    assert all(any(k in p for k in ("package.json", "package-lock.json", "mcp.json", ".kiro/agents")) for p in scope), scope


@pytest.mark.parametrize("secret", [".env", "config.pem", "server.key", "secrets/token.txt", "my-secret.json"])
def test_remediation_can_never_write_secrets(secret):
    denied = patterns("remediation", "fs_write", "deny")
    assert any(fnmatch.fnmatch(secret, p.replace("**/", "")) or fnmatch.fnmatch(secret, p) for p in denied), (
        f"{secret} must be covered by a deny rule")


@pytest.mark.parametrize("agent", [*READ_ONLY, "remediation"])
@pytest.mark.parametrize("cmd", ["npm install lodash", "npm ci", "pip install x", "npx -y something", "pnpm install"])
def test_nothing_runs_package_installs_without_asking(agent, cmd):
    """Install scripts run arbitrary code, so installs must never be silently allowed."""
    for pat in patterns(agent, "shell", "allow"):
        assert not fnmatch.fnmatch(cmd, pat), f"{agent} silently allows {cmd!r} via {pat!r}"


@pytest.mark.parametrize("agent", [*READ_ONLY, "remediation"])
@pytest.mark.parametrize("cmd", ["git push origin main", "git merge feature", "gh pr merge 3", "git commit -am x",
                                  "rm -rf x", "sudo ls", "bash -c x", "sh -c x"])
def test_nothing_can_merge_push_or_run_a_shell_silently(agent, cmd):
    for pat in patterns(agent, "shell", "allow"):
        assert not fnmatch.fnmatch(cmd, pat), f"{agent} silently allows {cmd!r} via {pat!r}"


@pytest.mark.parametrize("cmd", ["git push origin main", "git merge feature", "gh pr merge 3"])
def test_remediation_explicitly_denies_merging_and_pushing(cmd):
    assert any(fnmatch.fnmatch(cmd, p) for p in patterns("remediation", "shell", "deny")), cmd


@pytest.mark.parametrize("agent", [*READ_ONLY, "remediation"])
def test_no_agent_has_a_wildcard_allow(agent):
    for r in AGENTS[agent]["permissions"]["rules"]:
        if r.get("effect") == "allow":
            assert r.get("capability") not in ("all", "builtin", "filesystem"), r
            assert r.get("capability") not in ("shell", "fs_write") or r.get("match"), f"unscoped allow: {r}"


def test_coordinator_does_not_pre_approve_the_remediation_agent():
    allowed = patterns("coordinator", "subagent", "allow")
    assert "supplaiguard-remediation" not in allowed, "starting the writing agent must still prompt the human"


# ---- the coordinator must actually be able to start its four sub-agents in Kiro CLI v3 ----
SUBAGENTS = ("supplaiguard-discovery", "supplaiguard-threat-analysis", "supplaiguard-remediation", "supplaiguard-verification")


def test_coordinator_can_start_exactly_its_four_subagents():
    """A live run showed 'I have no delegate tool': in v3 the orchestrator needs subagent/<name> in `tools`."""
    tools = AGENTS["coordinator"]["tools"]
    assert {t for t in tools if t.startswith("subagent/")} == {f"subagent/{n}" for n in SUBAGENTS}, tools


def test_coordinator_uses_no_legacy_or_overbroad_tools():
    tools = AGENTS["coordinator"]["tools"]
    assert "delegate" not in tools, "`delegate` is a CLI 2.x tool and does not exist in v3"
    assert not {"*", "@builtin", "write", "shell"} & set(tools), (
        "'*' and '@builtin' include a tool that can start ANY agent; the coordinator must not write or run a shell itself")


def test_coordinator_prompt_does_not_tell_it_to_use_a_tool_it_does_not_have():
    text = (AGENTS_DIR / "prompts" / "coordinator.md").read_text().lower()
    assert "delegate tool" not in text


def test_coordinator_never_blocks_the_remediation_subagent_but_never_writes_silently():
    """In v3 a deny in the PARENT policy also denies sub-agent calls, so a blanket deny here would break step 3.
    The coordinator has no write tool; writes made by sub-agents must still ask the human (stricter side wins)."""
    assert "**" not in patterns("coordinator", "fs_write", "deny"), "a blanket write deny would block remediation"
    assert not rules("coordinator", "fs_write", "allow"), "never silently allow writes"
    assert "**" in patterns("coordinator", "fs_write", "ask"), "every sub-agent write must still ask the human"
    assert any(".env" in p for p in patterns("coordinator", "fs_write", "deny")), "secrets stay denied"


def test_coordinator_allows_the_scanner_so_subagents_can_run_it_silently():
    assert "python3 ~/.kiro/supplaiguard/scanner/sg_scan.py *" in patterns("coordinator", "shell", "allow")
