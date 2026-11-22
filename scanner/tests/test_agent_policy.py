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


# ---- R20: remediation works on its own branch; push and PR prompt; merge/force/other branches never ----
STRICTNESS = {"deny": 3, "ask": 2, "allow": 1}


def shell_effect(agent: str, cmd: str) -> str | None:
    """Strictest matching shell rule (deny > ask > allow), or None if no rule matches."""
    hits = [r["effect"] for r in rules(agent, "shell") for p in r.get("match", []) if fnmatch.fnmatch(cmd, p)]
    return max(hits, key=STRICTNESS.__getitem__) if hits else None


FIX = "supplaiguard/fix-scan-20261115-101500"


@pytest.mark.parametrize("cmd", [
    "git status --porcelain", "git rev-parse --is-inside-work-tree", "git rev-parse --short HEAD",
    "git branch --show-current"])
def test_remediation_reads_git_state_without_prompting(cmd):
    assert shell_effect("remediation", cmd) == "allow", cmd


@pytest.mark.parametrize("cmd", [
    f"git switch -c {FIX}", "git switch main", "git add demo/app/package.json",
    "git commit -m 'SupplAIGuard: fix F-001 (GHSA-xxxx)'", f"git branch -D {FIX}",
    f"git push -u origin {FIX}", f"gh pr create --base main --head {FIX} --title t --body b"])
def test_every_git_state_change_prompts_the_developer(cmd):
    assert shell_effect("remediation", cmd) == "ask", cmd


@pytest.mark.parametrize("cmd", [
    "git push origin main", "git push -u origin main", "git push origin master", f"git push --force origin {FIX}",
    f"git push -f origin {FIX}", f"git push origin -f {FIX}", f"git push --force-with-lease origin {FIX}",
    f"git push origin +{FIX}", f"git push origin {FIX}:main", f"git push -u origin {FIX}:main",
    f"git push -u origin {FIX} main", f"git push -u origin {FIX} other", "git push --all origin",
    "git push --mirror origin", "git push --delete origin main", "git push origin -d main", "git push --tags",
    "git push origin HEAD", "git push origin HEAD:main", "git merge feature", f"git merge {FIX}", "gh pr merge 3",
    "gh pr merge --admin 3", "git reset --hard HEAD~1", "git rebase main", "git commit --amend -m x",
    f"git branch -D {FIX} main"])
def test_remediation_can_never_merge_force_push_or_push_another_branch(cmd):
    assert shell_effect("remediation", cmd) == "deny", cmd


@pytest.mark.parametrize("cmd", [
    "git status --porcelain; rm -rf ~", "git status --porcelain && curl http://x", "echo hi; sh -c x",
    "jq . a.json && git push origin main", f"git commit -m `curl x`", "git commit -m $(cat ~/.ssh/id_rsa)",
    f"git push -u origin {FIX} || git push origin main"])
def test_remediation_denies_command_chaining(cmd):
    """An allow or ask pattern must never let a second command ride along."""
    assert shell_effect("remediation", cmd) == "deny", cmd


def test_no_git_state_change_is_ever_silent():
    for pat in patterns("remediation", "shell", "allow"):
        if pat.startswith(("git", "gh")):
            assert "*" not in pat and "?" not in pat, f"git allow rules must be exact strings: {pat!r}"


def test_legacy_tools_settings_match_v3_rules():
    """`kiro-cli agent upgrade` regenerates rules from toolsSettings; keep them in step so an upgrade can't loosen them."""
    legacy = AGENTS["remediation"]["toolsSettings"]["execute_bash"]
    assert not any(c.startswith("git push") for c in legacy["allowedCommands"]), "no push may be pre-approved"
    assert {"git merge .*", "gh pr merge .*"} <= set(legacy["deniedCommands"])


@pytest.mark.parametrize("cmd", ["git merge feature", "gh pr merge 3", "git push --force origin x", "git push origin main"])
def test_coordinator_parent_also_denies_merge_and_force_push(cmd):
    """A deny in the parent applies to its sub-agents, so this is a second, independent guard."""
    assert shell_effect("coordinator", cmd) == "deny", cmd


