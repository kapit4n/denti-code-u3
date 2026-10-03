/**
 * Editing a patient: `/patients/$patientId/edit`.
 *
 * Named `patients_.$patientId_.edit` for the same reason the profile is named
 * `patients_.$patientId` — the underscore opts out of nesting, so this is a
 * sibling page of the profile rather than a child of it. The list and the profile
 * render no `<Outlet />`, so a nested route would render nothing at all.
 *
 * The route loads the patient before showing the form, rather than accepting the
 * values from a link. The alternative — passing them through the URL or through
 * navigation state — would let a page be opened against a record that has since
 * changed or been anonymised, and would make the browser's back button land on a
 * form full of stale values. Loading also means the edit is refused up front
 * instead of after the user has typed.
 *
 * On success it returns to the profile, which has been invalidated by the mutation
 * and so re-reads what was stored.
 */

import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { Button } from '@denti-code-u3/ui';
import { ArrowLeft } from 'lucide-react';

import { usePatient } from '../features/patients/hooks/use-patients.js';
import { PatientEditForm } from '../features/patients/components/patient-edit-form.js';

export const Route = createFileRoute('/patients_/$patientId_/edit')({
  component: PatientEditPage,
});

function PatientEditPage() {
  const { patientId } = Route.useParams();
  const router = useRouter();
  const { data: patient, isPending, error } = usePatient(patientId);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading patient…</p>;
  }

  if (error) {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-destructive">
          {error instanceof Error && 'status' in error && error.status === 404
            ? 'This patient does not exist in the current clinic.'
            : 'The patient record could not be loaded.'}
        </p>
        <BackButton />
      </div>
    );
  }

  if (!patient) {
    return <p className="text-sm text-muted-foreground">No patient selected.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <BackButton />
        <h1 className="text-3xl font-bold tracking-tight">
          Edit {patient.preferredName ?? `${patient.firstName} ${patient.lastName}`}
        </h1>
      </header>

      <PatientEditForm
        patient={patient}
        onSaved={() => {
          // `href`, not `to`. The router's `navigate()` types `to` as a path
          // *descendant* of the current route, and the profile is a tree-sibling: the
          // `_` prefix that keeps it from rendering inside the list also puts it
          // outside this route's subtree. `Link` accepts absolute paths, which is why
          // it is used everywhere a click drives navigation; this is the one place
          // navigation is a consequence of a save rather than a click, so the path is
          // built here. Renaming the profile route means updating this line, and the
          // test below fails if the save stops returning to a real page.
          void router.navigate({ href: `/patients/${encodeURIComponent(patientId)}` });
        }}
        onCancel={() => {
          // `href`, not `to`. The router's `navigate()` types `to` as a path
          // *descendant* of the current route, and the profile is a tree-sibling: the
          // `_` prefix that keeps it from rendering inside the list also puts it
          // outside this route's subtree. `Link` accepts absolute paths, which is why
          // it is used everywhere a click drives navigation; this is the one place
          // navigation is a consequence of a save rather than a click, so the path is
          // built here. Renaming the profile route means updating this line, and the
          // test below fails if the save stops returning to a real page.
          void router.navigate({ href: `/patients/${encodeURIComponent(patientId)}` });
        }}
      />
    </div>
  );
}

function BackButton() {
  const { patientId } = Route.useParams();

  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2">
      <Link to="/patients/$patientId" params={{ patientId }} data-testid="edit-back">
        <ArrowLeft aria-hidden className="size-4" />
        Back to patient
      </Link>
    </Button>
  );
}
