/**
 * Tests for the patient picker.
 *
 * The picker is a combobox built on an ordinary text input, so the things worth
 * asserting are the ones a `<select>` would have given for free and this does not:
 *
 * - **It only asks once the question is answerable.** One character matches most of a
 *   clinic, so a request fired on it is a page of results answering nothing.
 * - **The keyboard can finish the job.** ArrowDown opens and moves, Enter picks,
 *   Escape closes. A screen-reader user arrives at a text box with no button, so
 *   without these the list is unreachable.
 * - **The caret stays in the input.** The highlight moves with
 *   `aria-activedescendant` instead of moving focus, because moving focus out of the
 *   input loses the text that narrowed the list.
 * - **Clearing the box clears the choice.** A form that kept a selected patient
 *   behind an emptied search would book someone the user can no longer see.
 */

import { useState } from 'react';
import { ApiClient } from '@denti-code-u3/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../query/api-client-provider.js';
import { PatientPicker, type SelectedPatient } from './patient-picker.js';

const BASE_URL = 'http://api.test/api/v1';

const ANA = {
  id: 'b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  recordNumber: 'OD-0007',
  firstName: 'Ana',
  lastName: 'Torres',
  isActive: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const BRUNO = {
  id: 'd4e5f6a7-8b9c-4d5e-8f7a-8b9c4d5e6f7a',
  recordNumber: 'OD-0008',
  firstName: 'Bruno',
  lastName: 'Torres',
  isActive: true,
  createdAt: '2026-10-01T12:00:00.000Z',
};

/**
 * The picker wired the way a form uses it: the choice is held by the parent.
 *
 * **Not a spy alone**, because that would test a picker that can only ever show what it
 * was handed at mount — the one thing a controlled component is trusted to do, and the
 * thing most likely to break when someone wires it into a form. The harness re-renders
 * from state and prints the id it is holding, so "the box shows the name" and "the form
 * has the id" are separate assertions about separate owners.
 */
function Harness({
  initial,
  onChange,
}: {
  readonly initial?: SelectedPatient | undefined;
  readonly onChange: (patient: SelectedPatient | undefined) => void;
}) {
  const [selected, setSelected] = useState<SelectedPatient | undefined>(initial);

  return (
    <>
      <PatientPicker
        id="pick"
        value={selected}
        onChange={(patient) => {
          setSelected(patient);
          onChange(patient);
        }}
      />
      <span data-testid="held-id">{selected?.id ?? 'none'}</span>
    </>
  );
}

/** Answers the search endpoint with `items`, and records what was asked for. */
function renderPicker({
  items = [ANA, BRUNO],
  onChange = vi.fn(),
  value,
  describedBy,
}: {
  readonly items?: unknown[];
  readonly onChange?: (patient: SelectedPatient | undefined) => void;
  readonly value?: SelectedPatient | undefined;
  readonly describedBy?: string;
} = {}) {
  const askedFor: string[] = [];
  const fetchImplementation = vi.fn<typeof fetch>((url) => {
    askedFor.push(String(url));
    return Promise.resolve(
      new Response(JSON.stringify({ items }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  const client = new ApiClient({ baseUrl: BASE_URL, fetchImplementation });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider baseUrl={BASE_URL} client={client}>
        {describedBy === undefined ? (
          <Harness initial={value} onChange={onChange} />
        ) : (
          <>
            <PatientPicker id="pick" value={value} onChange={onChange} describedBy={describedBy} />
            <span data-testid="held-id">{value?.id ?? 'none'}</span>
          </>
        )}
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  return { askedFor, onChange };
}

/** The query the search endpoint was last asked. */
function lastQuery(askedFor: string[]): string | undefined {
  return askedFor.at(-1)?.match(/q=([^&]*)/)?.[1];
}

describe('PatientPicker', () => {
  it('asks nothing until the query can answer something', async () => {
    const { askedFor } = renderPicker();
    const input = screen.getByRole('combobox');

    await userEvent.type(input, 'T');

    // One character matches most of the clinic: the answer would be a page and a guess.
    // The threshold is the same one the header search uses, for that reason.
    expect(askedFor).toHaveLength(0);
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.type(input, 'or');

    // Every keystroke past the threshold is its own question, because a receptionist
    // typing "Torres" should see the list narrow rather than wait for a debounce they
    // cannot see. The list of what was asked is the honest assertion here; counting a
    // single request would only be true for a string typed in one go.
    await waitFor(() => expect(askedFor.length).toBeGreaterThan(0));
    expect(askedFor.every((href) => /q=T/.test(href))).toBe(true);
    expect(lastQuery(askedFor)).toBe('Tor');
  });

  it('reports the choice as an id and a name, and shows the name', async () => {
    const { onChange } = renderPicker();

    await userEvent.type(screen.getByRole('combobox'), 'Tor');
    await userEvent.click(await screen.findByRole('option', { name: /Ana Torres/ }));

    // The id is what the booking needs; the name is what the box keeps showing, so a
    // selected patient who then reads "Tor" is not left wondering who is booked.
    expect(onChange).toHaveBeenCalledWith({ id: ANA.id, label: 'Ana Torres' });
    // Two owners, two assertions: the form holds the id, the box holds the name. A
    // picker that kept only the name would make the booking ask the API for a patient
    // it does not have.
    expect(screen.getByTestId('held-id')).toHaveTextContent(ANA.id);
    expect(screen.getByRole('combobox')).toHaveValue('Ana Torres');
  });

  it('opens and moves with the arrow keys, and picks with Enter', async () => {
    const { onChange } = renderPicker();
    const input = screen.getByRole('combobox');

    await userEvent.type(input, 'Tor');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    await userEvent.type(input, '{ArrowDown}');

    // The highlight moves without focus leaving the box: focus is still the input, so
    // the text that narrowed the list is still there to be narrowed further.
    const first = screen.getAllByRole('option')[0];
    expect(input).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first?.id);

    await userEvent.type(input, '{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await userEvent.type(input, '{Enter}');
    expect(onChange).toHaveBeenCalledWith({ id: BRUNO.id, label: 'Bruno Torres' });
  });

  it('reports truthfully whether its list is open', async () => {
    renderPicker();

    // `aria-expanded` is the only thing telling a screen-reader user whether there is
    // anything below the box, so it is asserted in both states rather than left to the
    // implementation.
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    await userEvent.type(input, 'Tor');
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
  });

  it('closes on Escape without choosing anybody', async () => {
    const { onChange } = renderPicker();

    await userEvent.type(screen.getByRole('combobox'), 'Tor');
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument());

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // Escape is "stop looking", not "book nobody": the field is untouched.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the choice when the box is emptied', async () => {
    const onChange = vi.fn();
    renderPicker({ onChange, value: { id: ANA.id, label: 'Ana Torres' } });

    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('Ana Torres');

    await userEvent.clear(input);

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('says so when nothing matches, rather than showing an empty box', async () => {
    renderPicker({ items: [] });

    await userEvent.type(screen.getByRole('combobox'), 'Zzz');

    expect(await screen.findByText(/No patient matches/)).toBeInTheDocument();
  });

  it('links its error message so it is read with the field', () => {
    renderPicker({ describedBy: 'pick-error' });

    // Announced through `aria-describedby` rather than only sitting next to the box, so
    // a screen-reader user hears the reason with the field instead of having to go and
    // find it.
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 'pick-error');
  });
});
