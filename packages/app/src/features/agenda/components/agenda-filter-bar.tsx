/**
 * The agenda's filters: which clinicians and which chairs the grid is showing.
 *
 * **The narrowing happens on the server.** A chip does not hide events in the
 * browser — it changes the request, so what the grid draws is the API's answer to
 * "these dentists, these chairs, these days". Fetching the day and filtering it here
 * would be a second implementation of the same question, and the two would agree
 * until the API learned a rule the client had not heard of.
 *
 * **Chips rather than a dropdown** because the lists are short and both matter at
 * once. A clinic has a handful of clinicians and a handful of chairs, the answer to
 * "show me Dr Rivera's day" is one click, and a popover would hide the current
 * selection behind a button. There is no multi-select primitive in `packages/ui`,
 * and adding one for a case that a row of buttons covers would be an abstraction
 * without a second caller.
 *
 * **Every clinician is offered, including one who has left.** Filtering by a
 * clinician who has since departed is the question "what did their day look like",
 * and a list that hid them makes it unanswerable while the grid still draws their
 * appointments — which is why the chips read the full list and the booking dialog
 * reads the active one (see `bookable-resources-query.ts`).
 */

import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

import { useChairs, useDentists } from '../queries/bookable-resources-query.js';
import {
  hasAgendaFilters,
  type AgendaFilters as AgendaSelection,
} from '../queries/agenda-range-query.js';
import { dentistChipColor } from '../dentist-chip-color.js';

export interface AgendaFilterBarProps {
  readonly filters: AgendaSelection;
  readonly onChange: (next: AgendaSelection) => void;
}

export function AgendaFilterBar({ filters, onChange }: AgendaFilterBarProps) {
  // The full lists, not the bookable ones: this bar is a question about history as
  // much as about the future.
  const dentists = useDentists({ onlyActive: false });
  const chairs = useChairs({ onlyActive: false });

  const failed = dentists.isError || chairs.isError;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ChipGroup
          label="Dentists"
          ids={filters.dentistIds}
          onChange={(dentistIds) => onChange({ ...filters, dentistIds })}
          options={(dentists.data?.items ?? []).map((dentist) => ({
            id: dentist.id,
            label: dentist.fullName,
            /** A clinician who has left is still a filter; the suffix says why the day is quiet. */
            detail: dentist.isActive ? undefined : 'inactive',
            color: dentistChipColor(dentist.color),
          }))}
        />

        <ChipGroup
          label="Chairs"
          ids={filters.chairIds}
          onChange={(chairIds) => onChange({ ...filters, chairIds })}
          options={(chairs.data?.items ?? []).map((chair) => ({
            id: chair.id,
            // The room is what tells two identical chairs apart, and it is nullable:
            // a chair with no room says nothing rather than showing an id.
            label: chair.roomName ? `${chair.name} · ${chair.roomName}` : chair.name,
            detail: chair.isActive ? undefined : 'inactive',
          }))}
        />

        {hasAgendaFilters(filters) && (
          <button
            type="button"
            className="rounded-full px-2 py-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onChange({ dentistIds: [], chairIds: [] })}
          >
            Clear filters
          </button>
        )}
      </div>

      {/*
        A failed filter list is not a failed grid, and it must not be drawn as one:
        the appointments on screen are complete and correct, and the user is missing
        a control. Saying so quietly is the accurate report — the alternative is
        silently offering no filters, which reads as "this clinic has one dentist".
      */}
      {failed && (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          role="status"
          data-testid="agenda-filters-unavailable"
        >
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          The filters could not be loaded.
        </p>
      )}
    </div>
  );
}

/**
 * Generic over the id type, so a chip's id stays a `DentistId` or a `ChairId` all
 * the way back to the state that holds it. Widening it to `string` for the row's
 * convenience would push a cast to the caller of every toggle.
 */
interface ChipOption<TId extends string> {
  readonly id: TId;
  readonly label: string;
  readonly detail?: string;
  /** Only ever a validated hex triplet: see `dentist-chip-color.ts`. */
  readonly color?: string;
}

/**
 * One row of toggle chips and an "All" that clears it.
 *
 * Clicking a selected chip clears it rather than opening anything, so a filter is
 * removed the same way it was added. `aria-pressed` carries the state, which means a
 * screen reader announces each chip as a toggle and the row needs no extra wording.
 */
function ChipGroup<TId extends string>({
  label,
  ids,
  onChange,
  options,
}: {
  readonly label: string;
  readonly ids: readonly TId[];
  readonly onChange: (ids: readonly TId[]) => void;
  readonly options: readonly ChipOption<TId>[];
}) {
  // Nothing to choose from yet, or nothing left to choose from: rendering an "All"
  // with no chips under it is a control that does nothing.
  if (options.length === 0) {
    return null;
  }

  const selected = new Set(ids);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Chip pressed={selected.size === 0} onClick={() => onChange([])}>
        All
      </Chip>
      {options.map((option) => (
        <Chip
          key={option.id}
          pressed={selected.has(option.id)}
          onClick={() =>
            onChange(
              selected.has(option.id) ? ids.filter((id) => id !== option.id) : [...ids, option.id],
            )
          }
          color={option.color}
        >
          {option.detail ? `${option.label} (${option.detail})` : option.label}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  color,
  children,
}: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly color?: string;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? 'inline-flex items-center gap-1.5 rounded-full border border-brand-600 bg-brand-500/15 px-2 py-0.5 text-xs text-brand-900'
          : 'inline-flex items-center gap-1.5 rounded-full border border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted'
      }
    >
      {color ? (
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full border border-black/10"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {children}
    </button>
  );
}
