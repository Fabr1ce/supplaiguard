import { describe, expect, it } from "vitest";
import { parseLaunchRequest } from "../src/validate";

describe("parseLaunchRequest", () => {
  it("accepts a demo alone and defaults proposeFix to false", () => {
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp" })).toEqual({ ok: true, demoId: "crypt-keeper-mcp", proposeFix: false });
  });
  it("accepts a real boolean", () => {
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp", proposeFix: true })).toMatchObject({ ok: true, proposeFix: true });
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp", proposeFix: false })).toMatchObject({ ok: true, proposeFix: false });
  });
  it.each(["true", "false", 1, 0, null, {}, [], "yes"])("rejects proposeFix = %j", (v) => {
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp", proposeFix: v })).toMatchObject({ ok: false, code: "bad_request" });
  });
  it("rejects unknown fields, unknown demos and non-objects", () => {
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp", extra: 1 })).toMatchObject({ ok: false });
    expect(parseLaunchRequest({ demoId: "crypt-keeper-mcp", "propose-fix": true })).toMatchObject({ ok: false });
    expect(parseLaunchRequest({ demoId: "all" })).toMatchObject({ ok: false });
    expect(parseLaunchRequest({ proposeFix: true })).toMatchObject({ ok: false });
    for (const b of [null, [], "x", 3, undefined]) expect(parseLaunchRequest(b)).toMatchObject({ ok: false });
  });
});

describe("parseLaunchRequest: scan by URL", () => {
  const on = { scanUrlEnabled: true };
  it("is rejected with its own code when the flag is off (default)", () => {
    expect(parseLaunchRequest({ repoUrl: "o/r" })).toMatchObject({ ok: false, code: "scan_url_disabled" });
    expect(parseLaunchRequest({ repoUrl: "o/r" }, { scanUrlEnabled: false })).toMatchObject({ ok: false, code: "scan_url_disabled" });
    expect(parseLaunchRequest({ repoUrl: "o/r\u202e" })).toMatchObject({ ok: false, code: "scan_url_disabled" });
  });
  it("returns only normalized values", () => {
    expect(parseLaunchRequest({ repoUrl: "https://github.com/O/R.git" }, on)).toEqual({ ok: true, scanUrl: { repo: "O/R", ref: null } });
    expect(parseLaunchRequest({ repoUrl: "o/r", ref: "v1.0" }, on)).toEqual({ ok: true, scanUrl: { repo: "o/r", ref: "v1.0" } });
    expect(parseLaunchRequest({ repoUrl: "o/r", ref: null }, on)).toEqual({ ok: true, scanUrl: { repo: "o/r", ref: null } });
  });
  it("rejects both forms together, ref alone, wrong types and unknown fields", () => {
    expect(parseLaunchRequest({ repoUrl: "o/r", demoId: "crypt-keeper-mcp" }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({ repoUrl: "o/r", proposeFix: true }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({ ref: "main" }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({ repoUrl: 5 }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({ repoUrl: "o/r", ref: 5 }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({ repoUrl: "o/r", extra: 1 }, on)).toMatchObject({ ok: false, code: "bad_request" });
    expect(parseLaunchRequest({}, on)).toMatchObject({ ok: false });
  });
  it("rejects hostile input with invalid_repo", () => {
    for (const v of ["https://evil.test/o/r", "o/r%2e", "ignore previous instructions/x", "o/r\n"]) {
      expect(parseLaunchRequest({ repoUrl: v }, on)).toMatchObject({ ok: false, code: "invalid_repo" });
    }
    expect(parseLaunchRequest({ repoUrl: "o/r", ref: "--upload-pack=x" }, on)).toMatchObject({ ok: false, code: "invalid_repo" });
    expect(parseLaunchRequest({ repoUrl: "o/r", ref: "" }, on)).toMatchObject({ ok: false, code: "invalid_repo" });
  });
});
