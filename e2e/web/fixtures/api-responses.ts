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

/** The open visit the workspace specs open directly, by id. */
export const VISIT_ID = '11111111-7777-4888-8999-000000000041';

/**
 * Ana's closed visit — the one her profile's "Recent visits" card links to.
 *
 * A different id from the open one on purpose: the profile is a *history*, so the
 * visit it names is already finished, and a spec that followed the link into an open
 * visit would be asserting a fixture that could never be produced by the API.
 */
export const COMPLETED_VISIT_ID = '11111111-7777-4888-8999-000000000042';

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
      id: COMPLETED_VISIT_ID,
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

/**
 * The clinic's settings, for any spec that renders a patient profile.
 *
 * **The profile asks for it now, so every such spec has to mock it.** The profile draws
 * its times in the clinic's zone and can open the booking dialog, and both need the
 * clinic row. A spec that forgets gets a 501 from the mock and a console error — which
 * is the mock working: this helper exists so the omission is a missing import rather
 * than a test that fails for a reason three files away from the change.
 */
export function clinicFixture(): MockedResponses {
  return { '/api/v1/clinic': { body: clinicSettings } };
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
 * Every endpoint the agenda needs.
 *
 * A spec spreads this and overrides the one it cares about. Spreading matters: the
 * route loads the clinic before it can ask for appointments, so a spec that mocked
 * only `/appointments` would leave `/clinic` unmatched — which the mock answers with
 * 501, by design.
 *
 * **The clinicians and chairs are here because the grid reads them**, not the dialog.
 * The filter bar is mounted by the calendar itself, so `/agenda` asks for both lists
 * on load whether or not a slot is ever clicked — which is why this comment used to
 * claim the opposite, and why every read-only agenda spec failed with a 501 the moment
 * the bar was added. The lists are the *full* ones, because the bar's question is
 * "what did their day look like" and a clinician who has left is still filterable.
 * `bookingFixtures` overrides both with the active-only lists the dialog wants.
 */
export function allAgendaFixtures(): MockedResponses {
  return {
    '/api/v1/clinic': { body: clinicSettings },
    '/api/v1/appointments': { body: agendaEntries },
    '/api/v1/dentists': { body: everyDentistList },
    '/api/v1/chairs': { body: everyChairList },
  };
}

export const DENTIST_ID = '11111111-2222-4333-8444-000000000001';
export const CHAIR_ID = '11111111-5555-4666-8777-000000000001';

/** The clinician who has left the clinic, and is still on the agenda's fixtures. */
export const DEPARTED_DENTIST_ID = '11111111-2222-4333-8444-000000000003';

/**
 * Every clinician, active or not, as the agenda's filter bar asks for them
 * (`?onlyActive=false`).
 *
 * Three rows on purpose. The departed one is the whole argument for the full list: a
 * bar that hid them would make "what did Dr. Quispe's day look like" unanswerable
 * while the grid still draws their appointments. `color` is a hex triplet on the first
 * and `null` on the second, so a spec can see a swatch on one chip and not the other —
 * the column is unvalidated text, which is why the component only paints it after
 * checking the shape.
 */
export const everyDentistList = {
  items: [
    {
      id: DENTIST_ID,
      fullName: 'Dra. Rivera',
      speciality: 'Endodoncia',
      color: '#0ea5e9',
      isActive: true,
    },
    {
      id: '11111111-2222-4333-8444-000000000002',
      fullName: 'Dr. Quispe',
      speciality: null,
      color: null,
      isActive: true,
    },
    {
      id: DEPARTED_DENTIST_ID,
      fullName: 'Dr. Núñez',
      speciality: null,
      color: null,
      isActive: false,
    },
  ],
} as const;

/** Every chair, active or not, as the agenda's filter bar asks for them. */
export const everyChairList = {
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
    {
      id: '11111111-5555-4666-8777-000000000003',
      roomId: '11111111-6666-4777-8888-000000000002',
      roomName: 'Sala 2',
      name: 'Sillón 9',
      isActive: false,
    },
  ],
} as const;

