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
