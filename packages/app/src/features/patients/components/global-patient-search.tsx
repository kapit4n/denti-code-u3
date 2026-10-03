/**
 * Global patient search in the app header.
 *
 * The roadmap asks for patient search "from anywhere in the app". It reuses
 * `usePatientList` rather than adding a second endpoint, so a result here and a
 * row in the patient list can never disagree.
 *
 * Two deliberate limits: it needs two characters before querying (a single
 * character matches most of the clinic) and it caps results, because a header
 * dropdown is a shortcut, not the patient list.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Input } from '@denti-code-u3/ui';
import { Search } from 'lucide-react';

import { usePatientList } from '../hooks/use-patients.js';

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 5;

export function GlobalPatientSearch() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const { data } = usePatientList({
    search: trimmed,
    page: 1,
    // Over-fetch slightly so a short result list still fills the dropdown when
    // the query is short enough to match many records.
    limit: MAX_RESULTS * 2,
    // The header search is mounted on every page, so an empty box must not fire a
    // request on every navigation.
    enabled: trimmed.length >= MIN_QUERY_LENGTH,
  });

  const results = trimmed.length >= MIN_QUERY_LENGTH ? (data?.items ?? []) : [];

  // A click anywhere else closes the dropdown. Without this it would stay open
  // over the page content after navigating away.
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

  /** Clears the box on the way out, so returning to the header starts fresh. */
  function closeAfterSelect() {
    setIsOpen(false);
    setQuery('');
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <Search aria-hidden className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder="Search patients…"
        aria-label="Search patients"
        role="combobox"
        aria-expanded={isOpen && results.length > 0}
        aria-controls="global-patient-search-results"
        className="pl-8"
      />

      {isOpen && results.length > 0 ? (
        <ul
          id="global-patient-search-results"
          role="listbox"
          aria-label="Patient results"
          className="absolute right-0 z-50 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md"
        >
          {results.slice(0, MAX_RESULTS).map((patient) => (
            <li key={patient.id} role="option" aria-selected={false}>
              <Link
                to="/patients/$patientId"
                params={{ patientId: patient.id }}
                onClick={closeAfterSelect}
                className="flex w-full flex-col items-start px-3 py-2 text-sm hover:bg-muted"
              >
                <span className="font-medium">
                  {patient.preferredName ?? `${patient.firstName} ${patient.lastName}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {patient.recordNumber ?? 'No record number'}
                  {patient.phone ? ` · ${patient.phone}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {isOpen && trimmed.length >= MIN_QUERY_LENGTH && data && results.length === 0 ? (
        <p className="absolute right-0 z-50 mt-1 w-full rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-md">
          No patient matches “{trimmed}”.
        </p>
      ) : null}
    </div>
  );
}
