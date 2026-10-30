/**
 * Tests for the booking dialog.
 *
 * The dialog is where the person booking meets the rules the domain holds, so these
 * tests watch three things and nothing else:
 *
 * - **What is required.** A field the API refuses must be impossible to submit blank,
 *   and the sentence the user is shown has to come from the schema the API validates
 *   with, not from a copy of it here.
 * - **What is sent.** The body must be the form's values, with the chair dropped when
 *   the user left it out. The dropdown cannot express "no chair" with an empty string
 *   (Radix reserves it), so there is a sentinel, and a sentinel leaking into a request
 *   is the bug this file is most able to catch.
 * - **What happens when the server says no.** The refusal is displayed. The dialog
 *   does not pre-judge the slot, so a refusal has to be *visible* — swallowing it
 *   would leave a person who clicked at 03:00 with nothing to act on.
 * - **Whose clock the time is.** Opened from the grid the slot is fixed and shown in
 *   the clinic's zone; opened from a profile or the dashboard the person types it, and
 *   what they type is the *clinic's* wall clock, not the machine's. The two are easy to
 *   confuse and expensive to get wrong — a booking an hour or a day out, for everybody
 *   in the room.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Clinic } from '@denti-code-u3/domain';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { I18nProvider, type Locale } from '../../../i18n/index.js';
import { AppointmentBookingDialog } from './appointment-booking-dialog.js';

const BASE_URL = 'http://api.test/api/v1';

/** A Monday morning slot in Lima: 09:00 local is 14:00Z. */
const STARTS_AT = '2026-10-05T14:00:00.000Z';

const CLINIC: Clinic = {
  id: 'clinic-1',
  name: 'Clínica Dental U3',
  legalName: 'Denti-Code U3 S.A.C.',
  timeZone: 'America/Lima',
  currency: 'PEN',
  operatingHours: [
    { weekday: 1, opensAtLocalTime: '08:00', closesAtLocalTime: '13:00', isClosed: false },
  ],
  settings: {},
};

const PATIENT_ID = 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const DENTIST_ID = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5e';
// A v4 uuid, variant nibble included: Zod's `uuid` checks the version *and* the
// variant, and an id that is the right shape but the wrong nibble is refused — which
// is what caught this file using an id it had made up.
const CHAIR_ID = 'c4d5e6f7-8a9b-4c5d-8e7f-8a9b4c5d6e7f';

const PATIENT = {
  id: PATIENT_ID,
  recordNumber: 'OD-0007',
  firstName: 'Ana',
  lastName: 'Torres',
  preferredName: null,
  phone: null,
  email: null,
  birthDate: null,
  isActive: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const DENTIST = {
  id: DENTIST_ID,
  fullName: 'Dra. Rivera',
  speciality: 'Endodoncia',
  isActive: true,
};

const CHAIR = {
  id: CHAIR_ID,
  name: 'Sillón 2',
  roomName: 'Sala 1',
  isActive: true,
};

/** The JSON body of the most recent POST, or `undefined` if none was made. */
function postedBodies(fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>): unknown[] {
  return fetchImplementation.mock.calls
    .filter(([url, init]) => String(url).endsWith('/appointments') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)));
}

/**
 * Answers the four endpoints the dialog touches: the two resource lists, the patient
 * search, and the booking itself. `booking` is what the server does with the body, so
 * a test can accept it or refuse it without stubbing a component.
 */
