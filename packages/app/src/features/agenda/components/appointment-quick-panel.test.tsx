/**
 * Tests for the quick panel.
 *
 * What is being pinned down is the panel's honesty about what may be done next: the
 * buttons on screen come from the domain's own transition table, a cancellation asks
 * for a reason before it sends one, and a refusal is shown rather than swallowed.
 *
 * The panel is rendered with a real `ApiClient` and a stub `fetch`, so the request it
 * builds is asserted as it goes over the wire — a panel that shows the right buttons
 * and sends the wrong body is the failure this is here to catch.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  allowedAppointmentTransitions,
  type AgendaEntry,
  type AppointmentProgressEntry,
  type Clinic,
} from '@denti-code-u3/domain';
import { asAppointmentId, asChairId, asDentistId, asPatientId } from '@denti-code-u3/types';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { I18nProvider, type Locale } from '../../../i18n/index.js';
import { AppointmentQuickPanel } from './appointment-quick-panel.js';

const BASE_URL = 'http://api.test/api/v1';

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

const ENTRY: AgendaEntry = {
  id: asAppointmentId('appt-1'),
  clinicId: 'clinic-1' as AgendaEntry['clinicId'],
  patientId: asPatientId('pat-1'),
  patientFirstName: 'Ana',
  patientLastName: 'Torres',
  dentistId: asDentistId('den-1'),
  dentistFullName: 'Dra. Rivera',
  chairId: asChairId('chair-1'),
  chairName: 'Sillón 1',
  startsAt: '2026-10-05T14:00:00.000Z' as AgendaEntry['startsAt'],
  endsAt: '2026-10-05T15:00:00.000Z' as AgendaEntry['endsAt'],
  durationMinutes: 60,
  status: 'CONFIRMED',
  notes: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPanel({
  entry = ENTRY,
  reply,
  progress = [],
  plans = [],
  onClose = vi.fn(),
  onVisitStarted = vi.fn(),
  locale = 'en',
}: {
  readonly entry?: AgendaEntry;
  readonly reply?: () => Promise<Response>;
  readonly progress?: readonly AppointmentProgressEntry[];
  readonly plans?: readonly Record<string, unknown>[];
  readonly onClose?: () => void;
  readonly onVisitStarted?: (started: {
    readonly visitId: string;
    readonly treatmentPlanItemId?: string;
  }) => void;
  readonly locale?: Locale;
} = {}) {
  const fetchImplementation = vi.fn<typeof fetch>((input) => {
    if (String(input).endsWith('/progress')) {
      return Promise.resolve(json({ items: progress }));
    }
    if (String(input).endsWith('/treatment-plans')) {
      return Promise.resolve(json({ items: plans }));
    }
    return (reply ?? (() => Promise.resolve(json({ ...entry, status: 'ARRIVED' }))))();
  });
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <I18nProvider initialLocale={locale}>
          <AppointmentQuickPanel
            entry={entry}
            clinic={CLINIC}
            onClose={onClose}
            onVisitStarted={onVisitStarted}
          />
        </I18nProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, onClose, onVisitStarted };
}

function writes(fetchImplementation: ReturnType<typeof vi.fn>) {
  return fetchImplementation.mock.calls.filter(
    ([, init]) => init?.method === 'POST' || init?.method === 'PUT',
  );
}

/** The body of the nth write, as JSON. Progress reads are not writes. */
function sentBody(fetchImplementation: ReturnType<typeof vi.fn>, index = 0): unknown {
  const call = writes(fetchImplementation)[index];
  if (!call) throw new Error(`Expected a write number ${index + 1}`);
  return JSON.parse(String(call[1]?.body));
}

