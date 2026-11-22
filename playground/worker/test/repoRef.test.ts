import { describe, expect, it } from "vitest";
import corpus from "../../../scanner/tests/fixtures/injection_corpus.json";
import shared from "../../../scanner/tests/fixtures/github_ref_cases.json";
import { parseRepoRef } from "../src/repoRef";

// Both validators run against the same inputs: scanner/tests/test_github_ref_cases.py checks the Python side.
describe("parseRepoRef agrees with scanner/github_fetch.py on the shared cases", () => {
  it.each(shared.cases.map((c) => [JSON.stringify(c.input).slice(0, 50) + " | " + JSON.stringify(c.ref), c] as const))("%s", (_n, c) => {
    const r = parseRepoRef(c.input, c.ref);
    expect(r.ok).toBe(c.accepted);
    if (r.ok && c.accepted) {
      expect([r.owner, r.repo, r.ref]).toEqual([c.owner, c.repo, c.resolvedRef]);
      expect(r.slug).toBe(`${c.owner}/${c.repo}`);
    }
  });
  it("covers accepted and rejected cases", () => {
    expect(shared.cases.some((c) => c.accepted)).toBe(true);
    expect(shared.cases.some((c) => !c.accepted)).toBe(true);
  });
});

describe("parseRepoRef rejects the shared adversarial corpus", () => {
  it.each(corpus.bad_inputs.map((b) => [JSON.stringify(b.value).slice(0, 50), b] as const))("%s", (_n, b) => {
    const r = b.kind === "url" ? parseRepoRef(b.value) : parseRepoRef("o/r", b.value);
    expect(r.ok).toBe(false);
  });
});

describe("parseRepoRef normalizes", () => {
  it("strips .git, the trailing slash and the /tree/ part", () => {
    expect(parseRepoRef("https://github.com/Octo/Hello.git/")).toMatchObject({ ok: true, slug: "Octo/Hello", ref: null });
    expect(parseRepoRef("https://github.com/o/r/tree/release/1.2")).toMatchObject({ ok: true, slug: "o/r", ref: "release/1.2" });
    expect(parseRepoRef(" o/r ", "main")).toMatchObject({ ok: true, slug: "o/r", ref: "main" });
  });
  it("rejects non-strings and never echoes the input in the message", () => {
    for (const v of [1, null, undefined, {}, []]) expect(parseRepoRef(v)).toMatchObject({ ok: false, code: "not_str" });
    const r = parseRepoRef("o/r\u202eSECRET-MARKER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("SECRET-MARKER");
  });
  it.each(["", "   ", "o/r\u0000", "https://evil.test/o/r", "ftp://github.com/o/r", "o/r/../x", "--upload-pack=x/y"])("rejects %j", (v) => {
    expect(parseRepoRef(v).ok).toBe(false);
  });
});
