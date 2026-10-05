/**
 * Choosing a patient by name.
 *
 * A controlled combobox over `usePatientList`, so the result a booking dialog shows
 * and a row in the patient list can never disagree — it is the same query, not a
 * second search. The endpoint exists, folds accents and is already used by the header
 * search, so a picker that fetched differently would be a third answer to "who is
 * this patient".
 *
 * **It is a combobox and not a `<select>`.** A clinic has thousands of patients and
 * one of them is in front of the receptionist, who knows two letters of the name. A
 * dropdown of every patient in the clinic is a list nobody scrolls.
 *
 * **Two characters before querying**, the same threshold the header search uses, for
 * the same reason: one character matches most of the clinic, so it is a request that
 * returns a page and answers nothing.
 *
 * **Keyboard support is not decoration here.** The trigger is an ordinary text input,
 * so a screen-reader or keyboard user arrives at it with no way to open a list unless
 * ArrowDown, Enter and Escape work. The active option is tracked with
 * `aria-activedescendant` rather than by moving focus, which keeps the caret in the
 * input while the highlight moves — moving focus into the list would lose the text the
 * user has typed, and the whole point is that they can keep typing to narrow it.
 */

import { useEffect, useRef, useState } from 'react';
import { Input, Label } from '@denti-code-u3/ui';
import { Search } from 'lucide-react';

import { usePatientList } from '../hooks/use-patients.js';

/** Below this the query matches most of the clinic and answers nothing useful. */
const MIN_QUERY_LENGTH = 2;
/** A picker needs a result the eye can scan, not the whole clinic. */
const MAX_RESULTS = 8;

/**
 * A chosen patient: the id the booking needs, and the name to keep showing.
 *
 * Both travel together because the input has to display the name and the form has to
 * store the id, and holding only one of them means the other has to be looked up
 * again. The label is never sent to the API — it is for the person reading the box.
 */
export interface SelectedPatient {
  readonly id: string;
  readonly label: string;
}

export interface PatientPickerProps {
  readonly id: string;
  readonly value: SelectedPatient | undefined;
  /** Called with `undefined` when the choice is cleared. */
  readonly onChange: (patient: SelectedPatient | undefined) => void;
  readonly disabled?: boolean;
  /** Reported by `aria-describedby` when the required field is missing. */
  readonly describedBy?: string;
}

export function PatientPicker({ id, value, onChange, disabled, describedBy }: PatientPickerProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  /** Which option the arrow keys are on. `-1` is "none", which is the closed state. */
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const { data, isFetching } = usePatientList({
    search: trimmed,
    page: 1,
    limit: MAX_RESULTS,
    enabled: trimmed.length >= MIN_QUERY_LENGTH,
  });

  const results = trimmed.length >= MIN_QUERY_LENGTH ? (data?.items ?? []) : [];

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  function choose(patientId: string, patientLabel: string) {
    onChange({ id: patientId, label: patientLabel });
    setQuery('');
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Opening on the first ArrowDown, so a keyboard user never has to guess whether
      // there is a list below the box.
      if (!isOpen || results.length === 0) {
        setIsOpen(true);
        setActiveIndex(results.length > 0 ? 0 : -1);
        return;
      }
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + results.length) % results.length);
      return;
    }

    if (event.key === 'Enter') {
      const active = results[activeIndex];
      if (isOpen && active) {
        // Handled rather than left to submit: Enter in a combobox picks the active
        // option, and letting it submit the form first would book a patient nobody
        // chose.
        event.preventDefault();
        choose(active.id, `${active.firstName} ${active.lastName}`);
      }
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  const listId = `${id}-results`;

  return (
    <div ref={containerRef} className="relative space-y-1">
      <Label htmlFor={id}>
        Patient<span aria-hidden> *</span>
      </Label>
      <Search aria-hidden className="absolute left-2 top-8 h-4 w-4 text-muted-foreground" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={isOpen && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={describedBy}
        aria-activedescendant={
          activeIndex >= 0 && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        className="pl-8"
        disabled={disabled}
        // The chosen name, or whatever is being typed — the id is never shown, and a
        // uuid in a text box helps nobody. `query` wins while it is non-empty, which
        // is what lets a user keep typing to narrow a selection they have made.
        value={query.length > 0 ? query : (value?.label ?? '')}
        placeholder="Search by name…"
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          // The highlight is dropped with every keystroke, because a list that
          // narrowed under a moving highlight would leave "index 3" pointing at a
          // different patient than it did a moment ago — and Enter books whoever that
          // is. Resetting here rather than in an effect on the result count: typing is
          // the only thing that changes the list, and this is where it happens.
          setActiveIndex(-1);
          if (event.target.value.length === 0) {
            // Clearing the box clears the choice, because a form that kept a selected
            // patient behind an emptied search would book someone the user can no
            // longer see.
            onChange(undefined);
          }
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
      />

      {isOpen && trimmed.length >= MIN_QUERY_LENGTH ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Patients"
          data-testid="patient-picker-results"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              {isFetching ? 'Searching…' : `No patient matches “${trimmed}”.`}
            </li>
          ) : (
            results.map((patient, index) => (
              <li
                key={patient.id}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  index === activeIndex ? 'bg-accent' : ''
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // `mousedown`, not `click`: the input loses focus on mousedown, and a
                  // click handler would never fire for a list that closes on blur.
                  event.preventDefault();
                  choose(patient.id, `${patient.firstName} ${patient.lastName}`);
                }}
              >
                {patient.firstName} {patient.lastName}
                {patient.recordNumber ? (
                  <span className="ml-2 text-muted-foreground">{patient.recordNumber}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
