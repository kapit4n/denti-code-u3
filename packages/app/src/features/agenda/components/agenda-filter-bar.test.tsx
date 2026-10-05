/**
 * Tests for the agenda's filter bar.
 *
 * What is worth protecting here is not that a chip toggles — that is what a button
 * does — but three decisions that would fail quietly:
 *
 * - **The lists are the full ones, active or not.** A filter that hid the clinician
 *   who has left makes "what did their day look like" unanswerable while the grid
 *   still draws their appointments. The request itself is asserted, because a caller
 *   that silently passed `onlyActive: true` would render a plausible shorter bar.
 * - **The colour is not painted unless it is a hex triplet.** `dentists.color` is
 *   unvalidated text, so a chip that styles itself from it verbatim is an
 *   inline-style injection. The test that matters renders a hostile value and checks
 *   nothing became a style.
 * - **A failed list does not pretend the grid is broken.** The appointments on screen
 *   are complete; what is missing is a control, and the bar says that in its own
 *   words instead of rendering as though the clinic had no filters.
 */

import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useState, type ReactNode } from 'react';
import type { AgendaFilters } from '../queries/agenda-range-query.js';
import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { AgendaFilterBar } from './agenda-filter-bar.js';

const BASE_URL = 'http://api.test/api/v1';

const DENTIST_ACTIVE = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5e';
const DENTIST_GONE = 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const CHAIR = 'c4d5e6f7-8a9b-4c5d-8e7f-8a9b4c5d6e7f';
const CHAIR_NO_ROOM = 'd5e6f7a8-9b0c-4d6e-9f8a-9b0c4d6e7f8a';

const DENTIST = {
  id: DENTIST_ACTIVE,
  fullName: 'Dra. Rivera',
  speciality: 'Endodoncia',
  color: '#0ea5e9',
  isActive: true,
};

/** Left the clinic, and still has appointments on the agenda. */
const DEPARTED_DENTIST = {
  id: DENTIST_GONE,
  fullName: 'Dr. Núñez',
  speciality: null,
  color: null,
  isActive: false,
};

const CHAIRS = [
  { id: CHAIR, roomId: 'room-1', roomName: 'Consultorio 1', name: 'Sillón 2', isActive: true },
  { id: CHAIR_NO_ROOM, roomId: null, roomName: null, name: 'Sillón 3', isActive: true },
];

/**
 * Renders the bar the way the calendar does: state above, the bar below it.
 *
 * A controlled wrapper rather than testing the component's callbacks directly,
 * because the thing being protected is what a user ends up with — a chip that
 * reports a selection nobody stores changes nothing on screen.
 */
