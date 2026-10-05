/**
 * The appointment write use cases.
 *
 * These are the rules the front desk relies on, and each one exists because the
 * obvious implementation gets it wrong in a way nobody notices until a patient
 * arrives at the wrong time:
 *
 *  - a booking that ends after the clinic closes is refused even though it starts
 *    inside opening hours;
 *  - un-cancelling a booking re-takes the chair, and two receptionists can
 *    collide on a slot that was free for both of them a second earlier;
 *  - the time of an appointment that has already been attended to is history, and
 *    rewriting it is falsifying the record rather than fixing it;
 *  - a rejected booking consumes no identifier.
 *
 * Fakes, not a database: every rule here is pure and the ports are declared by
 * this package. The one thing a fake cannot prove — that two *concurrent* writes
 * collide — is covered in `apps/api/test/appointment-write.integration.test.ts`,
 * where the exclusion constraint is real.
 */

import { describe, expect, it } from 'vitest';

import {
  asAppointmentId,
  asChairId,
  asClinicId,
  asDentistId,
  asPatientId,
  type AppointmentId,
  type IsoDateTime,
} from '@denti-code-u3/types';
import type { AgendaEntry } from './agenda-read-model.js';
import type { Appointment } from './appointment.js';
import type { AppointmentWindow } from './agenda-read-model.js';
import type { Clinic, ClinicOperatingHours } from '../organization/index.js';
import type { AppointmentRepository, ClinicRepository } from '../ports/index.js';
import {
  createAppointment,
  rescheduleAppointment,
  transitionAppointmentStatus,
  type AppointmentWriteDependencies,
} from './appointment-write.js';

const CLINIC_ID = asClinicId('11111111-1111-4111-8111-111111111111');
const PATIENT = asPatientId('22222222-2222-4222-8222-222222222222');
const DENTIST_A = asDentistId('33333333-3333-4333-8333-333333333333');
const DENTIST_B = asDentistId('44444444-4444-4444-8444-444444444444');
const CHAIR_1 = asChairId('55555555-5555-4555-8555-555555555555');
const CHAIR_2 = asChairId('66666666-6666-4666-8666-666666666666');

/** Monday 2026-09-28, 14:00Z. */
const MONDAY_14_00 = '2026-09-28T14:00:00.000Z' as IsoDateTime;

/** A clinic open 08:00–17:00, every day, in a zone that keeps it simple. */
const CLINIC: Clinic = {
  id: CLINIC_ID,
  name: 'Test Clinic',
  timeZone: 'UTC',
  currency: 'GTQ',
  operatingHours: openEveryDay('08:00', '17:00'),
  settings: {},
};

function openEveryDay(opensAtLocalTime: string, closesAtLocalTime: string): ClinicOperatingHours[] {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    opensAtLocalTime,
    closesAtLocalTime,
    isClosed: false,
  }));
}

interface Writes {
  readonly inserted: Appointment[];
  readonly schedules: Appointment[];
  readonly statuses: { status: string; reason?: string }[];
}

/**
 * In-memory ports that record what they were asked to do.
 *
 * `overlapping` is the seam the conflict check reads from, and it is set per test
 * rather than computed: what a conflict check *does* with the rows is the domain's
 * business, and what the rows are is the repository's.
 */
