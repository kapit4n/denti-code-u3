/**
 * The single error type the domain throws.
 *
 * Domain errors are pure data: they carry a stable machine-readable `code` and
 * optional structured details, never a stack trace or a database message. The
 * API maps them to HTTP status codes; the UI maps them to user-facing text.
 */
export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'SCHEDULING_CONFLICT'
  | 'OUTSIDE_OPERATING_HOURS'
  /**
   * A booking named a clinician or chair that cannot be booked.
   *
   * Its own code rather than `INVALID_INPUT` for the same reason
   * `OUTSIDE_OPERATING_HOURS` has one: the request is well formed and the value is
   * real, it is the *combination* that the clinic does not allow, and a log line that
   * says `INVALID_INPUT` sends whoever reads it looking for a malformed body. The API
   * folds it into `DOMAIN_RULE_VIOLATION` on the wire, so a client sees one code for
   * rules it cannot satisfy.
   */
  | 'UNBOOKABLE_RESOURCE'
  | 'INSUFFICIENT_STOCK'
  | 'DUPLICATED_RECORD'
  | 'FORBIDDEN';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function notFound(entity: string, id: string): DomainError {
  return new DomainError('NOT_FOUND', `${entity} ${id} was not found`, { entity, id });
}

export function illegalTransition(entity: string, from: string, to: string): DomainError {
  return new DomainError('ILLEGAL_TRANSITION', `${entity} cannot move from ${from} to ${to}`, {
    entity,
    from,
    to,
  });
}
