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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  allowedAppointmentTransitions,
  type AgendaEntry,
  type Clinic,
} from '@denti-code-u3/domain';
import { asAppointmentId, asChairId, asDentistId, asPatientId } from '@denti-code-u3/types';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
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

function renderPanel({
  entry = ENTRY,
  reply,
  onClose = vi.fn(),
}: {
  readonly entry?: AgendaEntry;
  readonly reply?: () => Promise<Response>;
  readonly onClose?: () => void;
} = {}) {
  const fetchImplementation = vi.fn<typeof fetch>(
    reply ??
      (() =>
        Promise.resolve(
          new Response(JSON.stringify({ ...entry, status: 'ARRIVED' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )),
  );
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <AppointmentQuickPanel entry={entry} clinic={CLINIC} onClose={onClose} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, onClose };
}

/** The body of the nth request, as JSON. */
function sentBody(fetchImplementation: ReturnType<typeof vi.fn>, index = 0): unknown {
  const call = fetchImplementation.mock.calls[index];
  if (!call) throw new Error(`Expected a request number ${index + 1}`);
  return JSON.parse(String(call[1]?.body));
}

describe('AppointmentQuickPanel', () => {
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

  it('sends the transition and closes once the server has agreed', async () => {
    const user = userEvent.setup();
    const { fetchImplementation, onClose } = renderPanel();

    await user.click(screen.getByTestId('transition-ARRIVED'));

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/appointments/appt-1/status`);
    expect(init?.method).toBe('POST');
    expect(sentBody(fetchImplementation)).toEqual({ to: 'ARRIVED' });

    // The panel is not closed optimistically: the grid is redrawn from the server's
    // answer, and only then is there nothing left to look at.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('asks why before it cancels, and sends the reason', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-CANCELLED'));

    // Cancelling is the one move that cannot be undone by re-booking the slot, so the
    // first click asks rather than sends.
    expect(fetchImplementation).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText('Why is it being cancelled?'),
      'The patient called to cancel',
    );
    await user.click(screen.getByTestId('confirm-cancellation'));

    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
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

    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('lets the receptionist back out of cancelling', async () => {
    const user = userEvent.setup();
    const { fetchImplementation } = renderPanel();

    await user.click(screen.getByTestId('transition-CANCELLED'));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    // Back to the other moves, with nothing sent and nothing lost.
    expect(fetchImplementation).not.toHaveBeenCalled();
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

    await waitFor(() => expect(screen.getByTestId('transition-ARRIVED')).toBeDisabled());
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
  });

  it('shows the notes the appointment carries', () => {
    renderPanel({ entry: { ...ENTRY, notes: 'Bring the crown from the lab' } });

    expect(screen.getByText('Bring the crown from the lab')).toBeTruthy();
  });
});