function ports(options: { overlapping?: readonly Appointment[] } = {}) {
  const writes: Writes = { inserted: [], schedules: [], statuses: [] };
  const stored = new Map<string, Appointment>();
  let sequence = 0;

  const nextId = (): AppointmentId => {
    sequence += 1;
    return asAppointmentId(`00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`);
  };

  const repository: AppointmentRepository = {
    findAgenda: async () => [],
    findById: async (clinicId, appointmentId) => {
      const found = stored.get(appointmentId);
      return found && found.clinicId === clinicId ? found : undefined;
    },
    findEntryById: async (clinicId, appointmentId) => {
      const found = stored.get(appointmentId);
      return found && found.clinicId === clinicId ? toEntry(found) : undefined;
    },
    findOverlapping: async (clinicId, _window: AppointmentWindow) =>
      options.overlapping?.filter((appointment) => appointment.clinicId === clinicId) ?? [],
    insert: async (appointment) => {
      writes.inserted.push(appointment);
      stored.set(appointment.id, appointment);
      return appointment;
    },
    replaceSchedule: async (appointment) => {
      if (!stored.has(appointment.id)) {
        return undefined;
      }
      writes.schedules.push(appointment);
      stored.set(appointment.id, appointment);
      return appointment;
    },
    changeStatus: async (clinicId, appointmentId, status, reason) => {
      const found = stored.get(appointmentId);
      if (!found || found.clinicId !== clinicId) {
        return undefined;
      }
      writes.statuses.push(reason === undefined ? { status } : { status, reason });
      const changed: Appointment = { ...found, status };
      stored.set(appointmentId, changed);
      return changed;
    },
  };

  const clinics: ClinicRepository = {
    findById: async (clinicId) => (clinicId === CLINIC_ID ? CLINIC : undefined),
  } as ClinicRepository;

  const dependencies: AppointmentWriteDependencies = {
    appointments: repository,
    clinics,
    newId: nextId,
  };

  return { dependencies, writes, stored, repository };
}

function toEntry(appointment: Appointment): AgendaEntry {
  return {
    id: appointment.id,
    clinicId: appointment.clinicId,
    patientId: appointment.patientId,
    patientFirstName: 'Ana',
    patientLastName: 'Pérez',
    dentistId: appointment.dentistId,
    dentistFullName: 'Dr Test',
    chairId: appointment.chairId ?? null,
    chairName: 'Chair 1',
    startsAt: appointment.startsAt,
    endsAt: appointment.startsAt,
    durationMinutes: appointment.durationMinutes,
    status: appointment.status,
    notes: appointment.notes ?? null,
  };
}

function booked(
  overrides: Partial<Appointment> & Pick<Appointment, 'id' | 'startsAt' | 'status'>,
): Appointment {
  return {
    clinicId: CLINIC_ID,
    patientId: PATIENT,
    dentistId: DENTIST_A,
    chairId: CHAIR_1,
    durationMinutes: 30,
    ...overrides,
  };
}

const BOOKED_ID = asAppointmentId('77777777-7777-4777-8777-777777777777');

function withBooked(appointment: Appointment, extra: readonly Appointment[] = []) {
  const harness = ports({ overlapping: [appointment, ...extra] });
  harness.stored.set(appointment.id, appointment);
  return harness;
}

async function expectDomainError(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toMatchObject({ code });
}

