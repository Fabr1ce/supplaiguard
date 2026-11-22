// Validation of a GitHub repository reference typed by a visitor.
//
// This is a faithful TypeScript port of scanner/github_fetch.py (parse_github_ref, _validate_ref) and the
// user-string checks in scanner/sg_guard.py (validate_user_string). The Python code is the reference: if one of
// them changes, change the other and the shared cases in scanner/tests/fixtures/github_ref_cases.json.
// A byte-identical copy lives in playground/src/services/repoRef.ts (checked by a test). Pure: no I/O.

export const MAX_URL_LEN = 300;
export const MAX_REF_LEN = 200;
export const MAX_REPO_LEN = 100;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const URL_RE = /^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)(?:\/tree\/(?<ref>.+))?\/?$/;
const SHORT_RE = /^(?<owner>[^/]+)\/(?<repo>[^/]+)$/;

const KIND_CAPS = { url: MAX_URL_LEN, ref: MAX_REF_LEN, repo: MAX_REPO_LEN } as const;
type Kind = keyof typeof KIND_CAPS;

const inRange = (o: number, lo: number, hi: number) => o >= lo && o <= hi;
const isTag = (o: number) => inRange(o, 0xe0000, 0xe007f);
const isBidi = (o: number) => inRange(o, 0x202a, 0x202e) || inRange(o, 0x2066, 0x2069) || o === 0x200e || o === 0x200f || o === 0x061c;
const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x180e, 0x00ad]);
// Unicode categories Cc, Cf, Cs, Co, Cn (all of "C") plus the line and paragraph separators Zl and Zp.
const CONTROL_RE = /^[\p{C}\p{Zl}\p{Zp}]$/u;

const SEP_RE = /[-_./]+/g;
const HEX_RE = /^[0-9a-fA-F]+$/;
const BLOB_RE = /[A-Za-z0-9+/=]{40,}/g;
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bsystem\s+prompt\b/i,
  /\bact\s+as\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bjailbreak/i,
  /\brun\s+the\s+following\b/i,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bexfiltrat/i,
];

function instructionLike(value: string): boolean {
  const spaced = value.replace(SEP_RE, " ");
  if (INSTRUCTION_PATTERNS.some((p) => p.test(spaced))) return true;
  for (const m of value.matchAll(BLOB_RE)) if (!HEX_RE.test(m[0])) return true; // a 40 or 64 digit hex string is a commit id
  return false;
}

function charCode(ch: string): string | null {
  const o = ch.codePointAt(0)!;
  if (ch === "\r" || ch === "\n") return "newline";
  if (isTag(o)) return "tag_chars";
  if (isBidi(o)) return "bidi";
  if (ZERO_WIDTH.has(o)) return "zero_width";
  if (ch === "%") return "percent_encoding";
  if (ch === "\\") return "backslash";
  if (CONTROL_RE.test(ch)) return "control_chars";
  if (o > 127) return "non_ascii";
  return null;
}

export type Guard = { ok: true; value: string } | { ok: false; code: string };

/** validate_user_string: strict allow-list check. Returns the value minus leading and trailing ASCII spaces. */
export function guardUserString(value: unknown, kind: Kind): Guard {
  if (typeof value !== "string") return { ok: false, code: "not_str" };
  if ([...value].length > KIND_CAPS[kind]) return { ok: false, code: "too_long" };
  const v = value.replace(/^ +| +$/g, "");
  if (!v) return { ok: false, code: "empty" };
  for (const ch of v) {
    const code = charCode(ch);
    if (code) return { ok: false, code };
  }
  if ((kind === "ref" || kind === "repo") && instructionLike(v)) return { ok: false, code: "instruction_like" };
  return { ok: true, value: v };
}

export type RepoRef = { ok: true; owner: string; repo: string; slug: string; ref: string | null } | { ok: false; code: string; message: string };

const bad = (code: string, message: string): RepoRef => ({ ok: false, code, message });

/** Messages are fixed text. They never echo the input. */
const MESSAGES: Record<string, string> = {
  not_str: "Enter text.",
  empty: "This field is empty.",
  too_long: "This is too long.",
  newline: "Line breaks are not allowed.",
  tag_chars: "Hidden characters are not allowed.",
  bidi: "Hidden direction characters are not allowed.",
  zero_width: "Invisible characters are not allowed.",
  percent_encoding: "Percent-encoding is not allowed. Type the plain name.",
  backslash: "Backslashes are not allowed.",
  control_chars: "Control characters are not allowed.",
  non_ascii: "Only plain ASCII characters are allowed.",
  instruction_like: "This looks like an instruction, not a name.",
};
const msg = (code: string) => MESSAGES[code] ?? "This is not an accepted value.";

function validateRef(ref: string): { ok: true; value: string } | { ok: false; code: string } {
  const g = guardUserString(ref, "ref");
  if (!g.ok) return g;
  const r = g.value;
  if (!REF_RE.test(r) || r.startsWith("-") || r.startsWith("/") || r.endsWith("/") || r.endsWith(".lock") || r.includes("..") || r.includes("//")) {
    return { ok: false, code: "invalid" };
  }
  return { ok: true, value: r };
}

/**
 * parse_github_ref: only https://github.com/<owner>/<repo>[.git][/tree/<ref>] or owner/repo.
 * `ref` is the separate branch or tag field (undefined or null when not given).
 */
export function parseRepoRef(text: unknown, ref?: unknown): RepoRef {
  if (typeof text !== "string") return bad("not_str", msg("not_str"));
  const t = guardUserString(text, "url");
  if (!t.ok) return bad(t.code, msg(t.code));
  let explicit: string | null = null;
  if (ref !== undefined && ref !== null) {
    const g = guardUserString(ref, "ref");
    if (!g.ok) return bad(g.code, "Branch or tag: " + msg(g.code));
    explicit = g.value;
  }
  const s = t.value;
  const m = URL_RE.exec(s) ?? (s.includes("://") || s.includes("@") ? null : SHORT_RE.exec(s));
  if (!m || !m.groups) return bad("invalid", "Use owner/repo or https://github.com/owner/repo.");
  const owner = m.groups.owner;
  let repo = m.groups.repo;
  let urlRef: string | null = m.groups.ref ?? null;
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (urlRef !== null) {
    const g = guardUserString(urlRef, "ref");
    if (!g.ok) return bad(g.code, "Branch or tag: " + msg(g.code));
    urlRef = g.value;
  }
  if (!OWNER_RE.test(owner)) return bad("invalid", "The owner name is not a valid GitHub name.");
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") return bad("invalid", "The repository name is not a valid GitHub name.");
  const rg = guardUserString(repo, "repo");
  if (!rg.ok) return bad(rg.code, msg(rg.code));
  if (explicit !== null && urlRef !== null && explicit !== urlRef) return bad("invalid", "The branch is given twice with different values.");
  const chosen = explicit !== null ? explicit : urlRef;
  let finalRef: string | null = null;
  if (chosen !== null) {
    const v = validateRef(chosen);
    if (!v.ok) return bad(v.code, "Branch or tag: " + (v.code === "invalid" ? "use letters, digits, . _ - and / only, with no '..'." : msg(v.code)));
    finalRef = v.value;
  }
  return { ok: true, owner, repo, slug: `${owner}/${repo}`, ref: finalRef };
}
