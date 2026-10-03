/**
 * The searchable, paginated patient list.
 *
 * Search and page are component state rather than router search params: the
 * installed `@tanstack/router-plugin` (1.167.x) generates a route tree without
 * the `Register` augmentation that `@tanstack/router-core` 1.171 reads, so search
 * params would be typed `any` here. The route tree is generated with `@ts-nocheck`,
 * so that gap fails silently. Tracked in docs/open-questions.md; until the plugin
 * is upgraded, list state stays local and the queries stay explicitly typed.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@denti-code-u3/ui';
import { Search } from 'lucide-react';

import { usePatientList } from '../features/patients/hooks/use-patients.js';

const PAGE_SIZE = 20;

/** How long to wait after the last keystroke before querying. */
const SEARCH_DEBOUNCE_MS = 250;

export const Route = createFileRoute('/patients')({
  component: PatientList,
});

function PatientList() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  /**
   * The query runs against the debounced value, so a burst of keystrokes produces
   * one request instead of one per character.
   */
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isPending, error } = usePatientList({
    search: debouncedSearch,
    page,
    limit: PAGE_SIZE,
  });

  const pagination = data?.pagination;
  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
          <p className="text-muted-foreground">
            {pagination ? `${pagination.total} registered` : 'Loading records'}
          </p>
        </div>
        <Button disabled title="Available with patient registration">
          New Patient
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search aria-hidden className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              // Editing the query invalidates the current offset: page 7 of the
              // old result set rarely exists in the new one, and an empty page
              // reads as "no results".
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search by name or record number…"
              aria-label="Search patients"
              className="pl-8"
            />
          </div>

          {isPending ? (
            <ul aria-hidden className="space-y-2">
              {Array.from({ length: 5 }, (_, row) => (
                <li key={row} className="h-14 animate-pulse rounded-lg bg-muted" />
              ))}
            </ul>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              The patient list could not be loaded.
            </p>
          ) : rows.length > 0 ? (
            <>
              <ul className="space-y-2">
                {rows.map((patient) => (
                  <li key={patient.id} className="rounded-lg border">
                    <Link
                      to="/patients/$patientId"
                      params={{ patientId: patient.id }}
                      className="flex items-center justify-between p-3 hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {patient.preferredName ?? `${patient.firstName} ${patient.lastName}`}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {patient.recordNumber ?? 'No record number'}
                          {patient.birthDate ? ` · born ${patient.birthDate}` : ''}
                        </p>
                      </div>
                      {!patient.isActive ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Inactive</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>

              {pagination && pagination.totalPages > 1 ? (
                <nav aria-label="Pagination" className="flex items-center justify-between">
                  <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <Button
                    variant="outline"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </nav>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {debouncedSearch.length > 0
                ? `No patient matches “${debouncedSearch}”.`
                : 'No patients registered yet.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
