"""The Python reference validator against the cases shared with the TypeScript port
(playground/worker/src/repoRef.ts, playground/worker/test/repoRef.test.ts)."""
import json
from pathlib import Path

import pytest

import github_fetch as g

FIX = Path(__file__).parent / "fixtures"
CASES = json.loads((FIX / "github_ref_cases.json").read_text(encoding="utf-8"))["cases"]
CORPUS = json.loads((FIX / "injection_corpus.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("c", CASES, ids=[repr(c["input"])[:50] + "|" + repr(c["ref"]) for c in CASES])
def test_shared_cases_match_python(c):
    if not c["accepted"]:
        with pytest.raises(g.InvalidGithubRef):
            g.parse_github_ref(c["input"], c["ref"])
        return
    x = g.parse_github_ref(c["input"], c["ref"])
    assert (x.owner, x.repo, x.ref) == (c["owner"], c["repo"], c["resolvedRef"])


def test_there_are_both_accepted_and_rejected_cases():
    assert any(c["accepted"] for c in CASES) and any(not c["accepted"] for c in CASES)


@pytest.mark.parametrize("b", CORPUS["bad_inputs"], ids=lambda b: repr(b["value"])[:40])
def test_corpus_bad_inputs_rejected_as_url_or_ref(b):
    with pytest.raises(g.InvalidGithubRef):
        if b["kind"] == "url":
            g.parse_github_ref(b["value"])
        else:
            g.parse_github_ref("o/r", b["value"])