describe('createAppointment', () => {
  const request = {
    patientId: PATIENT,
    dentistId: DENTIST_A,
    chairId: CHAIR_1,
    startsAt: MONDAY_14_00,
    durationMinutes: 30,
  } as const;

  it('books an appointment and answers with the row the agenda will show', async () => {
    const { dependencies, writes } = ports();

    const entry = await createAppointment(CLINIC_ID, request, dependencies);

    expect(writes.inserted).toHaveLength(1);
    expect(writes.inserted[0]?.status).toBe('SCHEDULED');
    expect(entry.patientFirstName).toBe('Ana');
    expect(entry.dentistFullName).toBe('Dr Test');
  });

  it('always starts as SCHEDULED, because a form cannot record an agreement nobody had', async () => {
    const { dependencies, writes } = ports();

    await createAppointment(CLINIC_ID, request, dependencies);

    expect(writes.inserted[0]?.status).toBe('SCHEDULED');
  });

  it('refuses a duration that is not a whole number of minutes inside the range', async () => {
    const { dependencies, writes } = ports();

    await expectDomainError(
      createAppointment(CLINIC_ID, { ...request, durationMinutes: 0 }, dependencies),
      'INVALID_INPUT',
    );
    await expectDomainError(
      createAppointment(CLINIC_ID, { ...request, durationMinutes: 30.5 }, dependencies),
      'INVALID_INPUT',
    );

    expect(writes.inserted).toHaveLength(0);
  });

  it('refuses a booking that starts before the clinic opens', async () => {
    const { dependencies, writes } = ports();

    await expectDomainError(
      createAppointment(
        CLINIC_ID,
        { ...request, startsAt: '2026-09-28T07:30:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'OUTSIDE_OPERATING_HOURS',
    );

    expect(writes.inserted).toHaveLength(0);
  });

  it('refuses a booking that starts inside opening hours but runs past closing', async () => {
    // The rule is about the interval, not the start. A 16:30 appointment at a
    // clinic that closes at 17:00 is not a 16:30 appointment; it is a dentist
    // still in the chair at 17:30.
    const { dependencies, writes } = ports();

    await expectDomainError(
      createAppointment(
        CLINIC_ID,
        { ...request, startsAt: '2026-09-28T16:30:00.000Z' as IsoDateTime, durationMinutes: 60 },
        dependencies,
      ),
      'OUTSIDE_OPERATING_HOURS',
    );

    expect(writes.inserted).toHaveLength(0);
  });

  it('accepts a booking that ends exactly at closing time', async () => {
    // Half-open, like every other interval in the system.
    const { dependencies } = ports();

    await expect(
      createAppointment(
        CLINIC_ID,
        { ...request, startsAt: '2026-09-28T16:30:00.000Z' as IsoDateTime, durationMinutes: 30 },
        dependencies,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a booking on a day the clinic is closed', async () => {
    const { dependencies } = ports();
    const closed: Clinic = {
      ...CLINIC,
      operatingHours: openEveryDay('08:00', '17:00').map((hours) =>
        hours.weekday === 7 ? { ...hours, isClosed: true } : hours,
      ),
    };
    const harness = ports();
    const withClosedClinic: AppointmentWriteDependencies = {
      ...harness.dependencies,
      clinics: { ...harness.dependencies.clinics, findById: async () => closed },
    };

    // 2026-10-04 is a Sunday.
    await expectDomainError(
      createAppointment(
        CLINIC_ID,
        { ...request, startsAt: '2026-10-04T14:00:00.000Z' as IsoDateTime },
        withClosedClinic,
      ),
      'OUTSIDE_OPERATING_HOURS',
    );
    expect(dependencies).toBeDefined();
  });

  it('refuses a booking that overlaps the same dentist, and names the conflict', async () => {
    const { dependencies, writes } = ports({
      overlapping: [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          startsAt: MONDAY_14_00,
          status: 'CONFIRMED',
        }),
      ],
    });

    await expectDomainError(
      createAppointment(CLINIC_ID, request, dependencies),
      'SCHEDULING_CONFLICT',
    );
    expect(writes.inserted).toHaveLength(0);
  });

  it('refuses a booking that overlaps the same chair for a different dentist', async () => {
    // The dentist is available; the chair is not. A check that only compared
    // dentists would happily double-book the chair.
    const { dependencies } = ports({
      overlapping: [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          dentistId: DENTIST_A,
          startsAt: MONDAY_14_00,
          status: 'CONFIRMED',
        }),
      ],
    });

    await expectDomainError(
      createAppointment(CLINIC_ID, { ...request, dentistId: DENTIST_B }, dependencies),
      'SCHEDULING_CONFLICT',
    );
  });

  it('allows two appointments that touch end to end', async () => {
    // 14:00–14:30 and 14:30–15:00 is a legal day, and the half-open interval is
    // what makes it one.
    const { dependencies, writes } = ports({
      overlapping: [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          startsAt: MONDAY_14_00,
          status: 'CONFIRMED',
        }),
      ],
    });

    await createAppointment(
      CLINIC_ID,
      { ...request, startsAt: '2026-09-28T14:30:00.000Z' as IsoDateTime },
      dependencies,
    );

    expect(writes.inserted).toHaveLength(1);
  });

  it('ignores a cancelled appointment, because a cancellation releases its slot', async () => {
    const { dependencies, writes } = ports({
      overlapping: [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          startsAt: MONDAY_14_00,
          status: 'CANCELLED',
        }),
      ],
    });

    await createAppointment(CLINIC_ID, request, dependencies);

    expect(writes.inserted).toHaveLength(1);
  });

  it('allocates no identifier for a booking refused before the conflict check', async () => {
    // A hole in the id sequence is the visible symptom of an identifier spent on
    // a write that never happened, so the rules that can be decided without an id
    // are decided first.
    const harness = ports();
    const allocated: AppointmentId[] = [];
    const dependencies: AppointmentWriteDependencies = {
      ...harness.dependencies,
      newId: () => {
        const id = harness.dependencies.newId();
        allocated.push(id);
        return id;
      },
    };

    await expectDomainError(
      createAppointment(CLINIC_ID, { ...request, durationMinutes: 1 }, dependencies),
      'INVALID_INPUT',
    );
    await expectDomainError(
      createAppointment(
        CLINIC_ID,
        { ...request, startsAt: '2026-09-28T20:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'OUTSIDE_OPERATING_HOURS',
    );

    expect(allocated).toHaveLength(0);
  });

  it('refuses to write into a clinic that does not exist', async () => {
    const { dependencies, writes } = ports();

    await expectDomainError(
      createAppointment(asClinicId('99999999-9999-4999-8999-999999999999'), request, dependencies),
      'NOT_FOUND',
    );
    expect(writes.inserted).toHaveLength(0);
  });
});

