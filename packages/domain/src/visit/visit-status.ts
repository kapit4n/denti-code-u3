export const VISIT_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === 'string' && (VISIT_STATUSES as readonly string[]).includes(value);
}
