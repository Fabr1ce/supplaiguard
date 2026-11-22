import sys
from pathlib import Path

import pytest
from hypothesis import given, strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from github_fetch import GithubRef, InvalidGithubRef, parse_github_ref  # noqa: E402


@pytest.mark.parametrize(
    "text,expected",
    [
        ("https://github.com/o/r", GithubRef("o", "r")),
        ("https://github.com/o/r.git", GithubRef("o", "r")),
        ("https://github.com/o/r/", GithubRef("o", "r")),
        ("https://github.com/o/r/tree/feat/x", GithubRef("o", "r", "feat/x")),
        ("o/r", GithubRef("o", "r")),
        ("  Fabr1ce/supplaiguard ", GithubRef("Fabr1ce", "supplaiguard")),
    ],
)
def test_accepts(text, expected):
    assert parse_github_ref(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "http://github.com/o/r",
        "ssh://git@github.com/o/r",
        "git@github.com:o/r.git",
        "file:///etc/passwd",
        "https://gitlab.com/o/r",
        "https://user:pw@github.com/o/r",
        "https://github.com/o",
        "https://github.com/o/r/extra",
        "o/..",
        "-o/r",
        "o/r;rm -rf /",
        "o/r r",
        "",
    ],
)
def test_rejects(text):
    with pytest.raises(InvalidGithubRef):
        parse_github_ref(text)


@pytest.mark.parametrize("ref", ["--upload-pack=x", "a..b", "-x", "a//b", "x.lock", "a b"])
def test_rejects_bad_ref(ref):
    with pytest.raises(InvalidGithubRef):
        parse_github_ref("o/r", ref=ref)


def test_ref_option_and_url_conflict():
    with pytest.raises(InvalidGithubRef):
        parse_github_ref("https://github.com/o/r/tree/a", ref="b")


def test_clone_url_rebuilt():
    assert parse_github_ref("o/r", ref="main").clone_url == "https://github.com/o/r.git"


@given(st.text())
def test_never_accepts_unsafe_output(text):
    try:
        r = parse_github_ref(text)
    except InvalidGithubRef:
        return
    assert r.clone_url.startswith("https://github.com/")
    assert not any(c in r.clone_url for c in " ;|&$`\n\\")
