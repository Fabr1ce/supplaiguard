import jwt from "jsonwebtoken";
import type { KeyPair } from "./keys";

export function issueAccessToken(keys: KeyPair, subject: string): string {
  return jwt.sign({ sub: subject, scope: "agent:invoke" }, keys.privateKey, {
    algorithm: "RS256",
    expiresIn: "15m",
  });
}
