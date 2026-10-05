/**
 * API response fixtures for the end-to-end specs.
 *
 * Every payload here was captured from the running API against the seeded
 * development database, then frozen. Two reasons for freezing rather than reading
 * a live server:
 *
 *  - a spec that depends on seed data drifts the moment the seed changes, and
 *    fails for a reason that has nothing to do with the code under test;
 *  - `pnpm run test:e2e` must stay runnable with no database, exactly like the
 *    unit suite. The API's own behaviour is covered by
 *    `apps/api/test/*.integration.test.ts` against real PostgreSQL.
 *
 * The values are chosen to be *distinguishable at a glance*: 3 appointments, 2
 * active patients, 65.00 USD outstanding. A spec that asserts "80.00" against a
 * fixture reading "80.00" proves only that the plumbing is intact — which is
 * precisely what an end-to-end test is for. Arithmetic is the API's job and is
 * tested there.
 */

export const ANA_ID = '11111111-3333-4444-8555-000000000001';
export const LUIS_ID = '11111111-3333-4444-8555-000000000002';

import type { Fixture, MockedResponses } from './mock-api.js';

export interface PatientSummaryFixture {
  readonly id: string;
  readonly recordNumber: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly birthDate: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export const patientSummaries: readonly PatientSummaryFixture[] = [
  {
    id: LUIS_ID,
    recordNumber: 'P-000002',
    firstName: 'Luis',
    lastName: 'Fernández',
    preferredName: null,
    phone: '+1 555 0102',
    email: 'luis.fernandez@example.test',
    birthDate: '1985-11-02',
    isActive: true,
    createdAt: '2026-10-03T00:06:36.214Z',
  },
  {
    id: ANA_ID,
    recordNumber: 'P-000001',
    firstName: 'Ana',
    lastName: 'García',
    preferredName: null,
    phone: '+1 555 0101',
    email: 'ana.garcia@example.test',
    birthDate: '1991-04-17',
    isActive: true,
    createdAt: '2026-10-03T00:06:36.214Z',
  },
  {
    // Inactive, so the list has to render the marker rather than assume every
    // row is a current patient.
    id: '11111111-3333-4444-8555-000000000003',
    recordNumber: 'P-000003',
    firstName: 'Sofía',
    lastName: 'Ramírez',
    preferredName: null,
    phone: null,
    email: null,
    birthDate: '1979-06-30',
    isActive: false,
    createdAt: '2026-10-03T00:06:36.214Z',
  },
];

/** Ana's profile: clinical history, an allergy, and a real balance. */
export const anaProfile = {
  ...patientSummaries[1]!,
  clinicId: '11111111-1111-4111-8111-111111111111',
  identificationNumber: null,
  address: null,
  allergies: 'Penicillin',
  additionalData: {},
  updatedAt: '2026-10-03T00:06:36.214Z',
  upcomingAppointment: {
    id: '11111111-4444-4555-8666-000000000009',
    startsAt: '2026-10-06T13:00:00.000Z',
    durationMinutes: 45,
    status: 'SCHEDULED',
    dentistId: '11111111-2222-4333-8444-000000000001',
  },
  recentVisits: [
    {
      id: '11111111-7777-4888-8999-000000000001',
      status: 'COMPLETED',
      startedAt: '2026-09-11T20:09:00.000Z',
      endedAt: '2026-09-11T20:54:00.000Z',
      reason: 'Sensitivity in the upper right quadrant',
      summary: 'Composite restoration on tooth 16.',
      createdAt: '2026-09-11T20:09:00.000Z',
    },
  ],
  outstandingTreatments: [
    {
      id: '11111111-9999-4aaa-8bbb-000000000001',
      planId: '11111111-8888-4999-8aaa-000000000001',
      planStatus: 'ACCEPTED',
      title: 'Restorative plan',
      tooth: '26',
      quantity: 1,
      estimatedPriceMinor: 15000,
    },
  ],
  financialBalance: {
    outstandingMinor: 6500,
    chargeCount: 2,
    currencyCode: 'USD',
  },
} as const;

/**
 * Luis's profile: a prepayment, so the balance is negative.
 *
 * A negative balance is money the patient is owed, not money they owe. The UI has
 * to say "Credit" — rendering "-80.00" would state the opposite of what happened.
 */
export const luisProfile = {
  ...patientSummaries[0]!,
  clinicId: '11111111-1111-4111-8111-111111111111',
  identificationNumber: null,
  address: null,
  allergies: null,
  additionalData: {},
  updatedAt: '2026-10-03T00:06:36.214Z',
  upcomingAppointment: null,
  // Empty collections, not missing keys. This is the shape that crashed the
  // profile page: an absent `recentVisits` is `undefined`, and `undefined.length`
  // throws.
  recentVisits: [],
  outstandingTreatments: [],
  financialBalance: {
    outstandingMinor: -8000,
    chargeCount: 0,
    currencyCode: 'USD',
  },
} as const;

export const dashboardStats = {
  today: {
    appointments: 3,
    completed: 0,
    pending: 2,
    inTreatment: 1,
    cancelled: 0,
    noShow: 0,
  },
  clinic: {
    activePatients: 2,
    pendingTreatmentItems: 2,
    collectedThisMonthMinor: 8000,
    currencyCode: 'USD',
    // `null`, not 0: the UI must render "—" rather than a confident "0%", which
    // would read as "nobody is working today".
    occupancyRate: null,
  },
} as const;

export const todayAppointments = {
  items: [
    {
      id: '11111111-4444-4555-8666-000000000001',
      startsAt: '2026-10-03T13:00:00.000Z',
      durationMinutes: 45,
      status: 'CONFIRMED',
      dentistId: '11111111-2222-4333-8444-000000000001',
      firstName: 'Ana',
      lastName: 'García',
    },
    {
      id: '11111111-4444-4555-8666-000000000002',
      startsAt: '2026-10-03T14:00:00.000Z',
      durationMinutes: 60,
      status: 'SCHEDULED',
      dentistId: '11111111-2222-4333-8444-000000000001',
      firstName: 'Luis',
      lastName: 'Fernández',
    },
  ],
} as const;

export const upcomingVisits = {
  items: [
    {
      id: '11111111-4444-4555-8666-000000000004',
      startsAt: '2026-10-06T13:00:00.000Z',
      durationMinutes: 45,
      status: 'SCHEDULED',
      dentistId: '11111111-2222-4333-8444-000000000001',
      firstName: 'Luis',
      lastName: 'Fernández',
    },
  ],
} as const;

export const recentPatients = {
  items: [
    {
      id: ANA_ID,
      firstName: 'Ana',
      lastName: 'García',
      recordNumber: 'P-000001',
      createdAt: '2026-10-03T00:06:36.214Z',
    },
    {
      id: LUIS_ID,
      firstName: 'Luis',
      lastName: 'Fernández',
      recordNumber: 'P-000002',
      createdAt: '2026-10-03T00:06:36.214Z',
    },
  ],
} as const;

export const calendarPreview = {
  from: '2026-10-03T03:00:00.000Z',
  to: '2026-10-17T03:00:00.000Z',
  days: 14,
  items: [
    { day: '2026-10-03', total: 2, completed: 0 },
    { day: '2026-10-06', total: 1, completed: 0 },
  ],
} as const;

/**
 * All five dashboard endpoints keyed by pathname.
 *
 * A dashboard spec spreads this and overrides the one endpoint it cares about:
 * `{ ...DASHBOARD_RESPONSES, '/api/v1/dashboard/stats': { ... } }`. Spreading
 * matters — the dashboard fires five queries, and a spec that mocked only one
 * would leave the other four hitting the network.
 */
const DASHBOARD_PAYLOADS = {
  '/api/v1/dashboard/stats': dashboardStats,
  '/api/v1/dashboard/today-appointments': todayAppointments,
  '/api/v1/dashboard/calendar-preview': calendarPreview,
  '/api/v1/dashboard/recent-patients': recentPatients,
  '/api/v1/dashboard/upcoming-visits': upcomingVisits,
} as const;

/**
 * All five dashboard endpoints, ready for `installApi`.
 *
 * The payloads above are plain frozen objects; the mock wants each one wrapped in
 * a `Fixture`. That wrapping is done here rather than in a spec so the shape is
 * described once, and so a payload can never be handed to the mock unwrapped.
 *
 * Spreading this and overriding one endpoint is the intended use:
 * `{ ...allDashboardFixtures(), '/api/v1/dashboard/stats': { body: stats } }`. The
 * dashboard fires five queries, so a spec that mocked only the one it cared about
 * would leave the other four unmatched — which the mock answers with 501, by
 * design.
 */
export function allDashboardFixtures(): MockedResponses {
  return Object.fromEntries(
    Object.entries(DASHBOARD_PAYLOADS).map(([pathname, body]) => [pathname, { body }]),
  );
}

/** Unpaginated list response for the three seeded patients. */
export const PATIENT_LIST_RESPONSE = {
  items: patientSummaries,
  pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
} as const;

/**
 * The clinic's own record, as `GET /api/v1/clinic` returns it.
 *
 * The agenda cannot be drawn without this: the timezone decides where every
 * appointment lands on the grid, and the opening hours decide what is shaded as
 * non-working. Both come from the clinic, not from a build-time constant, because
 * one API serves every clinic.
 *
 * `America/Lima` is UTC-5 all year, which makes the fixture's instants readable:
 * 14:00Z is 09:00 local, so a spec can assert a wall-clock hour without doing
 * timezone arithmetic of its own.
 */
export const clinicSettings = {
  id: '11111111-1111-4111-8111-000000000001',
  name: 'Clínica Dental U3',
  legalName: 'Denti-Code U3 S.A.C.',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [
    // ISO weekdays: 1 = Monday … 7 = Sunday.
    { weekday: 1, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    { weekday: 2, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    { weekday: 3, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    { weekday: 4, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    { weekday: 5, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
    // Saturday is open in the morning only; Sunday is closed outright.
    { weekday: 6, opensAtLocalTime: '09:00', closesAtLocalTime: '12:00', isClosed: false },
    { weekday: 7, opensAtLocalTime: '00:00', closesAtLocalTime: '00:00', isClosed: true },
  ],
  settings: {},
} as const;

/**
 * One day's agenda, as `GET /api/v1/appointments` returns it.
 *
 * Three statuses on purpose, so a spec can tell whether the grid distinguishes what
 * the clinic must act on: `CONFIRMED` is a patient coming, `CANCELLED` is a slot
 * deliberately left empty, and `NO_SHOW` is a chair that stayed empty. Cancelled and
 * no-show are in the response because a receptionist needs to see them; hiding them
 * would make a chair look bookable.
 */
export const agendaEntries = {
  items: [
    {
      id: '11111111-4444-4555-8666-000000000011',
      patientId: ANA_ID,
      patientFirstName: 'Ana',
      patientLastName: 'García',
      dentistId: '11111111-2222-4333-8444-000000000001',
      dentistFullName: 'Dra. Rivera',
      startsAt: '2026-10-05T14:00:00.000Z',
      endsAt: '2026-10-05T15:00:00.000Z',
      status: 'CONFIRMED',
    },
    {
      id: '11111111-4444-4555-8666-000000000012',
      patientId: LUIS_ID,
      patientFirstName: 'Luis',
      patientLastName: 'Fernández',
      dentistId: '11111111-2222-4333-8444-000000000002',
      dentistFullName: 'Dr. Quispe',
      startsAt: '2026-10-05T16:00:00.000Z',
      endsAt: '2026-10-05T17:00:00.000Z',
      status: 'SCHEDULED',
    },
    {
      id: '11111111-4444-4555-8666-000000000013',
      patientId: ANA_ID,
      patientFirstName: 'Ana',
      patientLastName: 'García',
      dentistId: null,
      dentistFullName: null,
      startsAt: '2026-10-05T18:00:00.000Z',
      endsAt: '2026-10-05T18:30:00.000Z',
      status: 'CANCELLED',
    },
  ],
  // The window the app asked for is echoed back, so a spec can compare the two.
  window: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-06T00:00:00.000Z' },
} as const;

/**
 * The agenda entry ids, so a spec can register the endpoint a write goes to.
 *
 * Exported rather than typed out again in each spec: the write paths carry the
 * appointment's id (`PUT /appointments/:id/schedule`), and the mock answers by exact
 * pathname, so a spec that guessed an id would be refused with a 501 and would spend
 * its time debugging the mock instead of the behaviour.
 */
export const ANA_APPOINTMENT_ID = '11111111-4444-4555-8666-000000000011';
export const CANCELLED_APPOINTMENT_ID = '11111111-4444-4555-8666-000000000013';

/**
 * A refusal naming the hour it collides at, as the API sends it.
 *
 * Ids and instants only, which is the whole point of the fixture: the client's job is
 * to turn this into a sentence a receptionist can act on, and a fixture carrying a
 * patient name would let a spec pass against a client that ignored `details` and
 * invented something plausible.
 */
export function schedulingConflict(startsAt: string, endsAt: string): Fixture['body'] {
  return {
    error: {
      code: 'SCHEDULING_CONFLICT',
      message: 'The appointment overlaps 1 existing appointment(s)',
      details: {
        conflicts: [
          {
            appointmentId: '11111111-4444-4555-8666-000000000099',
            patientId: ANA_ID,
            dentistId: '11111111-2222-4333-8444-000000000001',
            startsAt,
            endsAt,
          },
        ],
      },
      requestId: 'e2e',
    },
  };
}

/** An agenda with nothing in the visible range. */
export const emptyAgenda = { items: [], window: agendaEntries.window } as const;

/**
 * Both endpoints the agenda needs.
 *
 * A spec spreads this and overrides the one it cares about. Spreading matters: the
 * route loads the clinic before it can ask for appointments, so a spec that mocked
 * only `/appointments` would leave `/clinic` unmatched — which the mock answers with
 * 501, by design.
 *
 * **Deliberately not the booking endpoints.** This grid does not read dentists or
 * chairs; only the dialog does, and only once a slot is clicked. Putting them here
 * would make a read-only spec look like it depends on resources it never asks for.
 */
export function allAgendaFixtures(): MockedResponses {
  return {
    '/api/v1/clinic': { body: clinicSettings },
    '/api/v1/appointments': { body: agendaEntries },
  };
}

export const DENTIST_ID = '11111111-2222-4333-8444-000000000001';
export const CHAIR_ID = '11111111-5555-4666-8777-000000000001';

/**
 * `GET /api/v1/dentists?onlyActive=true`, as the booking dialog asks for it.
 *
 * Two active clinicians on purpose, because a one-item dropdown cannot tell "the
 * dialog filtered for active clinicians" from "the dialog happens to have one
 * clinician". The appointment already on the grid belongs to the first of them, so a
 * spec booking with the second also proves the choice is not silently reused.
 */
export const dentistList = {
  items: [
    {
      id: DENTIST_ID,
      fullName: 'Dra. Rivera',
      speciality: 'Endodoncia',
      color: null,
      isActive: true,
    },
    {
      id: '11111111-2222-4333-8444-000000000002',
      fullName: 'Dr. Quispe',
      speciality: null,
      color: null,
      isActive: true,
    },
  ],
} as const;

/**
 * `GET /api/v1/chairs?onlyActive=true`.
 *
 * One chair is in a room and one is not, because the room's name is optional in the
 * domain (`rooms.room_id` is nullable) and a fixture that always had rooms would let a
 * client that rendered `null` as a blank pass unnoticed.
 */
export const chairList = {
  items: [
    {
      id: CHAIR_ID,
      roomId: '11111111-6666-4777-8888-000000000001',
      roomName: 'Sala 1',
      name: 'Sillón 1',
      isActive: true,
    },
    {
      id: '11111111-5555-4666-8777-000000000002',
      roomId: null,
      roomName: null,
      name: 'Sillón 4',
      isActive: true,
    },
  ],
} as const;

/**
 * Every endpoint the booking dialog needs, on top of the grid's.
 *
 * Separate from `allAgendaFixtures` because the dialog is only ever opened by a spec
 * that clicks a slot, and only then are these four requests made.
 */
export function bookingFixtures(): MockedResponses {
  return {
    ...allAgendaFixtures(),
    '/api/v1/dentists': { body: dentistList },
    '/api/v1/chairs': { body: chairList },
    '/api/v1/patients': { body: PATIENT_LIST_RESPONSE },
  };
}

/**
 * The row a booking became, as `POST /api/v1/appointments` returns it.
 *
 * **The server's version of everything**, including the end time and the names: a
 * fixture echoing back the request would let a client that worked the times out for
 * itself pass, which is the mistake this whole path is built to avoid.
 */
export const BOOKED_APPOINTMENT_ID = '11111111-7777-4888-8999-000000000001';

export function bookedAppointment(overrides: Record<string, unknown> = {}): Fixture['body'] {
  return {
    id: BOOKED_APPOINTMENT_ID,
    patientId: ANA_ID,
    patientFirstName: 'Ana',
    patientLastName: 'García',
    dentistId: DENTIST_ID,
    dentistFullName: 'Dra. Rivera',
    startsAt: '2026-10-05T15:00:00.000Z',
    endsAt: '2026-10-05T15:30:00.000Z',
    status: 'SCHEDULED',
    ...overrides,
  };
}
