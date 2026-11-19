import test from "node:test";
import assert from "node:assert/strict";
import { applyProfileUpdate } from "../src/api/profile";

test("display name is trimmed", () => {
  assert.equal(applyProfileUpdate({ displayName: "  Ada  ", profile: {} }).displayName, "Ada");
});

test("a hidden field is omitted", () => {
  const out = applyProfileUpdate({ displayName: "Ada", profile: { email: "a@x.test", bio: "hi" }, hide: "email" });
  assert.equal(out.email, undefined);
  assert.equal(out.bio, "hi");
});
