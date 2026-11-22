"""Parse and validate GitHub repository references (spec: scan-github-repo, task 1).

Pure functions, no network or filesystem access. The clone URL is always rebuilt
from validated parts; the user's string is never passed to git.
"""

from __future__ import annotations

import contextlib
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

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


# ---------------------------------------------------------------------------
# Hardened fetch (spec: scan-github-repo, task 3). Nothing from the cloned repo is ever executed.
# ---------------------------------------------------------------------------

FETCH_CODES = ("not_found", "timeout", "too_large", "rate_limited", "git_missing", "network")
_MAX_MSG = 300
_SAFE_GIT = ("-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null")


class FetchError(Exception):
    """Fetching failed. `code` is one of FETCH_CODES. The message never carries raw git output."""

    def __init__(self, code: str, message: str = ""):
        detail = sg_guard.sanitize_untrusted(message, max_len=_MAX_MSG) if message else ""
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


@dataclass(frozen=True)
class FetchResult:
    path: Path
    commit: str
    branch: Optional[str]
    commit_subject: str


def _git_env(home: str) -> dict:
    """Minimal environment: no inherited tokens or user/system git config."""
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "HOME": home,
    }


def _tree_size(path: Path) -> int:
    total = 0
    stack = [str(path)]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        with contextlib.suppress(Exception):
            proc.kill()
    with contextlib.suppress(Exception):
        proc.wait(timeout=5)


def _map_stderr(text: str) -> str:
    low = text.lower()
    if "403" in low or "429" in low or "rate limit" in low:
        return "rate_limited"
    if "not found" in low or "could not read" in low or "does not exist" in low or "not a git repository" in low or (
        "remote branch" in low and "not found" in low
    ):
        return "not_found"
    return "network"


def _run_git(args: list, cwd: Path, env: dict, timeout: float) -> str:
    try:
        r = subprocess.run(
            ["git", *_SAFE_GIT, *args], cwd=str(cwd), env=env, capture_output=True, text=True,
            errors="replace", timeout=timeout, stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        raise FetchError("git_missing", "git executable not found") from None
    except subprocess.TimeoutExpired:
        raise FetchError("timeout", "git timed out") from None
    if r.returncode != 0:
        raise FetchError(_map_stderr(r.stderr), r.stderr)
    return r.stdout.strip()


def fetch_repo(
    ref: GithubRef,
    workdir: Path,
    timeout: float = 120,
    max_bytes: int = 200 * 1024 * 1024,
    _url_override: Optional[str] = None,  # tests only: never wired to CLI, env or user input
) -> FetchResult:
    workdir = Path(workdir)
    dest = workdir / "repo"
    url = _url_override if _url_override is not None else ref.clone_url
    cmd = [
        "git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never",
        "-c", "protocol.https.allow=always",
    ]
    if _url_override is not None:
        cmd += ["-c", "protocol.file.allow=always"]
    cmd += [
        "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false",
        "clone", "--depth", "1", "--single-branch", "--no-tags", "--no-recurse-submodules",
    ]
    if ref.ref:
        cmd += ["--branch", ref.ref]
    cmd += ["--", url, str(dest)]

    home = tempfile.mkdtemp(prefix="sg-home-")
    try:
        env = _git_env(home)
        errfile = Path(home) / "stderr.txt"
        try:
            with open(errfile, "wb") as err:
                proc = subprocess.Popen(
                    cmd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err,
                    start_new_session=True,
                )
        except FileNotFoundError:
            raise FetchError("git_missing", "git executable not found") from None
        deadline = time.monotonic() + timeout
        try:
            while proc.poll() is None:
                if time.monotonic() > deadline:
                    _kill_group(proc)
                    raise FetchError("timeout", f"clone exceeded {timeout}s")
                if _tree_size(dest) > max_bytes:
                    _kill_group(proc)
                    raise FetchError("too_large", f"clone exceeded {max_bytes} bytes")
                time.sleep(0.05)
        except BaseException:
            if proc.poll() is None:
                _kill_group(proc)
            raise
        if proc.returncode != 0:
            text = errfile.read_text(errors="replace")[:4000]
            raise FetchError(_map_stderr(text), text)
        if _tree_size(dest) > max_bytes:
            raise FetchError("too_large", f"clone exceeded {max_bytes} bytes")
        commit = _run_git(["rev-parse", "HEAD"], dest, env, 30)
        subject = _run_git(["log", "-1", "--format=%s"], dest, env, 30)
        return FetchResult(path=dest, commit=commit, branch=ref.ref, commit_subject=subject)
    finally:
        shutil.rmtree(home, ignore_errors=True)


@contextlib.contextmanager
def scan_workspace(keep: bool = False) -> Iterator[Path]:
    """Private (0700) temp dir, removed on exit, exception, SIGINT and SIGTERM unless keep=True."""
    path = Path(tempfile.mkdtemp(prefix="sg-"))
    if (os.stat(path).st_mode & 0o777) != 0o700:
        os.chmod(path, 0o700)
        if (os.stat(path).st_mode & 0o777) != 0o700:
            shutil.rmtree(path, ignore_errors=True)
            raise OSError("could not create a private workspace")
    previous: dict = {}

    def _raise_kbd(signum, frame):
        raise KeyboardInterrupt

    def _raise_exit(signum, frame):
        raise SystemExit(128 + signum)

    if threading.current_thread() is threading.main_thread():
        previous[signal.SIGINT] = signal.signal(signal.SIGINT, _raise_kbd)
        previous[signal.SIGTERM] = signal.signal(signal.SIGTERM, _raise_exit)
    try:
        yield path
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        if not keep:
            shutil.rmtree(path, ignore_errors=True)
