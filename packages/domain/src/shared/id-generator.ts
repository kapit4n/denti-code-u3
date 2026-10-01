/** Identifier generation is a dependency, so domain code stays deterministic. */
export interface IdGenerator {
  nextId(): string;
}