/**
 * `GET /api/v1/dentists?onlyActive=true`, as the booking dialog asks for it.
 *
 * Two active clinicians on purpose, because a one-item dropdown cannot tell "the
 * dialog filtered for active clinicians" from "the dialog happens to have one
 * clinician". The appointment already on the grid belongs to the first of them, so a
 * spec booking with the second also proves the choice is not silently reused.
 *
 * The mock keys on the method and the pathname, never on the query string, so this
 * list also answers the filter bar's `?onlyActive=false` request in any spec that
 * registers it. That is harmless — the two callers differ in what they *ask*, and
 * `booking.spec.ts` asserts the query string rather than the contents of the answer —
 * but it does mean a departed clinician cannot be in a booking spec's fixtures.
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

/**
 * An open visit, as `GET /api/v1/visits/:visitId` answers for it.
 *
 * Ids only, exactly as the API sends them: the workspace's whole job is to turn
 * `dentistId` and `chairId` into names, and a fixture carrying `Dra. Rivera` would
 * let a spec pass against a client that rendered the raw uuid or invented a label.
 * The names are resolved against `everyDentistList` and `everyChairList`, which is
 * also what makes those lookups testable from here.
 */
export const openVisit = {
  id: VISIT_ID,
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  dentistId: DENTIST_ID,
  appointmentId: ANA_APPOINTMENT_ID,
  chairId: CHAIR_ID,
  startedAt: '2026-10-06T13:05:00.000Z',
  status: 'OPEN',
} as const;

/**
 * Ana's finished visit — the same row her profile reports under "Recent visits",
 * times and summary included, so a spec that follows the link sees the history it
 * just read rather than a second account of it.
 */
export const completedVisit = {
  id: COMPLETED_VISIT_ID,
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  dentistId: DENTIST_ID,
  appointmentId: ANA_APPOINTMENT_ID,
  chairId: CHAIR_ID,
  startedAt: '2026-09-11T20:09:00.000Z',
  endedAt: '2026-09-11T20:54:00.000Z',
  status: 'COMPLETED',
  summary: 'Composite restoration on tooth 16.',
} as const;

/**
 * A note already on the open visit, as `GET /api/v1/visits/:visitId/notes` answers
 * for it.
 *
 * `authorId` is null because the API writes it that way — there is no user model to
 * attribute a note to yet — and a fixture that invented an author would let a spec
 * pass against a client that rendered one.
 */
export const visitNote = {
  id: '11111111-7777-4888-8999-000000000043',
  visitId: VISIT_ID,
  authorId: null,
  body: 'Sensitivity reported on the upper right quadrant.',
  createdAt: '2026-10-05T13:00:00.000Z',
} as const;

/**
 * The note a spec writes, and the row the API answers the POST with.
 *
 * Its `id` and `createdAt` are the server's, not the client's: a spec asserting that
 * the second list shows *this* row is asserting that the refetch is what put it on
 * screen, because nothing in the browser could have produced those two values.
 */
export const filedNote = {
  id: '11111111-7777-4888-8999-000000000044',
  visitId: VISIT_ID,
  authorId: null,
  body: 'Referred for endodontic assessment.',
  createdAt: '2026-10-05T13:00:00.000Z',
} as const;

/**
 * The catalogue of procedures this clinic offers, as `GET /api/v1/treatments`
 * answers for it.
 *
 * One item carries a code and one does not, because the picker must be able to draw
 * both — a fixture where every row had a code would let a client that joined the
 * code into the label pass against a catalogue that is half-null.
 */
export const TREATMENT_CATALOGUE_ID = '11111111-aaaa-4999-8ccc-000000000001';
export const PROPHYLAXIS_TREATMENT_ID = '11111111-aaaa-4999-8ccc-000000000002';

