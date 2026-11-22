"""Parse and validate GitHub repository references (spec: scan-github-repo, task 1).

Pure functions, no network or filesystem access. The clone URL is always rebuilt
from validated parts; the user's string is never passed to git.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

import sg_guard

OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
REF_RE = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")

_URL_RE = re.compile(r"^https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)(?:/tree/(?P<ref>.+))?/?$")
_SHORT_RE = re.compile(r"^(?P<owner>[^/]+)/(?P<repo>[^/]+)$")


class InvalidGithubRef(ValueError):
    """The input is not an accepted GitHub repository reference.

    `code` is a stable reason (a sg_guard.GuardError code, or "invalid" for a structural rejection).
    """

    def __init__(self, message: str, code: str = "invalid"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class GithubRef:
    owner: str
    repo: str
    ref: Optional[str] = None

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}.git"

    @property
    def display(self) -> str:
        return f"github.com/{self.owner}/{self.repo}"


def _guard(value: object, kind: str) -> str:
    try:
        return sg_guard.validate_user_string(value, kind)
    except sg_guard.GuardError as e:
        raise InvalidGithubRef(f"rejected {kind}: {e}", code=e.code) from None


def _validate_ref(ref: str) -> str:
    ref = _guard(ref, "ref")
    if (
        not REF_RE.match(ref)
        or ref.startswith(("-", "/"))
        or ref.endswith(("/", ".lock"))
        or ".." in ref
        or "//" in ref
    ):
        raise InvalidGithubRef(f"invalid ref: {ref!r}")
    return ref


def parse_github_ref(text: str, ref: Optional[str] = None) -> GithubRef:
    if not isinstance(text, str):
        raise InvalidGithubRef("reference must be a string", code="not_str")
    text = _guard(text, "url")  # reject hidden, encoded, non-ASCII and oversized input before any regex
    if ref is not None:
        ref = _guard(ref, "ref")
    m = _URL_RE.match(text) or (None if "://" in text or "@" in text else _SHORT_RE.match(text))
    if not m:
        raise InvalidGithubRef(f"unsupported repository reference: {text!r}")
    owner, repo = m.group("owner"), m.group("repo")
    url_ref = m.groupdict().get("ref")
    if repo.endswith(".git"):
        repo = repo[:-4]
    if url_ref is not None:
        url_ref = _guard(url_ref, "ref")
    if not OWNER_RE.match(owner):
        raise InvalidGithubRef(f"invalid owner: {owner!r}")
    if not REPO_RE.match(repo) or repo in (".", ".."):
        raise InvalidGithubRef(f"invalid repo: {repo!r}")
    _guard(repo, "repo")
    if ref is not None and url_ref is not None and ref != url_ref:
        raise InvalidGithubRef("ref given both in the URL and as an option")
    chosen = ref if ref is not None else url_ref
    if chosen is not None:
        chosen = _validate_ref(chosen)
    return GithubRef(owner=owner, repo=repo, ref=chosen)
