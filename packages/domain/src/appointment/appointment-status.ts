/**
 * Appointment statuses are domain data.
 *
 * The UI derives colour, label and available actions from these values; colour
 * is never the source of truth. Adding a status here is a compile error until
 * its presentation and transition rules exist.
 */
export const APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_TREATMENT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return typeof value === 'string' && (APPOINTMENT_STATUSES as readonly string[]).includes(value);
}