describe('rescheduleAppointment', () => {
  const scheduled = booked({
    id: BOOKED_ID,
    startsAt: MONDAY_14_00,
    status: 'SCHEDULED',
  });

  it('moves the time and answers with the row the agenda will show', async () => {
    const { dependencies, writes } = withBooked(scheduled);

    const entry = await rescheduleAppointment(
      CLINIC_ID,
      BOOKED_ID,
      { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime },
      dependencies,
    );

    expect(writes.schedules[0]?.startsAt).toBe('2026-09-28T15:00:00.000Z');
    expect(entry.startsAt).toBe('2026-09-28T15:00:00.000Z');
  });

  it('keeps the fields the caller did not mention', async () => {
    // A front desk that only changes the time must not clear the chair as a side
    // effect of a drag.
    const { dependencies, writes } = withBooked(scheduled);

    await rescheduleAppointment(
      CLINIC_ID,
      BOOKED_ID,
      { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime, durationMinutes: 45 },
      dependencies,
    );

    expect(writes.schedules[0]?.chairId).toBe(CHAIR_1);
    expect(writes.schedules[0]?.dentistId).toBe(DENTIST_A);
    expect(writes.schedules[0]?.durationMinutes).toBe(45);
  });

  it('refuses to move the schedule of an appointment that has already been attended to', async () => {
    // Once the patient has arrived, the booked time is history. Rewriting it is
    // falsifying the record, not fixing it.
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'ARRIVED' }),
    );

    await expectDomainError(
      rescheduleAppointment(
        CLINIC_ID,
        BOOKED_ID,
        { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'ILLEGAL_TRANSITION',
    );
    expect(writes.schedules).toHaveLength(0);
  });

  it('refuses to move a cancelled appointment back into the book', async () => {
    const { dependencies } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CANCELLED' }),
    );

    await expectDomainError(
      rescheduleAppointment(
        CLINIC_ID,
        BOOKED_ID,
        { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'ILLEGAL_TRANSITION',
    );
  });

  it("refuses a new time that is outside the clinic's opening hours", async () => {
    const { dependencies, writes } = withBooked(scheduled);

    await expectDomainError(
      rescheduleAppointment(
        CLINIC_ID,
        BOOKED_ID,
        { startsAt: '2026-09-28T18:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'OUTSIDE_OPERATING_HOURS',
    );
    expect(writes.schedules).toHaveLength(0);
  });

  it('refuses a new time that collides with another appointment', async () => {
    const { dependencies, writes } = withBooked(scheduled, [
      booked({
        id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
        startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime,
        status: 'CONFIRMED',
        chairId: CHAIR_2,
      }),
    ]);

    await expectDomainError(
      rescheduleAppointment(
        CLINIC_ID,
        BOOKED_ID,
        { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'SCHEDULING_CONFLICT',
    );
    expect(writes.schedules).toHaveLength(0);
  });

  it('does not treat the appointment as its own conflict', async () => {
    // The row being moved is in the window the checker reads; comparing it with
    // itself would make every reschedule a conflict with itself.
    const { dependencies, writes } = withBooked(scheduled);

    await rescheduleAppointment(
      CLINIC_ID,
      BOOKED_ID,
      { startsAt: '2026-09-28T14:15:00.000Z' as IsoDateTime },
      dependencies,
    );

    expect(writes.schedules).toHaveLength(1);
  });

  it('answers NOT_FOUND for an appointment in another clinic', async () => {
    const { dependencies } = withBooked(scheduled);

    await expectDomainError(
      rescheduleAppointment(
        asClinicId('99999999-9999-4999-8999-999999999999'),
        BOOKED_ID,
        { startsAt: '2026-09-28T15:00:00.000Z' as IsoDateTime },
        dependencies,
      ),
      'NOT_FOUND',
    );
  });
});

describe('transitionAppointmentStatus', () => {
  it('confirms a scheduled appointment', async () => {
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'SCHEDULED' }),
    );

    await transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'CONFIRMED' }, dependencies);

    expect(writes.statuses).toEqual([{ status: 'CONFIRMED' }]);
  });

  it('refuses a transition the lifecycle does not allow', async () => {
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'COMPLETED' }),
    );

    await expectDomainError(
      transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'SCHEDULED' }, dependencies),
      'ILLEGAL_TRANSITION',
    );
    expect(writes.statuses).toHaveLength(0);
  });

  it('requires a reason for a cancellation', async () => {
    // "Cancelled" alone is a gap in the record: a patient who no-showed and a
    // clinic whose compressor failed are both cancellations, and the front desk
    // tells them apart when someone calls.
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CONFIRMED' }),
    );

    await expectDomainError(
      transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'CANCELLED' }, dependencies),
      'INVALID_INPUT',
    );
    expect(writes.statuses).toHaveLength(0);
  });

  it('records why an appointment was cancelled', async () => {
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CONFIRMED' }),
    );

    await transitionAppointmentStatus(
      CLINIC_ID,
      BOOKED_ID,
      { to: 'CANCELLED', reason: 'Patient rescheduled by phone' },
      dependencies,
    );

    expect(writes.statuses).toEqual([
      { status: 'CANCELLED', reason: 'Patient rescheduled by phone' },
    ]);
  });

  it('cancelling frees the slot without a conflict check', async () => {
    // A cancellation can only ever release, so the rows in the window are
    // irrelevant to it.
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CONFIRMED' }),
      [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          startsAt: MONDAY_14_00,
          status: 'SCHEDULED',
        }),
      ],
    );

    await transitionAppointmentStatus(
      CLINIC_ID,
      BOOKED_ID,
      { to: 'CANCELLED', reason: 'Patient unwell' },
      dependencies,
    );

    expect(writes.statuses).toHaveLength(1);
  });

  it('refuses to un-cancel into a slot that has since been taken', async () => {
    // The subtle one. A cancelled appointment holds nothing, so the moment it
    // takes a slot again it must be checked like any other booking — otherwise
    // two receptionists can both press undo and both succeed.
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CANCELLED' }),
      [
        booked({
          id: asAppointmentId('88888888-8888-4888-8888-888888888888'),
          startsAt: MONDAY_14_00,
          status: 'SCHEDULED',
        }),
      ],
    );

    await expectDomainError(
      transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'SCHEDULED' }, dependencies),
      'SCHEDULING_CONFLICT',
    );
    expect(writes.statuses).toHaveLength(0);
  });

  it('un-cancelling into a free slot is allowed', async () => {
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'CANCELLED' }),
    );

    await transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'SCHEDULED' }, dependencies);

    expect(writes.statuses).toEqual([{ status: 'SCHEDULED' }]);
  });

  it('records a no-show without asking for a reason', async () => {
    const { dependencies, writes } = withBooked(
      booked({ id: BOOKED_ID, startsAt: MONDAY_14_00, status: 'ARRIVED' }),
    );

    await transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'NO_SHOW' }, dependencies);

    expect(writes.statuses).toEqual([{ status: 'NO_SHOW' }]);
  });

  it('answers NOT_FOUND for an appointment that does not exist', async () => {
    const { dependencies } = ports();

    await expectDomainError(
      transitionAppointmentStatus(CLINIC_ID, BOOKED_ID, { to: 'CONFIRMED' }, dependencies),
      'NOT_FOUND',
    );
  });
});