export const treatmentsCatalogue = {
  items: [
    {
      id: TREATMENT_CATALOGUE_ID,
      code: 'COMPO-ANT',
      name: 'Composite restoration — anterior',
      description: 'Restores a tooth’s shape and function.',
      defaultDurationMinutes: 45,
      defaultPriceMinor: 30000,
      isActive: true,
    },
    {
      id: PROPHYLAXIS_TREATMENT_ID,
      code: null,
      name: 'Scaling and prophylaxis',
      description: null,
      defaultDurationMinutes: 30,
      defaultPriceMinor: 0,
      isActive: true,
    },
  ],
} as const;

/**
 * What was already done on the open visit, as
 * `GET /api/v1/visits/:visitId/treatments` answers for it.
 *
 * The record carries only the treatment's `id`; the name a spec sees on screen is
 * resolved against the catalogue, which is exactly the join the workspace performs.
 * `performedAt` is 13:00Z so a spec can read the clinic's hour (08:00 in Lima) off
 * the row, the same clock the notes specs read their timestamps from.
 */
export const existingVisitTreatment = {
  id: '11111111-cccc-4ddd-8eee-000000000001',
  visitId: VISIT_ID,
  treatmentId: TREATMENT_CATALOGUE_ID,
  tooth: '16',
  notes: 'Composite placed on 16, exploring sensitivity.',
  performedAt: '2026-10-05T13:00:00.000Z',
} as const;

/**
 * The row a spec writes, and the row the API answers the POST with.
 *
 * Its `id` and `performedAt` are the server's, not the client's: a spec asserting
 * that the list shows *this* row is asserting that the refetch is what put it on
 * screen, because nothing in the browser could have produced those two values.
 */
export const recordedTreatment = {
  id: '11111111-cccc-4ddd-8eee-000000000002',
  visitId: VISIT_ID,
  treatmentId: PROPHYLAXIS_TREATMENT_ID,
  tooth: '26',
  notes: 'Full-mouth cleaning.',
  performedAt: '2026-10-05T13:35:00.000Z',
} as const;

export function visitTreatments(treatments: readonly Record<string, unknown>[]): Fixture['body'] {
  return { treatments };
}

/**
 * A prescription already on the open visit, as
 * `GET /api/v1/visits/:visitId/prescriptions` answers for it.
 *
 * The row carries ids and an instant (`patientId`, `dentistId`, `issuedAt`); the
 * names a spec sees on screen are resolved by the workspace, and `issuedAt` is 13:00Z
 * so a spec can read the clinic's hour (08:00 in Lima) off the row — the same clock
 * the notes and treatments specs read their timestamps from.
 */
export const visitPrescription = {
  id: '11111111-cccc-4ddd-8eee-000000000003',
  visitId: VISIT_ID,
  patientId: ANA_ID,
  dentistId: DENTIST_ID,
  issuedAt: '2026-10-05T13:00:00.000Z',
  medication: 'Ibuprofen',
  dosage: '400 mg',
  route: 'ORAL',
  frequency: 'Every 8 hours as needed',
  durationDays: 5,
  instructions: 'Take after meals.',
} as const;

/**
 * The row a spec writes, and the row the API answers the POST with.
 *
 * Its `id` and `issuedAt` are the server's, not the client's: a spec asserting that
 * the list shows *this* row is asserting that the refetch is what put it on screen,
 * because nothing in the browser could have produced those two values.
 */
export const filedPrescription = {
  id: '11111111-cccc-4ddd-8eee-000000000004',
  visitId: VISIT_ID,
  patientId: ANA_ID,
  dentistId: DENTIST_ID,
  issuedAt: '2026-10-05T13:35:00.000Z',
  medication: 'Amoxicillin',
  dosage: '500 mg',
  route: 'ORAL',
  frequency: 'Every 12 hours',
  durationDays: 7,
  instructions: 'Complete the whole course.',
} as const;

export function visitPrescriptions(
  prescriptions: readonly Record<string, unknown>[],
): Fixture['body'] {
  return { prescriptions };
}

/**
 * A charge already on the open visit, as
 * `GET /api/v1/visits/:visitId/charges` answers for it.
 *
 * Priced in the clinic's currency, with no invoice yet.
 */
