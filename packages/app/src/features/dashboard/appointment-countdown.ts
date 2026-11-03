/**
 * How far away — or how late — a scheduled appointment is.
 *
 * This is presentation arithmetic, not clinic policy: it compares two instants and
 * names the difference. The appointment's start is UTC by contract (ADR 0012), so no
 * timezone is involved; the same instant produces the same countdown anywhere.
 *
 * Only appointments that are still waiting to begin carry a countdown. An arrived or
 * in-treatment patient already has a status badge saying so, and a closed appointment
 * has no remaining time worth counting. Keeping the rule here means the component
 * renders the answer instead of deciding it.
 */

import type { StatusTone } from '@denti-code-u3/ui';

import type { Translate } from '../../i18n/index.js';

export type AppointmentCountdown =
  | {
      readonly kind: 'upcoming';
      readonly totalMinutes: number;
      readonly hours: number;
      readonly minutes: number;
    }
  | {
      readonly kind: 'late';
      readonly totalMinutes: number;
      readonly hours: number;
      readonly minutes: number;
    }
  | { readonly kind: 'now' };

interface CountdownAppointment {
  readonly startsAt: string;
  readonly status: string;
}

const COUNTDOWN_STATUSES = new Set(['SCHEDULED', 'CONFIRMED']);
const NOW_WINDOW_MS = 60_000;

export function describeAppointmentCountdown(
  appointment: CountdownAppointment,
  nowMs: number,
): AppointmentCountdown | null {
  if (!COUNTDOWN_STATUSES.has(appointment.status)) {
    return null;
  }

  const startsAtMs = Date.parse(appointment.startsAt);
  if (Number.isNaN(startsAtMs)) {
    return null;
  }

  const remainingMs = startsAtMs - nowMs;
  if (remainingMs > 0) {
    // Round up so a start 45 seconds away reads "in 1 min", not "in 0 min".
    return { kind: 'upcoming', ...splitMinutes(Math.ceil(remainingMs / 60_000)) };
  }

  if (-remainingMs < NOW_WINDOW_MS) {
    return { kind: 'now' };
  }

  // Round down for lateness: one full minute must have passed before it is named.
  return { kind: 'late', ...splitMinutes(Math.floor(-remainingMs / 60_000)) };
}

export function appointmentCountdownTone(countdown: AppointmentCountdown): StatusTone {
  if (countdown.kind === 'late') {
    return 'danger';
  }
  if (countdown.kind === 'now') {
    return 'warning';
  }
  return countdown.totalMinutes <= 15 ? 'warning' : 'neutral';
}

export function formatAppointmentCountdown(t: Translate, countdown: AppointmentCountdown): string {
  if (countdown.kind === 'now') {
    return t('dashboard.todayAppointments.countdown.now');
  }

  const minutes = countdown.minutes;

  if (countdown.kind === 'late') {
    if (countdown.hours > 0 && minutes > 0) {
      return t('dashboard.todayAppointments.countdown.lateHoursMinutes', {
        hours: countdown.hours,
        minutes,
      });
    }
    if (countdown.hours > 0) {
      return t('dashboard.todayAppointments.countdown.lateHours', { hours: countdown.hours });
    }
    return t('dashboard.todayAppointments.countdown.lateMinutes', {
      count: countdown.totalMinutes,
    });
  }

  if (countdown.hours > 0 && minutes > 0) {
    return t('dashboard.todayAppointments.countdown.inHoursMinutes', {
      hours: countdown.hours,
      minutes,
    });
  }
  if (countdown.hours > 0) {
    return t('dashboard.todayAppointments.countdown.inHours', { hours: countdown.hours });
  }
  return t('dashboard.todayAppointments.countdown.inMinutes', { count: countdown.totalMinutes });
}

function splitMinutes(totalMinutes: number): {
  readonly totalMinutes: number;
  readonly hours: number;
  readonly minutes: number;
} {
  return {
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}