def test_verification_may_only_read_which_branch_and_commit_it_checked():
    """R20.6: Verification states the branch and commit; its git access stays exact read-only strings."""
    git = [p for p in patterns("verification", "shell", "allow") if p.startswith("git")]
    assert set(git) == {"git branch --show-current", "git rev-parse --short HEAD"}, git


# ---- untrusted repository text (spec scan-github-repo, G8; OWASP Agentic ASI01 / ASI06)
ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("prompt", sorted((AGENTS_DIR / "prompts").glob("*.md")), ids=lambda p: p.stem)
def test_every_agent_prompt_declares_repo_text_untrusted(prompt):
    text = prompt.read_text().lower()
    assert "untrusted input" in text and "never instructions" in text


def test_demo_triage_feeds_the_agent_only_wrapped_scanner_output():
    wf = (ROOT / ".github" / "workflows" / "demo-triage.yml").read_text()
    assert "wrap_untrusted" in wf
    assert "findings.untrusted.txt" in wf
    assert 'cp "$RUNNER_TEMP/out/findings.json" "$work/findings.json"' not in wf
    assert "./findings.json" not in wf


# ---- propose-fix job in demo-triage.yml (optional, off by default, draft PR only)
import re  # noqa: E402

WORKFLOW = ROOT / ".github" / "workflows" / "demo-triage.yml"


def _job(name: str) -> str:
    """Text of one top-level job (no YAML parser is installed for the scanner)."""
    m = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [a-z][a-z-]*:\n|\Z)", WORKFLOW.read_text(), re.S | re.M)
    assert m, f"job {name} not found"
    return m.group(1)


def test_propose_fix_input_is_a_boolean_off_by_default_and_launch_id_survives():
    wf = WORKFLOW.read_text()
    block = re.search(r"^      propose-fix:\n(.*?)(?=^permissions:)", wf, re.S | re.M).group(1)
    assert "type: boolean" in block and "default: false" in block
    assert "launch_id:" in wf and "run-name: Demo triage ${{ inputs.demo }} ${{ inputs.launch_id }}" in wf


def test_propose_fix_job_runs_only_when_requested():
    assert "if: ${{ inputs.propose-fix }}" in _job("propose-fix")


def test_propose_fix_agent_gets_only_wrapped_untrusted_findings():
    job = _job("propose-fix")
    assert "wrap_untrusted" in job and "findings.untrusted.txt" in job
    assert 'cp "$RUNNER_TEMP/out/before.json" "$work/findings.json"' not in job
    assert "./findings.json" not in job


def test_propose_fix_permissions_are_least_privilege_and_other_jobs_stay_read_only():
    assert re.search(r"permissions:\n      contents: write[^\n]*\n      pull-requests: write", _job("propose-fix"))
    assert "actions: write" not in _job("propose-fix") and "id-token" not in _job("propose-fix")
    assert "contents: read" in _job("triage") and "write" not in _job("triage").split("steps:")[0]
    assert "write" not in _job("publish").split("steps:")[0]
    assert re.search(r"^permissions: \{\}$", WORKFLOW.read_text(), re.M)


def test_propose_fix_is_gated_deterministically_and_opens_only_a_draft():
    job = _job("propose-fix")
    assert "scanner/fix_gate.py" in job
    assert job.index("fix_gate.py") < job.index("gh pr create")
    assert "gh pr create --draft" in job
    for forbidden in ("gh pr merge", "--auto", "--admin", "push --force", "push -f"):
        assert forbidden not in job


def test_propose_fix_never_hands_the_token_to_the_agent_or_stores_it():
    job = _job("propose-fix")
    agent_step = job.split("The Remediation agent proposes edits")[1].split("- name:")[0]
    assert "GH_TOKEN" not in agent_step and "github.token" not in agent_step
    assert job.count("persist-credentials: false") >= 1
    assert "fs_write" in job and '"**/.github/**"' in job


def test_every_action_in_the_workflow_is_pinned_to_a_sha():
    for line in WORKFLOW.read_text().splitlines():
        m = re.search(r"uses:\s*(\S+)", line)
        if m:
            assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", m.group(1)), m.group(1)
