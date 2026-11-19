import jwt from "jsonwebtoken";
import type { KeyPair } from "./keys";

export function issueRefreshToken(keys: KeyPair, subject: string): string {
  return jwt.sign({ sub: subject, kind: "refresh" }, keys.privateKey, {
    algorithm: "RS256",
    expiresIn: "7d",
  });
}
