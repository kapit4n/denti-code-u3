import { illegalTransition } from '../shared/errors.js';
import type { AppointmentStatus } from './appointment-status.js';

/**
 * The single source of truth for appointment state changes.
 *
 * Everything else in the system asks this function — the API's use case, the
 * agenda's quick panel, and the patient's upcoming-appointment card — so the
 * same answer is produced everywhere.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['SCHEDULED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_TREATMENT', 'CANCELLED', 'NO_SHOW'],
  IN_TREATMENT: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['SCHEDULED'],
  NO_SHOW: ['SCHEDULED'],
};

export function allowedAppointmentTransitions(
  from: AppointmentStatus,
): readonly AppointmentStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransitionAppointment(from, to)) {
    throw illegalTransition('Appointment', from, to);
  }
}

/** A completed appointment is history; it is never edited again. */
export function isTerminalAppointmentStatus(status: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * After the patient has arrived the scheduled time is history, so the schedule
 * may no longer be edited — only the clinical work may still advance.
 */
export function isScheduleEditable(status: AppointmentStatus): boolean {
  return status === 'SCHEDULED' || status === 'CONFIRMED';
}

/**
 * A status that means the chair was actually used.
 *
 * This is an operational question ("was this chair occupied?"), not a scheduling
 * question: a confirmed 09:00 appointment reserves the chair even though nobody
 * arrived yet.
 */
export function occupiesChairTime(status: AppointmentStatus): boolean {
  return status === 'ARRIVED' || status === 'IN_TREATMENT' || status === 'COMPLETED';
}

/**
 * A status that still reserves the dentist and the chair.
 *
 * Cancelled and no-show appointments release their slot, which is why they never
 * produce a scheduling conflict; a scheduled or confirmed appointment does.
 */
export function reservesSchedulingSlot(status: AppointmentStatus): boolean {
  return status !== 'CANCELLED' && status !== 'NO_SHOW';
}
