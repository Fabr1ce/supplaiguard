import { ExtractJwt, Strategy as JwtStrategy } from "passport-jwt";
import type { KeyPair } from "./keys";

// Strategy for the admin UI. passport-jwt verifies tokens with its own copy of jsonwebtoken.
export function adminStrategy(keys: KeyPair): JwtStrategy {
  return new JwtStrategy(
    { jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: keys.publicKey, algorithms: ["RS256"] },
    (payload, done) => done(null, payload),
  );
}