function renderDialog({
  booking = () =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'appt-9' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  patients = [PATIENT],
  // `STARTS_AT` is the agenda's case — a slot was clicked, so the field starts there
  // and stays editable. Pass `null` for the profile's and the dashboard's case, where
  // nobody has chosen a time and the field starts empty. The distinction is the whole
  // difference between the two doors, so it is a parameter rather than a boolean.
  startsAt = STARTS_AT,
  patient,
  clinic = CLINIC,
  locale = 'en',
}: {
  readonly booking?: (body: unknown) => Promise<Response>;
  readonly patients?: unknown[];
  readonly startsAt?: string | null;
  readonly patient?: { readonly id: string; readonly label: string };
  readonly clinic?: Clinic;
  readonly locale?: Locale;
} = {}) {
  const fetchImplementation = vi.fn<typeof fetch>((url, init) => {
    const href = String(url);

    if (href.includes('/dentists')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [DENTIST] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (href.includes('/chairs')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [CHAIR] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (href.includes('/patients')) {
      return Promise.resolve(
        new Response(JSON.stringify({ items: patients }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (init?.method === 'POST') {
      return booking(JSON.parse(String(init.body)));
    }

    return Promise.resolve(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <I18nProvider initialLocale={locale}>
          <AppointmentBookingDialog
            startsAt={startsAt ?? undefined}
            patient={patient}
            clinic={clinic}
            onClose={onClose}
          />
        </I18nProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, onClose };
}

/** Fills the patient box and picks the only result. */
async function choosePatient(user: UserEvent): Promise<void> {
  const input = await screen.findByRole('combobox', { name: /patient/i });
  await user.type(input, 'Tor');
  await user.click(await screen.findByRole('option', { name: /Ana Torres/ }));
}

/** Picks an option from one of the dialog's Radix selects. */
async function chooseFrom(user: UserEvent, trigger: string, optionName: RegExp): Promise<void> {
  await user.click(screen.getByTestId(trigger));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

async function chooseDateTime(
  user: UserEvent,
  date: string,
  hour: string,
  minute: string,
): Promise<void> {
  fireEvent.change(screen.getByTestId('booking-date'), { target: { value: date } });
  await chooseFrom(user, 'booking-hour', new RegExp(`^${hour}$`));
  await chooseFrom(user, 'booking-minute', new RegExp(`^${minute}$`));
}

describe('AppointmentBookingDialog', () => {
  /**
   * Radix sets `body { pointer-events: none }` while one of its dropdowns is open, and
   * user-event honours it — refusing to click anything afterwards. jsdom never runs the
   * close animation that takes the attribute back off, so the setting survives the
   * interaction that caused it and every later click in the test is refused.
   *
   * The check is turned off rather than the attribute scrubbed between steps: the
   * browser behaviour being asserted here is that the fields can be filled and
   * submitted, and "the dropdown cleaned up after itself in jsdom" is not that.
   */
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup({ pointerEventsCheck: 0 });

    // Radix positions its content with these, and jsdom implements neither. The
    // dialog's own behaviour does not depend on either, so a stub is honest here
    // rather than a workaround.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the booking in Spanish, with the date in Spanish', () => {
    renderDialog({ locale: 'es' });

    expect(screen.getByRole('heading', { name: 'Nueva cita' })).toBeInTheDocument();
    expect(screen.getByText('lun, 5 oct, 09:00 · 09:00 – 09:30')).toBeInTheDocument();
    expect(screen.getByLabelText('Fecha')).toBeInTheDocument();
    expect(screen.getByLabelText('Hora')).toBeInTheDocument();
    expect(screen.getByLabelText('Minuto')).toBeInTheDocument();
    expect(screen.getByText('Odontólogo')).toBeInTheDocument();
    expect(screen.getByText('Sillón')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByText(/hora propia de la clínica, America\/Lima/)).toBeInTheDocument();
  });

  it('shows the clicked slot in the clinic own time', () => {
    renderDialog();

    // 14:00Z is 09:00 in Lima, and the clinic's Monday is 08:00–13:00 local. Rendering
    // this in the browser's own zone would misreport the booking by however many hours
    // the machine running the test happens to be in — so the assertion is on the exact
    // clinic-local string, not on a moment.
    expect(screen.getByText('Mon, Oct 5, 09:00 · 09:00 – 09:30')).toBeInTheDocument();
  });

  it('will not submit without the required fields, and says which are missing', async () => {
    const { fetchImplementation } = renderDialog();

    await user.click(screen.getByTestId('booking-submit'));

    // Both missing fields are named, each in its own live region: a form that said only
    // "something is wrong" would leave the receptionist guessing which box to look at.
    // The clinician select's placeholder reads the same sentence as its error, so the
    // assertion is on the list of announcements rather than on one string.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      'Choose a patient',
      'Choose a clinician',
    ]);
    // Nothing was sent: the form refused before the mutation, not the server.
    expect(postedBodies(fetchImplementation)).toHaveLength(0);
  });

  it('books with the clicked instant, the chosen people, and no chair', async () => {
    const { fetchImplementation, onClose } = renderDialog();

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await user.click(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));

    // The chair was never picked, and "no chair" is an API fact about the body — not a
    // `none` string the server would have to recognise and ignore.
    expect(postedBodies(fetchImplementation)[0]).toEqual({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: STARTS_AT,
      durationMinutes: 30,
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('sends the chair when one is picked, and the notes when they are typed', async () => {
    const { fetchImplementation } = renderDialog();

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await chooseFrom(user, 'booking-duration', /60 min/);
    await chooseFrom(user, 'booking-chair', /Sillón 2/);
    await user.type(screen.getByLabelText(/notes/i), 'Traer radiografía');
    await user.click(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    expect(postedBodies(fetchImplementation)[0]).toEqual({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: STARTS_AT,
      durationMinutes: 60,
      chairId: CHAIR_ID,
      notes: 'Traer radiografía',
    });
  });

  it('shows the refusal when the server refuses the slot', async () => {
    // The dialog checks nothing itself, so a domain refusal is the only thing that will
    // ever tell the user this slot cannot be booked.
    const { onClose } = renderDialog({
      booking: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'DOMAIN_RULE_VIOLATION',
                message: 'The clinic opens at 08:00 on 2026-10-05',
                // Required by the envelope: without it the client cannot tell a
                // refusal from a proxy that rewrote the body, and says so instead.
                requestId: 'req-1',
              },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await user.click(screen.getByTestId('booking-submit'));

    expect(await screen.findByTestId('booking-error')).toHaveTextContent(
      /the clinic opens at 08:00/i,
    );
    // Staying open is the point: the person has to correct the slot or the details,
    // and a dialog that vanished on failure would take their typing with it.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts from the clicked slot, and still lets the hour be changed', async () => {
    const { fetchImplementation } = renderDialog();

    // Pre-filled rather than locked: the click decides where the typing starts, not
    // where it stops. The month view names only a day, and a mistyped lane is
    // corrected here rather than by closing the dialog and starting over.
    const date = screen.getByTestId('booking-date');
    expect(date).toHaveValue('2026-10-05');
    expect(date).not.toHaveAttribute('readonly');
    expect(screen.getByTestId('booking-hour')).toHaveTextContent('09');
    expect(screen.getByTestId('booking-minute')).toHaveTextContent('00');
    expect(screen.getByText(/from the slot you clicked/i)).toBeInTheDocument();

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await chooseDateTime(user, '2026-10-05', '10', '30');
    await user.click(screen.getByTestId('booking-submit'));

    // The hour the person chose, not the one the slot happened to hold.
    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    expect(postedBodies(fetchImplementation)[0]).toMatchObject({
      // 10:30 in Lima is 15:30Z — the slot said 14:00Z and was overridden.
      startsAt: '2026-10-05T15:30:00.000Z',
    });
  });

  it('opens with an empty, editable time when no slot was clicked', () => {
    renderDialog({ startsAt: null });

    // Nothing here can answer "when", so the field is the person's. Empty rather than
    // filled with a guess: a dialog that defaults to an hour nobody chose is a booking
    // nobody made.
    expect(screen.getByTestId('booking-date')).toHaveValue('');
    expect(screen.getByTestId('booking-hour')).toHaveTextContent('--');
    expect(screen.getByTestId('booking-minute')).toHaveTextContent('--');
  });

  it('says whose clock the typed time is in, since a bare wall clock is ambiguous', () => {
    renderDialog({ startsAt: null });

    expect(screen.getByText(/america\/lima/i)).toBeInTheDocument();
  });

  it('will not submit without a time, and says so on the field', async () => {
    const { fetchImplementation } = renderDialog({ startsAt: null });

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await user.click(screen.getByTestId('booking-submit'));

    // The third required field, and it fails on its own: the other two can be filled
    // while the person reads this sentence.
    expect(await screen.findByText('Choose a date and time')).toBeInTheDocument();
    expect(postedBodies(fetchImplementation)).toHaveLength(0);
  });

  it('reads the typed time as the clinic clock, not the machine clock', async () => {
    const { fetchImplementation } = renderDialog({ startsAt: null });

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await chooseDateTime(user, '2026-10-05', '09', '00');
    await user.click(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));

    // 09:00 in Lima is 14:00Z. Anything else would mean the booking moved by whatever
    // offset the machine running the tests happens to have — which for a receptionist
    // abroad is the whole day.
    expect(postedBodies(fetchImplementation)[0]).toEqual({
      patientId: PATIENT_ID,
      dentistId: DENTIST_ID,
      startsAt: STARTS_AT,
      durationMinutes: 30,
    });
  });

  it('refuses a wall clock the zone skipped over, and books nothing', async () => {
    // A clinic in New York on 8 March 2026, the morning the clocks jump from 02:00 to
    // 03:00. 02:30 is a string every other library will happily turn into 03:30.
    const { fetchImplementation } = renderDialog({
      startsAt: null,
      clinic: { ...CLINIC, timeZone: 'America/New_York' },
    });

    await choosePatient(user);
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await chooseDateTime(user, '2026-03-08', '02', '30');
    await user.click(screen.getByTestId('booking-submit'));

    // The only check the dialog makes itself, and it names the zone so the person can
    // see which clock refused them.
    expect(
      await screen.findByText(/does not exist on that date in America\/New_York/i),
    ).toBeInTheDocument();
    expect(postedBodies(fetchImplementation)).toHaveLength(0);
  });

  it('names the patient it was opened for, and books them without a search', async () => {
    const { fetchImplementation } = renderDialog({
      startsAt: null,
      patient: { id: PATIENT_ID, label: 'Ana Torres' },
    });

    // Opened from Ana's profile: the title says whose it is, and the picker shows her
    // rather than an empty box to search. Prefilled and not locked — a person who
    // opened it for the wrong patient can pick the right one instead of closing it.
    expect(
      screen.getByRole('heading', { name: /new appointment for ana torres/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /patient/i })).toHaveValue('Ana Torres');

    await chooseDateTime(user, '2026-10-05', '09', '00');
    await chooseFrom(user, 'booking-dentist', /Dra\. Rivera/);
    await user.click(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(postedBodies(fetchImplementation)).toHaveLength(1));
    expect(postedBodies(fetchImplementation)[0]).toMatchObject({ patientId: PATIENT_ID });
  });

  it('asks for the active clinicians and chairs only', async () => {
    const { fetchImplementation } = renderDialog();

    // The convenience, not the rule: both lists ask for `onlyActive`, so a clinician
    // who has left is not offered. The API still enforces it, and this test only claims
    // the dropdown agrees with it — not that it is what makes the booking safe.
    await waitFor(() => {
      const urls = fetchImplementation.mock.calls.map(([url]) => String(url));
      expect(urls.filter((href) => href.includes('onlyActive=true'))).toHaveLength(2);
    });
  });
});
