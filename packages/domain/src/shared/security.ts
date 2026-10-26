/**
 * Password hashing is a dependency, not a domain rule.
 *
 * The domain never sees a password: it sees a stored hash and asks this port
 * whether a candidate matches. That keeps the crypto library (scrypt here, but
 * the port does not care) out of `packages/domain`, and lets tests inject a
 * trivial hasher instead of paying for key derivation on every case.
 *
 * Two methods, no options, no algorithm name on the wire: a caller cannot choose
 * a weaker scheme by passing one, and rotating the algorithm later is a change to
 * the one implementation, not to every call site.
 */
export interface PasswordHasher {
  /** Derive a storable hash, salt included in its own encoding. */
  hash(password: string): Promise<string>;
  /** Constant-time verification of a candidate against a stored hash. */
  verify(password: string, storedHash: string): Promise<boolean>;
}

/** Opaque bearer tokens are generated, never chosen by a caller. */
export interface TokenGenerator {
  /** A fresh, high-entropy token to hand to a client. */
  nextToken(): string;
  /** The value stored for a token. One-way: a dump cannot be replayed. */
  hashToken(token: string): string;
}