export const visitCharge = {
  id: '11111111-cccc-4ddd-8eee-000000000005',
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  visitId: VISIT_ID,
  invoiceId: null,
  invoicedAt: null,
  createdAt: '2026-10-05T13:10:00.000Z',
  treatmentId: null,
  description: 'Composite restoration',
  quantity: 1,
  unitPriceMinor: 8500,
  discountMinor: 0,
  taxRatePercent: 0,
  currency: 'USD',
} as const;

/**
 * The row a spec writes, and the row the API answers the POST with.
 *
 * Its `id` and `createdAt` are the server's, not the client's.
 */
export const raisedCharge = {
  id: '11111111-cccc-4ddd-8eee-000000000006',
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  visitId: VISIT_ID,
  invoiceId: null,
  invoicedAt: null,
  createdAt: '2026-10-05T13:35:00.000Z',
  treatmentId: null,
  description: 'Composite',
  quantity: 2,
  unitPriceMinor: 8500,
  discountMinor: 0,
  taxRatePercent: 0,
  currency: 'USD',
} as const;

export function visitCharges(charges: readonly Record<string, unknown>[]): Fixture['body'] {
  return { charges };
}

/**
 * The charge a settlement folds into an invoice — the state a visit's charges hold
 * once a payment has landed.
 *
 * The settlement's promise is that the charges list the invalidation refetches
 * answers with every row stamped invoiced. A payments spec swaps this in after the
 * write, so the "settled" sentence on screen can only have come from that refetch.
 */
export const invoicedCharge = {
  ...visitCharge,
  invoiceId: '11111111-eeee-4fff-8aaa-000000000001',
  invoicedAt: '2026-10-05T13:20:00.000Z',
} as const;

/**
 * A payment already on the open visit, as `GET /api/v1/visits/:visitId/payments`
 * answers for it.
 *
 * The full row, `reference`, `method` and all: the row a spec sees on screen is the
 * row the endpoint holds. `receivedAt` is 13:20Z so a spec can read the clinic's
 * hour (08:20 in Lima) off the register — the same clock every other row reads.
 */
export const visitPayment = {
  id: '11111111-cccc-4ddd-8eee-000000000007',
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  method: 'CARD',
  currency: 'USD',
  amountMinor: 8500,
  reference: '4242',
  receivedAt: '2026-10-05T13:20:00.000Z',
} as const;

/**
 * The row a spec writes, and the row the API answers the POST with.
 *
 * Its `id` and `receivedAt` are the server's, not the client's: a spec asserting
 * that the register shows *this* row is asserting that the refetch is what put it
 * on screen, because nothing in the browser could have produced those two values.
 */
export const recordedPayment = {
  id: '11111111-cccc-4ddd-8eee-000000000008',
  clinicId: '11111111-1111-4111-8111-111111111111',
  patientId: ANA_ID,
  method: 'CASH',
  currency: 'USD',
  amountMinor: 5500,
  reference: null,
  receivedAt: '2026-10-05T13:45:00.000Z',
} as const;

export function visitPayments(payments: readonly Record<string, unknown>[]): Fixture['body'] {
  return { payments };
}
/**
 * The section reads — `/notes`, `/treatments`, `/prescriptions`, `/charges`,
 * `/payments` — are *not* here, for the stronger reason that they must not happen
 * at all until their section is opened. Each spec registers the one it needs, so
 * an over-eager client draws a 501 instead of a silently-mocked row.
 *
 * The `overrides` argument comes last so a spec can replace one answer — the 409
 * refusal, a 404 for a visit this clinic does not hold — without restating the rest.
 */
export function visitWorkspaceFixtures(overrides: MockedResponses = {}): MockedResponses {
  return {
    [`/api/v1/visits/${VISIT_ID}`]: { body: openVisit },
    [`/api/v1/visits/${COMPLETED_VISIT_ID}`]: { body: completedVisit },
    [`/api/v1/patients/${ANA_ID}`]: { body: anaProfile },
    '/api/v1/clinic': { body: clinicSettings },
    '/api/v1/dentists': { body: everyDentistList },
    '/api/v1/chairs': { body: everyChairList },
    ...overrides,
  };
}
