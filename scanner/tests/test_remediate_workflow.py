"""remediate.yml is the reusable remediate, verify and draft-PR path. Pin its safety properties."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT = (ROOT / ".github" / "workflows" / "remediate.yml").read_text()
# The steps are the blocks that start with "      - name:"; the standard library has no YAML parser.
STEPS = ["      - name:" + b for b in TEXT.split("\n      - name:")[1:]]


def step(name_part):
    return next(b for b in STEPS if name_part in b.splitlines()[0])


def name(block):
    return block.splitlines()[0].split("name:", 1)[1].strip()


def test_no_workflow_level_permissions_and_job_scopes_are_minimal():
    assert "\npermissions: {}\n" in TEXT
    assert "    permissions:\n      contents: write" in TEXT and "      pull-requests: write" in TEXT
    assert TEXT.count("contents: write") == 2  # one in the header comment, one on the job


def test_sg_ref_must_be_a_full_sha():
    assert "[0-9a-f]{40}" in step("Validate inputs")


def test_checkout_stores_no_credentials():
    assert "persist-credentials: false" in step("Check out")


def test_agent_step_has_no_write_token_and_no_shell():
    agent = step("Remediation agent")
    assert "GH_TOKEN" not in agent and "GITHUB_TOKEN" not in agent
    assert "--trust-tools=read_file,grep_search,fs_write" in agent
    assert 'effect: deny\n              match: ["*"]' in step("Install the agents")


def test_only_the_guard_and_the_push_step_get_the_token():
    assert [name(b) for b in STEPS if "GH_TOKEN:" in b] == ["Do not stack fix PRs or re-fix the merge of one", "Open a DRAFT pull request"]
    guard = step("Do not stack fix PRs")
    # The guard only reads: plain `gh api` GETs, no method override, no fields, no git.
    assert guard.count("gh api ") == 2 and not re.search(r"-X|--method|-f |-F |--field|git ", guard)
    assert "github.token" not in "".join(b for b in STEPS if "GH_TOKEN:" not in b)


def test_guard_skips_when_a_fix_pr_is_open_or_this_push_merged_one():
    guard = step("Do not stack fix PRs")
    assert 'startswith("supplaiguard/fix-")' in guard and "merged_at != null" in guard
    assert 'if [ "$SKIP_GUARDS" != "true" ]' in guard
    later = STEPS[STEPS.index(guard) + 1:]
    for b in later:
        if name(b).startswith("Upload what the agent"):
            assert "always()" in b
        else:
            assert "steps.guard.outputs.skip != 'true'" in b, name(b)


def test_major_bumps_only_with_allow_major():
    agent = step("Remediation agent")
    assert "ALLOW_MAJOR: ${{ inputs.allow-major }}" in agent
    assert "NEEDS APPROVAL:" in agent and "do not make it; list it on a line starting with NEEDS HUMAN:" in agent
    assert re.search(r"allow-major:\n(.*\n){1,2}\s+type: boolean\n\s+default: false", TEXT)


def test_findings_reach_the_agent_only_wrapped():
    assert "wrap_untrusted" in step("pristine copy")


def test_gate_runs_before_anything_is_applied_and_verify_runs_before_the_pr():
    names = [name(b) for b in STEPS]
    order = [names.index(name(step(n))) for n in ("Gate the proposed", "Apply the allowed", "Verify by scanning", "Open a DRAFT")]
    assert order == sorted(order)


def test_branch_name_matches_what_the_learning_step_expects():
    assert 'branch="supplaiguard/fix-${RUN_ID}"' in step("Open a DRAFT")
    assert "supplaiguard/fix-" in (ROOT / ".github" / "workflows" / "report-fix.yml").read_text()


def test_pr_is_a_draft_and_never_merged():
    run = step("Open a DRAFT")
    assert "gh pr create --draft" in run and "gh pr merge" not in TEXT and "--auto" not in TEXT


def test_actions_are_pinned_by_sha():
    refs = re.findall(r"uses: ([\w./-]+)@(\S+)", TEXT)
    assert refs and all(re.fullmatch(r"[0-9a-f]{40}", sha) for _, sha in refs if "<" not in sha and "FULL" not in sha)