describe('AppointmentQuickPanel', () => {
  it('names the status, the moves and the times in Spanish', () => {
    renderPanel({ locale: 'es' });

    expect(screen.getByText('Confirmada')).toBeTruthy();
    expect(screen.getByText(/09:00 – 10:00/)).toBeTruthy();
    expect(screen.getByText('Odontólogo')).toBeTruthy();
    expect(screen.getByText('Sillón')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Registrar llegada' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('says who is coming, when, and for how long — in the clinic timezone', () => {
    renderPanel();

    expect(screen.getByText('Ana Torres')).toBeTruthy();
    // 14:00Z is 09:00 in Lima. A panel quoting 14:00 would be quoting the server's
    // storage, not the clinic's day.
    expect(screen.getByText('09:00 – 10:00 · 60 min')).toBeTruthy();
    expect(screen.getByText('Dra. Rivera')).toBeTruthy();
    expect(screen.getByText('Sillón 1')).toBeTruthy();
  });

  it('names an appointment with no chair rather than leaving a blank', () => {
    renderPanel({ entry: { ...ENTRY, chairId: null, chairName: null } });

    expect(screen.getByText('No chair assigned')).toBeTruthy();
  });

  it('offers exactly the transitions the domain allows', () => {
    renderPanel();

    // CONFIRMED may be unconfirmed, checked in, cancelled or marked a no-show, and
    // nothing else — not "completed", because the patient has not been treated. The
    // list is the domain's, so the API's use case and this panel cannot disagree.
    for (const to of allowedAppointmentTransitions('CONFIRMED')) {
      expect(screen.getByTestId(`transition-${to}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('transition-COMPLETED')).toBeNull();
  });

  it('offers a completed appointment nothing to do', () => {
    renderPanel({ entry: { ...ENTRY, status: 'COMPLETED' } });

    // A row of empty buttons reads as a panel that failed to load. Saying it is
    // history is the truth, and it is the domain's truth: COMPLETED has no exits.
    expect(screen.getByText(/This appointment is finished/)).toBeTruthy();
    expect(screen.queryByTestId('transition-ARRIVED')).toBeNull();
  });

  it('records the arrival at the time the receptionist chose, then closes', async () => {
    const user = userEvent.setup();
    const { fetchImplementation, onClose } = renderPanel();

    await user.click(screen.getByTestId('transition-ARRIVED'));
    await user.click(screen.getByTestId('confirm-recording'));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    const [url, init] = writes(fetchImplementation)[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/appointments/appt-1/status`);
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImplementation)).toMatchObject({ to: 'ARRIVED' });
    expect(sentBody(fetchImplementation)).toHaveProperty('occurredAt');

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('accepts a different arrival time instead of the current one', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-ARRIVED'));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-05' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:15' } });
    await user.click(screen.getByTestId('confirm-recording'));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    expect(sentBody(fetchImplementation)).toEqual({
      to: 'ARRIVED',
      occurredAt: '2026-10-05T14:15:00.000Z',
    });
  });

  it('asks why before it cancels, and sends the reason', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-CANCELLED'));

    // Cancelling is the one move that cannot be undone by re-booking the slot, so the
    // first click asks rather than sends.
    expect(writes(fetchImplementation)).toHaveLength(0);

    await user.type(
      screen.getByLabelText('Why is it being cancelled?'),
      'The patient called to cancel',
    );
    await user.click(screen.getByTestId('confirm-cancellation'));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    expect(sentBody(fetchImplementation)).toEqual({
      to: 'CANCELLED',
      reason: 'The patient called to cancel',
    });
  });

  it('will not let a cancellation through without a reason', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-CANCELLED'));

    // Disabled rather than sending an empty reason: the domain demands one, and a 422
    // naming a field is a worse answer than a button that will not press. `reason: ''`
    // would sail past that check and record a cancellation with a blank explanation.
    expect(screen.getByTestId('confirm-cancellation')).toBeDisabled();

    await user.type(screen.getByLabelText('Why is it being cancelled?'), '   ');
    expect(screen.getByTestId('confirm-cancellation')).toBeDisabled();

    expect(writes(fetchImplementation)).toHaveLength(0);
  });

  it('lets the receptionist back out of cancelling', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-CANCELLED'));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    // Back to the other moves, with nothing sent and nothing lost.
    expect(writes(fetchImplementation)).toHaveLength(0);
    expect(screen.getByTestId('transition-ARRIVED')).toBeTruthy();
  });

  it('does not ask for a reason when checking a patient in', () => {
    renderPanel();

    // An empty text box under every status would be asking for a reason to check
    // someone in — and almost every status can be cancelled.
    expect(screen.queryByLabelText('Why is it being cancelled?')).toBeNull();
  });

  it('says which hour is taken when the move is refused', async () => {
    const user = userEvent.setup();
    renderPanel({
      entry: { ...ENTRY, status: 'ARRIVED' },
      reply: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'SCHEDULING_CONFLICT',
                message: 'The appointment overlaps 1 existing appointment(s)',
                details: {
                  conflicts: [
                    {
                      appointmentId: '99999999-9999-4999-8999-999999999999',
                      patientId: '88888888-8888-4888-8888-888888888888',
                      dentistId: '77777777-7777-4777-8777-777777777777',
                      startsAt: '2026-10-05T16:00:00.000Z',
                      endsAt: '2026-10-05T17:00:00.000Z',
                    },
                  ],
                },
                requestId: 'req-1',
              },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await user.click(screen.getByTestId('transition-IN_TREATMENT'));
    await user.click(screen.getByTestId('confirm-recording'));

    // 16:00Z is 11:00 in Lima, and this is the sentence that tells the receptionist
    // which block to go and look at.
    expect(await screen.findByRole('alert')).toHaveTextContent('11:00 – 12:00');
  });

  it('keeps the panel open when the write is refused', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel({
      reply: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'A cancellation must say why',
                requestId: 'req-1',
              },
            }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });

    await user.click(screen.getByTestId('transition-CANCELLED'));
    await user.type(screen.getByLabelText('Why is it being cancelled?'), 'No idea yet');
    await user.click(screen.getByTestId('confirm-cancellation'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Closing on failure would throw away the reason the user just typed and leave
    // them to type it again.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the buttons while a write is in flight', async () => {
    const user = userEvent.setup();
    renderPanel({
      reply: () =>
        // Held open, so the pending state is observable rather than a race.
        new Promise<Response>(() => {}),
    });

    await user.click(screen.getByTestId('transition-ARRIVED'));
    await user.click(screen.getByTestId('confirm-recording'));

    await waitFor(() => expect(screen.getByTestId('confirm-recording')).toBeDisabled());
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('shows every recorded move and its time', async () => {
    renderPanel({
      progress: [
        {
          fromStatus: 'CONFIRMED',
          toStatus: 'ARRIVED',
          occurredAt: '2026-10-05T14:07:00.000Z',
          reason: null,
        },
        {
          fromStatus: 'ARRIVED',
          toStatus: 'CANCELLED',
          occurredAt: '2026-10-05T14:20:00.000Z',
          reason: 'The patient felt unwell',
        },
      ],
    });

    expect(await screen.findByText('Confirmed → Arrived')).toBeTruthy();
    expect(screen.getByText(/09:07/)).toBeTruthy();
    expect(screen.getByText('Arrived → Cancelled')).toBeTruthy();
    expect(screen.getByText('The patient felt unwell')).toBeTruthy();
  });

  it('moves the appointment 30 minutes later', async () => {
    const user = userEvent.setup();
    const { fetchImplementation, onClose } = renderPanel();

    await user.click(screen.getByTestId('reschedule-30'));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    const [url, init] = writes(fetchImplementation)[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/appointments/appt-1/schedule`);
    expect(init?.method).toBe('PUT');
    expect(sentBody(fetchImplementation)).toEqual({ startsAt: '2026-10-05T14:30:00.000Z' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('moves the appointment to a custom clinic time', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('reschedule-custom'));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-06' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '11:00' } });
    await user.click(screen.getByTestId('confirm-reschedule'));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    expect(sentBody(fetchImplementation)).toEqual({ startsAt: '2026-10-06T16:00:00.000Z' });
  });

  it('does not offer a reschedule once the patient has arrived', () => {
    renderPanel({ entry: { ...ENTRY, status: 'ARRIVED' } });

    expect(screen.queryByTestId('reschedule-30')).toBeNull();
    expect(screen.queryByTestId('reschedule-custom')).toBeNull();
  });

  it('shows the notes the appointment carries', () => {
    renderPanel({ entry: { ...ENTRY, notes: 'Bring the crown from the lab' } });

    expect(screen.getByText('Bring the crown from the lab')).toBeTruthy();
  });

  it("shows the patient's open planned treatments once the patient has arrived", async () => {
    renderPanel({
      entry: { ...ENTRY, status: 'ARRIVED' },
      plans: [
        {
          id: 'plan-1',
          dentistId: null,
          status: 'ACCEPTED',
          title: 'Restorative plan',
          notes: null,
          presentedAt: null,
          acceptedAt: null,
          updatedAt: '2026-10-01T12:00:00.000Z',
          progress: { total: 2, completed: 0, percentComplete: 0 },
          items: [
            {
              id: 'item-not-started',
              treatmentId: 'treatment-1',
              treatmentCode: 'RESINA',
              treatmentName: 'Composite filling',
              tooth: '16',
              surfaces: [],
              quantity: 1,
              estimatedPriceMinor: 10000,
              isCompleted: false,
              completedAt: null,
              notes: null,
              sessions: [],
            },
            {
              id: 'item-in-progress',
              treatmentId: 'treatment-2',
              treatmentCode: 'ENDO',
              treatmentName: 'Root canal',
              tooth: '24',
              surfaces: [],
              quantity: 1,
              estimatedPriceMinor: 20000,
              isCompleted: false,
              completedAt: null,
              notes: null,
              sessions: [
                {
                  id: 'session-1',
                  visitId: 'visit-old',
                  tooth: '24',
                  notes: null,
                  performedAt: '2026-10-04T15:00:00.000Z',
                  endedAt: '2026-10-04T15:45:00.000Z',
                },
              ],
            },
            {
              id: 'item-completed',
              treatmentId: 'treatment-3',
              treatmentCode: 'PROFILAXIS',
              treatmentName: 'Cleaning',
              tooth: null,
              surfaces: [],
              quantity: 1,
              estimatedPriceMinor: 5000,
              isCompleted: true,
              completedAt: '2026-10-01T12:00:00.000Z',
              notes: null,
              sessions: [],
            },
          ],
        },
      ],
    });

    const section = await screen.findByTestId('agenda-planned-treatments');
    await waitFor(() => expect(section).toHaveTextContent('Composite filling'));
    expect(section).toHaveTextContent('Root canal');
    expect(within(section).getByText('In progress')).toBeTruthy();
    expect(within(section).getByText('Not started')).toBeTruthy();
    expect(within(section).queryByText('Cleaning')).toBeNull();
    expect(within(section).getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('starts the visit for the chosen planned line and opens its workspace', async () => {
    const user = userEvent.setup();
    const { fetchImplementation, onVisitStarted } = renderPanel({
      entry: { ...ENTRY, status: 'ARRIVED' },
      plans: [
        {
          id: 'plan-1',
          dentistId: null,
          status: 'ACCEPTED',
          title: 'Restorative plan',
          notes: null,
          presentedAt: null,
          acceptedAt: null,
          updatedAt: '2026-10-01T12:00:00.000Z',
          progress: { total: 1, completed: 0, percentComplete: 0 },
          items: [
            {
              id: 'item-in-progress',
              treatmentId: 'treatment-2',
              treatmentCode: 'ENDO',
              treatmentName: 'Root canal',
              tooth: '24',
              surfaces: [],
              quantity: 1,
              estimatedPriceMinor: 20000,
              isCompleted: false,
              completedAt: null,
              notes: null,
              sessions: [
                {
                  id: 'session-1',
                  visitId: 'visit-old',
                  tooth: '24',
                  notes: null,
                  performedAt: '2026-10-04T15:00:00.000Z',
                  endedAt: '2026-10-04T15:45:00.000Z',
                },
              ],
            },
          ],
        },
      ],
      reply: () =>
        Promise.resolve(
          json(
            {
              visit: {
                id: 'visit-new',
                clinicId: 'clinic-1',
                patientId: 'pat-1',
                dentistId: 'den-1',
                appointmentId: 'appt-1',
                status: 'OPEN',
                startedAt: '2026-10-05T14:05:00.000Z',
              },
              appointment: {
                ...ENTRY,
                status: 'IN_TREATMENT',
                visitId: 'visit-new',
              },
            },
            201,
          ),
        ),
    });

    const section = await screen.findByTestId('agenda-planned-treatments');
    await user.click(await within(section).findByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(writes(fetchImplementation)).toHaveLength(1));
    const [url, init] = writes(fetchImplementation)[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/visits`);
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImplementation)).toEqual({ appointmentId: 'appt-1' });

    await waitFor(() =>
      expect(onVisitStarted).toHaveBeenCalledWith({
        visitId: 'visit-new',
        treatmentPlanItemId: 'item-in-progress',
      }),
    );
  });
});
