import { generateKeyPairSync } from "node:crypto";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

// Signing keys for the gateway. Generated at start-up so no key material is committed.
export function generateSigningKeys(): KeyPair {
  return generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}
