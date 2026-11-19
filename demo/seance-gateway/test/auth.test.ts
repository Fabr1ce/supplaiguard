import test from "node:test";
import assert from "node:assert/strict";
import { generateSigningKeys } from "../src/auth/keys";
import { issueAccessToken } from "../src/auth/token";
import { issueRefreshToken } from "../src/auth/refresh";
import { verifyBearer } from "../src/auth/middleware";
import { adminStrategy } from "../src/auth/passport";

test("access token round-trips through the bearer check", () => {
  const keys = generateSigningKeys();
  const claims = verifyBearer(keys, `Bearer ${issueAccessToken(keys, "alice")}`);
  assert.equal(claims?.sub, "alice");
  assert.equal(claims?.scope, "agent:invoke");
});

test("refresh token carries its kind", () => {
  const keys = generateSigningKeys();
  assert.equal(verifyBearer(keys, `Bearer ${issueRefreshToken(keys, "bob")}`)?.kind, "refresh");
});

test("a token signed with other keys is rejected", () => {
  const a = generateSigningKeys();
  const b = generateSigningKeys();
  assert.equal(verifyBearer(b, `Bearer ${issueAccessToken(a, "mallory")}`), null);
});

test("missing or malformed header is rejected", () => {
  const keys = generateSigningKeys();
  assert.equal(verifyBearer(keys, undefined), null);
  assert.equal(verifyBearer(keys, "Basic abc"), null);
});

test("admin strategy can be built", () => {
  assert.ok(adminStrategy(generateSigningKeys()));
});
