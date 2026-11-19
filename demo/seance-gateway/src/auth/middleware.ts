import jwt from "jsonwebtoken";
import type { KeyPair } from "./keys";

export interface Claims {
  sub: string;
  scope?: string;
  kind?: string;
}

export function verifyBearer(keys: KeyPair, header: string | undefined): Claims | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice("Bearer ".length), keys.publicKey, { algorithms: ["RS256"] }) as Claims;
  } catch {
    return null;
  }
}