function renderFilters({
  dentists = [DENTIST, DEPARTED_DENTIST],
  chairs = CHAIRS,
}: {
  readonly dentists?: unknown[];
  readonly chairs?: unknown[];
} = {}) {
  const fetchImplementation = vi.fn<typeof fetch>((url) => {
    const href = String(url);
    const items = href.includes('/dentists') ? dentists : chairs;

    return Promise.resolve(
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const selections: AgendaFilters[] = [];

  function Harness(): ReactNode {
    const [filters, setFilters] = useState<AgendaFilters>({ dentistIds: [], chairIds: [] });
    selections.push(filters);
    return <AgendaFilterBar filters={filters} onChange={setFilters} />;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <Harness />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { fetchImplementation, selections };
}

/** A bar whose two lists both fail, which is what a stopped API looks like. */
function renderFailingFilters(): void {
  const fetchImplementation = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'no' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        <AgendaFilterBar filters={{ dentistIds: [], chairIds: [] }} onChange={() => undefined} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

/**
 * A chip row, once it exists.
 *
 * Awaited rather than read synchronously: the lists arrive from the API, so on the
 * first paint there is no row at all, and a synchronous lookup here would fail for a
 * reason that has nothing to do with what is being tested.
 */
async function group(name: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name });
}

/**
 * The URL the client asked for on one endpoint, or `undefined` if it never did.
 *
 * Per endpoint rather than "any request": the two lists want different things, and an
 * assertion about the pair cannot tell which one changed.
 */
function requestedUrl(
  fetchImplementation: ReturnType<typeof vi.fn>,
  path: string,
): string | undefined {
  const call = fetchImplementation.mock.calls.find(([url]) => String(url).includes(path));
  return call ? String(call[0]) : undefined;
}

describe('AgendaFilterBar', () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('asks for the full lists, so a clinician who has left can still be filtered on', async () => {
    const { fetchImplementation } = renderFilters();

    await waitFor(() => expect(requestedUrl(fetchImplementation, '/dentists')).toBeDefined());
    await waitFor(() => expect(requestedUrl(fetchImplementation, '/chairs')).toBeDefined());

    // Per endpoint, because a combined "some request asked for everything" passes as
    // soon as *one* of the two does — which is how this assertion survived being
    // mutated from `false` to `true` for the dentists alone and stayed green.
    expect(requestedUrl(fetchImplementation, '/dentists')).toContain('onlyActive=false');
    expect(requestedUrl(fetchImplementation, '/chairs')).toContain('onlyActive=false');

    // `onlyActive=true` is what the booking dialog wants, and it would render a bar
    // that silently cannot show a departed clinician's day.
    expect(requestedUrl(fetchImplementation, '/dentists')).not.toContain('onlyActive=true');
  });

  it('names every clinician, and says which one has left', async () => {
    renderFilters();

    expect(
      within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' }),
    ).toBeInTheDocument();
    // The suffix is the whole reason the full list is asked for: the chip is offered,
    // and the fact that explains an empty day is on the chip.
    expect(
      within(await group('Dentists')).getByRole('button', { name: 'Dr. Núñez (inactive)' }),
    ).toBeInTheDocument();
  });

  it('names a chair with its room, and a chair with none without an empty half', async () => {
    renderFilters();

    const chairs = within(await group('Chairs'));

    // The two exact names are the whole assertion. A `/Sillón/` lookup was here first
    // and matched both chairs, so it failed for a reason that had nothing to do with
    // either: a loose pattern is not a weaker version of a specific one, it is a
    // different question, and it cannot be answered when there is more than one chair.
    expect(chairs.getByRole('button', { name: 'Sillón 2 · Consultorio 1' })).toBeInTheDocument();
    // No room is not an id and not a dangling separator.
    expect(chairs.getByRole('button', { name: 'Sillón 3' })).toBeInTheDocument();
  });

  it('selects and deselects a clinician, and never leaves "All" pressed while a chip is', async () => {
    const { selections } = renderFilters();

    const all = within(await group('Dentists')).getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');

    const rivera = within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' });
    await user.click(rivera);

    expect(selections.at(-1)?.dentistIds).toEqual([DENTIST_ACTIVE]);
    expect(rivera).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');

    await user.click(rivera);

    expect(selections.at(-1)?.dentistIds).toEqual([]);
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });

  it('accumulates several selections in one group', async () => {
    const { selections } = renderFilters();

    await user.click(within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' }));
    await user.click(
      within(await group('Dentists')).getByRole('button', { name: 'Dr. Núñez (inactive)' }),
    );

    // A filter is a set, and the order it was built in is not meaning.
    expect(new Set(selections.at(-1)?.dentistIds)).toEqual(new Set([DENTIST_ACTIVE, DENTIST_GONE]));
  });

  it('clears one group with its own "All" and leaves the other alone', async () => {
    const { selections } = renderFilters();

    await user.click(within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' }));
    await user.click(within(await group('Chairs')).getByRole('button', { name: /Sillón 2/ }));

    await user.click(within(await group('Dentists')).getByRole('button', { name: 'All' }));

    const last = selections.at(-1);
    expect(last?.dentistIds).toEqual([]);
    expect(last?.chairIds).toEqual([CHAIR]);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('offers a way back only while something is narrowed', async () => {
    renderFilters();

    // Nothing selected: a "clear" button would clear nothing.
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    await user.click(within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' }));
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('paints the colour the clinic chose, and only when it is a colour', async () => {
    renderFilters();

    const rivera = within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' });
    // In `rgb()`, not in the `#0ea5e9` the fixture holds: jsdom normalises a CSS
    // colour when it serialises the attribute. Asserting the stored form would mean
    // a test that fails for a reason in the DOM implementation rather than in the
    // component — which is the failure this project keeps meeting from the other
    // side, where the assertion is right and the code is wrong.
    expect(rivera.querySelector('[style]')).toHaveAttribute(
      'style',
      'background-color: rgb(14, 165, 233);',
    );

    // No colour recorded: no swatch rather than an empty one.
    const nunez = within(await group('Dentists')).getByRole('button', {
      name: 'Dr. Núñez (inactive)',
    });
    expect(nunez.querySelector('[style]')).toBeNull();
  });

  it('renders nothing coloured when the stored colour is not a hex triplet', async () => {
    // The column is unvalidated text, so the chip's colour comes from whatever an
    // admin screen last typed.
    //
    // `chartreuse` rather than an injection string, and the reason is worth keeping:
    // the injection string is *also* refused — by the browser's own CSS parser, which
    // rejects a second declaration in a single property — so asserting on it here
    // would be asserting on jsdom. A keyword is a valid CSS colour, so nothing below
    // this component refuses it. The injection string is tested where the assertion is
    // about the function's answer rather than the DOM's: `dentist-chip-color.test.ts`.
    renderFilters({ dentists: [{ ...DENTIST, color: 'chartreuse' }] });

    const rivera = within(await group('Dentists')).getByRole('button', { name: 'Dra. Rivera' });
    expect(rivera.querySelector('[style]')).toBeNull();
  });

  it('says a failed list is a missing control, not a failed day', async () => {
    renderFailingFilters();

    // Waited on, because a component that renders its error state on the first paint
    // would pass this test spuriously.
    expect(await screen.findByTestId('agenda-filters-unavailable')).toHaveTextContent(
      'The filters could not be loaded.',
    );
    expect(screen.queryByRole('group', { name: 'Dentists' })).not.toBeInTheDocument();
  });
});
